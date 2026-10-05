/**
 * Managed install layout and metadata binding.
 *
 * Layout (default root `~/.local/share/capir`, installer override
 * CAPIR_INSTALL_DIR; launcher `~/.local/bin/capir`, override CAPIR_BIN_DIR):
 *
 *   <root>/state.json                  managed metadata (strict schema, atomic writes)
 *   <root>/current -> versions/<v>     atomic switch symlink
 *   <root>/versions/<v>/{node,package,LICENSES,build-info.json}
 *   <root>/staging/<uuid>/             download + extraction workspace
 *   <root>/.update-lock.sqlite         process lock mutex file
 *
 * The launcher resolves `current` to ONE physical version directory before
 * exec, so an atomic switch can never mix a runtime from one version with JS
 * from another, and exports its fixed CAPIR_INSTALL_DIR so nested resolution
 * always agrees with the install it serves.
 *
 * Metadata binds the invoked binary path and platform to the install root:
 * the root is derived from the ACTUAL physical invoked script (inside
 * <root>/versions/<version>/), never from an environment variable alone. A
 * `capir` invocation is "managed" only when the executed script physically
 * lives inside that versions tree, the state file agrees on root + platform +
 * launcher, and the invoked version is a recorded member. Everything else
 * (source checkout, package-manager install, copied binary) is "unmanaged"
 * and must never be updated in place.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { CapirCliError, EXIT } from "../errors.js";

export const INSTALL_STATE_SCHEMA_VERSION = "capir-install-state.v1";
export const LAUNCHER_MARKER = "# capir managed launcher (capir-launcher.v1)";
export const DEFAULT_INSTALL_DIR = ".local/share/capir";
export const DEFAULT_BIN_DIR = ".local/bin";

const SEMVER_KEY = /^\d+\.\d+\.\d+$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export interface InstalledVersion {
  sha256: string;
  installed_at: string;
}

export interface InstallState {
  schema_version: typeof INSTALL_STATE_SCHEMA_VERSION;
  /** Physical install root; binds every other claim to one real directory. */
  install_root: string;
  platform: string;
  launcher: string;
  current_version: string;
  previous_version: string | null;
  versions: Record<string, InstalledVersion>;
}

export type InstallMethod = "managed" | "unmanaged";

export interface ManagedInstall {
  root: string;
  state: InstallState;
  /** Physical path of the executed CLI script. */
  invokedBinary: string;
  /** Version directory of the executed CLI script (physical). */
  invokedVersion: string;
  launcher: string;
}

export interface InstallResolution {
  method: InstallMethod;
  /** Why an install is unmanaged; machine-stable reason codes. */
  reason:
    | "not-under-install-root"
    | "no-state"
    | "state-root-mismatch"
    | "state-platform-mismatch"
    | "launcher-mismatch"
    | "version-not-recorded";
  managed?: ManagedInstall;
  /** Human-readable safe installation guidance for unmanaged installs. */
  guidance: string;
}

export function defaultInstallRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CAPIR_INSTALL_DIR?.trim();
  return override || join(homedir(), DEFAULT_INSTALL_DIR);
}

export function defaultBinDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CAPIR_BIN_DIR?.trim();
  return override || join(homedir(), DEFAULT_BIN_DIR);
}

export function versionsDirectory(root: string): string {
  return join(root, "versions");
}

export function versionDirectory(root: string, version: string): string {
  return join(versionsDirectory(root), version);
}

export function statePath(root: string): string {
  return join(root, "state.json");
}

export function currentLinkPath(root: string): string {
  return join(root, "current");
}

export function stagingDirectory(root: string): string {
  return join(root, "staging");
}

export function lockPath(root: string): string {
  return join(root, ".update-lock.sqlite");
}

/**
 * Strict state parsing: every field is validated, unknown keys are refused.
 * A state file that deviates in any way is treated as missing (unmanaged),
 * never partially trusted.
 */
export function parseInstallState(raw: unknown): InstallState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  if (keys !== "current_version,install_root,launcher,platform,previous_version,schema_version,versions")
    return null;
  if (record.schema_version !== INSTALL_STATE_SCHEMA_VERSION) return null;
  if (typeof record.install_root !== "string" || !isAbsolute(record.install_root)) return null;
  if (typeof record.platform !== "string" || !/^(darwin|linux)-(arm64|x64)$/.test(record.platform))
    return null;
  if (typeof record.launcher !== "string" || !isAbsolute(record.launcher)) return null;
  if (typeof record.current_version !== "string" || !SEMVER_KEY.test(record.current_version))
    return null;
  const previous = record.previous_version;
  if (previous !== null && (typeof previous !== "string" || !SEMVER_KEY.test(previous)))
    return null;
  const versions = record.versions;
  if (!versions || typeof versions !== "object" || Array.isArray(versions)) return null;
  const parsedVersions: Record<string, InstalledVersion> = {};
  for (const [version, entry] of Object.entries(versions as Record<string, unknown>)) {
    if (!SEMVER_KEY.test(version)) return null;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const value = entry as Record<string, unknown>;
    const entryKeys = Object.keys(value).sort().join(",");
    if (entryKeys !== "installed_at,sha256") return null;
    if (typeof value.sha256 !== "string" || !SHA256_HEX.test(value.sha256)) return null;
    if (typeof value.installed_at !== "string" || Number.isNaN(Date.parse(value.installed_at)))
      return null;
    parsedVersions[version] = { sha256: value.sha256, installed_at: value.installed_at };
  }
  if (!parsedVersions[record.current_version]) return null;
  return {
    schema_version: INSTALL_STATE_SCHEMA_VERSION,
    install_root: record.install_root,
    platform: record.platform,
    launcher: record.launcher,
    current_version: record.current_version,
    previous_version: previous as string | null,
    versions: parsedVersions,
  };
}

export function readState(root: string): InstallState | null {
  try {
    return parseInstallState(JSON.parse(readFileSync(statePath(root), "utf8")));
  } catch {
    return null;
  }
}

/** Atomic metadata write: temp file in the same directory then rename. */
export function writeState(root: string, state: InstallState): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const target = statePath(root);
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, target);
}

/**
 * The exact launcher content for one install root. `#!/bin/sh` must be the
 * FIRST line so the kernel executes it directly. The launcher resolves
 * `current` to one physical version before exec and exports its fixed
 * CAPIR_INSTALL_DIR for anything it spawns.
 */
export function launcherScript(installRoot: string): string {
  return [
    "#!/bin/sh",
    LAUNCHER_MARKER,
    "# Replaced only by the capir installer; it resolves `current` to one",
    "# physical version before exec so an atomic switch cannot mix runtimes.",
    "set -eu",
    `install_root=${shellQuote(installRoot)}`,
    "CAPIR_INSTALL_DIR=\"$install_root\"",
    "export CAPIR_INSTALL_DIR",
    'version_dir="$(CDPATH= cd -- "$install_root/current" 2>/dev/null && pwd -P)" || {',
    '  printf \'%s\\n\' "capir: managed install at $install_root has no current version; rerun the installer." >&2',
    "  exit 3",
    "}",
    'exec "$version_dir/node/bin/node" "$version_dir/package/dist/cli.js" "$@"',
    "",
  ].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * Ownership check is exact-content: a launcher this install root owns is
 * byte-identical to the generated script. Marker or root substring matches in
 * an arbitrary user script never count as ownership.
 */
export function isManagedLauncher(text: string, installRoot: string): boolean {
  return text === launcherScript(installRoot);
}

export type LauncherPlan = {
  mode: "write" | "backup-and-write";
  launcher: string;
  backup?: string;
  /** Byte-exact prior content, or null when no file existed. */
  previous: Buffer | null;
  /** Prior executable bit; restored by undo. */
  previousMode: number;
  /** Original symlink identity, including a dangling link. */
  previousLink?: string;
};

export interface LauncherApply {
  backup?: string;
  /** Restore the previous launcher entry byte-exactly; the backup is kept. */
  undo(): void;
}

/**
 * Preflight the launcher write BEFORE any state or symlink change: an
 * unrelated or custom launcher is never silently replaced. Only the explicit
 * `--replace-existing` flag may back it up and proceed. Runs inside the
 * install/update lock ahead of activation. Ownership is exact-content, so a
 * user script that merely contains the marker and root substring is never
 * mistaken for the managed launcher.
 */
export function planLauncher(
  launcher: string,
  installRoot: string,
  replaceExisting: boolean,
): LauncherPlan {
  // A launcher may live at root/bin, but never within mutable version or
  // staging trees: those directories have a different lifecycle.
  for (const reserved of [versionsDirectory(installRoot), join(installRoot, "current"), stagingDirectory(installRoot)]) {
    if (isInside(reserved, launcher) || isInside(physical(reserved), physical(launcher)))
      throw new CapirCliError("CAPIR_UPDATE_LAUNCHER_CONFLICT", EXIT.INFRASTRUCTURE,
        "Launcher directory cannot be inside capir versions, current or staging. Choose a separate bin directory.");
  }
  let entry;
  try {
    entry = lstatSync(launcher);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { mode: "write", launcher, previous: null, previousMode: 0o755 };
  }
  const previousLink = entry.isSymbolicLink() ? readlinkSync(launcher) : undefined;
  const text = previousLink !== undefined && !existsSync(launcher)
    ? null
    : readFileSync(launcher);
  const previousMode = entry.mode & 0o777;
  const linkIdentity = previousLink === undefined ? {} : { previousLink };
  if (text !== null && isManagedLauncher(text.toString("utf8"), installRoot)) {
    return { mode: "write", launcher, previous: text, previousMode, ...linkIdentity };
  }
  if (!replaceExisting) {
    throw new CapirCliError(
      "CAPIR_UPDATE_LAUNCHER_CONFLICT",
      EXIT.INFRASTRUCTURE,
      `${launcher} exists and is not the managed capir launcher for ${installRoot}. The installer never replaces unrelated or custom launchers; rerun with --replace-existing to back it up first. Nothing was installed.`,
    );
  }
  return {
    mode: "backup-and-write",
    launcher,
    backup: `${launcher}.capir-backup-${new Date().toISOString().replaceAll(":", "-")}`,
    previous: text,
    previousMode,
    ...linkIdentity,
  };
}

/**
 * Execute a preflighted launcher plan (still before activation). The new
 * content is fully prepared as a temp file BEFORE the original is touched,
 * and any commit failure restores the original entry. The returned undo()
 * restores the previous entry byte-exactly (backup preserved) so a later
 * activation failure can roll the launcher back with the install state.
 */
export function applyLauncher(plan: LauncherPlan, installRoot: string): LauncherApply {
  const backup = plan.mode === "backup-and-write" ? plan.backup! : undefined;
  const undo = (): void => {
    if (plan.previousLink !== undefined) {
      const restored = `${plan.launcher}.restore-${process.pid}`;
      try {
        symlinkSync(plan.previousLink, restored);
        renameSync(restored, plan.launcher);
      } finally {
        rmSync(restored, { force: true });
      }
      return;
    }
    if (plan.previous === null) {
      rmSync(plan.launcher, { force: true });
      return;
    }
    writeFileSync(plan.launcher, plan.previous, { mode: plan.previousMode });
    chmodSync(plan.launcher, plan.previousMode);
  };

  // 1. Prepare the replacement completely; the original is untouched so far.
  mkdirSync(dirname(plan.launcher), { recursive: true });
  const temporary = `${plan.launcher}.tmp-${process.pid}`;
  rmSync(temporary, { force: true });
  writeFileSync(temporary, launcherScript(installRoot), { mode: 0o755 });
  chmodSync(temporary, 0o755);

  // 2. Commit: back the original up first, then swap the temp into place.
  try {
    if (backup) renameSync(plan.launcher, backup);
    renameSync(temporary, plan.launcher);
  } catch (error) {
    rmSync(temporary, { force: true });
    try {
      undo();
    } catch {
      /* restore is best-effort; the failing error below is authoritative */
    }
    throw error;
  }
  return backup === undefined ? { undo } : { backup, undo };
}

/**
 * Backwards-compatible direct path: preflight then apply with no undo kept.
 * Used by callers without a later activation step.
 */
export function installLauncher(
  launcher: string,
  installRoot: string,
  replaceExisting: boolean,
): { launcher: string; backup?: string } {
  const plan = planLauncher(launcher, installRoot, replaceExisting);
  const applied = applyLauncher(plan, installRoot);
  return applied.backup === undefined
    ? { launcher }
    : { launcher, backup: applied.backup };
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function physical(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    // A planned launcher may not exist yet; resolve its existing ancestors
    // so a bin-directory symlink cannot hide a reserved version path.
    const absolute = resolve(path), parent = dirname(absolute);
    return parent === absolute ? absolute : join(physical(parent), basename(absolute));
  }
}

export const UNMANAGED_INSTALL_GUIDANCE = [
  "This capir runs from an unmanaged location (source checkout or package-manager install).",
  "The updater never modifies source checkouts or package-manager files.",
  "Install a managed standalone copy instead:",
  "  curl -fsSL https://github.com/getyak/capir/releases/download/capir-stable/install.sh -o capir-install.sh",
  "  sh capir-install.sh",
  "Then run the managed launcher (default ~/.local/bin/capir) and retry `capir update`.",
].join("\n");

/**
 * Resolve the managed install that owns the invoked binary. The root is bound
 * to the ACTUAL physical invoked script: it must live at
 * <root>/versions/<version>/... for an existing version directory. The
 * environment override alone never proves anything and is not consulted here.
 */
export function resolveInstall(
  invokedBinaryPath: string,
  _env: NodeJS.ProcessEnv = process.env,
  platform: string = `${process.platform}-${process.arch}`,
): InstallResolution {
  const unmanaged = (reason: InstallResolution["reason"]): InstallResolution => ({
    method: "unmanaged",
    reason,
    guidance: UNMANAGED_INSTALL_GUIDANCE,
  });

  const invoked = physical(invokedBinaryPath);
  const separator = `${sep}versions${sep}`;
  const marker = invoked.lastIndexOf(separator);
  if (marker <= 0) return unmanaged("not-under-install-root");
  const root = invoked.slice(0, marker);
  const rest = invoked.slice(marker + separator.length);
  const separatorIndex = rest.indexOf(sep);
  const invokedVersion = separatorIndex === -1 ? rest : rest.slice(0, separatorIndex);
  if (!SEMVER_KEY.test(invokedVersion)) return unmanaged("not-under-install-root");
  if (!existsSync(versionDirectory(root, invokedVersion)))
    return unmanaged("not-under-install-root");

  const state = readState(root);
  if (!state) return unmanaged("no-state");
  if (physical(state.install_root) !== physical(root)) return unmanaged("state-root-mismatch");
  if (state.platform !== platform) return unmanaged("state-platform-mismatch");
  const launcherPhysical = physical(state.launcher);
  if (isInside(versionsDirectory(root), launcherPhysical) || isInside(stagingDirectory(root), launcherPhysical))
    return unmanaged("launcher-mismatch");
  if (isInside(root, launcherPhysical)) {
    try {
      if (!isManagedLauncher(readFileSync(state.launcher, "utf8"), state.install_root))
        return unmanaged("launcher-mismatch");
    } catch { return unmanaged("launcher-mismatch"); }
  }
  if (!state.versions[invokedVersion]) return unmanaged("version-not-recorded");

  return {
    method: "managed",
    reason: "not-under-install-root",
    managed: { root, state, invokedBinary: invoked, invokedVersion, launcher: state.launcher },
    guidance: "",
  };
}

export function exists(path: string): boolean {
  return existsSync(path);
}

export function lstatIsSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}
