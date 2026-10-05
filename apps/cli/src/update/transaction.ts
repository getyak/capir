/**
 * Transactional managed-install operations: fresh install, version A->B
 * update, and rollback.
 *
 * Locking and ordering: ONE ProcessLock covers recovery + every mutation,
 * and state.json is re-read after the lock is held. state.json is the commit
 * record; the `current` symlink is derived and repaired toward it. Because
 * recovery only flips the symlink (never rewrites state from a stale read),
 * a stale recovery can never overwrite a concurrently committed version.
 *
 * Update ordering (crash-recoverable):
 *   1. under the lock: recover the symlink, re-read state, and RECHECK the
 *      manifest version against current_version (never downgrade; a stale or
 *      slow older fetch can not overwrite a newer committed version);
 *   2. download capped bodies into <root>/staging/<uuid>/;
 *   3. verify signed manifest + sha256 + byte size + version/platform;
 *   4. validate tar paths and the physical link graph, extract into staging;
 *   5. smoke the bundled CLI (--version, --help, keyring) in a clean env;
 *   6. publish the version directory by atomic rename (never overwrite an
 *      existing version directory; a reused one is validated and smoked at
 *      its actual location first — recorded hashes are never trusted alone);
 *   7. write state.json atomically (current/previous ordering preserved);
 *   8. switch the `current` symlink atomically and read the result back.
 *
 * Install additionally PREFLIGHTS the launcher conflict inside the same lock
 * before activation: any install failure preserves the old current, state and
 * launcher. Old versions are never deleted; the rollback target and running
 * sessions (which resolved one physical version at exec) stay intact.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  lstatSync,
  readdirSync,
  realpathSync,
  writeFileSync,
  openSync,
  readSync,
  closeSync,
  cpSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import { CapirCliError, EXIT } from "../errors.js";
import type { FetchLike } from "../http.js";
import { ProcessLock } from "../lock.js";
import {
  applyLauncher,
  currentLinkPath,
  INSTALL_STATE_SCHEMA_VERSION,
  lockPath,
  planLauncher,
  readState,
  stagingDirectory,
  statePath,
  versionDirectory,
  versionsDirectory,
  writeState,
  type InstallState,
  type LauncherPlan,
  type ManagedInstall,
} from "./layout.js";
import { compareVersions, type ReleaseAsset, type ReleaseManifest } from "./manifest.js";
import {
  ARCHIVE_MAX_BYTES,
  fetchCapped,
  verifyArchiveFile,
} from "./release.js";
import { smokePortableTree } from "./smoke.js";
import { extractTarGz, validateLinkGraph, type LinkNode } from "./tar.js";

export interface PortableTreeInfo {
  version: string;
  platform: string;
  node_version: string;
  revision: string;
  built_at: string;
}

export interface UpdateTransport {
  fetchImpl: FetchLike;
  timeoutMs?: number;
  /** Explicit test trust key dependency; production uses the committed key. */
  trustPublicKey: string;
  lockTimeoutMs?: number;
  now?: () => Date;
}

export interface UpdateOutcome {
  action: "updated" | "already-current" | "installed";
  previous_version: string | null;
  current_version: string;
  version_dir: string;
  launcher: string;
  reused_existing_version: boolean;
  smoke: { help_bytes: number; keyring: "loaded" };
}

const EXPECTED_TREE_ENTRIES = new Set(["node", "package", "LICENSES", "build-info.json"]);

function infra(code: string, message: string): CapirCliError {
  return new CapirCliError(code, EXIT.INFRASTRUCTURE, message);
}

/** Recover an unrecorded publish only when it exactly matches verified staging. */
function samePortableTree(left: string, right: string): boolean {
  const digest = (path: string): string => {
    const file = openSync(path, "r");
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
      let count;
      while ((count = readSync(file, buffer, 0, buffer.length, null)) > 0)
        hash.update(buffer.subarray(0, count));
      return hash.digest("hex");
    } finally {
      closeSync(file);
    }
  };
  const compare = (a: string, b: string, root = false): boolean => {
    const x = lstatSync(a);
    const y = lstatSync(b);
    // Extraction-root permissions are local policy, not an archive entry.
    if (!root && (x.mode & 0o777) !== (y.mode & 0o777)) return false;
    if (x.isSymbolicLink()) return y.isSymbolicLink() && readlinkSync(a) === readlinkSync(b);
    if (x.isFile()) return y.isFile() && x.size === y.size && digest(a) === digest(b);
    if (!x.isDirectory() || !y.isDirectory()) return false;
    const names = readdirSync(a).sort();
    const other = readdirSync(b).sort();
    return names.length === other.length &&
      names.every((name, index) => name === other[index] && compare(join(a, name), join(b, name)));
  };
  try {
    return compare(left, right, true);
  } catch {
    return false;
  }
}

/** Read and validate the portable tree's build info against the signed manifest. */
export function readBuildInfo(tree: string): PortableTreeInfo {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(tree, "build-info.json"), "utf8"));
  } catch {
    throw infra("CAPIR_UPDATE_ARCHIVE_UNSAFE", "Portable tree has no readable build-info.json.");
  }
  const info = raw as PortableTreeInfo;
  if (
    !info ||
    typeof info !== "object" ||
    typeof info.version !== "string" ||
    typeof info.platform !== "string" ||
    typeof info.node_version !== "string" ||
    typeof info.revision !== "string" ||
    typeof info.built_at !== "string"
  )
    throw infra("CAPIR_UPDATE_ARCHIVE_UNSAFE", "Portable tree build-info.json is malformed.");
  return info;
}

/**
 * Validate an extracted (or already installed) portable tree: expected
 * top-level layout plus the full physical link-graph confinement proof over
 * the real tree (chains, nested hops and cycles included). Files may never
 * live under symlink ancestors.
 */
export function validatePortableTree(tree: string): void {
  const root = resolve(tree);
  for (const name of readdirSync(root)) {
    if (!EXPECTED_TREE_ENTRIES.has(name))
      throw infra("CAPIR_UPDATE_ARCHIVE_UNSAFE", `Portable tree contains unexpected entry "${name}".`);
  }
  const nodes: LinkNode[] = [];
  const walk = (directory: string): void => {
    for (const name of readdirSync(directory)) {
      const full = join(directory, name);
      const rel = relative(root, full).split(sep).join("/");
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) {
        nodes.push({ path: rel, type: "symlink", linkTarget: readlinkSync(full) });
      } else if (stat.isDirectory()) {
        nodes.push({ path: rel, type: "directory" });
        walk(full);
      } else if (stat.isFile()) {
        nodes.push({ path: rel, type: "file" });
      } else {
        throw infra(
          "CAPIR_UPDATE_ARCHIVE_UNSAFE",
          `Portable tree entry "${rel}" is a device/fifo/other special file; refused.`,
        );
      }
    }
  };
  walk(root);
  validateLinkGraph(nodes, "portable tree");
}

function assertManifestTreeBinding(
  tree: string,
  manifest: ReleaseManifest,
  asset: ReleaseAsset,
): PortableTreeInfo {
  const info = readBuildInfo(tree);
  if (info.version !== manifest.version)
    throw infra("CAPIR_UPDATE_ARCHIVE_UNSAFE", "Portable tree version does not match the signed manifest.");
  if (info.platform !== asset.platform)
    throw infra("CAPIR_UPDATE_ARCHIVE_UNSAFE", "Portable tree platform does not match the signed manifest.");
  if (info.node_version !== manifest.node_version)
    throw infra("CAPIR_UPDATE_ARCHIVE_UNSAFE", "Portable tree runtime version does not match the signed manifest.");
  if (info.revision !== manifest.source_commit)
    throw infra("CAPIR_UPDATE_ARCHIVE_UNSAFE", "Portable tree revision does not match the signed manifest.");
  return info;
}

/** Atomic `current` switch + readback; state.json is written first. */
function activateVersion(root: string, state: InstallState): void {
  writeState(root, state);
  switchCurrentLink(root, state.current_version);
}

/**
 * Activation with rollback: when state publication or the link switch fails,
 * the previous state is restored and the launcher change undone so the old
 * current, state and launcher all keep working. If the restore itself fails,
 * crash-recovery semantics take over on the next locked run (state.json is
 * the commit record and the symlink is repaired toward it).
 */
function activateVersionRecoverable(
  root: string,
  state: InstallState,
  previous: InstallState | null,
  undoLauncher?: () => void,
): void {
  try {
    activateVersion(root, state);
  } catch (error) {
    try {
      if (previous) writeState(root, previous);
      else rmSync(statePath(root), { force: true });
    } catch {
      /* crash recovery converges on the next locked run */
    }
    try {
      undoLauncher?.();
    } catch {
      /* the launcher backup is preserved either way */
    }
    throw error;
  }
}

/** Flip only the derived symlink; never writes state (stale-recovery safe). */
function switchCurrentLink(root: string, version: string): void {
  const link = currentLinkPath(root);
  const temporary = `${link}.new-${process.pid}-${randomUUID().slice(0, 8)}`;
  try {
    symlinkSync(join("versions", version), temporary);
    renameSync(temporary, link);
  } finally {
    rmSync(temporary, { force: true });
  }
  // Readback: the physical target must be exactly the intended version dir.
  const resolved = realpathSync(link);
  const expected = realpathSync(versionDirectory(root, version));
  if (resolved !== expected)
    throw infra("CAPIR_UPDATE_STATE_MISMATCH", "current symlink did not read back to the published version.");
}

/**
 * Crash recovery, called ONLY while holding the install lock after re-reading
 * state: repair the symlink toward state.json's current_version. It never
 * writes state, so a stale recovery can never roll back a committed version.
 */
function recoverLocked(root: string): InstallState | null {
  const state = readState(root);
  if (!state) return null;
  const intended = versionDirectory(root, state.current_version);
  if (!existsSync(intended))
    throw infra(
      "CAPIR_UPDATE_MANAGED_METADATA_MISMATCH",
      `Managed state names version ${state.current_version} but ${intended} is missing; nothing was changed.`,
    );
  let resolved = "";
  try {
    resolved = realpathSync(currentLinkPath(root));
  } catch {
    resolved = "";
  }
  if (resolved !== realpathSync(intended)) switchCurrentLink(root, state.current_version);
  return state;
}

function nextInstallState(
  root: string,
  previous: InstallState | null,
  platform: string,
  launcher: string,
  version: string,
  sha256: string,
  now: Date,
): InstallState {
  const versions = { ...(previous?.versions ?? {}) };
  versions[version] = { sha256, installed_at: now.toISOString() };
  const currentVersion = previous?.current_version;
  return {
    schema_version: INSTALL_STATE_SCHEMA_VERSION,
    install_root: realpathSync(root),
    platform,
    launcher,
    current_version: version,
    previous_version:
      currentVersion && currentVersion !== version
        ? currentVersion
        : (previous?.previous_version ?? null),
    versions,
  };
}

/**
 * Publish a verified staged tree as a managed install (installer entry path).
 * Runs entirely under the install lock: launcher conflicts are preflighted
 * BEFORE any activation so every failure preserves the old current, state and
 * launcher. A reused version directory is validated and smoked at its actual
 * location; its recorded sha256 is never trusted alone.
 */
export async function installPortable(options: {
  tree: string;
  archivePath: string;
  manifest: ReleaseManifest;
  asset: ReleaseAsset;
  installRoot: string;
  binDir: string;
  replaceExisting: boolean;
  transport: UpdateTransport;
}): Promise<UpdateOutcome> {
  const { tree, archivePath, manifest, asset, installRoot: requestedInstallRoot, binDir, replaceExisting, transport } = options;
  await verifyArchiveFile(archivePath, asset);
  assertManifestTreeBinding(tree, manifest, asset);
  validatePortableTree(tree);
  const stagedSmoke = await smokePortableTree(tree, manifest.version);

  mkdirSync(versionsDirectory(requestedInstallRoot), { recursive: true, mode: 0o700 });
  // Save metadata and generate launcher bytes from one physical root, even
  // when the user's install-root path contains directory symlinks.
  const installRoot = realpathSync(requestedInstallRoot);
  return withLock(installRoot, transport, async () => {
    const existingState = readState(installRoot);
    const launcherPath = join(binDir, "capir");
    // Preflight the launcher ownership/conflict decision BEFORE activation.
    const launcherPlan: LauncherPlan = planLauncher(launcherPath, installRoot, replaceExisting);

    const target = versionDirectory(installRoot, manifest.version);
    let reused = false;
    let smoke = stagedSmoke;
    if (existsSync(target)) {
      const recorded = existingState?.versions[manifest.version];
      if (recorded ? recorded.sha256 !== asset.sha256 : !samePortableTree(tree, target))
        throw infra(
          "CAPIR_UPDATE_VERSION_CONFLICT",
          `Version ${manifest.version} already exists at ${target} with different or unrecorded contents; refusing to overwrite. Remove it explicitly or install another version.`,
        );
      // Never trust recorded hashes or the staged smoke for a previously
      // installed target: validate and smoke the ACTUAL version directory.
      validatePortableTree(target);
      assertManifestTreeBinding(target, manifest, asset);
      smoke = await smokePortableTree(target, manifest.version);
      reused = true;
    } else {
      try {
        renameSync(tree, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
        // TMPDIR and HOME can be on different volumes. Recheck and smoke a
        // private copy on the destination filesystem before atomic publish.
        const local = join(stagingDirectory(installRoot), randomUUID());
        mkdirSync(local, { recursive: true, mode: 0o700 });
        const copiedTree = join(local, "tree");
        try {
          cpSync(tree, copiedTree, { recursive: true, verbatimSymlinks: true });
          validatePortableTree(copiedTree);
          assertManifestTreeBinding(copiedTree, manifest, asset);
          smoke = await smokePortableTree(copiedTree, manifest.version);
          renameSync(copiedTree, target);
        } finally {
          rmSync(local, { recursive: true, force: true });
        }
      }
    }

    const launcherApply = applyLauncher(launcherPlan, installRoot);
    const state = nextInstallState(
      installRoot,
      existingState,
      asset.platform,
      launcherPath,
      manifest.version,
      asset.sha256,
      transport.now ? transport.now() : new Date(),
    );
    activateVersionRecoverable(installRoot, state, existingState, launcherApply.undo);
    return {
      action: "installed" as const,
      previous_version: state.previous_version,
      current_version: state.current_version,
      version_dir: target,
      launcher: state.launcher,
      reused_existing_version: reused,
      smoke: { help_bytes: smoke.help_bytes, keyring: smoke.keyring },
    };
  });
}

/** Managed A->B update driven by an already-resolved managed install. */
export async function performUpdate(
  managed: ManagedInstall,
  verified: { manifest: ReleaseManifest; asset: ReleaseAsset },
  transport: UpdateTransport,
): Promise<UpdateOutcome> {
  const { manifest, asset } = verified;
  const root = managed.root;
  return withLock(root, transport, async () => {
    // Recovery and state reads happen ONLY under the held lock.
    const current = recoverLocked(root);
    if (!current)
      throw infra(
        "CAPIR_UPDATE_MANAGED_METADATA_MISMATCH",
        "Managed state.json disappeared during the update; nothing was changed.",
      );
    // Recheck the manifest version against the committed current version:
    // a slow or stale fetch can never downgrade or overwrite a newer version.
    if (compareVersions(manifest.version, current.current_version) <= 0) {
      return {
        action: "already-current" as const,
        previous_version: current.previous_version,
        current_version: current.current_version,
        version_dir: versionDirectory(root, current.current_version),
        launcher: current.launcher,
        reused_existing_version: true,
        smoke: { help_bytes: 0, keyring: "loaded" as const },
      };
    }

    mkdirSync(stagingDirectory(root), { recursive: true, mode: 0o700 });
    const staging = join(stagingDirectory(root), randomUUID());
    mkdirSync(staging, { recursive: true, mode: 0o700 });
    const archivePath = join(staging, asset.filename);
    try {
      const bytes = await fetchCapped(
        {
          fetchImpl: transport.fetchImpl,
          ...(transport.timeoutMs === undefined ? {} : { timeoutMs: transport.timeoutMs }),
        },
        asset.url,
        Math.min(asset.size, ARCHIVE_MAX_BYTES),
      );
      writeFileSync(archivePath, bytes, { mode: 0o600 });
      await verifyArchiveFile(archivePath, asset);
      const tree = join(staging, "tree");
      await extractTarGz(archivePath, tree);
      assertManifestTreeBinding(tree, manifest, asset);
      validatePortableTree(tree);
      const stagedSmoke = await smokePortableTree(tree, manifest.version);

      // Re-read state under the lock right before activation; the version
      // recheck above stays valid because nothing else can commit meanwhile.
      const latest = readState(root);
      if (!latest || latest.current_version !== current.current_version)
        throw infra(
          "CAPIR_UPDATE_MANAGED_METADATA_MISMATCH",
          "Managed state changed concurrently during the update; nothing was activated.",
        );

      const target = versionDirectory(root, manifest.version);
      let reused = false;
      let smoke = stagedSmoke;
      if (existsSync(target)) {
        const recorded = latest.versions[manifest.version];
        if (recorded ? recorded.sha256 !== asset.sha256 : !samePortableTree(tree, target))
          throw infra(
            "CAPIR_UPDATE_VERSION_CONFLICT",
            `Version ${manifest.version} is already present with different or unrecorded contents; refusing to overwrite.`,
          );
        validatePortableTree(target);
        assertManifestTreeBinding(target, manifest, asset);
        smoke = await smokePortableTree(target, manifest.version);
        reused = true;
      } else {
        renameSync(tree, target);
      }
      const state = nextInstallState(
        root,
        latest,
        asset.platform,
        latest.launcher,
        manifest.version,
        asset.sha256,
        transport.now ? transport.now() : new Date(),
      );
      activateVersionRecoverable(root, state, latest);
      return {
        action: "updated" as const,
        previous_version: state.previous_version,
        current_version: state.current_version,
        version_dir: target,
        launcher: state.launcher,
        reused_existing_version: reused,
        smoke: { help_bytes: smoke.help_bytes, keyring: smoke.keyring },
      };
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });
}

export interface RollbackOutcome {
  previous_version: string | null;
  current_version: string;
  version_dir: string;
  launcher: string;
}

/** Roll `current` back to the recorded previous version; never deletes anything. */
export async function performRollback(
  managed: ManagedInstall,
  transport: Pick<UpdateTransport, "lockTimeoutMs"> = {},
): Promise<RollbackOutcome> {
  const root = managed.root;
  return withLock(root, transport, async () => {
    const current = recoverLocked(root);
    if (!current)
      throw infra("CAPIR_UPDATE_MANAGED_METADATA_MISMATCH", "Managed state.json disappeared; nothing was changed.");
    const target = current.previous_version;
    if (!target)
      throw infra(
        "CAPIR_UPDATE_NO_PREVIOUS",
        "No previous managed version is recorded; there is nothing to roll back to.",
      );
    const targetDir = versionDirectory(root, target);
    if (!existsSync(targetDir))
      throw infra(
        "CAPIR_UPDATE_NO_PREVIOUS",
        `The recorded previous version ${target} is not present under ${versionsDirectory(root)}; nothing was changed.`,
      );
    // The rollback target is validated and smoked at its actual location
    // before activation; a corrupted target never becomes current.
    validatePortableTree(targetDir);
    await smokePortableTree(targetDir, target);
    const state: InstallState = {
      ...current,
      current_version: target,
      previous_version: current.current_version,
    };
    activateVersionRecoverable(root, state, current);
    return {
      previous_version: state.previous_version,
      current_version: state.current_version,
      version_dir: targetDir,
      launcher: state.launcher,
    };
  });
}

/** One lock boundary for recovery + mutation; contention maps to a stable error. */
async function withLock<T>(
  root: string,
  transport: Pick<UpdateTransport, "lockTimeoutMs">,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = new ProcessLock(lockPath(root), {
    acquireTimeoutMs: transport.lockTimeoutMs ?? 60_000,
  });
  try {
    return await lock.runAsync(operation);
  } catch (error) {
    if (error instanceof Error && error.message.includes("is held by another process"))
      throw new CapirCliError(
        "CAPIR_UPDATE_LOCK_HELD",
        EXIT.INFRASTRUCTURE,
        `Another install, update or rollback holds the managed lock for ${root}; retry after it finishes. Nothing was changed.`,
      );
    throw error;
  }
}

export function versionIsNewer(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}
