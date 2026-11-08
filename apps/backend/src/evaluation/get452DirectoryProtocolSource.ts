import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { requireProtocol } from "./get452DirectoryProtocolHost.js";

const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const git = (repo: string, args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 2 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).trim();
const scopes = ["apps/web", "apps/backend/src", "packages/contracts", "packages/agent", "apps/agent", "packages/workspace-ui", "pnpm-lock.yaml", "package.json", ".github/workflows/ci.yml"];
const artifacts = ["BUILD_ID", "build-manifest.json", "server/app-paths-manifest.json", "required-server-files.json"];
export async function bindDirectorySource() {
  const repo = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  const web = join(repo, "apps/web"), requireWeb = createRequire(join(web, "package.json"));
  const head = git(repo, ["rev-parse", "HEAD"]);
  requireProtocol(/^[0-9a-f]{40}$/.test(head) && head === process.env.GITHUB_SHA, "SOURCE_HEAD");
  const installed: Record<string, string> = {};
  const declared = JSON.parse(await readFile(join(web, "package.json"), "utf8")) as { dependencies: Record<string, string> };
  for (const name of ["next", "react", "react-dom", "next-auth"]) {
    const value = JSON.parse(await readFile(requireWeb.resolve(`${name}/package.json`), "utf8")) as { version: unknown };
    requireProtocol(typeof value.version === "string" && value.version === declared.dependencies[name], "FRAMEWORK_SELECTION");
    installed[name] = value.version;
  }
  async function observation() {
    requireProtocol(git(repo, ["diff", "--name-only", "HEAD", "--", ...scopes]) === "", "SOURCE_DIRTY");
    requireProtocol(!git(repo, ["ls-files", "-v", "--", ...scopes]).split("\n").some(line => /^[a-zS]/.test(line)), "SOURCE_SKIPPED");
    const build: Record<string, string> = {};
    for (const name of artifacts) {
      const path = join(web, ".next", name);
      requireProtocol((await realpath(path)).startsWith(join(web, ".next") + "/"), "BUILD_PATH");
      build[name] = hash(await readFile(path));
    }
    return {
      head: git(repo, ["rev-parse", "HEAD"]),
      rootTree: git(repo, ["rev-parse", "HEAD^{tree}"]),
      trees: Object.fromEntries(["apps/web", "apps/backend/src", "packages/contracts"].map(path => [path, git(repo, ["rev-parse", `HEAD:${path}`])])),
      lockSha256: hash(await readFile(join(repo, "pnpm-lock.yaml"))), build,
    };
  }
  const original = await observation();
  return {
    repo, web, next: requireWeb.resolve("next/dist/bin/next"),
    receipt: { ...original, frameworks: installed, runId: process.env.GITHUB_RUN_ID!, attempt: process.env.GITHUB_RUN_ATTEMPT!, buildMode: "existing-full-production-web" },
    async assertUnchanged() {
      requireProtocol(JSON.stringify(await observation()) === JSON.stringify(original), "SOURCE_OR_BUILD_CHANGED");
      for (const [name, version] of Object.entries(installed)) {
        const value = JSON.parse(await readFile(requireWeb.resolve(`${name}/package.json`), "utf8")) as { version?: unknown };
        requireProtocol(value.version === version, "FRAMEWORK_CHANGED");
      }
    },
  };
}
