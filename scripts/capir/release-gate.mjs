#!/usr/bin/env node
/**
 * Release reference gate for the capir standalone release workflow.
 *
 * Publish-time validation (trusted tag push / workflow_dispatch only):
 *   - the release version is strict semver and the tag is exactly capir-v<version>;
 *   - apps/cli/package.json carries that exact version;
 *   - the source revision is clean and matches the checked-out commit;
 *   - the tagged commit is on main ancestry (never a side branch).
 *
 *   node scripts/capir/release-gate.mjs validate --tag capir-v0.2.0 [--revision <sha>]
 *   node scripts/capir/release-gate.mjs validate --version 0.2.0 [--revision <sha>]
 *   node scripts/capir/release-gate.mjs check-version --tag capir-v0.2.0   (no git)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SEMVER = /^\d+\.\d+\.\d+$/;

export function versionFromTag(tag) {
  const match = /^capir-v(\d+\.\d+\.\d+)$/.exec(tag);
  if (!match) throw new Error(`tag must be capir-vX.Y.Z, got "${tag}"`);
  return match[1];
}

export function packageVersion(repoRoot = REPO_ROOT) {
  return JSON.parse(readFileSync(join(repoRoot, "apps", "cli", "package.json"), "utf8")).version;
}

export function checkVersionConsistency({ tag, version, repoRoot = REPO_ROOT }) {
  const resolved = version ?? versionFromTag(tag ?? "");
  if (tag && versionFromTag(tag) !== resolved)
    throw new Error(`tag ${tag} does not match version ${resolved}`);
  if (!SEMVER.test(resolved)) throw new Error(`version must be strict semver, got "${resolved}"`);
  const packaged = packageVersion(repoRoot);
  if (packaged !== resolved)
    throw new Error(`apps/cli/package.json version ${packaged} != release version ${resolved}`);
  return resolved;
}

function git(args, repoRoot = REPO_ROOT) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

export function checkCleanRevision({ revision, repoRoot = REPO_ROOT }) {
  const status = git(["status", "--porcelain"], repoRoot);
  if (status !== "") throw new Error(`source tree is not clean:\n${status}`);
  const head = git(["rev-parse", "HEAD"], repoRoot);
  if (revision && revision !== head)
    throw new Error(`checked-out revision ${head} does not match the release revision ${revision}`);
  return head;
}

export function checkTagOnMain({ tag, repoRoot = REPO_ROOT }) {
  const tagCommit = git(["rev-parse", `${tag}^{commit}`], repoRoot);
  let onMain = false;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", tagCommit, "origin/main"], {
      cwd: repoRoot,
      stdio: "pipe",
    });
    onMain = true;
  } catch {
    onMain = false;
  }
  if (!onMain) {
    try {
      execFileSync("git", ["merge-base", "--is-ancestor", tagCommit, "main"], {
        cwd: repoRoot,
        stdio: "pipe",
      });
      onMain = true;
    } catch {
      onMain = false;
    }
  }
  if (!onMain) throw new Error(`tag ${tag} commit ${tagCommit} is not on main ancestry`);
  return tagCommit;
}

/**
 * Release source binding: the checked-out HEAD must BE the tagged commit.
 * A clean tree at a different revision never publishes a tag's release.
 */
export function checkHeadMatchesTag({ tag, repoRoot = REPO_ROOT }) {
  const tagCommit = git(["rev-parse", `${tag}^{commit}`], repoRoot);
  const head = git(["rev-parse", "HEAD"], repoRoot);
  if (head !== tagCommit)
    throw new Error(`HEAD ${head} is not the tagged commit ${tagCommit} for ${tag}; refusing to publish`);
  return head;
}

function main(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let index = 0; index < rest.length; index += 2) values[rest[index].slice(2)] = rest[index + 1];
  if (command === "check-version") {
    const version = checkVersionConsistency({
      ...(values.tag ? { tag: values.tag } : {}),
      ...(values.version ? { version: values.version } : {}),
    });
    process.stdout.write(`version consistent: ${version}\n`);
    return;
  }
  if (command === "validate") {
    const version = checkVersionConsistency({
      ...(values.tag ? { tag: values.tag } : {}),
      ...(values.version ? { version: values.version } : {}),
    });
    const head = checkCleanRevision({ ...(values.revision ? { revision: values.revision } : {}) });
    if (!values.tag)
      throw new Error("validate requires --tag capir-vX.Y.Z (dispatch resolves the exact tag)");
    const tagCommit = checkTagOnMain({ tag: values.tag });
    checkHeadMatchesTag({ tag: values.tag });
    process.stdout.write(
      `release gate ok: ${values.tag} (version ${version}, commit ${tagCommit}, head ${head})\n`,
    );
    return;
  }
  process.stderr.write("usage: release-gate.mjs validate|check-version [--tag capir-vX.Y.Z] [--version X.Y.Z] [--revision <sha>]\n");
  process.exit(2);
}


/** True when executed as a script (realpath comparison survives symlinked tmp paths). */
function isMainModule(metaUrl) {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

if (process.argv[1] && isMainModule(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
