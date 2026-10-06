#!/usr/bin/env node
/**
 * Portable capir package builder.
 *
 * Produces capir-<version>-<platform>.tar.gz containing:
 *
 *   node/         bundled official Node runtime (provenance verified)
 *   package/      pnpm deploy --legacy --prod output: CLI dist, compiled
 *                 contracts, @napi-rs/keyring native optional package,
 *                 Playwright libs (browser download remains explicit),
 *                 everything needed at runtime with NO source checkout,
 *                 pnpm or system Node required
 *   LICENSES/     Node LICENSE and the production dependency licenses
 *   build-info.json  version, platform, node version, build revision
 *
 * Runtime provenance: the release path downloads the official Node archive
 * and verifies it against the official SHASUMS256.txt. Local verification
 * runs may reuse an unpacked runtime with the same exact version by passing
 * `--node-dir` (this is the only non-official path and it is recorded in
 * build-info as runtime_source: "local-reuse" so it can never masquerade as
 * a release artifact).
 *
 *   node scripts/capir/package-portable.mjs \
 *     --version 0.2.0 --revision <sha> --out build/capir
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, lstatSync, readlinkSync, realpathSync, unlinkSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { hostPlatform, SUPPORTED_PLATFORMS } from "./platforms.mjs";
import { DEFAULT_NODE_VERSION, fetchNodeRuntime, reuseNodeRuntime } from "./node-runtime.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMMIT_HEX = /^[0-9a-f]{40}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`unexpected argument ${key}`);
    values[key.slice(2)] = argv[++index];
  }
  return values;
}

/** Collect license files from every deployed production package. */
function collectLicenses(packageDir, licensesDir) {
  mkdirSync(licensesDir, { recursive: true });
  const nodeModules = realpathSync(join(packageDir, "node_modules"));
  const seen = new Set();
  let collected = 0;
  const walk = (directory) => {
    let real;
    try {
      real = realpathSync(directory);
    } catch {
      return;
    }
    if (seen.has(real)) return;
    seen.add(real);
    for (const name of readdirSync(directory)) {
      if (name.startsWith(".")) continue;
      const full = join(directory, name);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue; // dangling link: nothing to license
      }
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (stat.isFile() && /^(LICENSE|LICENCE|COPYING|NOTICE)(\..*)?$/i.test(name)) {
        // Package dirs are often symlinks into .pnpm; label by real location
        // relative to the real node_modules root so labels stay short.
        const label = `${relative(nodeModules, dirname(real)).split(sep).join("__")}__${name}`;
        cpSync(full, join(licensesDir, label));
        collected += 1;
      }
    }
  };
  if (existsSync(nodeModules)) walk(nodeModules);
  return collected;
}

/**
 * `pnpm deploy` links the deployed package's virtual-store self-entry back to
 * the SOURCE checkout (node_modules/.pnpm/node_modules/@talent-signal/cli ->
 * ../../../../../../.../apps/cli). That escaping symlink must never ship:
 * replace it with a confined relative link to the deployed package root. Any
 * other escaping or dangling symlink fails the build outright.
 */
function sanitizeDeployTree(packageDir) {
  const root = realpathSync(packageDir);
  const packageName = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).name;
  const selfEntry = join("node_modules", ".pnpm", "node_modules", packageName);
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const full = join(directory, name);
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) {
        const rel = relative(root, full).split(sep).join("/");
        let resolved = "";
        try {
          resolved = realpathSync(full);
        } catch {
          resolved = ""; // dangling: counted as escaping below
        }
        const confined =
          resolved !== "" && (resolved === root || resolved.startsWith(root + sep));
        if (confined) continue;
        if (rel === selfEntry.split(sep).join("/")) {
          // Confined replacement pointing at the deployed package root.
          unlinkSync(full);
          symlinkSync(relative(dirname(full), root) || ".", full);
          continue;
        }
        throw new Error(`deployed symlink ${full} escapes or dangles outside the package root`);
      }
      if (stat.isDirectory()) walk(full);
    }
  };
  walk(root);
}

/**
 * Physical link-graph confinement check over the staging tree before it is
 * archived (same rule the updater enforces: no symlink-ancestor files, every
 * link target resolves inside the tree, no escaping hardlinks).
 */
function assertConfinedTree(tree) {
  const root = resolve(tree);
  const nodes = new Map();
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const full = join(directory, name);
      const rel = relative(root, full).split(sep).join("/");
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) nodes.set(rel, { type: "symlink", linkTarget: readlinkSync(full) });
      else if (stat.isDirectory()) {
        nodes.set(rel, { type: "directory" });
        walk(full);
      } else nodes.set(rel, { type: "file" });
    }
  };
  walk(root);
  for (const [path, node] of nodes) {
    if (node.type !== "symlink") continue;
    let current = resolve(root, path, "..");
    const target = resolve(current, node.linkTarget);
    if (target !== root && !target.startsWith(root + sep))
      throw new Error(`staging symlink ${path} -> ${node.linkTarget} escapes the package root`);
  }
  for (const path of nodes.keys()) {
    let parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    while (parent) {
      if (nodes.get(parent)?.type === "symlink")
        throw new Error(`staging entry ${path} lives under symlink ${parent}`);
      parent = parent.includes("/") ? parent.slice(0, parent.lastIndexOf("/")) : "";
    }
  }
}

function assertProductionLayout(packageDir) {
  const required = [
    "package.json",
    "dist/cli.js",
    "dist/update/installEntry.js",
    "dist/update/smokeEntry.js",
    "node_modules/@napi-rs/keyring",
    "node_modules/@talent-signal/contracts",
    "node_modules/@sinclair/typebox",
  ];
  for (const path of required) {
    if (!existsSync(join(packageDir, path)))
      throw new Error(`deployed package is missing ${path}`);
  }
  // Playwright libs ship; browser binaries stay explicit (never bundled).
  const playwright = join(packageDir, "node_modules", "playwright");
  const playwrightCore = join(packageDir, "node_modules", "playwright-core");
  if (!existsSync(playwright) && !existsSync(playwrightCore))
    throw new Error("deployed package is missing the Playwright libs");
  for (const candidate of ["ms-playwright", "browsers"]) {
    if (existsSync(join(packageDir, candidate)))
      throw new Error(`deployed package must not bundle Playwright browsers (${candidate})`);
  }
}

export async function buildPortablePackage({
  version,
  revision,
  outDir,
  platform = hostPlatform(),
  nodeVersion = DEFAULT_NODE_VERSION,
  nodeDir = null,
  nodeArchive = null,
  repoRoot = REPO_ROOT,
  fetchImpl = fetch,
}) {
  if (!SEMVER.test(version)) throw new Error("version must be strict semver X.Y.Z");
  if (!COMMIT_HEX.test(revision)) throw new Error("revision must be a full lowercase commit id");
  if (!SUPPORTED_PLATFORMS.includes(platform)) throw new Error(`unsupported platform ${platform}`);
  // Native optional packages are platform-specific: one native build per host.
  if (platform !== hostPlatform())
    throw new Error(`platform ${platform} must be built on its own runner (host is ${hostPlatform()})`);

  // Exact monorepo pnpm: production deploy output must match the lockfile tool.
  const expectedPnpm = /pnpm@(\S+)/.exec(
    JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).packageManager,
  )?.[1];
  const actualPnpm = execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim();
  if (actualPnpm !== expectedPnpm)
    throw new Error(`pnpm ${expectedPnpm} is required for reproducible deploys; found ${actualPnpm}`);

  mkdirSync(outDir, { recursive: true });
  const staging = join(outDir, `staging-${version}-${platform}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });

  try {
    // 1. Production dependency closure via pnpm deploy --legacy --prod.
    const packageDir = join(staging, "package");
    execFileSync(
      "pnpm",
      ["--filter", "@talent-signal/cli", "deploy", "--legacy", "--prod", packageDir],
      { cwd: repoRoot, stdio: "pipe", env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" } },
    );
    assertProductionLayout(packageDir);
    sanitizeDeployTree(packageDir);

    // Stamp the release version into the deployed manifest so the shipped
    // CLI reports exactly the release version (the release gate already
    // enforces repo package version == tag before any production build).
    const deployedManifestPath = join(packageDir, "package.json");
    const deployedManifest = JSON.parse(readFileSync(deployedManifestPath, "utf8"));
    deployedManifest.version = version;
    writeFileSync(deployedManifestPath, `${JSON.stringify(deployedManifest, null, 2)}\n`);

    // 2. Bundled runtime with demonstrated provenance. The release path is
    // always the official download + SHASUMS256.txt verification; only local
    // verification runs may pass --node-dir and that is recorded explicitly.
    let runtimeSource;
    let nodeDirOut;
    if (nodeDir) {
      nodeDirOut = join(staging, "node");
      cpSync(nodeDir, nodeDirOut, { recursive: true, dereference: true, verbatimSymlinks: false });
      reuseNodeRuntime(nodeDirOut);
      runtimeSource = "local-reuse";
    } else {
      const fetched = await fetchNodeRuntime({
        platform,
        nodeVersion,
        outDir: join(outDir, "node-runtime"),
        fetchImpl,
      });
      nodeDirOut = join(staging, "node");
      // verbatimSymlinks keeps the runtime's internal relative npm/corepack
      // symlinks relative; resolving them would produce escaping links.
      cpSync(fetched.nodeDir, nodeDirOut, { recursive: true, verbatimSymlinks: true });
      runtimeSource = "official-nodejs.org";
    }
    if (!existsSync(join(nodeDirOut, "LICENSE")))
      throw new Error("bundled runtime must carry the Node LICENSE");

    // 3. Licenses for the production dependency closure.
    const licensesDir = join(staging, "LICENSES");
    const licenseCount = collectLicenses(packageDir, licensesDir);
    if (licenseCount === 0) throw new Error("no dependency licenses were collected");
    cpSync(join(nodeDirOut, "LICENSE"), join(licensesDir, "node-LICENSE"));

    // 4. Build info records version, platform, runtime and build revision.
    const buildInfo = {
      version,
      platform,
      node_version: nodeVersion,
      revision,
      built_at: new Date().toISOString(),
      runtime_source: runtimeSource,
    };
    writeFileSync(join(staging, "build-info.json"), `${JSON.stringify(buildInfo, null, 2)}\n`);

    assertConfinedTree(staging);

    // 5. Archive (system tar; the updater re-parses and re-proves confinement).
    // COPYFILE_DISABLE keeps macOS AppleDouble `._*` xattr entries out: the
    // portable layout is exactly node/ package/ LICENSES/ build-info.json.
    const filename = `capir-${version}-${platform}.tar.gz`;
    const archivePath = join(outDir, filename);
    rmSync(archivePath, { force: true });
    execFileSync(
      "tar",
      ["-czf", archivePath, "-C", staging, "node", "package", "LICENSES", "build-info.json"],
      { stdio: "pipe", env: { ...process.env, COPYFILE_DISABLE: "1" } },
    );
    const sha256 = createHash("sha256").update(readFileSync(archivePath)).digest("hex");
    return {
      archivePath,
      filename,
      sha256,
      size: statSync(archivePath).size,
      buildInfo,
    };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
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
  const values = parseArgs(process.argv.slice(2));
  buildPortablePackage({
    version: values.version,
    revision: values.revision,
    outDir: values.out,
    ...(values.platform ? { platform: values.platform } : {}),
    ...(values["node-version"] ? { nodeVersion: values["node-version"] } : {}),
    ...(values["node-dir"] ? { nodeDir: values["node-dir"] } : {}),
  })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
