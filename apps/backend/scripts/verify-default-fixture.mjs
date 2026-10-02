import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { loadConfig } from "../dist/config.js";
import { createPasswordSession } from "../dist/modules/auth.js";

// Creates and drops only its own disposable database, never seeds the supplied
// admin database. Require an explicitly selected loopback test server.
const adminUrl = new URL(process.env.FIXTURE_PROOF_DATABASE_URL || "");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(adminUrl.hostname));
assert.notEqual(process.env.NODE_ENV, "production");
const database = `ai_auth_entry_${randomUUID().replaceAll("-", "")}`;
const admin = new Pool({ connectionString: adminUrl.toString(), connectionTimeoutMillis: 5000 });
const proofUrl = new URL(adminUrl); proofUrl.pathname = `/${database}`;
const env = { ...process.env, NODE_ENV: "test", DATABASE_URL: proofUrl.toString(), SIMULATED_AUTH_ENABLED: "true", PASSWORD_AUTH_ENABLED: "true" };
let pool, created = false;
function command(file, overrides = {}, shouldPass = true) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], {
    env: { ...env, ...overrides }, encoding: "utf8", timeout: 120_000,
  });
  assert.equal(result.status === 0, shouldPass, `${file} completion`);
}
try {
  await admin.query(`CREATE DATABASE ${database}`); created = true;
  command("../dist/database/migrate.js");
  command("../dist/database/seed.js");
  command("../dist/database/seed.js");
  pool = new Pool({ connectionString: proofUrl.toString(), connectionTimeoutMillis: 5000 });
  const id = "10000000-0000-4000-8000-000000000013";
  const user = await pool.query("SELECT username,email FROM users WHERE id=$1", [id]);
  assert.deepEqual(user.rows, [{ username: "test@gmail.com", email: "test@gmail.com" }]);
  const config = { ...loadConfigFromFixture(), databaseUrl: proofUrl.toString() };
  for (const identifier of ["test@gmail.com", " TEST@GMAIL.COM "]) {
    const session = await createPasswordSession(pool, config, { identifier, password: "cubxxw", client_label: "ai-auth-proof" });
    assert.equal(session.user.username, "test@gmail.com");
    assert.equal(session.user.id, id);
  }
  await assert.rejects(pool.query("UPDATE users SET username='foreign@gmail.com' WHERE id=$1", [id]), { code: "23514" });
  await assert.rejects(pool.query("UPDATE users SET username='test@@gmail.com' WHERE id=$1", [id]), { code: "23514" });
  await pool.query("UPDATE users SET username='legacy_handle' WHERE id=$1", [id]);
  await pool.query("UPDATE users SET username='test@gmail.com' WHERE id=$1", [id]);
  command("../dist/database/seed.js", { NODE_ENV: "production", SIMULATED_AUTH_ENABLED: "false" }, false);
  command("../dist/database/seed.js", { SIMULATED_AUTH_ENABLED: "false" }, false);
} finally {
  await pool?.end();
  try {
    if (created) {
      await admin.query(`DROP DATABASE ${database}`);
      const remaining = await admin.query("SELECT datname FROM pg_database WHERE datname=$1", [database]);
      assert.equal(remaining.rowCount, 0);
    }
  } finally { await admin.end(); }
}
console.log(JSON.stringify({ passed: true, seededTwice: true, username: "test@gmail.com", email: "test@gmail.com", normalizedLogin: true, foreignAliasRejected: true, legacyHandlePreserved: true, productionAndDisabledSeedRejected: true, cleanupVerified: true, remainingDatabases: 0 }));
function loadConfigFromFixture() {
  const before = process.env.DATABASE_URL;
  process.env.DATABASE_URL = proofUrl.toString();
  try { return loadConfig(); }
  finally { if (before === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = before; }
}
