#!/usr/bin/env node
/**
 * Focused release/packaging policy tests for the standalone capir slice:
 * workflow trigger and publication semantics, Infisical-only signing, pinned
 * actions, hosted-runner platform mapping, release-gate release-source
 * binding, CLI CI integration, and canonical getyak/capir URLs.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

import { RUNNERS, SUPPORTED_PLATFORMS, HOSTED_RUNNER_LABELS } from "./platforms.mjs";
import {
  checkHeadMatchesTag,
  checkTagOnMain,
  checkVersionConsistency,
  versionFromTag,
} from "./release-gate.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const workflow = readFileSync(join(REPO_ROOT, ".github/workflows/release-capir.yml"), "utf8");
const ciWorkflow = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
const installSh = readFileSync(new URL("./install.sh", import.meta.url), "utf8");
const publicKey = readFileSync(new URL("./release-public-key.txt", import.meta.url), "utf8");

const work = mkdtempSync(join(tmpdir(), "capir-policy-test-"));
after(() => rmSync(work, { recursive: true, force: true }));

describe("release workflow: triggers and scope", () => {
  it("smokes PRs on all four runners and releases only from tags or dispatch", () => {
    assert.match(workflow, /pull_request:\n    paths:/);
    assert.match(workflow, /push:\n    tags:\n      - "capir-v\*"/);
    assert.match(workflow, /workflow_dispatch:\n    inputs:\n      version:/);
    assert.match(workflow, /description: "Exact release version \(X\.Y\.Z\)/);
    // Publication is gated to trusted events and never runs for PRs.
    assert.match(
      workflow,
      /if: needs\.validate\.outputs\.publish == 'true' && \(github\.event_name == 'push' \|\| github\.event_name == 'workflow_dispatch'\)/,
    );
    assert.ok(!workflow.includes("pull_request_target"));
  });

  it("uses only valid hosted runner labels mapped to every platform", () => {
    for (const platform of SUPPORTED_PLATFORMS) {
      assert.ok(workflow.includes(`platform: ${platform}`), `matrix covers ${platform}`);
      assert.ok(workflow.includes(`runner: ${RUNNERS[platform]}`), `runner pinned for ${platform}`);
      assert.ok(HOSTED_RUNNER_LABELS.has(RUNNERS[platform]), `${RUNNERS[platform]} is a hosted label`);
    }
  });

  it("pins every action to a full commit SHA", () => {
    for (const line of workflow.split("\n")) {
      const match = /^\s*(?:- )?uses:\s+(\S+)/.exec(line);
      if (!match) continue;
      const reference = match[1];
      if (reference.startsWith("./")) continue;
      assert.match(reference, /@[0-9a-f]{40}$/, `unpinned action: ${reference}`);
    }
    assert.ok(workflow.includes("Infisical/secrets-action@d2e351f16c6ca20d17c85e6c992e04bdeb64e87d"));
    assert.ok(workflow.includes("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1"));
  });
});

describe("release workflow: Infisical-only signing", () => {
  it("loads the signing key only from Infisical via OIDC in the capir-release environment", () => {
    assert.match(workflow, /environment: capir-release/);
    assert.match(workflow, /permissions:\n      contents: write\n      id-token: write/);
    for (const required of [
      "method: oidc",
      "identity-id: ${{ vars.INFISICAL_CAPIR_IDENTITY_ID }}",
      "oidc-audience: infisical://talent-signal/capir-release",
      "project-slug: talent-signal-8p1-x",
      "env-slug: staging",
      "secret-path: /release",
      "export-type: env",
    ]) {
      assert.ok(workflow.includes(required), `missing Infisical parameter: ${required}`);
    }
  });

  it("fails closed on missing identity or exported key and has no GitHub-secret fallback", () => {
    assert.match(workflow, /INFISICAL_CAPIR_IDENTITY_ID must be configured/);
    assert.match(workflow, /CAPIR_RELEASE_SIGNING_KEY was not exported from Infisical/);
    assert.ok(!workflow.includes("secrets.CAPIR_RELEASE_SIGNING_KEY"), "no GitHub secret fallback");
  });

  it("keeps manifest signing inside the trusted publish job only", () => {
    const publishIndex = workflow.indexOf("  publish:");
    const signIndex = workflow.indexOf("manifest.mjs sign");
    assert.ok(publishIndex !== -1 && signIndex > publishIndex, "signing lives in the publish job");
    assert.ok(workflow.indexOf("pull_request") < publishIndex, "publish job exists outside PR scope");
  });
});

describe("release workflow: publication wiring", () => {
  it("serializes all release versions and freezes the validated source SHA", () => {
    assert.ok(workflow.includes("|| 'stable'"));
    assert.ok(workflow.includes('echo "ref=$(git rev-parse HEAD)"'));
    assert.equal((workflow.match(/ref: \$\{\{ needs\.validate\.outputs\.ref \}\}/g) ?? []).length, 2);
    assert.ok(workflow.includes('node scripts/capir/publication.mjs publish'));
    assert.ok(workflow.includes('RELEASE_COMMIT: ${{ needs.validate.outputs.ref }}'));
  });
  it("passes manual input as data and requests only the signing key", () => {
    assert.ok(workflow.includes('CAPIR_DISPATCH_VERSION: ${{ inputs.version }}'));
    assert.ok(workflow.includes('node scripts/capir/publication.mjs version'));
    assert.ok(!workflow.includes('version="${{ github.event.inputs.version }}"'));
    assert.ok(workflow.includes('secret-name: CAPIR_RELEASE_SIGNING_KEY'));
    assert.ok(workflow.includes('include-imports: false'));
  });
});

describe("release gate: release-source binding", () => {
  function makeRepo() {
    const repo = join(work, `repo-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(repo, "apps", "cli"), { recursive: true });
    writeFileSync(join(repo, "apps", "cli", "package.json"), JSON.stringify({ version: "1.2.3" }));
    const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
    git("init", "-b", "main");
    git("config", "user.email", "policy-test@example.com");
    git("config", "user.name", "policy-test");
    git("add", ".");
    git("commit", "-m", "release candidate");
    git("tag", "capir-v1.2.3");
    return { repo, git };
  }

  it("requires the checked-out HEAD to be the exact tagged commit", () => {
    const { repo, git } = makeRepo();
    assert.equal(checkVersionConsistency({ tag: "capir-v1.2.3", repoRoot: repo }), "1.2.3");
    assert.equal(checkTagOnMain({ tag: "capir-v1.2.3", repoRoot: repo }), git("rev-parse", "HEAD").trim());
    assert.equal(checkHeadMatchesTag({ tag: "capir-v1.2.3", repoRoot: repo }), git("rev-parse", "HEAD").trim());

    // A clean tree at a different revision never publishes the tag's release,
    // even though the tag stays on main ancestry.
    writeFileSync(join(repo, "apps", "cli", "package.json"), JSON.stringify({ version: "1.2.4" }));
    git("commit", "-a", "-m", "move past the tag");
    assert.throws(() => checkHeadMatchesTag({ tag: "capir-v1.2.3", repoRoot: repo }), /not the tagged commit/);

    // A tag outside main ancestry is refused.
    git("checkout", "-b", "side");
    writeFileSync(join(repo, "apps", "cli", "package.json"), JSON.stringify({ version: "1.2.5" }));
    git("commit", "-a", "-m", "side change");
    git("tag", "capir-v1.2.4");
    assert.throws(() => checkTagOnMain({ tag: "capir-v1.2.4", repoRoot: repo }), /not on main ancestry/);
  });

  it("rejects tag/version drift and non-semver tags", () => {
    assert.equal(versionFromTag("capir-v0.2.0"), "0.2.0");
    assert.throws(() => versionFromTag("v0.2.0"), /capir-vX\.Y\.Z/);
    assert.throws(() => checkVersionConsistency({ tag: "capir-v1.2.3", version: "9.9.9" }), /does not match/);
  });
});

describe("packaging and installer policy", () => {
  it("installs only through the shell+Node trust chain with the committed public key", () => {
    assert.ok(installSh.includes(publicKey.trim()), "install.sh embeds the committed public key");
    assert.match(installSh, /openssl dgst -sha256 -verify/);
    assert.match(installSh, /--proto =https/);
    for (const forbidden of ["python", "node -", "nodejs"]) {
      assert.ok(!installSh.includes(forbidden), `bootstrap must not use ${forbidden}`);
    }
    assert.match(installSh, /--version X\.Y\.Z/);
    assert.match(installSh, /capir-stable/);
  });

  it("builds production packages with pnpm deploy and verified official runtimes", () => {
    const packager = readFileSync(new URL("./package-portable.mjs", import.meta.url), "utf8");
    assert.match(packager, /"deploy", "--legacy", "--prod"/);
    assert.match(packager, /PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD/);
    assert.match(packager, /official-nodejs\.org/);
    const runtime = readFileSync(new URL("./node-runtime.mjs", import.meta.url), "utf8");
    assert.match(runtime, /SHASUMS256\.txt/);
    assert.match(runtime, /nodejs\.org\/dist/);
  });

  it("keeps canonical getyak/capir release URLs across the slice", () => {
    assert.ok(publicKey.includes("BEGIN PUBLIC KEY"));
    for (const source of [installSh, workflow]) {
      assert.ok(source.includes("getyak/capir"), "canonical repository used");
      assert.ok(!source.includes("getyak/talent-signal"), "redirect repository is never used");
    }
  });

  it("integrates the capir packaging and installer checks into the CLI CI job", () => {
    const start = ciWorkflow.indexOf("  cli:");
    assert.notEqual(start, -1, "CLI job exists");
    const rest = ciWorkflow.slice(start);
    const end = rest.search(/\n  [a-z][a-z0-9-]*:\n/);
    const cliJob = end === -1 ? rest : rest.slice(0, end);
    assert.ok(cliJob.includes("scripts/capir/manifest.test.mjs"));
    assert.ok(cliJob.includes("scripts/capir/publication.test.mjs"));
    assert.ok(cliJob.includes("scripts/capir/package-portable.test.mjs"));
    assert.ok(cliJob.includes("scripts/capir/release-policy.test.mjs"));
    assert.ok(cliJob.includes("scripts/capir/install.test.mjs"));
    assert.ok(cliJob.includes("shellcheck scripts/capir/install.sh"));
  });
});
