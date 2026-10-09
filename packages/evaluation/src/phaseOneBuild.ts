import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { digestCanonicalJson } from "./digest.js";
import { phaseOneAssert } from "./phaseOneDataset.js";

function fileDigest(path: string): string { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function digestTrees(root: string, paths: readonly string[], extensions: readonly string[]) {
  const files: Array<{ path: string; digest: string }> = [];
  const walk = (path: string) => {
    const stat = lstatSync(path);
    phaseOneAssert(!stat.isSymbolicLink(), "PHASE_ONE_BUILD_SYMLINK_REJECTED");
    if (stat.isDirectory()) for (const item of readdirSync(path).sort()) walk(join(path, item));
    else if (stat.isFile() && extensions.some(extension => path.endsWith(extension))) files.push({ path: relative(root, path).replaceAll("\\", "/"), digest: fileDigest(path) });
  };
  for (const path of paths) walk(join(root, path));
  phaseOneAssert(files.length > 0, "PHASE_ONE_BUILD_FILES_UNAVAILABLE");
  return digestCanonicalJson(files.sort((a, b) => a.path.localeCompare(b.path)));
}

/** Hashes the emitted code the backend actually loads; capture once at process startup. */
export function phaseOneRuntimeBuildDigest(root: string) {
  return digestTrees(root, ["apps/agent/dist", "apps/backend/dist", "packages/contracts/dist", "packages/evaluation/dist"], [".js"]);
}

/** Includes verifier code and tests as well as runtime source, manifests and the locked dependency graph.
 * The private evaluation harness is intentionally excluded: product runtime source identity is frozen
 * independently of the extracted evaluation repository, so a harness-only change cannot re-sign a product
 * proof and an old signed proof cannot claim validity for changed product source. */
export function phaseOneImplementationSourceDigest(root: string) {
  return digestTrees(root, ["apps/agent/src", "apps/backend/src", "packages/contracts/src", "packages/evaluation/src",
    "apps/agent/package.json", "apps/backend/package.json", "packages/contracts/package.json", "packages/evaluation/package.json",
    "pnpm-lock.yaml", ".github/workflows/ci.yml"], [".ts", ".sql", ".json", ".yaml", ".yml", ".py"]);
}
