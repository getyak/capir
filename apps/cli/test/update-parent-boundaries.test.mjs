import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, readlinkSync, lstatSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planLauncher, applyLauncher } from "../dist/update/layout.js";
import { updateNoticeEligible } from "../dist/update/notice.js";

test("offline and explicit update commands with leading flags never auto-check", () => {
  for (const argv of [["--human", "update", "--check"], ["--profile", "default", "doctor"], ["--human", "help"], ["auth", "status", "--env", "--help"]])
    assert.equal(updateNoticeEligible(argv), false, JSON.stringify(argv));
  assert.equal(updateNoticeEligible(["--env", "test", "auth", "status", "--human"]), true);
});

for (const dangling of [false, true]) {
  test(`launcher undo restores original symlink identity (dangling=${dangling})`, () => {
    const work = mkdtempSync(join(tmpdir(), "capir-parent-launcher-"));
    try {
      const launcher = join(work, "capir");
      const original = join(work, "original");
      if (!dangling) writeFileSync(original, "#!/bin/sh\necho legacy\n", { mode: 0o755 });
      symlinkSync("original", launcher);
      assert.throws(() => planLauncher(launcher, join(work, "install"), false), { code: "CAPIR_UPDATE_LAUNCHER_CONFLICT" });
      const applied = applyLauncher(planLauncher(launcher, join(work, "install"), true), join(work, "install"));
      assert.equal(lstatSync(launcher).isSymbolicLink(), false);
      applied.undo();
      assert.equal(lstatSync(launcher).isSymbolicLink(), true);
      assert.equal(readlinkSync(launcher), "original");
      assert.equal(lstatSync(applied.backup).isSymbolicLink(), true);
      if (!dangling) assert.equal(readFileSync(original, "utf8"), "#!/bin/sh\necho legacy\n");
    } finally { rmSync(work, { recursive: true, force: true }); }
  });
}


test("launcher undo restores an existing binary byte for byte", () => {
  const work = mkdtempSync(join(tmpdir(), "capir-parent-binary-"));
  try {
    const launcher = join(work, "capir"), root = join(work, "install");
    const original = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0xff, 0xc0, 0x80, 0x00]);
    writeFileSync(launcher, original, { mode: 0o751 });
    const applied = applyLauncher(planLauncher(launcher, root, true), root);
    applied.undo();
    assert.deepEqual(readFileSync(launcher), original);
    assert.deepEqual(readFileSync(applied.backup), original);
    assert.equal(lstatSync(launcher).mode & 0o777, 0o751);
  } finally { rmSync(work, { recursive: true, force: true }); }
});
