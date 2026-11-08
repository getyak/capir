/** Actual historical 099 SQL plus synthetic retained rows, upgraded by the
 * normal migrator. This owned empty database never uses the resident URL. */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../database/migrate.js";

const supplied = process.env.GET_455_MEMORY_LEGACY_UPGRADE_TEST_DATABASE_URL;
if (!supplied && process.env.GET_455_MEMORY_LEGACY_UPGRADE_SQL_REQUIRED === "1") {
  throw new Error("GET-455 requires its dedicated empty legacy-upgrade database.");
}
let databaseName: string | undefined;
if (supplied) {
  let url: URL;
  try { url = new URL(supplied); } catch { throw new Error("GET-455 legacy database URL is invalid."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || url.search || url.hash
    || !["127.0.0.1", "localhost"].includes(url.hostname)
    || !/^\/talent_signal_get455_legacy_upgrade_[a-z0-9_]+$/.test(url.pathname)) {
    throw new Error("GET-455 requires an owned loopback talent_signal_get455_legacy_upgrade_* database without URL options.");
  }
  databaseName = url.pathname.slice(1);
}
const suite = supplied ? describe : describe.skip;
const hash = (body: string) => createHash("sha256").update(body).digest("hex");
const sql = (name: string) => readFile(new URL(`../database/${name}.sql`, import.meta.url), "utf8");
let pool: Pool | undefined;
let legacyBefore: unknown;
const owner = { account: randomUUID(), user: randomUUID(), item: randomUUID(), task: randomUUID() };

async function legacySnapshot() {
  return (await pool!.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(d) ORDER BY task_id,memory_item_id) FROM agent_task_memory_dependencies d) AS rows,
    (SELECT jsonb_agg(jsonb_build_array(attnum,attname,format_type(atttypid,atttypmod),attnotnull,
      pg_get_expr(ad.adbin,ad.adrelid)) ORDER BY attnum)
      FROM pg_attribute a LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
      WHERE a.attrelid='agent_task_memory_dependencies'::regclass AND attnum>0 AND NOT attisdropped) AS columns,
    (SELECT jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) ORDER BY conname)
      FROM pg_constraint WHERE conrelid='agent_task_memory_dependencies'::regclass) AS constraints,
    (SELECT jsonb_agg(jsonb_build_array(indexname,indexdef) ORDER BY indexname)
      FROM pg_indexes WHERE schemaname='public' AND tablename='agent_task_memory_dependencies') AS indexes,
    (SELECT jsonb_agg(jsonb_build_array(tgname,pg_get_triggerdef(oid)) ORDER BY tgname)
      FROM pg_trigger WHERE tgrelid='agent_task_memory_dependencies'::regclass AND NOT tgisinternal) AS triggers,
    (SELECT scope FROM lab_test_workspace_table_manifest WHERE table_name='agent_task_memory_dependencies') AS lab_scope,
    (SELECT checksum FROM schema_migrations WHERE version='099_saved_memory_chat_lineage') AS applied_checksum`)).rows[0];
}

async function normalMigrate() {
  // migrate() owns its normal pool/transactions/checksums. The selector above
  // validates the sole replacement; no global/resident fallback is allowed.
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = supplied!;
  try { await migrate(); }
  finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
}

beforeAll(async () => {
  if (!supplied) return;
  pool = new Pool({ connectionString: supplied, max: 2, statement_timeout: 5_000, query_timeout: 7_000,
    options: "-c search_path=public,pg_catalog", application_name: "get455-owned-legacy-upgrade" });
  expect((await pool.query("SELECT current_database() AS db,current_schema() AS schema")).rows[0])
    .toEqual({ db: databaseName, schema: "public" });
  expect((await pool.query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')`)).rows[0]?.n).toBe(0);
  const manifest = JSON.parse(await readFile(new URL("../database/migration-manifest.json", import.meta.url), "utf8")) as { migrations: string[] };
  const boundary = manifest.migrations.indexOf("114_saved_memory_lineage");
  expect(boundary).toBe(117);
  const client = await pool.connect();
  try {
    await client.query("CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())");
    const legacy = await readFile(new URL("./fixtures/legacySavedMemory099.sql", import.meta.url), "utf8");
    // Byte-exact historical Git SQL, not a compatible empty-table substitute.
    expect(hash(legacy)).toBe("db07cef3fe5ca9a7976a79edc04d4fbe02a01322e7d20445040f2d37567c6160");
    for (const name of [...manifest.migrations.slice(0, boundary), "099_saved_memory_chat_lineage"]) {
      const body = name === "099_saved_memory_chat_lineage" ? legacy : await sql(name);
      await client.query("BEGIN");
      try {
        await client.query(body);
        await client.query("INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)", [name, hash(body)]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
    }
    await client.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic legacy upgrade')", [owner.account, `legacy-${owner.account}`]);
    await client.query(`INSERT INTO users(id,account_id,email,display_name,kind)
      VALUES($1,$2,$3,'Synthetic retained owner','simulated_human')`, [owner.user, owner.account, `${owner.user}@synthetic.example.test`]);
    await client.query(`INSERT INTO memory_items(id,account_id,owner_user_id,scope,display_text,statement_kind,time_status,created_by_user_id)
      VALUES($1,$2,$3,'self','Synthetic retained old clue','source_statement','unknown',$3)`, [owner.item, owner.account, owner.user]);
    await client.query(`INSERT INTO agent_task_memory_dependencies(account_id,task_id,memory_item_id,memory_item_version,owner_user_id)
      VALUES($1,$2,$3,1,$4),($1,'synthetic-legacy-text-task',$3,7,$4)`, [owner.account, owner.task, owner.item, owner.user]);
  } finally { client.release(); }
  legacyBefore = await legacySnapshot();
}, 60_000);
afterAll(async () => { await pool?.end(); });

suite("saved Memory historical 099 compatibility through the normal migrator", { concurrent: false }, () => {
  it("upgrades both canonical drafts without changing the old table, constraints, trigger or retained rows", async () => {
    await normalMigrate();
    expect(await legacySnapshot()).toEqual(legacyBefore);
    expect((await pool!.query(`SELECT version,checksum FROM schema_migrations
      WHERE version=ANY($1::text[]) ORDER BY version`, [["114_saved_memory_lineage", "115_saved_memory_durable_retention"]])).rows)
      .toEqual(await Promise.all(["114_saved_memory_lineage", "115_saved_memory_durable_retention"].map(async version => ({ version, checksum: hash(await sql(version)) }))));
    expect((await pool!.query(`SELECT table_name,scope FROM lab_test_workspace_table_manifest
      WHERE table_name=ANY($1::text[]) ORDER BY table_name`, [["agent_task_memory_dependencies", "agent_task_saved_memory_dependencies"]])).rows)
      .toEqual([{ table_name: "agent_task_memory_dependencies", scope: "account" }, { table_name: "agent_task_saved_memory_dependencies", scope: "account" }]);
  }, 30_000);

  it("does not convert a legacy UUID or text task into a new epoch proof or a new read grant", async () => {
    expect((await pool!.query("SELECT count(*)::int AS n FROM agent_task_saved_memory_dependencies")).rows[0]?.n).toBe(0);
    expect((await pool!.query("SELECT count(*)::int AS n FROM agent_task_memory_lineage")).rows[0]?.n).toBe(0);
    expect((await pool!.query(`SELECT saved_memory_task_current($1,$2,$3,clock_timestamp()) AS readable`,
      [owner.account, owner.task, owner.user])).rows[0]?.readable).toBe(false);
    expect((await pool!.query(`SELECT format_type(atttypid,atttypmod) AS type FROM pg_attribute
      WHERE attrelid='agent_task_saved_memory_dependencies'::regclass AND attname='task_id'`)).rows[0]?.type).toBe("uuid");
    expect(await legacySnapshot()).toEqual(legacyBefore);
  });

  it("repeats the normal migration with identical applied receipts and retained rows", async () => {
    const before = (await pool!.query("SELECT * FROM schema_migrations ORDER BY version")).rows;
    await normalMigrate();
    expect((await pool!.query("SELECT * FROM schema_migrations ORDER BY version")).rows).toEqual(before);
    expect(await legacySnapshot()).toEqual(legacyBefore);
  }, 30_000);

  it("still refuses any already-applied checksum mismatch without rewriting that receipt", async () => {
    const checksum = hash(await sql("114_saved_memory_lineage"));
    await pool!.query("UPDATE schema_migrations SET checksum=$1 WHERE version='114_saved_memory_lineage'", ["0".repeat(64)]);
    try {
      await expect(normalMigrate()).rejects.toThrow("Migration 114_saved_memory_lineage differs from the already applied checksum.");
      expect((await pool!.query("SELECT checksum FROM schema_migrations WHERE version='114_saved_memory_lineage'")).rows[0]?.checksum).toBe("0".repeat(64));
      expect(await legacySnapshot()).toEqual(legacyBefore);
    } finally {
      await pool!.query("UPDATE schema_migrations SET checksum=$1 WHERE version='114_saved_memory_lineage'", [checksum]);
    }
  }, 30_000);
});
