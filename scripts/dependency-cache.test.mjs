import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const { verifyDependencyCache } = createRequire(import.meta.url)("../apps/agent/scripts/verify-dependency-cache.cjs");
const linuxBuilder = { skip: process.platform !== "linux" };

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), "capir-cafs-guard-"));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function content(root, bytes, executable = false) {
  const digest = createHash("sha512").update(bytes).digest("hex");
  const directory = join(root, "v11", "files", digest.slice(0, 2));
  await mkdir(directory, { recursive: true });
  const file = join(directory, digest.slice(2) + (executable ? "-exec" : ""));
  await writeFile(file, bytes);
  return file;
}

test("missing and initialized empty CAFS stores are valid", linuxBuilder, async () => {
  await fixture(async (root) => {
    assert.deepEqual(await verifyDependencyCache(join(root, "missing")), { files: 0, bytes: 0 });
    assert.deepEqual(await verifyDependencyCache(root), { files: 0, bytes: 0 });
    await mkdir(join(root, "v11", "files", "00"), { recursive: true });
    assert.deepEqual(await verifyDependencyCache(root), { files: 0, bytes: 0 });
  });
});

test("regular and executable CAFS files are hashed independently of timestamps", linuxBuilder, async () => {
  await fixture(async (root) => {
    const normal = await content(root, Buffer.from("normal"));
    await content(root, Buffer.from("executable"), true);
    await utimes(normal, 0, 0);
    assert.deepEqual(await verifyDependencyCache(root), { files: 2, bytes: 16 });
  });
});

test("same-size corruption with preserved mtime fails closed", linuxBuilder, async () => {
  await fixture(async (root) => {
    const file = await content(root, Buffer.from("original"));
    const before = await stat(file);
    await writeFile(file, "corrupt!");
    await utimes(file, before.atime, before.mtime);
    await assert.rejects(verifyDependencyCache(root), /digest mismatch/);
  });
});

test("malformed bucket and content names fail closed", linuxBuilder, async () => {
  for (const relative of [["not-hex"], ["00", "not-a-digest"], ["00", "a".repeat(126) + "-unexpected"]]) {
    await fixture(async (root) => {
      const target = join(root, "v11", "files", ...relative);
      await mkdir(relative.length === 1 ? target : join(root, "v11", "files", relative[0]), { recursive: true });
      if (relative.length > 1) await writeFile(target, "bad");
      await assert.rejects(verifyDependencyCache(root), /Invalid CAFS/);
    });
  }
});

test("symbolic links at store, v11, files, bucket and content boundaries fail closed", linuxBuilder, async () => {
  for (const relative of [[], ["v11"], ["v11", "files"], ["v11", "files", "00"], ["v11", "files", "00", "a".repeat(126)]]) {
    await fixture(async (root) => {
      const store = join(root, "store");
      const target = join(store, ...relative);
      await mkdir(join(root, "outside"));
      await writeFile(join(root, "outside", "secret"), "must not read");
      await mkdir(join(target, ".."), { recursive: true });
      await symlink(relative.length === 4 ? join(root, "outside", "secret") : join(root, "outside"), target);
      await assert.rejects(verifyDependencyCache(store));
      assert.equal(await readFile(join(root, "outside", "secret"), "utf8"), "must not read");
    });
  }
});

test("a dangling files symlink is rejected rather than treated as empty", linuxBuilder, async () => {
  await fixture(async (root) => {
    await mkdir(join(root, "v11"));
    await symlink(join(root, "absent"), join(root, "v11", "files"));
    await assert.rejects(verifyDependencyCache(root));
  });
});

test("unreadable content fails closed", linuxBuilder, async () => {
  await fixture(async (root) => {
    const file = await content(root, Buffer.from("unreadable"));
    await chmod(file, 0);
    await assert.rejects(verifyDependencyCache(root), { code: "EACCES" });
  });
});
