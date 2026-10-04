import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import {
  checkArchitectureBoundaries,
  countLines,
  extractTypeScriptContractVersion,
  migrationHistoryDigest,
  parseMigrationManifest,
  renderSwiftContractMirror,
  unexpectedWorkspaceDependencies,
  validateMigrationInventory,
  writeSwiftContractMirror,
} from "./check-architecture-boundaries.mjs";

const fixtureManifests = new Map([
  ["package.json", "talent-signal"],
  ["packages/contracts/package.json", "@talent-signal/contracts"],
  ["packages/evaluation/package.json", "@talent-signal/evaluation"],
  ["packages/workspace-ui/package.json", "@talent-signal/workspace-ui"],
  ["apps/agent/package.json", "@talent-signal/agent"],
  ["apps/agent-host/package.json", "@talent-signal/agent-host"],
  ["apps/backend/package.json", "@talent-signal/backend"],
  ["apps/cli/package.json", "@talent-signal/cli"],
  ["apps/macos-hybrid/package.json", "@talent-signal/macos-hybrid"],
  ["apps/web/package.json", "@talent-signal/web"],
]);

const fixtureHotspots = [
  "apps/ios/Sources/Features/RelationshipAskView.swift",
  "apps/ios/Sources/Features/RelationshipArchiveView.swift",
  "apps/ios/Sources/Services/PursuitWorkspaceClient.swift",
  "apps/backend/src/app.ts",
  "apps/backend/src/modules/captures.ts",
  "apps/backend/src/modules/actions.ts",
  "apps/agent/src/chatAnswerProvider.ts",
  "apps/agent/src/runner.ts",
  "apps/agent/src/personResearchRunner.ts",
];

function writeFixtureFile(root, relativePath, content) {
  const absolutePath = join(root, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content);
}

function renderSwiftService(version, lineEnding = "\n", suffix = "") {
  const mirror = renderSwiftContractMirror(version).replace(
    /\n/gu,
    lineEnding,
  );
  return `import CryptoKit${lineEnding}import Foundation${lineEnding}${lineEnding}${mirror}${lineEnding}${suffix}`;
}

function createArchitectureFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "talent-signal-architecture-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  writeFixtureFile(root, "apps/.keep", "");
  writeFixtureFile(root, "packages/.keep", "");
  writeFixtureFile(
    root,
    "pnpm-workspace.yaml",
    'packages:\n  - "apps/*"\n  - "packages/*"\n',
  );
  writeFixtureFile(
    root,
    "packages/contracts/src/constants.ts",
    'export const CONTRACT_VERSION = "2026-08-24.10" as const;\n',
  );
  writeFixtureFile(
    root,
    "apps/ios/Sources/Services/TextSignalSyncClient.swift",
    renderSwiftService("2026-08-24.10"),
  );
  writeFixtureFile(
    root,
    "apps/backend/src/database/migration-manifest.json",
    `${JSON.stringify({
      schemaVersion: "talent-signal-migrations.v1",
      migrations: ["001_authority"],
    })}\n`,
  );
  writeFixtureFile(
    root,
    "apps/backend/src/database/001_authority.sql",
    "-- fixture\n",
  );
  for (const [relativePath, name] of fixtureManifests) {
    writeFixtureFile(root, relativePath, `${JSON.stringify({ name })}\n`);
  }
  for (const relativePath of fixtureHotspots) {
    writeFixtureFile(root, relativePath, "fixture\n");
  }
  return root;
}

function checkFixture(root) {
  return checkArchitectureBoundaries(root, { frozenMigrationCount: 0 });
}

test("reads one canonical TypeScript contract declaration", () => {
  assert.equal(
    extractTypeScriptContractVersion(
      'export const CONTRACT_VERSION = "2026-08-24.10" as const;\n',
    ),
    "2026-08-24.10",
  );
  assert.equal(
    extractTypeScriptContractVersion(
      '/* fake */\nexport const CONTRACT_VERSION = "2026-08-24.10" as const;\n',
    ),
    null,
  );
});

test("renders the iOS mirror from the TypeScript contract source", () => {
  assert.match(
    renderSwiftContractMirror("2026-08-24.10"),
    /static let version = "2026-08-24\.10"/u,
  );
});

test("requires exact SQL and migration-manifest parity", () => {
  const names = parseMigrationManifest(
    JSON.stringify({
      schemaVersion: "talent-signal-migrations.v1",
      migrations: ["001_authority", "002_retention"],
    }),
  );
  assert.deepEqual(names, ["001_authority", "002_retention"]);
  assert.deepEqual(
    validateMigrationInventory(names, ["001_authority.sql"]),
    ["Migration manifest entry has no SQL file: 002_retention.sql"],
  );
  assert.deepEqual(
    validateMigrationInventory(names, [
      "001_authority.sql",
      "002_retention.sql",
      "003_unlisted.sql",
    ]),
    ["Migration SQL is not listed in the manifest: 003_unlisted.sql"],
  );
});

test("freezes migration names, order, and SQL until an append is reviewed", (t) => {
  const sql = new Map([
    ["001_authority", "one"],
    ["002_retention", "two"],
    ["003_append", "three"],
  ]);
  const readSql = (name) => sql.get(name);
  const baseline = migrationHistoryDigest(
    ["001_authority", "002_retention"],
    readSql,
  );
  assert.equal(
    migrationHistoryDigest(
      ["001_authority", "002_retention", "003_append"].slice(0, 2),
      readSql,
    ),
    baseline,
  );
  assert.notEqual(
    migrationHistoryDigest(
      ["002_retention", "001_authority"],
      readSql,
    ),
    baseline,
  );
  sql.set("002_retention", "changed");
  assert.notEqual(
    migrationHistoryDigest(
      ["001_authority", "002_retention"],
      readSql,
    ),
    baseline,
  );

  const root = createArchitectureFixture(t);
  const fixtureDigest = migrationHistoryDigest(
    ["001_authority"],
    () => "-- fixture\n",
  );
  assert.deepEqual(
    checkArchitectureBoundaries(root, {
      frozenMigrationCount: 1,
      frozenMigrationDigest: fixtureDigest,
    }).errors,
    [],
  );
  writeFixtureFile(
    root,
    "apps/backend/src/database/001_authority.sql",
    "-- changed fixture\n",
  );
  assert.ok(
    checkArchitectureBoundaries(root, {
      frozenMigrationCount: 1,
      frozenMigrationDigest: fixtureDigest,
    }).errors.some((error) => error.includes("Applied migration history changed")),
  );
  writeFixtureFile(
    root,
    "apps/backend/src/database/001_authority.sql",
    "-- fixture\n",
  );
  writeFixtureFile(
    root,
    "apps/backend/src/database/migration-manifest.json",
    `${JSON.stringify({
      schemaVersion: "talent-signal-migrations.v1",
      migrations: ["001_authority", "002_append"],
    })}\n`,
  );
  writeFixtureFile(
    root,
    "apps/backend/src/database/002_append.sql",
    "-- append\n",
  );
  assert.ok(
    checkArchitectureBoundaries(root, {
      frozenMigrationCount: 1,
      frozenMigrationDigest: fixtureDigest,
    }).errors.some((error) => error.includes("unfrozen entry")),
  );
  writeFixtureFile(
    root,
    "apps/backend/src/database/migration-manifest.json",
    `${JSON.stringify({
      schemaVersion: "talent-signal-migrations.v1",
      migrations: [],
    })}\n`,
  );
  rmSync(join(root, "apps/backend/src/database/001_authority.sql"));
  rmSync(join(root, "apps/backend/src/database/002_append.sql"));
  assert.ok(
    checkArchitectureBoundaries(root, {
      frozenMigrationCount: 1,
      frozenMigrationDigest: fixtureDigest,
    }).errors.some((error) => error.includes("shortened below")),
  );
});

test("rejects new numeric-prefix collisions", () => {
  assert.deepEqual(
    validateMigrationInventory(
      ["070_first", "070_second"],
      ["070_first.sql", "070_second.sql"],
    ),
    [
      "Migration prefix 070 is duplicated outside the frozen legacy baseline: 070_first, 070_second",
    ],
  );
});

test("allows only the exact deployed 073 pair", () => {
  const names = ["073_conversation_queue", "073_account_onboarding"];
  assert.deepEqual(validateMigrationInventory(names, names.map(name => `${name}.sql`)), []);
  for (const unexpected of [
    [...names, "073_unreviewed"],
    ["073_conversation_queue", "073_replacement"],
  ]) {
    assert.ok(validateMigrationInventory(unexpected, unexpected.map(name => `${name}.sql`))
      .some(error => error.includes("outside the frozen legacy baseline")));
  }
});

test("rejects direct, aliased, and linked inward workspace dependencies", () => {
  assert.deepEqual(
    unexpectedWorkspaceDependencies(
      {
        dependencies: {
          "@talent-signal/contracts": "workspace:*",
          "@talent-signal/backend": "workspace:*",
          "backend-alias": "workspace:@talent-signal/backend@*",
        },
        devDependencies: {
          "backend-alias": "1.0.0",
        },
      },
      ["@talent-signal/contracts"],
    ),
    ["@talent-signal/backend"],
  );
  const root = resolve("/fixture");
  assert.deepEqual(
    unexpectedWorkspaceDependencies(
      {
        dependencies: {
          "backend-file": "file:../backend",
          "backend-link": "link:../backend",
          "backend-relative": "workspace:../backend",
          "backend-renamed": "workspace:*",
        },
      },
      ["@talent-signal/contracts"],
      {
        internalPackageNames: new Set([
          "@talent-signal/backend",
          "backend-renamed",
        ]),
        manifestPath: "apps/web/package.json",
        packageNameByDirectory: new Map([
          [resolve(root, "apps/backend"), "@talent-signal/backend"],
        ]),
        root,
      },
    ),
    ["@talent-signal/backend", "backend-renamed"],
  );
});

test("freezes unique workspace package names and checks renamed targets", (t) => {
  const root = createArchitectureFixture(t);
  writeFixtureFile(
    root,
    "apps/backend/package.json",
    `${JSON.stringify({ name: "backend-core" })}\n`,
  );
  writeFixtureFile(
    root,
    "apps/web/package.json",
    `${JSON.stringify({
      name: "@talent-signal/web",
      dependencies: {
        "backend-core": "workspace:*",
        "backend-relative": "workspace:../backend",
      },
    })}\n`,
  );

  const renamedErrors = checkFixture(root).errors;
  assert.ok(
    renamedErrors.some((error) =>
      error.includes(
        "expected @talent-signal/backend, found backend-core",
      ),
    ),
  );
  assert.ok(
    renamedErrors.some((error) =>
      error.includes("forbidden inward dependencies: backend-core"),
    ),
  );

  writeFixtureFile(
    root,
    "packages/evaluation/package.json",
    `${JSON.stringify({ name: "@talent-signal/contracts" })}\n`,
  );
  assert.ok(
    checkFixture(root).errors.some((error) =>
      error.includes("Workspace package name is duplicated"),
    ),
  );
});

test("rejects source imports and aliases that bypass workspace manifests", (t) => {
  const root = createArchitectureFixture(t);
  const sourcePath = "apps/web/review-fixture.ts";

  writeFixtureFile(
    root,
    sourcePath,
    [
      '/// <reference path="../backend/src/config.d.ts" />',
      'import "../backend/src/config.js";',
      'export { run } from "../agent/src/run.js";',
      'const provider = import("../backend/src/provider.js");',
      'const legacy = require("../backend/src/legacy.js");',
      'const runtimeTarget = "../backend/src/runtime.js";',
      "require(runtimeTarget);",
      'type RemoteConfig = import("../backend/src/type-config.js").Config;',
      'import "@talent-signal/contracts/constants";',
      'const example = "import ../backend/src/not-code.js";',
      '// import "../backend/src/commented.js";',
    ].join("\n"),
  );
  const relativeImportErrors = checkFixture(root).errors.filter((error) =>
    error.includes(sourcePath),
  );
  assert.equal(relativeImportErrors.length, 6);
  assert.ok(
    relativeImportErrors.every((error) =>
      error.includes("across the @talent-signal/web ->"),
    ),
  );

  writeFixtureFile(
    root,
    sourcePath,
    'import "@talent-signal/backend/private";\n',
  );
  assert.ok(
    checkFixture(root).errors.some((error) =>
      error.includes(
        "imports forbidden workspace package @talent-signal/backend from @talent-signal/web",
      ),
    ),
  );

  rmSync(join(root, sourcePath));
  writeFixtureFile(
    root,
    "tsconfig.shared.json",
    [
      "{",
      "  // Inherited JSONC aliases must retain their declaring base path.",
      '  "compilerOptions": {',
      '    "baseUrl": ".",',
      '    "paths": { "@backend/*": ["apps/backend/src/*"] }',
      "  }",
      "}",
    ].join("\n"),
  );
  writeFixtureFile(
    root,
    "apps/web/tsconfig.json",
    `${JSON.stringify({ extends: "../../tsconfig.shared.json" })}\n`,
  );
  assert.ok(
    checkFixture(root).errors.some((error) =>
      error.includes(
        "maps @backend/* across the @talent-signal/web -> @talent-signal/backend workspace boundary",
      ),
    ),
  );
});

test("counts every supported logical line ending", () => {
  assert.equal(countLines(""), 0);
  assert.equal(countLines("one"), 1);
  assert.equal(countLines("one\ntwo\n"), 2);
  assert.equal(countLines("one\r\ntwo\r\n"), 2);
  assert.equal(countLines("one\rtwo\r"), 2);
  assert.equal(countLines("one\u2028two\u2029"), 2);
});

test("the full check reports cross-boundary regressions", (t) => {
  const root = createArchitectureFixture(t);
  assert.deepEqual(checkFixture(root).errors, []);

  writeFixtureFile(
    root,
    "apps/ios/Sources/Services/TextSignalSyncClient.swift",
    `import Foundation\n\n/*\n${renderSwiftContractMirror("2026-08-24.10")}\n*/\nenum TalentSignalAPIContract {\n    static let version = "stale"\n}\n`,
  );
  writeFixtureFile(
    root,
    "apps/backend/src/database/002_unlisted.sql",
    "-- fixture\n",
  );
  writeFixtureFile(
    root,
    "apps/backend/package.json",
    `${JSON.stringify({
      name: "@talent-signal/backend",
      optionalDependencies: { "@talent-signal/web": "workspace:*" },
    })}\n`,
  );
  writeFixtureFile(
    root,
    "apps/agent/src/runner.ts",
    "line\n".repeat(783),
  );
  writeFixtureFile(
    root,
    "apps/unmanaged/package.json",
    `${JSON.stringify({ name: "@talent-signal/unmanaged" })}\n`,
  );
  writeFixtureFile(
    root,
    "pnpm-workspace.yaml",
    'packages:\n  - "apps/*"\n  - "packages/*"\n  - "tools/*"\n',
  );

  const errors = checkFixture(root).errors;
  assert.equal(errors.length, 6);
  assert.ok(errors.some((error) => error.includes("iOS contract mirror drifted")));
  assert.ok(errors.some((error) => error.includes("002_unlisted.sql")));
  assert.ok(errors.some((error) => error.includes("@talent-signal/web")));
  assert.ok(
    errors.some((error) =>
      error.includes("apps/agent/src/runner.ts is 783 lines"),
    ),
  );
  assert.ok(errors.some((error) => error.includes("apps/unmanaged/package.json")));
  assert.ok(errors.some((error) => error.includes("pnpm-workspace.yaml")));
});

test("contract generation is exact and idempotent", (t) => {
  const root = createArchitectureFixture(t);
  const mirrorPath = join(
    root,
    "apps/ios/Sources/Services/TextSignalSyncClient.swift",
  );
  writeFileSync(
    mirrorPath,
    renderSwiftService("2026-08-24.10", "\r\n"),
  );
  assert.deepEqual(checkFixture(root).errors, []);
  writeSwiftContractMirror(root);
  assert.equal(
    readFileSync(mirrorPath, "utf8"),
    renderSwiftService("2026-08-24.10", "\r\n"),
  );

  writeFileSync(
    mirrorPath,
    renderSwiftService("stale", "\n", 'let marker = "🧭"\n'),
  );

  const first = writeSwiftContractMirror(root);
  const firstSource = readFileSync(mirrorPath, "utf8");
  const second = writeSwiftContractMirror(root);
  assert.equal(
    firstSource,
    renderSwiftService(
      first.contractVersion,
      "\n",
      'let marker = "🧭"\n',
    ),
  );
  assert.equal(readFileSync(mirrorPath, "utf8"), firstSource);
  assert.equal(second.digest, first.digest);
});

test("contract generation refuses ambiguous or commented mirrors", (t) => {
  const root = createArchitectureFixture(t);
  const mirrorPath = join(
    root,
    "apps/ios/Sources/Services/TextSignalSyncClient.swift",
  );
  writeFileSync(
    mirrorPath,
    `import Foundation\n\n/*\n${renderSwiftContractMirror("2026-08-24.10")}\n*/\n`,
  );
  assert.throws(
    () => writeSwiftContractMirror(root),
    /Expected exactly one active iOS contract mirror/u,
  );

  writeFileSync(
    mirrorPath,
    `import Foundation\n\n/* outer\n/* nested */\n${renderSwiftContractMirror("2026-08-24.10")}\n*/\n`,
  );
  assert.throws(
    () => writeSwiftContractMirror(root),
    /Expected exactly one active iOS contract mirror/u,
  );

  writeFileSync(
    mirrorPath,
    `import Foundation\n\nlet fakeMirror = \"\"\"\n${renderSwiftContractMirror("2026-08-24.10")}\n\"\"\"\n`,
  );
  assert.throws(
    () => writeSwiftContractMirror(root),
    /Expected exactly one active iOS contract mirror/u,
  );

  writeFileSync(
    mirrorPath,
    `import Foundation\n\nlet decoy = #\"\"\"\n\"\"\"\n${renderSwiftContractMirror("2026-08-24.10")}\n\"\"\"#\nenum TalentSignalAPIContract {\n    static let version = "stale"\n}\n`,
  );
  assert.ok(
    checkFixture(root).errors.some((error) =>
      error.includes("iOS contract mirror drifted"),
    ),
  );
  assert.throws(
    () => writeSwiftContractMirror(root),
    /Expected exactly one active iOS contract mirror/u,
  );
});
