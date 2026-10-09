/**
 * `capir update` command family: --check, apply, --rollback.
 *
 * Runs with NO --env and NO credential: it never resolves a test environment,
 * never loads the keyring, and never sends credentials anywhere. Machine
 * callers get the stable JSON envelope; humans get readable text. The update
 * family is routed before model parsing so no model ever sees these keywords.
 */
import { CapirCliError, EXIT } from "../errors.js";
import type { FetchLike } from "../http.js";
import { readVersion } from "../version.js";
import {
  CAPIR_RELEASE_PUBLIC_KEY,
  CHANNEL_MANIFEST_URL,
  CHANNEL_SIGNATURE_URL,
  compareVersions,
  RELEASE_BASE_URL,
  type ReleaseManifest,
} from "./manifest.js";
import {
  resolveInstall,
  UNMANAGED_INSTALL_GUIDANCE,
  type InstallResolution,
} from "./layout.js";
import { fetchChannelManifest, type ReleaseTransport } from "./release.js";
import { hostPlatform } from "./platform.js";
import {
  performRollback,
  performUpdate,
  type UpdateOutcome,
} from "./transaction.js";

export type UpdateMode = "check" | "apply" | "rollback";

export interface UpdateCommandDeps {
  env: NodeJS.ProcessEnv;
  fetchImpl: FetchLike;
  /** Absolute path of the executed CLI script; drives managed-root binding. */
  invokedBinary: string;
  /** Explicit test trust key; production omits this and uses the committed key. */
  trustPublicKey?: string;
  channelManifestUrl?: string;
  channelSignatureUrl?: string;
  requestTimeoutMs?: number;
  lockTimeoutMs?: number;
  now?: () => Date;
  platform?: string;
}

export interface UpdatePayload extends Record<string, unknown> {
  current: string;
  latest: string | null;
  update_available: boolean;
  install_method: "managed" | "unmanaged";
  source: string;
  action: "checked" | "updated" | "already-current" | "rolled-back";
  current_version?: string;
  previous_version?: string | null;
  version_dir?: string;
  launcher?: string;
  guidance?: string;
}

export interface UpdateCommandResult {
  payload: UpdatePayload;
  humanOutput: string;
}

function sourceUrl(manifest: ReleaseManifest): string {
  return `${RELEASE_BASE_URL}/tag/${manifest.tag}`;
}

function transport(deps: UpdateCommandDeps): ReleaseTransport {
  return {
    fetchImpl: deps.fetchImpl,
    ...(deps.requestTimeoutMs === undefined ? {} : { timeoutMs: deps.requestTimeoutMs }),
  };
}

function channelUrls(deps: UpdateCommandDeps): { manifest: string; signature: string } {
  return {
    manifest: deps.channelManifestUrl ?? CHANNEL_MANIFEST_URL,
    signature: deps.channelSignatureUrl ?? CHANNEL_SIGNATURE_URL,
  };
}

function requireManaged(resolution: InstallResolution): NonNullable<InstallResolution["managed"]> {
  if (resolution.method !== "managed" || !resolution.managed) {
    throw new CapirCliError(
      "CAPIR_UPDATE_UNMANAGED",
      EXIT.INFRASTRUCTURE,
      `This capir install is unmanaged (${resolution.reason}); the updater never modifies source checkouts or package-manager files.\n${UNMANAGED_INSTALL_GUIDANCE}`,
    );
  }
  return resolution.managed;
}

function readRunningVersion(): string {
  return readVersion();
}

async function fetchVerified(
  deps: UpdateCommandDeps,
  trustKey: string,
  platform: string,
) {
  return fetchChannelManifest(transport(deps), channelUrls(deps), trustKey, platform);
}

export async function runUpdateCheck(deps: UpdateCommandDeps): Promise<UpdateCommandResult> {
  const trustKey = deps.trustPublicKey ?? CAPIR_RELEASE_PUBLIC_KEY;
  const platform = deps.platform ?? hostPlatform();
  const resolution = resolveInstall(deps.invokedBinary, deps.env, platform);
  // The running version: the managed invoked version when managed (bound to
  // the physical binary path), else the executed package's own version.
  const current = resolution.managed?.invokedVersion ?? readRunningVersion();
  const { manifest } = await fetchVerified(deps, trustKey, platform);
  const updateAvailable = compareVersions(manifest.version, current) > 0;
  const payload: UpdatePayload = {
    action: "checked",
    current,
    latest: manifest.version,
    update_available: updateAvailable,
    install_method: resolution.method,
    source: sourceUrl(manifest),
  };
  if (resolution.method === "unmanaged") payload.guidance = UNMANAGED_INSTALL_GUIDANCE;
  return {
    payload,
    humanOutput: [
      `capir update check`,
      `  installed:      ${current}`,
      `  latest stable:  ${manifest.version}`,
      `  update:         ${updateAvailable ? "available" : "none"}`,
      `  install method: ${resolution.method}`,
      `  source:         ${sourceUrl(manifest)}`,
      ...(resolution.method === "unmanaged" ? ["", UNMANAGED_INSTALL_GUIDANCE] : []),
    ].join("\n"),
  };
}

export async function runUpdateApply(deps: UpdateCommandDeps): Promise<UpdateCommandResult> {
  const platform = deps.platform ?? hostPlatform();
  const trustKey = deps.trustPublicKey ?? CAPIR_RELEASE_PUBLIC_KEY;
  const resolution = resolveInstall(deps.invokedBinary, deps.env, platform);
  const managed = requireManaged(resolution);

  const { manifest, asset } = await fetchVerified(deps, trustKey, platform);
  // Every explicit apply enters the same lock, runs crash recovery and
  // re-reads the actual state/current link — there is NO command-level
  // already-current shortcut. An interrupted activation (state published,
  // link still old) must be repaired and reported accurately here, and a
  // stale manifest must never downgrade a newer committed version.
  const outcome: UpdateOutcome = await performUpdate(managed, { manifest, asset }, {
    fetchImpl: deps.fetchImpl,
    ...(deps.requestTimeoutMs === undefined ? {} : { timeoutMs: deps.requestTimeoutMs }),
    trustPublicKey: trustKey,
    ...(deps.lockTimeoutMs === undefined ? {} : { lockTimeoutMs: deps.lockTimeoutMs }),
    ...(deps.now ? { now: deps.now } : {}),
  });
  const payload: UpdatePayload = {
    action: outcome.action === "already-current" ? "already-current" : "updated",
    current: outcome.current_version,
    latest: manifest.version,
    update_available: compareVersions(manifest.version, outcome.current_version) > 0,
    install_method: "managed",
    source: sourceUrl(manifest),
    current_version: outcome.current_version,
    previous_version: outcome.previous_version,
    version_dir: outcome.version_dir,
    launcher: outcome.launcher,
  };
  return {
    payload,
    humanOutput:
      outcome.action === "already-current"
        ? [
            "capir update",
            `  already at ${outcome.current_version}; latest stable is ${manifest.version}.`,
            "  Nothing was written.",
          ].join("\n")
        : [
            "capir update",
            `  updated:      ${outcome.previous_version ?? "(none)"} -> ${outcome.current_version}`,
            `  version dir:  ${outcome.version_dir}`,
            `  launcher:     ${outcome.launcher}`,
            `  smoke:        --version, --help and native keyring verified from the bundled runtime`,
            "",
            "  Running sessions keep their current version; the update applies to the next invocation.",
          ].join("\n"),
  };
}

export async function runUpdateRollback(deps: UpdateCommandDeps): Promise<UpdateCommandResult> {
  const platform = deps.platform ?? hostPlatform();
  const resolution = resolveInstall(deps.invokedBinary, deps.env, platform);
  const managed = requireManaged(resolution);
  const outcome = await performRollback(managed, {
    ...(deps.lockTimeoutMs === undefined ? {} : { lockTimeoutMs: deps.lockTimeoutMs }),
  });
  const payload: UpdatePayload = {
    action: "rolled-back",
    current: outcome.current_version,
    latest: null,
    update_available: false,
    install_method: "managed",
    source: "local",
    current_version: outcome.current_version,
    previous_version: outcome.previous_version,
    version_dir: outcome.version_dir,
    launcher: outcome.launcher,
  };
  return {
    payload,
    humanOutput: [
      "capir update --rollback",
      `  current:      ${outcome.current_version}`,
      `  version dir:  ${outcome.version_dir}`,
      `  launcher:     ${outcome.launcher}`,
      "",
      "  Running sessions keep their current version; the rollback applies to the next invocation.",
    ].join("\n"),
  };
}

export async function runUpdateCommand(
  mode: UpdateMode,
  deps: UpdateCommandDeps,
): Promise<UpdateCommandResult> {
  if (mode === "check") return runUpdateCheck(deps);
  if (mode === "rollback") return runUpdateRollback(deps);
  return runUpdateApply(deps);
}
