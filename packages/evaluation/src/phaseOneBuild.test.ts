import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { phaseOneImplementationSourceDigest, phaseOneRuntimeBuildDigest } from "./phaseOneBuild.js";

const directories: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "phase-one-build-")); directories.push(root);
  for (const path of ["apps/agent", "apps/backend", "packages/contracts", "packages/evaluation"]) {
    mkdirSync(join(root, path, "src"), { recursive: true }); mkdirSync(join(root, path, "dist"));
    writeFileSync(join(root, path, "src", "entry.ts"), "export const loaded = 'source';\n");
    writeFileSync(join(root, path, "dist", "entry.js"), "export const loaded = 'compiled';\n");
    writeFileSync(join(root, path, "package.json"), "{}");
  }
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, ".github/workflows/ci.yml"), "name: test"); writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: 9");
  return root;
}
afterEach(() => { for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe("actual phase one build identity", () => {
  it("detects emitted code changes even when prompt revisions and source labels are unchanged", () => {
    const root = fixture(), before = phaseOneRuntimeBuildDigest(root), source = phaseOneImplementationSourceDigest(root);
    writeFileSync(join(root, "apps/backend/dist/entry.js"), "export const loaded = 'different compiled behavior';\n");
    expect(phaseOneRuntimeBuildDigest(root)).not.toBe(before);
    expect(phaseOneImplementationSourceDigest(root)).toBe(source);
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: changed");
    expect(phaseOneImplementationSourceDigest(root)).not.toBe(source);
    const beforeMigration = phaseOneImplementationSourceDigest(root);
    writeFileSync(join(root, "apps/backend/src", "057_feedback_learning.sql"), "CREATE TRIGGER retract_private_sources;\n");
    expect(phaseOneImplementationSourceDigest(root)).not.toBe(beforeMigration);
  });
  it("rejects build symlinks instead of hashing arbitrary files outside the artifact", () => {
    const root = fixture(); symlinkSync(join(root, "pnpm-lock.yaml"), join(root, "apps/agent/dist/outside.js"));
    expect(() => phaseOneRuntimeBuildDigest(root)).toThrow("PHASE_ONE_BUILD_SYMLINK_REJECTED");
  });
});
