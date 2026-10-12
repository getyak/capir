/**
 * PH-07 dependency-safety regression tests.
 *
 * Covers the local braces depth patch (upstream fix for
 * https://github.com/micromatch/braces/issues/70 is unpublished; npm has no
 * braces@3.0.4 and no sprintf-js@1.1.4 as of this change) and the resolved
 * dependency-graph repairs recorded in pnpm-workspace.yaml / pnpm-lock.yaml.
 *
 * The braces assertions run against the actually installed patched package in
 * node_modules/.pnpm, bound to the SHA-256 patch digest frozen in
 * pnpm-lock.yaml. Stale physical store directories carrying older patch
 * hashes are ignored; there is no fallback to an unpatched or arbitrary
 * braces instance.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const workspace = readFileSync(join(repositoryRoot, "pnpm-workspace.yaml"), "utf8");
const lock = readFileSync(join(repositoryRoot, "pnpm-lock.yaml"), "utf8");
const rootManifest = JSON.parse(
  readFileSync(join(repositoryRoot, "package.json"), "utf8"),
);

// The test target is bound to the SHA-256 digest of the patch file as frozen
// in pnpm-lock.yaml: a legitimate later patch change keeps old physical store
// directories around, so the gate must key on the current digest rather than
// on store inventory.
const patchPath = join(repositoryRoot, "patches/braces@3.0.3.patch");
const patchDigest = createHash("sha256")
  .update(readFileSync(patchPath))
  .digest("hex");

function installedBracesDir() {
  const dir = join(
    repositoryRoot,
    "node_modules/.pnpm",
    `braces@3.0.3_patch_hash=${patchDigest}`,
    "node_modules/braces",
  );
  assert.ok(
    existsSync(join(dir, "package.json")),
    `the digest-bound patched install must exist at ${dir}`,
  );
  return dir;
}

const bracesDir = installedBracesDir();
const require = createRequire(import.meta.url);
const braces = require(bracesDir);

function assertDeliberateDepthError(fn, label) {
  assert.throws(fn, (error) => {
    assert.ok(
      error instanceof RangeError,
      `${label}: expected RangeError, got ${error && error.name}: ${error && error.message}`,
    );
    assert.match(error.message, /nesting depth exceeds maximum/);
    assert.doesNotMatch(
      error.message,
      /call stack/i,
      `${label}: must reject with the deliberate bound, not a stack overflow`,
    );
    return true;
  }, label);
}

test("the installed braces package is 3.0.3 with the local patch applied (version not spoofed)", () => {
  const manifest = JSON.parse(readFileSync(join(bracesDir, "package.json"), "utf8"));
  assert.equal(manifest.version, "3.0.3");
  const compileSource = readFileSync(join(bracesDir, "lib/compile.js"), "utf8");
  assert.match(compileSource, /MAX_DEPTH/);
});

test("dependents resolve the digest-bound patched braces instance", () => {
  const micromatchBraces = join(
    repositoryRoot,
    "node_modules/.pnpm/micromatch@4.0.8/node_modules/braces",
  );
  assert.equal(realpathSync(micromatchBraces), realpathSync(bracesDir));
});

test("patches/braces@3.0.3.patch is registered with a frozen digest", () => {
  assert.match(workspace, /patchedDependencies:\n {2}braces@3\.0\.3: patches\/braces@3\.0\.3\.patch/);
  assert.match(lock, /patchedDependencies:\n {2}braces@3\.0\.3: [0-9a-f]{64}\n/);
  assert.ok(
    lock.includes(`braces@3.0.3: ${patchDigest}`),
    "pnpm-lock.yaml must record the frozen digest of the patch file",
  );
});

test("the backend Docker context admits patches while preserving its exclusion boundary", () => {
  const dockerfile = readFileSync(join(repositoryRoot, "apps/backend/Dockerfile"), "utf8");
  const rules = readFileSync(join(repositoryRoot, "apps/backend/Dockerfile.dockerignore"), "utf8")
    .trim().split("\n");
  assert.match(dockerfile, /^COPY patches patches$/m);
  assert.equal(rules[0], "**", "the context must remain default-deny");
  const patchDirectory = rules.indexOf("!patches/");
  const patchContents = rules.indexOf("!patches/**");
  assert.ok(patchDirectory > 0, "the patch directory must be admitted");
  assert.ok(patchContents > patchDirectory, "registered patch files must be admitted");
  for (const exclusion of ["**/node_modules", "**/dist", "**/.env*", "**/*.log", "**/.DS_Store"]) {
    assert.ok(rules.indexOf(exclusion) > patchContents,
      `${exclusion} must remain excluded after the patch allowlist`);
  }
});

function backendFetchTimeoutGuard() {
  const dockerfile = readFileSync(join(repositoryRoot, "apps/backend/Dockerfile"), "utf8");
  const guard = dockerfile.replace(/\\\n\s*/g, " ")
    .match(/^RUN (case .*?) && pnpm config set registry/m)?.[1];
  assert.ok(guard, "the actual Docker install guard must precede registry/config/install commands");
  return guard;
}

test("the backend install has bounded transport settings without bypassing supply-chain checks", () => {
  const dockerfile = readFileSync(join(repositoryRoot, "apps/backend/Dockerfile"), "utf8");
  const install = dockerfile.replace(/\\\n\s*/g, " ")
    .match(/&& pnpm install (.*?)\s*&& node /)?.[1];
  assert.ok(install, "the backend's pnpm install command must remain explicit");
  for (const flag of [
    "--frozen-lockfile", "--ignore-scripts",
    '--fetch-timeout="$PNPM_FETCH_TIMEOUT_MS"', "--network-concurrency=4",
    "--filter @talent-signal/backend...", "--filter @talent-signal/agent-host...",
  ]) {
    assert.ok(install.includes(flag), `the backend install must retain ${flag}`);
  }
  assert.match(dockerfile, /^RUN npm install --global pnpm@11\.18\.0$/m);
  assert.match(dockerfile, /^ARG PNPM_REGISTRY=https:\/\/registry\.npmjs\.org$/m);
  assert.match(dockerfile, /^ARG PNPM_FETCH_TIMEOUT_MS=180000$/m);
  assert.doesNotMatch(dockerfile, /^ENV PNPM_FETCH_TIMEOUT_MS=/m);
  assert.match(dockerfile, /&& pnpm config set --location=project --json maxSockets 4/);
  assert.doesNotMatch(install, /--(?:config\.)?maxsockets=/);
  assert.doesNotMatch(dockerfile,
    /--trust-lockfile|--minimum-release-age(?:=|\s+)0\b|--trust-policy(?:=|\s+)off\b/);
});

test("pnpm 11.18 uses bounded deadlines and numeric maxSockets in real frozen offline installs", () => {
  const discovered = spawnSync("pnpm", ["exec", "which", "pnpm"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(discovered.status, 0, `pinned pnpm discovery failed: ${discovered.stderr}`);
  const pnpm = discovered.stdout.trim();
  const fixture = mkdtempSync(join(tmpdir(), "capir-pnpm-config-"));
  try {
    writeFileSync(join(fixture, "package.json"), JSON.stringify({
      name: "capir-owned-pnpm-config-test", private: true, version: "0.0.0",
      packageManager: "pnpm@11.18.0",
    }));
    writeFileSync(join(fixture, "pnpm-workspace.yaml"), "packages: []\n");
    const emptyConfig = join(fixture, "empty.npmrc");
    writeFileSync(emptyConfig, "");
    const env = {
      PATH: process.env.PATH, HOME: process.env.HOME,
      TMPDIR: tmpdir(), XDG_CONFIG_HOME: join(fixture, "config"),
      XDG_CACHE_HOME: join(fixture, "cache"), XDG_DATA_HOME: join(fixture, "data"),
      XDG_STATE_HOME: join(fixture, "state"),
      npm_config_userconfig: emptyConfig, npm_config_globalconfig: emptyConfig,
    };
    const run = (args) => spawnSync(pnpm, args, {
      cwd: fixture, env, encoding: "utf8", timeout: 30_000,
    });
    const configured = run(["config", "set", "--location=project", "--json", "maxSockets", "4"]);
    assert.equal(configured.status, 0, `typed project config failed: ${configured.stderr}`);
    assert.match(readFileSync(join(fixture, "pnpm-workspace.yaml"), "utf8"), /^maxSockets: 4$/m);
    const installFlags = [
      "--offline", "--ignore-scripts", `--store-dir=${join(fixture, "store")}`,
      "--fetch-timeout=180000", "--network-concurrency=4",
    ];
    const generated = run(["install", "--lockfile-only", ...installFlags]);
    assert.equal(generated.status, 0, `fixture lock generation failed: ${generated.stderr}`);
    const lockfile = readFileSync(join(fixture, "pnpm-lock.yaml"), "utf8");
    const rejected = run(["install", "--frozen-lockfile", ...installFlags, "--maxsockets=4"]);
    assert.equal(rejected.status, 1);
    assert.match(rejected.stdout + rejected.stderr, /Unknown option: 'maxsockets'/);
    const installScript = `${backendFetchTimeoutGuard()} && printf 'INSTALL_REACHED\\n' \
      && "$PNPM_TEST_BIN" install --frozen-lockfile --offline --ignore-scripts \
      --store-dir="$PNPM_TEST_STORE" --fetch-timeout="$PNPM_FETCH_TIMEOUT_MS" --network-concurrency=4`;
    const validatedInstall = (value) => spawnSync("/bin/sh", ["-c", installScript], {
      cwd: fixture,
      env: { ...env, PNPM_TEST_BIN: pnpm, PNPM_TEST_STORE: join(fixture, "store"), PNPM_FETCH_TIMEOUT_MS: value },
      encoding: "utf8", timeout: 30_000,
    });
    for (const value of [
      "", "abc", "+180000", "180000.0", "180000 ", "179999", "3600001",
      "999999999999999999999999999", "180000; printf INJECTED", "$(printf 180000)", "180000\nprintf INJECTED",
    ]) {
      const invalid = validatedInstall(value);
      assert.notEqual(invalid.status, 0, `${JSON.stringify(value)} must fail validation`);
      assert.doesNotMatch(invalid.stdout, /INSTALL_REACHED|INJECTED|using pnpm/);
    }
    const defaultTimeout = readFileSync(join(repositoryRoot, "apps/backend/Dockerfile"), "utf8")
      .match(/^ARG PNPM_FETCH_TIMEOUT_MS=(\d+)$/m)?.[1];
    for (const value of [defaultTimeout, "3600000"]) {
      const installed = validatedInstall(value);
      assert.equal(installed.status, 0, `frozen offline install (${value}) failed: ${installed.stderr}`);
      assert.match(installed.stdout, /INSTALL_REACHED[\s\S]*using pnpm v11\.18\.0/);
      assert.equal(readFileSync(join(fixture, "pnpm-lock.yaml"), "utf8"), lockfile);
    }
    const effective = run(["config", "get", "--json", "maxSockets"]);
    assert.equal(effective.status, 0);
    assert.equal(JSON.parse(effective.stdout), 4);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("ordinary compile/expand/escape/quote behavior is unchanged", () => {
  const goldens = {
    "a/{b,c}/d": { default: ["a/(b|c)/d"], expand: ["a/b/d", "a/c/d"] },
    "{a,b,c}": { default: ["(a|b|c)"], expand: ["a", "b", "c"] },
    "x{1..3}y": { default: ["x([1-3])y"], expand: ["x1y", "x2y", "x3y"] },
    "{a,{b,c},d}": { default: ["(a|(b|c)|d)"], expand: ["a", "b", "c", "d"] },
    "foo/{a,b}/bar": { default: ["foo/(a|b)/bar"], expand: ["foo/a/bar", "foo/b/bar"] },
    "a\\{b,c}d": { default: ["a{b,c}d"], expand: ["a{b,c}d"] },
    "{a,b}/{c,d}": { default: ["(a|b)/(c|d)"], expand: ["a/c", "a/d", "b/c", "b/d"] },
    "{a,}": { default: ["(a|)"], expand: ["a", ""] },
    "{}": { default: ["{}"], expand: ["{}"] },
    "{{a,b},{c,d}}": { default: ["((a|b)|(c|d))"], expand: ["a", "b", "c", "d"] },
    'quoted-{"x,y"}': { default: ["quoted-{x,y}"], expand: ["quoted-{x,y}"] },
    "\\{escaped}": { default: ["{escaped}"], expand: ["{escaped}"] },
    "'q,{a,b}'": { default: ["q,{a,b}"], expand: ["q,{a,b}"] },
  };

  for (const [input, expected] of Object.entries(goldens)) {
    assert.deepEqual(braces(input), expected.default, `default(${JSON.stringify(input)})`);
    assert.deepEqual(
      braces(input, { expand: true }),
      expected.expand,
      `expand(${JSON.stringify(input)})`,
    );
  }

  assert.equal(braces.stringify(braces.parse("a/{b,c}/d")), "a/{b,c}/d");
  assert.equal(braces.compile("a/{b,c}/d"), "a/(b|c)/d");
  assert.deepEqual(braces('a/{"b,c"}d', { keepQuotes: true }), ['a/{"b,c"}d']);
  for (const name of ["parse", "stringify", "compile", "expand", "create"]) {
    assert.equal(typeof braces[name], "function", `export ${name} must remain`);
  }
});

test("adversarial nested text rejects with the deliberate bounded error", () => {
  const deepBraces = "{".repeat(3500) + "a" + "}".repeat(3500);
  const deepParens = "(".repeat(3500) + "a" + ")".repeat(3500);
  assertDeliberateDepthError(() => braces(deepBraces), "braces(deep braces)");
  assertDeliberateDepthError(() => braces.parse(deepBraces), "braces.parse(deep braces)");
  assertDeliberateDepthError(() => braces.expand(deepBraces), "braces.expand(deep braces)");
  assertDeliberateDepthError(() => braces(deepParens), "braces(deep parens)");
});

test("the depth bound matches the parser bound at the boundary", () => {
  assert.doesNotThrow(() => braces("{".repeat(100) + "a" + "}".repeat(100)));
  assertDeliberateDepthError(
    () => braces("{".repeat(101) + "a" + "}".repeat(101)),
    "text depth 101",
  );
  assert.doesNotThrow(() => braces("(".repeat(100) + "a" + ")".repeat(100)));
  assertDeliberateDepthError(
    () => braces("(".repeat(101) + "a" + ")".repeat(101)),
    "paren depth 101",
  );
});

test("directly supplied deep or cyclic ASTs reject with the deliberate bounded error", () => {
  // Run in a child process so a regression that reintroduces unbounded
  // recursion (hang or crash) fails cleanly instead of freezing the runner.
  const child = `
    const bracesDir = process.argv[1];
    const braces = require(bracesDir);
    const results = [];
    const run = (name, fn) => {
      try {
        fn();
        results.push({ name, threw: false });
      } catch (error) {
        results.push({
          name,
          threw: true,
          errorName: error && error.constructor ? error.constructor.name : "unknown",
          message: String(error && error.message),
        });
      }
    };
    const containers = (n) => {
      let node = { type: "text", value: "x" };
      for (let i = 0; i < n; i++) node = { type: "brace", nodes: [node] };
      return { type: "root", nodes: [node] };
    };
    const selfCycle = { type: "text", nodes: [] };
    selfCycle.nodes.push(selfCycle);
    const cyclicParentAst = () => {
      const inner = { type: "text", nodes: [] };
      const outer = { type: "text", nodes: [inner] };
      outer.parent = inner;
      inner.parent = outer;
      inner.nodes.push({ type: "text", value: "x" });
      return { type: "root", nodes: [outer] };
    };
    run("deepAstStringify", () => braces.stringify(containers(50000)));
    run("deepAstCompile", () => braces.compile(containers(50000)));
    run("deepAstExpand", () => braces.expand(containers(50000)));
    run("cyclicNodesStringify", () => braces.stringify({ type: "root", nodes: [selfCycle] }));
    run("cyclicNodesExpand", () => braces.expand({ type: "root", nodes: [selfCycle] }));
    run("cyclicParentExpand", () => braces.expand(cyclicParentAst()));
    run("boundaryAst100Stringify", () => braces.stringify(containers(100)));
    run("boundaryAst100Expand", () => braces.expand(containers(100)));
    run("boundaryAst101Stringify", () => braces.stringify(containers(101)));
    process.stdout.write(JSON.stringify(results));
  `;
  const spawned = spawnSync(process.execPath, ["-e", child, bracesDir], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(spawned.status, 0, `probe child failed: ${spawned.stderr}`);
  const results = JSON.parse(spawned.stdout);
  const byName = new Map(results.map((entry) => [entry.name, entry]));

  for (const name of [
    "deepAstStringify",
    "deepAstCompile",
    "deepAstExpand",
    "cyclicNodesStringify",
    "cyclicNodesExpand",
    "cyclicParentExpand",
    "boundaryAst101Stringify",
  ]) {
    const result = byName.get(name);
    assert.ok(result && result.threw, `${name} must reject`);
    assert.equal(result.errorName, "RangeError", `${name} must throw RangeError`);
    assert.match(result.message, /nesting depth exceeds maximum/);
    assert.doesNotMatch(result.message, /call stack/i, `${name} must use the deliberate bound`);
  }

  for (const name of ["boundaryAst100Stringify", "boundaryAst100Expand"]) {
    const result = byName.get(name);
    assert.ok(result && !result.threw, `${name} must stay within the bound`);
  }
});

// Package/snapshot entries look like `  name@version:`, `  name@version: {}` or
// `  name@version(peers):`; override selectors (`  name@range: target`) and
// dependency references (`      name: version`) never match.
function resolvedVersions(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^ {2}'?${escaped}@([^:'\\n]+)'?:( \\{\\})?\\s*$`, "gm");
  return [
    ...new Set(
      [...lock.matchAll(pattern)].map((match) => match[1].replace(/\(.*$/, "")),
    ),
  ].sort();
}

test("resolved production repairs are recorded in the lockfile", () => {
  assert.deepEqual(resolvedVersions("@modelcontextprotocol/sdk"), ["1.31.0"]);
  assert.deepEqual(resolvedVersions("hono"), ["4.13.7"]);
  assert.deepEqual(resolvedVersions("ip-address"), ["10.7.1"]);
  assert.deepEqual(resolvedVersions("fast-uri"), ["3.1.8", "4.1.5"]);
  assert.deepEqual(resolvedVersions("source-map-js"), ["1.2.2"]);
  assert.ok(lock.includes("\n  mammoth@1.13.0:"));
});

test("the unused mammoth CLI argparse/sprintf-js graph is gone and the SDK pin holds", () => {
  assert.deepEqual(resolvedVersions("argparse"), []);
  assert.deepEqual(resolvedVersions("sprintf-js"), []);
  assert.doesNotMatch(lock, /\n {4}argparse: /);
  assert.doesNotMatch(lock, /\n {4}sprintf-js: /);
  assert.match(workspace, /"mammoth@1\.13\.0>argparse": "-"/);
  assert.match(lock, /mammoth@1\.13\.0>argparse: '-'/);
  assert.deepEqual(resolvedVersions("@anthropic-ai/claude-agent-sdk"), ["0.3.287"]);
  assert.doesNotMatch(lock, /0\.3\.241/);
  assert.doesNotMatch(workspace, /^ *- .*0\.3\.241/m);
  assert.ok(workspace.includes("opik@2.2.45"));
});

test("overrides and audit policy: existing qs override kept, no audit suppression", () => {
  assert.match(workspace, /"qs@6\.15\.3": "6\.16\.0"/);
  assert.match(lock, /qs@6\.15\.3: 6\.16\.0/);
  assert.doesNotMatch(workspace, /audit\.(ignore|ignorePrune)|auditIgnore/i);
  assert.ok(!rootManifest.pnpm || !("audit" in rootManifest.pnpm));
});
