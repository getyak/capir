/** GET-455 populated canonical upgrade and snapshot/tick contracts. Source
 * only until Root's dedicated Hosted empty-DB gate actually executes it.
 * No HTTP/login authority is fabricated: these are schema/read-predicate
 * contracts, not delivery authorization or a replacement for the original6. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient, type QueryResult } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importResearchNotebook, researchNotebookOwner, researchRecordId, type ResearchNotebook } from "./researchNotebookImport.js";

const supplied = process.env.GET_455_MEMORY_UPGRADE_TEST_DATABASE_URL;
const required = process.env.GET_455_MEMORY_UPGRADE_SQL_REQUIRED === "1";
if (!supplied && required) throw new Error("GET-455 requires its dedicated empty loopback database.");
let databaseName: string | undefined;
if (supplied) {
  let parsed: URL;
  try { parsed = new URL(supplied); } catch { throw new Error("GET-455 database URL is invalid."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || parsed.search || parsed.hash
    || !["localhost", "127.0.0.1"].includes(parsed.hostname)
    || !/^\/talent_signal_get455_upgrade_[a-z0-9_]+$/.test(parsed.pathname)) {
    throw new Error("GET-455 requires a dedicated empty loopback talent_signal_get455_upgrade_* database without URL options.");
  }
  databaseName = parsed.pathname.slice(1);
}
const suite = supplied ? describe.sequential : describe.skip;
const hash = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const sql = (name: string) => readFile(new URL(`../database/${name}.sql`, import.meta.url), "utf8");
type Graph = { account: string; user: string; memory: string; session: string; harness: string; workspace: string | null };
let pool: Pool | undefined, client: PoolClient | undefined, upgrade: string;
const graphs = new Map<string, Graph>();
let parent: Graph;
let importOwner: { accountId: string; userId: string };
const importPlans: Array<{ packet: ResearchNotebook; memory: string }> = [];
const before = new Map<string, { generation: string; invalidated: boolean; entries: number; body_hash: string }>();

async function graph(label: string, lab = false): Promise<Graph> {
  const g: Graph = { account: randomUUID(), user: randomUUID(), memory: randomUUID(), session: randomUUID(), harness: randomUUID(), workspace: null };
  const c = client!;
  await c.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'GET455 synthetic upgrade')", [g.account, `get455-${g.account}`]);
  await c.query("INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,'Synthetic upgrade owner',$4)",
    [g.user, g.account, `${g.user}@synthetic.example.test`, lab ? "lab_human" : "simulated_human"]);
  await c.query(`INSERT INTO memory_items(id,account_id,owner_user_id,scope,display_text,statement_kind,time_status,created_by_user_id)
    VALUES($1,$2,$3,'self','Synthetic durable literal clue','source_statement','unknown',$3)`, [g.memory, g.account, g.user]);
  await c.query(`INSERT INTO memory_item_evidence(id,account_id,memory_item_id,locator,excerpt,content_hash)
    VALUES($1,$2,$3,'{"kind":"document","document_id":"synthetic-upgrade"}'::jsonb,'Synthetic retained evidence',$4)`,
  [randomUUID(), g.account, g.memory, hash("Synthetic retained evidence")]);
  await c.query(`INSERT INTO agent_sessions(account_id,id,created_by_user_id,revision,payload,created_at,expires_at)
    VALUES($1,$2,$3,1,'{"turns":[]}'::jsonb,clock_timestamp(),clock_timestamp()+interval '1 hour')`, [g.account, g.session, g.user]);
  await c.query(`INSERT INTO harness_sessions(account_id,id,product_session_id,owner_user_id,sdk_session_id,
    configuration_fingerprint,scope_fingerprint,source_generation,expires_at)
    SELECT $1,$2,$3,$4,$5,$6,$6,generation,clock_timestamp()+interval '1 hour'
    FROM harness_source_generations WHERE account_id=$1`, [g.account, g.harness, g.session, g.user, randomUUID(), "a".repeat(64)]);
  await c.query(`INSERT INTO harness_session_entries(account_id,harness_session_id,entry_uuid,body)
    VALUES($1,$2,'synthetic-upgrade-entry','{"kind":"synthetic-upgrade-mirror"}'::jsonb)`, [g.account, g.harness]);
  if (lab) {
    g.workspace = randomUUID();
    await c.query(`INSERT INTO lab_test_workspaces(id,owner_account_id,owner_user_id,target_account_id,target_user_id,duration_hours,expires_at,media_scope_hash)
      VALUES($1,$2,$3,$4,$5,1,clock_timestamp()+interval '1 hour',$6)`,
    [g.workspace, parent.account, parent.user, g.account, g.user, "b".repeat(64)]);
  }
  graphs.set(label, g); return g;
}
async function state(g: Graph) {
  return (await client!.query<{ generation: string; invalidated: boolean; entries: number; body_hash: string }>(`SELECT generation::text,
    (SELECT invalidated_at IS NOT NULL FROM harness_sessions WHERE account_id=$1 AND id=$2) AS invalidated,
    (SELECT count(*)::int FROM harness_session_entries WHERE account_id=$1 AND harness_session_id=$2) AS entries,
    (SELECT encode(sha256(convert_to(row_to_json(m)::text,'UTF8')),'hex') FROM memory_items m WHERE account_id=$1 AND id=$3) AS body_hash
    FROM harness_source_generations WHERE account_id=$1`, [g.account, g.harness, g.memory])).rows[0]!;
}
async function applyUpgrade() {
  // Both source schedules share ONE actual upgrade COMMIT: one transaction
  // exists before migration, one begins only inside the seed->trigger window.
  let prior: PoolClient | undefined, fresh: PoolClient | undefined;
  const states = [{ begun: false, committed: false }, { begun: false, committed: false }];
  const pending: Array<Promise<{ ok: boolean }>> = [];
  let migrationBegun = false, migrationCommitted = false, allowCommit = true;
  const runImport = async (c: PoolClient, index: number) => {
    try {
      if (!states[index]!.begun) { await c.query("BEGIN"); states[index]!.begun = true; }
      const receipt = await importResearchNotebook(c, importOwner, importPlans[index]!.packet);
      expect(receipt.people).toBe(0); expect(receipt.replayedPeople).toBe(1); expect(receipt.notes).toBe(1);
      if (!allowCommit) { await c.query("ROLLBACK"); return { ok: false }; }
      const commit = await c.query("COMMIT"); expect(commit.command).toBe("COMMIT"); states[index]!.committed = true;
      return { ok: true };
    } catch {
      // Static outcome only. Cleanup is not evidence that an unknown COMMIT
      // was undone, and the writer is never automatically replayed.
      try { await c.query("ROLLBACK"); } catch { /* Root destroys this owned DB. */ }
      return { ok: false };
    }
  };
  try {
    prior = await pool!.connect(); fresh = await pool!.connect();
    const migrationPID = (await client!.query("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
    const ids = await Promise.all([prior, fresh].map(async c => (await c.query("SELECT pg_backend_pid() AS pid")).rows[0]!.pid as number));
    await prior.query("BEGIN"); states[0]!.begun = true;
    expect((await prior.query("SHOW transaction_isolation")).rows[0]?.transaction_isolation).toBe("read committed");
    await client!.query("BEGIN"); migrationBegun = true;
    // Byte-exact split, no replacement/reordering or synthetic migration SQL.
    // Cutover/natural-expiry observer runs BEFORE the concurrency checkpoint,
    // so observing the two blocked writers cannot eat its original2s window.
    const boundary = "CREATE TRIGGER saved_memory_item_transition";
    const split = upgrade.indexOf(boundary);
    expect(split > 0 && upgrade.indexOf(boundary, split + 1) < 0).toBe(true);
    const prefix = upgrade.slice(0, split), suffix = upgrade.slice(split);
    expect(prefix + suffix).toBe(upgrade);
    await client!.query(prefix);
    expect((await client!.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgrelid='memory_items'::regclass AND tgname='saved_memory_item_transition'")).rows[0]?.n).toBe(0);
    expect((await client!.query("SELECT count(*)::int AS n FROM memory_item_lineage")).rows[0]?.n).toBe(graphs.size);
    pending.push(runImport(prior, 0), runImport(fresh, 1));
    for (const pid of ids) {
      const until = Date.now() + 2_000; let blocked = false;
      while (Date.now() < until) {
        blocked = (await client!.query("SELECT $2::int=ANY(pg_blocking_pids($1)) AS blocked", [pid, migrationPID])).rows[0]?.blocked === true;
        if (blocked) break; await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
    }
    expect(states.map(s => s.committed)).toEqual([false, false]);
    expect((await client!.query("SELECT count(*)::int AS n FROM memory_items WHERE id=ANY($1::uuid[])", [importPlans.map(p => p.memory)])).rows[0]?.n).toBe(0);
    await client!.query(suffix);
    expect((await client!.query("COMMIT")).command).toBe("COMMIT"); migrationCommitted = true;
    expect(await Promise.all(pending)).toEqual([{ ok: true }, { ok: true }]);
    expect((await client!.query("SELECT count(*)::int AS n FROM memory_items m LEFT JOIN memory_item_lineage l ON l.account_id=m.account_id AND l.memory_item_id=m.id WHERE l.memory_item_id IS NULL")).rows[0]?.n).toBe(0);
    for (const plan of importPlans) {
      const epoch = async () => (await client!.query<{ epoch: string }>("SELECT epoch::text FROM memory_item_lineage WHERE account_id=$1 AND memory_item_id=$2", [importOwner.accountId, plan.memory])).rows[0]!.epoch;
      const first = BigInt(await epoch()); expect(first > 0n).toBe(true);
      await client!.query("UPDATE memory_item_evidence SET excerpt='Corrected synthetic evidence',content_hash=$3 WHERE account_id=$1 AND memory_item_id=$2", [importOwner.accountId, plan.memory, hash("Corrected synthetic evidence")]);
      const corrected = BigInt(await epoch()); expect(corrected > first).toBe(true);
      await client!.query("DELETE FROM memory_item_evidence WHERE account_id=$1 AND memory_item_id=$2", [importOwner.accountId, plan.memory]);
      const withdrawn = BigInt(await epoch()); expect(withdrawn > corrected).toBe(true);
      await client!.query("DELETE FROM memory_items WHERE account_id=$1 AND id=$2", [importOwner.accountId, plan.memory]);
      expect(BigInt(await epoch()) > withdrawn).toBe(true); // Registry does not cascade away.
    }
  } catch (error) {
    allowCommit = false;
    throw error;
  } finally {
    try {
      if (migrationBegun && !migrationCommitted) { allowCommit = false; await client!.query("ROLLBACK"); }
    } finally {
      // Release/rollback the migration before draining blocked writers. Even a
      // cleanup error may not bypass either owned writer's rollback/release.
      await Promise.allSettled(pending);
      try { if (states[0]!.begun && !states[0]!.committed) await prior?.query("ROLLBACK"); }
      finally { try { if (states[1]!.begun && !states[1]!.committed) await fresh?.query("ROLLBACK"); } finally { prior?.release(); fresh?.release(); } }
    }
  }
}
beforeAll(async () => {
  if (!supplied) return;
  // No global/resident DATABASE_URL fallback, CLI child or custom socket option.
  pool = new Pool({ connectionString: supplied, max: 3, statement_timeout: 5_000, query_timeout: 7_000,
    options: "-c search_path=public,pg_catalog", application_name: "get455-owned-empty-upgrade" });
  client = await pool.connect();
  expect((await client.query("SELECT current_database() AS db,current_schema() AS schema")).rows[0]).toEqual({ db: databaseName, schema: "public" });
  expect((await client.query("SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f')")).rows[0]?.n).toBe(0);
  // Exact current canonical manifest order/bytes, pre114. No old SQL rewriting,
  // schema aliases, disabled trigger or changed search_path inside migrations.
  const manifest = JSON.parse(await readFile(new URL("../database/migration-manifest.json", import.meta.url), "utf8")) as { schemaVersion: string; migrations: string[] };
  expect(manifest.schemaVersion).toBe("talent-signal-migrations.v1");
  const target = manifest.migrations.indexOf("114_saved_memory_lineage");
  const pre114 = target < 0 ? manifest.migrations : manifest.migrations.slice(0, target);
  expect(pre114).toContain("113_memory_literal_content");
  await client.query("CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())");
  for (const name of pre114) {
    const body = await sql(name);
    await client.query("BEGIN");
    try { await client.query(body); await client.query("INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)", [name, hash(body)]); await client.query("COMMIT"); }
    catch (error) { await client.query("ROLLBACK"); throw error; }
  }
  upgrade = await sql("114_saved_memory_lineage");
  parent = await graph("parent");
  await graph("ordinary"); await graph("active", true);
  for (const label of ["expired", "deleting", "deleted"] as const) {
    const g = await graph(label, true);
    if (label === "expired") await client.query("UPDATE lab_test_workspaces SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [g.workspace]);
    else await client.query(`UPDATE lab_test_workspaces SET state=$2,stop_id=$3,stop_reason='manual',stopped_at=clock_timestamp(),
      deleted_at=CASE WHEN $2='deleted' THEN clock_timestamp() ELSE NULL END WHERE id=$1`, [g.workspace, label, randomUUID()]);
  }
  const retired = await graph("retired");
  await client.query("UPDATE accounts SET retired_at=clock_timestamp() WHERE id=$1", [retired.account]);
  for (const [label, g] of graphs) before.set(label, await state(g));
  // Failure injection has no policy exemption: exercise whole migration atomic
  // rollback on an UNKNOWN error rather than accepting any guard failure.
  await client.query(`CREATE FUNCTION get455_fail_unknown_cutover() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN IF current_setting('get455.fail_cutover',true)='on' THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='GET455_EXPECTED_UPGRADE_FAILURE'; END IF; RETURN NEW; END; $f$;
    CREATE TRIGGER zz_get455_fail_unknown_cutover BEFORE UPDATE ON harness_source_generations
      FOR EACH ROW EXECUTE FUNCTION get455_fail_unknown_cutover()`);
  // Canonical operator provisioning before the timed upgrade; no credentials
  // leave this function, and no extra CLI/auth process or provider is started.
  await client.query("BEGIN");
  try {
    importOwner = await researchNotebookOwner(client, { email: `get455-import-${randomUUID()}@synthetic.example.test`,
      displayName: "Synthetic barrier owner", password: randomBytes(32).toString("base64url") });
    for (const label of ["prior", "fresh"]) {
      const namespace = `get455-${label}-${randomUUID()}`, key = "synthetic-person";
      const packet: ResearchNotebook = { schema: "research-notebook.v1", namespace, people: [{ key, name: "Synthetic existing person",
        notes: [{ key: "bounded-note", text: "An attributed synthetic research note.", section: "analysis", metadata: {} }] }] };
      await client.query("INSERT INTO subjects(id,account_id,external_ref,display_label) VALUES($1,$2,$3,$4)",
        [researchRecordId(importOwner.accountId, namespace, `person:${key}`), importOwner.accountId, `research:${namespace}:${key}`, packet.people[0]!.name]);
      importPlans.push({ packet, memory: researchRecordId(importOwner.accountId, namespace, `note:${key}:bounded-note`) });
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}, 60_000);
afterAll(async () => {
  try { client?.release(); } finally { await pool?.end(); }
  // Root owns creation/destruction of this unique DB, even on setup failure.
});

suite("saved Memory populated upgrade and fixed caller snapshot", () => {
  it("propagates unknown cutover failure and rolls back all DDL/backfill/SDK writes", async () => {
    await client!.query("BEGIN");
    try {
      await client!.query("SET LOCAL get455.fail_cutover='on'");
      await expect(client!.query(upgrade)).rejects.toMatchObject({ code: "P0001", message: "GET455_EXPECTED_UPGRADE_FAILURE" });
    } finally { await client!.query("ROLLBACK"); }
    expect((await client!.query("SELECT to_regclass('public.memory_item_lineage')::text AS name")).rows[0]?.name).toBeNull();
    for (const [label, g] of graphs) expect(await state(g)).toEqual(before.get(label));
  });

  it.each(["account", "workspace"] as const)("aborts instead of skipping or waiting on a competing %s lifecycle lock", async kind => {
    const control = await pool!.connect(), g = graphs.get(kind === "account" ? "ordinary" : "active")!;
    try {
      await control.query("BEGIN");
      // FK backfill's KEY SHARE is compatible with NO KEY UPDATE, so the
      // account case specifically reaches the new cutover SHARE NOWAIT fence.
      if (kind === "account") await control.query("SELECT id FROM accounts WHERE id=$1 FOR NO KEY UPDATE", [g.account]);
      else await control.query("SELECT id FROM lab_test_workspaces WHERE id=$1 FOR UPDATE", [g.workspace]);
      await client!.query("BEGIN");
      try { await expect(client!.query(upgrade)).rejects.toMatchObject({ code: "55P03" }); }
      finally { await client!.query("ROLLBACK"); }
      expect((await client!.query("SELECT to_regclass('public.memory_item_lineage')::text AS name")).rows[0]?.name).toBeNull();
    } finally { try { await control.query("ROLLBACK"); } finally { control.release(); } }
    for (const [label, item] of graphs) expect(await state(item)).toEqual(before.get(label));
  }, 10_000);

  it.each([
    { relation: "memory_items", change: "correction" }, { relation: "memory_items", change: "deletion" },
    { relation: "memory_item_evidence", change: "correction" }, { relation: "memory_item_evidence", change: "deletion" },
  ])("refuses a pre-existing $relation $change writer before seed without partial upgrade", async ({ relation, change }) => {
    const control = await pool!.connect(), g = graphs.get("ordinary")!;
    try {
      await control.query("BEGIN");
      // Real schema DML corresponding to canonical correction/deletion states;
      // no fake AuthContext/API permission is claimed by this storage fixture.
      if (relation === "memory_items") await control.query(change === "correction"
        ? "UPDATE memory_items SET display_text='Corrected synthetic literal',version=version+1 WHERE account_id=$1 AND id=$2"
        : "UPDATE memory_items SET status='deleted',deleted_at=clock_timestamp() WHERE account_id=$1 AND id=$2", [g.account, g.memory]);
      else await control.query(change === "correction"
        ? "UPDATE memory_item_evidence SET excerpt='Corrected synthetic evidence',content_hash='synthetic-correction' WHERE account_id=$1 AND memory_item_id=$2"
        : "UPDATE memory_item_evidence SET status='revoked',revoked_at=clock_timestamp() WHERE account_id=$1 AND memory_item_id=$2", [g.account, g.memory]);
      await client!.query("BEGIN");
      try { await expect(client!.query(upgrade)).rejects.toMatchObject({ code: "55P03" }); }
      finally { await client!.query("ROLLBACK"); }
      expect((await client!.query("SELECT to_regclass('public.memory_item_lineage')::text AS name")).rows[0]?.name).toBeNull();
    } finally { try { await control.query("ROLLBACK"); } finally { control.release(); } }
    for (const [label, item] of graphs) expect(await state(item)).toEqual(before.get(label));
  }, 10_000);

  it("prelocks ALL historical account FK rows NOWAIT against actual FOR UPDATE retirement locks", async () => {
    const control = await pool!.connect(), retired = graphs.get("retired")!;
    try {
      await control.query("BEGIN");
      await control.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [retired.account]);
      await client!.query("BEGIN");
      try { await expect(client!.query(upgrade)).rejects.toMatchObject({ code: "55P03" }); }
      finally { await client!.query("ROLLBACK"); }
      expect((await client!.query("SELECT to_regclass('public.memory_item_lineage')::text AS name")).rows[0]?.name).toBeNull();
    } finally { try { await control.query("ROLLBACK"); } finally { control.release(); } }
  }, 10_000);

  it("bounds earlier FK-DDL relation waits transaction-locally without changing session defaults", async () => {
    const control = await pool!.connect(), priorTimeout = (await client!.query("SHOW lock_timeout")).rows[0]?.lock_timeout;
    try {
      await control.query("BEGIN"); await control.query("LOCK TABLE accounts IN ROW EXCLUSIVE MODE");
      await client!.query("BEGIN");
      try { await expect(client!.query(upgrade)).rejects.toMatchObject({ code: "55P03" }); }
      finally { await client!.query("ROLLBACK"); }
      expect((await client!.query("SHOW lock_timeout")).rows[0]?.lock_timeout).toBe(priorTimeout);
      expect((await client!.query("SELECT to_regclass('public.memory_item_lineage')::text AS name")).rows[0]?.name).toBeNull();
    } finally { try { await control.query("ROLLBACK"); } finally { control.release(); } }
  }, 10_000);

  it("backfills all historical epochs, cuts over only live legal owners, and rolls back natural-expiry partial writes", async () => {
    const natural = await graph("natural", true); before.set("natural", await state(natural));
    // Nontransactional sequence is a test-only observer that proves the pause
    // actually ran even when the per-owner cutover subtransaction rolls back.
    await client!.query(`CREATE SEQUENCE get455_cutover_pause_calls;
      CREATE FUNCTION get455_pause_to_real_expiry() RETURNS trigger LANGUAGE plpgsql AS $f$
      DECLARE until_time timestamptz; BEGIN
       IF NEW.account_id='${natural.account}'::uuid THEN
        PERFORM nextval('get455_cutover_pause_calls');
        SELECT expires_at INTO until_time FROM lab_test_workspaces WHERE target_account_id=NEW.account_id;
        PERFORM pg_sleep(GREATEST(0,EXTRACT(epoch FROM until_time-clock_timestamp()))+0.01);
       END IF; RETURN NEW; END; $f$;
      CREATE TRIGGER zzz_get455_pause_to_real_expiry BEFORE UPDATE ON harness_source_generations
        FOR EACH ROW EXECUTE FUNCTION get455_pause_to_real_expiry()`);
    await client!.query("UPDATE lab_test_workspaces SET expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1", [natural.workspace]);
    await applyUpgrade();
    expect((await client!.query("SELECT last_value,is_called FROM get455_cutover_pause_calls")).rows[0]).toEqual({ last_value: "1", is_called: true });
    for (const [label, g] of graphs) {
      expect((await client!.query("SELECT epoch::text AS epoch,cleanup_epoch::text AS cleanup FROM memory_item_lineage WHERE account_id=$1 AND memory_item_id=$2", [g.account, g.memory])).rows[0]).toEqual({ epoch: "1", cleanup: "1" });
      const after = await state(g), prior = before.get(label)!;
      expect(after.body_hash).toBe(prior.body_hash);
      if (["parent", "ordinary", "active"].includes(label)) expect(after).toEqual({ ...prior, generation: (BigInt(prior.generation) + 1n).toString(), invalidated: true, entries: 0 });
      else expect(after).toEqual(prior);
    }
    // Existing guards still reject closed/expired and retired writes. A short
    // rollback clears the failed command without erasing its expected denial.
    for (const label of ["expired", "deleting", "deleted", "natural", "retired"]) {
      const g = graphs.get(label)!;
      await client!.query("BEGIN");
      try { await expect(client!.query("UPDATE harness_source_generations SET generation=generation WHERE account_id=$1", [g.account])).rejects.toMatchObject({ code: "P0001", message: label === "retired" ? "ACCOUNT_RETIRED" : "LAB_TEST_WORKSPACE_CLOSED" }); }
      finally { await client!.query("ROLLBACK"); }
    }
  }, 15_000);

  it("uses one outer MATERIALIZED DB tick for all three STABLE readers even across real expiry", async () => {
    const g = graphs.get("ordinary")!, task = randomUUID(), query = randomUUID();
    const data = (await client!.query(`WITH t AS MATERIALIZED (SELECT clock_timestamp() AS tick)
      SELECT to_char(tick AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cutoff,
        to_char((tick+interval '1 second') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS deadline FROM t`)).rows[0]!;
    const stamps = [{ item_id: g.memory, item_version: 1, lineage_epoch: "1", memory_owner_id: g.user, scope: "self", subject_id: null, relationship_context_id: null }];
    const proof = { version: 1, account_id: g.account, reader_actor_id: g.user, task_id: task, expires_at: data.deadline, stamps };
    expect((await client!.query("SELECT register_saved_memory_lineage($1,$2,$3,$4,$5::jsonb,$6) AS ok", [g.account, g.user, task, data.deadline, JSON.stringify(stamps), hash(JSON.stringify(proof))])).rows[0]?.ok).toBe(true);
    await client!.query(`INSERT INTO memory_discovery_queries(account_id,reader_actor_id,id,query_digest,projection_version,cursor_key,created_at,cutoff,expires_at)
      VALUES($1,$2,$3,$4,1,$5,$6,$6,$7)`, [g.account, g.user, query, "c".repeat(64), randomBytes(32), data.cutoff, data.deadline]);
    const parameters = [g.account, g.user, JSON.stringify(stamps), data.deadline, task, query, "c".repeat(64), data.cutoff];
    const statement = `WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at),
      waited AS MATERIALIZED (SELECT pg_sleep(GREATEST(0,EXTRACT(epoch FROM $4::timestamptz-clock_timestamp()))+0.02) FROM tick)
      SELECT saved_memory_read_set_current($1,$2,$3::jsonb,$4,tick.checked_at) AS readset,
        saved_memory_task_current($1,$5,$2,tick.checked_at) AS task,
        saved_memory_discovery_current($1,$2,$6,$7,1,$8,$4,$3::jsonb,$3::jsonb,ARRAY['%literal%'],10,$4,tick.checked_at) AS discovery,
        tick.checked_at<$4::timestamptz AS admitted_before,clock_timestamp()>$4::timestamptz AS finished_after
      FROM tick CROSS JOIN waited`;
    expect((await client!.query(statement, parameters)).rows[0]).toEqual({ readset: true, task: true, discovery: true, admitted_before: true, finished_after: true });
    const fresh = statement.replace("pg_sleep(GREATEST(0,EXTRACT(epoch FROM $4::timestamptz-clock_timestamp()))+0.02)", "pg_sleep(0)");
    expect((await client!.query(fresh, parameters)).rows[0]).toEqual({ readset: false, task: false, discovery: false, admitted_before: false, finished_after: true });
    // Frozen SQL admission is not delivery permission after expiry; the private
    // monotonic ticket's existing pure regressions deny that full roundtrip.
    const volatility = (await client!.query(`SELECT proname,provolatile FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid
      WHERE n.nspname='public' AND proname=ANY($1::text[]) ORDER BY proname`, [["saved_memory_discovery_current", "saved_memory_read_set_current", "saved_memory_task_current", "register_saved_memory_lineage", "scrub_saved_memory_task"]])).rows;
    expect(volatility).toEqual([{ proname: "register_saved_memory_lineage", provolatile: "v" }, { proname: "saved_memory_discovery_current", provolatile: "s" },
      { proname: "saved_memory_read_set_current", provolatile: "s" }, { proname: "saved_memory_task_current", provolatile: "s" }, { proname: "scrub_saved_memory_task", provolatile: "v" }]);
  }, 10_000);

  it("keeps Memory membership in the outer auth snapshot while another real connection commits a correction", async () => {
    const g = graphs.get("ordinary")!, reader = await pool!.connect(), lock = "get455-snapshot-" + randomUUID();
    let pending: Promise<QueryResult> | undefined;
    try {
      const pid = (await reader.query("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      const blocker = (await client!.query("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      await client!.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [lock]);
      const stamps = [{ item_id: g.memory, item_version: 1, lineage_epoch: "1", memory_owner_id: g.user, scope: "self", subject_id: null, relationship_context_id: null }];
      pending = reader.query(`WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at),
        actor AS MATERIALIZED (SELECT status='active' AS live FROM users WHERE account_id=$1 AND id=$2),
        barrier AS MATERIALIZED (SELECT pg_advisory_xact_lock_shared(hashtextextended($4,0)) FROM actor)
        SELECT actor.live AS auth_live,saved_memory_read_set_current($1,$2,$3::jsonb,tick.checked_at+interval '1 hour',tick.checked_at) AS memory_live
        FROM actor CROSS JOIN tick CROSS JOIN barrier`, [g.account, g.user, JSON.stringify(stamps), lock]);
      void pending.catch(() => {});
      const until = Date.now() + 2_000; let waiting = false;
      while (Date.now() < until) {
        waiting = (await client!.query("SELECT $2::int=ANY(pg_blocking_pids($1)) AS waiting", [pid, blocker])).rows[0]?.waiting === true;
        if (waiting) break; await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await client!.query("UPDATE memory_items SET display_text='Corrected synthetic literal clue',version=version+1 WHERE account_id=$1 AND id=$2", [g.account, g.memory]);
      await client!.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [lock]);
      expect((await pending).rows[0]).toEqual({ auth_live: true, memory_live: true });
      expect((await client!.query(`WITH tick AS MATERIALIZED (SELECT clock_timestamp() AS checked_at)
        SELECT saved_memory_read_set_current($1,$2,$3::jsonb,tick.checked_at+interval '1 hour',tick.checked_at) AS live FROM tick`, [g.account, g.user, JSON.stringify(stamps)])).rows[0]?.live).toBe(false);
    } finally {
      try { await client!.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [lock]); }
      finally { try { await pending?.catch(() => {}); } finally { reader.release(); } }
    }
  }, 10_000);
});
