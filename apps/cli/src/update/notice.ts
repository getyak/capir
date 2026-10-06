/**
 * Bounded automatic update check and one-line stderr notice.
 *
 * Scope: ONLY ordinary human interactive commands and the chat TUI may run
 * this path. Help, --version, doctor, update, --json, --noninteractive and
 * non-TTY/script invocations never initiate network. The check is capped at
 * two seconds with unref'd timers (no leaked handles), writes at most one
 * cache file (~24h TTL, auto-check only — explicit `capir update --check`
 * never reads or writes it), prints to stderr only, never touches
 * credentials, and never installs anything. Failures are silent: the main
 * command's result is never delayed, changed or polluted.
 *
 * Managed installs only: an unmanaged source checkout is never auto-checked.
 * Disable entirely with CAPIR_DISABLE_UPDATE_CHECK=1.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { configDirectory } from "../config.js";
import type { FetchLike } from "../http.js";
import { readVersion } from "../version.js";
import {
  CAPIR_RELEASE_PUBLIC_KEY,
  CHANNEL_MANIFEST_URL,
  CHANNEL_SIGNATURE_URL,
  compareVersions,
} from "./manifest.js";
import { resolveInstall } from "./layout.js";
import { fetchChannelManifest } from "./release.js";
import { hostPlatform } from "./platform.js";

export const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_CHECK_MAX_MS = 2000;

export interface UpdateCheckCache {
  checked_at: string;
  latest: string;
  tag: string;
}

export interface NoticeDeps {
  env: NodeJS.ProcessEnv;
  fetchImpl: FetchLike;
  invokedBinary: string;
  interactive: boolean;
  now?: () => Date;
  platform?: string;
  trustPublicKey?: string;
  channelManifestUrl?: string;
  channelSignatureUrl?: string;
  cachePath?: string;
  writeStderr?: (text: string) => void;
}

/**
 * Eligibility from the RAW argv. Every exclusion flag ANYWHERE in the
 * invocation suppresses the network check: trailing `--json`, `--help`,
 * `-h`, `--version` and `--noninteractive` always win. Flag VALUES are
 * skipped value-aware, so a literal value of a value flag (e.g. `--system
 * --json`) is never treated as an exclusion flag.
 */
export function updateNoticeEligible(argv: string[]): boolean {
  const rest = argv[0] === "--" ? argv.slice(1) : [...argv];
  // The CLI's offline help/version resolver handles these tokens anywhere,
  // including in an otherwise malformed value position.
  if (rest.some((token) => ["-h", "--help", "--version"].includes(token))) return false;
  const VALUE_FLAGS = new Set([
    "profile", "model", "system", "max-tokens", "timeout", "provider",
    "base-url", "api-key-env", "auth", "token-limit-field", "system-role",
    "env", "client-label", "username", "password", "expires-in", "preset",
    "request-id", "open", "receipt-dir", "wait", "role", "scenario",
    "model-policy", "duration-hours", "surface",
  ]);
  const EXCLUSION_FLAGS = new Set(["-h", "--help", "--version", "--json", "--noninteractive"]);
  let index = 0;
  let literal = false;
  let command: string | undefined;
  while (index < rest.length) {
    const token = rest[index]!;
    if (!literal && token === "--") {
      literal = true;
      index += 1;
      continue;
    }
    if (!literal && token.startsWith("-")) {
      if (EXCLUSION_FLAGS.has(token)) return false;
      // Value-aware: the next token is this flag's value, never a flag.
      index += VALUE_FLAGS.has(token.slice(2)) ? 2 : 1;
      continue;
    }
    command ??= token;
    index += 1;
  }
  if (command === undefined) return false;
  if (["help", "doctor", "update", "models"].includes(command)) return false;
  // ask, chat, auth, sandbox, test and literal prompts are ordinary commands.
  return true;
}

function cachePathFor(deps: NoticeDeps): string {
  return deps.cachePath ?? join(configDirectory(deps.env), "update-check.json");
}

function readCache(path: string): UpdateCheckCache | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as UpdateCheckCache;
    if (
      !raw ||
      typeof raw !== "object" ||
      typeof raw.checked_at !== "string" ||
      typeof raw.latest !== "string" ||
      typeof raw.tag !== "string" ||
      Number.isNaN(Date.parse(raw.checked_at))
    )
      return null;
    return raw;
  } catch {
    return null;
  }
}

function writeCache(path: string, cache: UpdateCheckCache): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // The cache is best-effort; a read-only config directory never breaks a command.
  }
}

function noticeLine(current: string, latest: string): string {
  return `capir: update ${latest} is available (installed ${current}). Run "capir update".\n`;
}

/**
 * Run the bounded check and print at most one stderr notice. Never throws and
 * never delays the caller beyond UPDATE_CHECK_MAX_MS.
 */
export async function maybePrintUpdateNotice(deps: NoticeDeps): Promise<void> {
  try {
    if (!deps.interactive) return;
    if (deps.env.CAPIR_DISABLE_UPDATE_CHECK === "1") return;
    const platform = (() => {
      try {
        return deps.platform ?? hostPlatform();
      } catch {
        return null;
      }
    })();
    if (!platform) return;
    const resolution = resolveInstall(deps.invokedBinary, deps.env, platform);
    if (resolution.method !== "managed") return; // auto-check is managed-only

    const now = deps.now ? deps.now() : new Date();
    const current = readVersion();
    const path = cachePathFor(deps);
    const cached = readCache(path);
    const write = (latest: string, tag: string): void =>
      writeCache(path, { checked_at: now.toISOString(), latest, tag });

    if (cached && now.getTime() - Date.parse(cached.checked_at) < UPDATE_CHECK_TTL_MS) {
      if (compareVersions(cached.latest, current) > 0)
        (deps.writeStderr ?? ((text: string) => process.stderr.write(text)))(
          noticeLine(current, cached.latest),
        );
      return;
    }

    // Stale cache: one bounded network check sharing ONE deadline and ONE
    // AbortController across the manifest and signature fetches; any failure
    // or deadline abort is silent and leaves no request running.
    const trustKey = deps.trustPublicKey ?? CAPIR_RELEASE_PUBLIC_KEY;
    const controller = new AbortController();
    const result = await withDeadline(UPDATE_CHECK_MAX_MS, controller, () =>
      fetchChannelManifest(
        {
          fetchImpl: deps.fetchImpl,
          timeoutMs: Math.max(1, Math.min(1500, UPDATE_CHECK_MAX_MS - 250)),
          signal: controller.signal,
        },
        {
          manifest: deps.channelManifestUrl ?? CHANNEL_MANIFEST_URL,
          signature: deps.channelSignatureUrl ?? CHANNEL_SIGNATURE_URL,
        },
        trustKey,
        platform,
      ),
    );
    if (!result) return; // deadline: silent
    write(result.manifest.version, result.manifest.tag);
    if (compareVersions(result.manifest.version, current) > 0)
      (deps.writeStderr ?? ((text: string) => process.stderr.write(text)))(
        noticeLine(current, result.manifest.version),
      );
  } catch {
    // Silent: automatic checking must never affect the main command.
  }
}

/**
 * Hard deadline wrapper: one shared AbortController is aborted on timeout and
 * in finally, the unref'd timer is always cleared, and the caller observes
 * null the moment the budget expires — no request outlives the deadline.
 */
function withDeadline<T>(
  ms: number,
  controller: AbortController,
  run: () => Promise<T>,
): Promise<T | null> {
  return new Promise((resolveDone) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      controller.abort();
      resolveDone(null);
    }, ms);
    timer.unref();
    const finish = (value: T | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      controller.abort();
      resolveDone(value);
    };
    run().then(finish, () => finish(null));
  });
}
