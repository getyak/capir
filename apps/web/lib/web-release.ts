import { isGitRevision } from "@talent-signal/contracts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The active Web release identity.
 *
 * A resident checkout writes `.next/talent-signal-release.json` with a Git
 * `revision` (and a separate `buildID`); a platform deployment exposes
 * `VERCEL_GIT_COMMIT_SHA`. Only a validated hex Git revision is used. A
 * receipt `buildID` or a `commit` label is never treated as a revision, and
 * neither source is guessed from a package manifest. When neither is available
 * the identity is `null`, which the Versions pane renders as unknown.
 */
export type WebReleaseSource = "release_file" | "vercel_git_commit_sha";

export type WebReleaseIdentity = {
  revision: string;
  source: WebReleaseSource;
};

export const WEB_RELEASE_FILE = ".next/talent-signal-release.json";
const MAX_RELEASE_METADATA_BYTES = 4_096;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Only a Git `revision` counts; `buildID`/`commit` are never a revision. */
export function parseWebReleaseMetadata(
  value: unknown,
): WebReleaseIdentity | null {
  const item = record(value);
  if (!item) return null;
  return isGitRevision(item.revision)
    ? { revision: item.revision.toLowerCase(), source: "release_file" }
    : null;
}

/** A Vercel commit SHA is a bounded hex Git revision; anything else is unknown. */
export function vercelRevision(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return isGitRevision(trimmed) ? trimmed.toLowerCase() : null;
}

export function readWebReleaseIdentity(
  dependencies: {
    cwd?: string;
    env?: Readonly<Record<string, string | undefined>>;
    readFile?: (path: string) => string;
  } = {},
): WebReleaseIdentity | null {
  const environment = dependencies.env ?? process.env;
  const cwd = dependencies.cwd ?? process.cwd();
  const readFile =
    dependencies.readFile ?? ((path: string) => readFileSync(path, "utf8"));
  try {
    const raw = readFile(join(cwd, WEB_RELEASE_FILE));
    if (raw.length <= MAX_RELEASE_METADATA_BYTES) {
      const identity = parseWebReleaseMetadata(JSON.parse(raw));
      if (identity) return identity;
    }
  } catch {
    /* An absent or malformed receipt falls through to the platform revision. */
  }
  const revision = vercelRevision(environment.VERCEL_GIT_COMMIT_SHA);
  return revision ? { revision, source: "vercel_git_commit_sha" } : null;
}
