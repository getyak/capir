/** GET-451 storage integrity, not HTTP/source admission or human acceptance.
 * Opt in only with a new empty task-owned loopback DB. This test never reads
 * the resident/general DATABASE_URL, resets a DB, or drops/truncates data.
 * Root's dedicated Hosted gate must set REQUIRED=1 and require zero skips. */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMemoryAcceptedContentManifest, createMemoryContentManifest,
  createMemoryEvidenceManifest } from "@talent-signal/contracts";

const supplied = process.env.GET_451_MEMORY_LITERAL_TEST_DATABASE_URL;
if (!supplied && process.env.GET_451_MEMORY_LITERAL_SQL_REQUIRED === "1") {
  throw new Error("GET-451 requires its dedicated empty loopback database.");
}
let databaseName: string | undefined;
if (supplied) {
  let parsed: URL;
  try { parsed = new URL(supplied); }
  catch { throw new Error("GET-451 database URL is invalid."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["127.0.0.1", "localhost"].includes(parsed.hostname)
    || !/^\/talent_signal_get451_literal_[a-z0-9_]+$/u.test(parsed.pathname)
    || parsed.search || parsed.hash) {
    throw new Error("GET-451 requires a task-owned loopback talent_signal_get451_literal_* database without URL options.");
  }
  databaseName = parsed.pathname.slice(1);
}

const suite = supplied ? describe : describe.skip;
const migration = "113_memory_literal_content";
const tables = ["memory_proposal_items", "memory_items", "memory_item_evidence", "memory_review_drafts"] as const;
const newFields = ["content_protocol", "content_manifest", "content_manifest_digest", "content_version"];
const digest = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
const copy = <T>(value: T): T => structuredClone(value);
const json = (value: unknown): string => JSON.stringify(value);
const SQL_NULL = Symbol("SQL NULL, not JSON null");
const sqlJson = (value: unknown): string | null => value === SQL_NULL || value === undefined ? null : json(value);
type Json = Record<string, any>;
type Descriptor = { sha256: string; utf8_bytes: number; utf16_code_units: number; unicode_scalar_count: number };
// Deliberately independent of the production codec. Committed golden counts
// below are the stronger oracle; this helper makes additional boundary tuples.
function stats(text: string): Descriptor {
  return { sha256: digest(text), utf8_bytes: Buffer.byteLength(text, "utf8"),
    utf16_code_units: text.length, unicode_scalar_count: [...text].length };
}
const tuple = (d: Descriptor): unknown[] => [d.sha256, d.utf8_bytes, d.utf16_code_units, d.unicode_scalar_count];
function rangeTuple(range: Json | null): unknown[] | null {
  return range === null ? null : [range.kind, range.session_id, range.message_id, range.range_version,
    range.representation, range.offset_unit, range.character_start, range.character_end,
    range.source_revision_hash, range.source_text_sha256, range.excerpt_sha256];
}
function proposalDigest(manifest: Json): string {
  return digest(json(["literal-v2", manifest.original_content_protocol, tuple(manifest.display_text),
    tuple(manifest.original_display_text), tuple(manifest.source_excerpt), manifest.source_revision_hash,
    manifest.source_locator_sha256, rangeTuple(manifest.message_range)]));
}
function evidenceDigest(manifest: Json): string {
  return digest(json(["memory-evidence-literal-v2", tuple(manifest.excerpt), manifest.source_revision_hash,
    manifest.source_locator_sha256, rangeTuple(manifest.message_range)]));
}
function acceptedDigest(manifest: Json): string {
  return digest(json(["memory-accepted-literal.v1", manifest.original_content_protocol, tuple(manifest.display_text),
    manifest.original_display_text === null ? null : tuple(manifest.original_display_text),
    manifest.reviewed_evidence.map((ref: Json) => [ref.evidence_id, ref.content_protocol, ref.content_version, ref.content_manifest_digest])]));
}

const revision = "a".repeat(64), locatorHash = "b".repeat(64);
const fixedSession = "11111111-1111-4111-8111-111111111111", fixedMessage = "22222222-2222-4222-8222-222222222222";
const documentLocator = { kind: "document", document_id: "get451-synthetic" };
type Proposal = { manifest: Json; hash: string; display: string; original: string; excerpt: string;
  revision: string; excerptHash: string; locator: Json; session: string | null; message: string | null };
function proposal(display = "é", original = "e\u0301", excerpt = "e\u0301"): Proposal {
  const manifest = { version: "literal-v2", original_content_protocol: "literal-v2", display_text: stats(display),
    original_display_text: stats(original), source_excerpt: stats(excerpt), source_revision_hash: revision,
    source_locator_sha256: locatorHash, message_range: null };
  return { manifest, hash: proposalDigest(manifest), display, original, excerpt, revision,
    excerptHash: digest(excerpt), locator: documentLocator, session: null, message: null };
}
type Evidence = { manifest: Json; hash: string; excerpt: string; contentHash: string; locator: Json;
  session: string | null; message: string | null };
function evidence(excerpt = "e\u0301"): Evidence {
  const manifest = { version: "literal-v2", excerpt: stats(excerpt), source_revision_hash: revision,
    source_locator_sha256: locatorHash, message_range: null };
  return { manifest, hash: evidenceDigest(manifest), excerpt, contentHash: digest(excerpt),
    locator: documentLocator, session: null, message: null };
}
const legacyRef = (id = fixedSession) => ({ evidence_id: id, content_protocol: "legacy-v1", content_version: 1, content_manifest_digest: null });
type Accepted = { manifest: Json; hash: string; display: string; original: string | null };
function accepted(display = "é", original: string | null = "e\u0301", refs = [legacyRef()]): Accepted {
  const manifest = { version: "accepted-memory-literal.v1", original_content_protocol: original === null ? "legacy-v1" : "literal-v2",
    display_text: stats(display), original_display_text: original === null ? null : stats(original), reviewed_evidence: refs };
  return { manifest, hash: acceptedDigest(manifest), display, original };
}

let pool: Pool | undefined, client: PoolClient | undefined;
let accountID: string, userID: string, proposalID: string, memoryID: string, proposalItemID: string, draftID: string;
let legacyBefore: unknown, legacyAfter: unknown, migrationUpdates = -1, migrationChecksum = "", expectedChecksum = "";
let contentGolden: Json, acceptedGolden: Json;
async function snapshots(): Promise<unknown> {
  const result: Record<string, unknown> = {};
  // These four identifiers are fixed test-owned names, not dynamic input.
  for (const table of tables) {
    result[table] = (await pool!.query(`SELECT to_jsonb(t) - $2::text[] AS row FROM ${table} t
      WHERE account_id=$1 ORDER BY id`, [accountID, newFields])).rows.map(row => row.row);
  }
  return result;
}
async function seedLegacy(): Promise<void> {
  accountID = randomUUID(); userID = randomUUID(); proposalID = randomUUID(); memoryID = randomUUID();
  proposalItemID = randomUUID(); draftID = randomUUID();
  await pool!.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'GET-451 synthetic SQL')", [accountID, `get451-${accountID}`]);
  await pool!.query(`INSERT INTO users(id,account_id,email,display_name,kind)
    VALUES($1,$2,$3,'Synthetic owner','simulated_human')`, [userID, accountID, `${userID}@synthetic.example.test`]);
  await pool!.query(`INSERT INTO memory_proposals(id,account_id,created_by_user_id,proposer_kind,proposer_name,
    proposer_version,surface,contact_decision,contact_status,target_revision,expires_at)
    VALUES($1,$2,$3,'human','Synthetic','1','chat','none','resolved',1,now()+interval '1 day')`, [proposalID, accountID, userID]);
  const display = `  Ａe\u0301🙂${"x".repeat(1200)}\r\n `, excerpt = `Old excerpt ${"x".repeat(5000)}\r\n`;
  await pool!.query(`INSERT INTO memory_items(id,account_id,owner_user_id,scope,display_text,statement_kind,time_status,
    created_by_user_id,original_display_text) VALUES($1,$2,$3,'self',$4,'fact','unknown',$3,NULL)`, [memoryID, accountID, userID, display]);
  await pool!.query(`INSERT INTO memory_item_evidence(id,account_id,memory_item_id,locator,excerpt,content_hash)
    VALUES($1,$2,$3,$4::jsonb,$5,$6)`, [randomUUID(), accountID, memoryID, json(documentLocator), excerpt, digest(excerpt)]);
  await pool!.query(`INSERT INTO memory_proposal_items(id,account_id,proposal_id,scope,operation,statement_kind,display_text,
    original_display_text,time_status,admission_status,default_selected,reason,source_excerpt,source_excerpt_hash,
    locator,content_hash,added_revision,subject_kind,relationship_kind,source_revision_hash)
    VALUES($1,$2,$3,'self','add','fact',$4,$4,'unknown','eligible',false,'Synthetic integrity fixture',$5,$6,
      $7::jsonb,$6,1,'owner_self','none',$8)`, [proposalItemID, accountID, proposalID, display, excerpt, digest(excerpt), json(documentLocator), revision]);
  // Valid old storage can exceed the old API's 1000/4000 caps. This is not an
  // assertion that the old HTTP API admitted these values or any source.
  await pool!.query(`INSERT INTO memory_review_drafts(id,account_id,proposal_id,reader_user_id,contact_decision,
    selected_item_ids,edited_text,item_decisions,expires_at)
    VALUES($1,$2,$3,$4,'none',$5::uuid[],$6::jsonb,$7::jsonb,now()+interval '1 day')`,
  [draftID, accountID, proposalID, userID, [proposalItemID], json({ [proposalItemID]: display }), json({ [proposalItemID]: "accept" })]);
}

async function applyOldPrefixThenRealMigration(): Promise<void> {
  const manifest = JSON.parse(await readFile(new URL("../database/migration-manifest.json", import.meta.url), "utf8")) as Json;
  if (manifest.schemaVersion !== "talent-signal-migrations.v1" || !Array.isArray(manifest.migrations)
    || !manifest.migrations.every((value: unknown) => typeof value === "string" && /^\d{3}_[a-z0-9_]+$/u.test(value))) {
    throw new Error("GET-451 canonical migration manifest is invalid.");
  }
  const versions = manifest.migrations as string[], index = versions.indexOf(migration);
  if (index < 0 || versions.lastIndexOf(migration) !== index) throw new Error("GET-451 migration must occur exactly once in the canonical manifest.");
  await pool!.query(`CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now())`);
  for (const version of versions.slice(0, index)) {
    const sql = await readFile(new URL(`../database/${version}.sql`, import.meta.url), "utf8");
    await pool!.query("BEGIN");
    try {
      await pool!.query(sql);
      await pool!.query("INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)", [version, digest(sql)]);
      await pool!.query("COMMIT");
    } catch (error) { await pool!.query("ROLLBACK"); throw error; }
  }
  expect((await pool!.query(`SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_schema='public' AND table_name=ANY($1::text[]) AND column_name='content_protocol'`, [tables])).rows[0]?.n).toBe(0);
  await seedLegacy();
  // A real trigger observer distinguishes no row UPDATE from merely equal
  // final values. Only table names/transaction IDs are observed, never text.
  await pool!.query(`CREATE TABLE get451_literal_upgrade_updates(table_name text NOT NULL,transaction_id bigint NOT NULL);
    CREATE FUNCTION get451_literal_observe_update() RETURNS trigger LANGUAGE plpgsql AS $observer$
    BEGIN INSERT INTO get451_literal_upgrade_updates VALUES(TG_TABLE_NAME,txid_current()); RETURN NEW; END; $observer$;`);
  for (const table of tables) await pool!.query(`CREATE TRIGGER get451_literal_observe_update BEFORE UPDATE ON ${table}
    FOR EACH ROW EXECUTE FUNCTION get451_literal_observe_update()`);
  await pool!.query("UPDATE memory_items SET display_text=display_text WHERE account_id=$1 AND id=$2", [accountID, memoryID]);
  expect((await pool!.query("SELECT count(*)::int AS n FROM get451_literal_upgrade_updates")).rows[0]?.n).toBe(1);
  legacyBefore = await snapshots();
  expectedChecksum = digest(await readFile(new URL(`../database/${migration}.sql`, import.meta.url), "utf8"));
  const previous = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_URL = supplied!;
    // This is the real loader/checksum/transaction path, not a direct call to
    // SQL113 or a hand-built approximation of its schema. No CLI child is run.
    await (await import("../database/migrate.js")).migrate();
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
  const applied = (await pool!.query("SELECT checksum,xmin::text AS tx FROM schema_migrations WHERE version=$1", [migration])).rows[0];
  expect(applied).toBeDefined(); migrationChecksum = applied.checksum;
  migrationUpdates = (await pool!.query(`SELECT count(*)::int AS n FROM get451_literal_upgrade_updates
    WHERE mod(transaction_id,4294967296)=$1::bigint`, [applied.tx])).rows[0].n;
  legacyAfter = await snapshots();
}

async function proposalValid(p: Proposal, manifest: unknown = p.manifest): Promise<boolean> {
  return (await client!.query(`SELECT memory_literal_proposal_113($1::jsonb,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::uuid,$10::uuid) AS valid`,
    [sqlJson(manifest), p.hash, p.display, p.original, p.excerpt, p.revision,
      p.excerptHash, json(p.locator), p.session, p.message])).rows[0].valid;
}
async function evidenceValid(e: Evidence, manifest: unknown = e.manifest): Promise<boolean> {
  return (await client!.query(`SELECT memory_literal_evidence_113($1::jsonb,$2,$3,$4,$5::jsonb,$6::uuid,$7::uuid) AS valid`,
    [sqlJson(manifest), e.hash, e.excerpt, e.contentHash, json(e.locator), e.session, e.message])).rows[0].valid;
}
async function acceptedValid(a: Accepted, manifest: unknown = a.manifest): Promise<boolean> {
  return (await client!.query("SELECT memory_literal_accepted_113($1::jsonb,$2,$3,$4) AS valid",
    [sqlJson(manifest), a.hash, a.display, a.original])).rows[0].valid;
}
async function insertProposal(p = proposal(), overrides: Json = {}): Promise<string> {
  const id = randomUUID(), v = { content_protocol: "literal-v2", content_manifest: p.manifest,
    content_manifest_digest: p.hash, previous_text: null, ...overrides };
  await client!.query(`INSERT INTO memory_proposal_items(id,account_id,proposal_id,scope,operation,statement_kind,
    display_text,original_display_text,time_status,admission_status,default_selected,reason,source_excerpt,
    source_excerpt_hash,locator,content_hash,added_revision,subject_kind,relationship_kind,source_revision_hash,
    source_session_id,source_message_id,content_protocol,content_manifest,content_manifest_digest,previous_text)
    VALUES($1,$2,$3,'self','add','fact',$4,$5,'unknown','eligible',false,'Synthetic SQL',$6,$7,$8::jsonb,$7,1,
      'owner_self','none',$9,$10::uuid,$11::uuid,$12,$13::jsonb,$14,$15)`,
  [id, accountID, proposalID, p.display, p.original, p.excerpt, p.excerptHash, json(p.locator), p.revision,
    p.session, p.message, v.content_protocol, sqlJson(v.content_manifest), v.content_manifest_digest, v.previous_text]);
  return id;
}
async function insertAccepted(a = accepted(), overrides: Json = {}): Promise<string> {
  const id = randomUUID(), v = { content_protocol: "literal-v2", content_manifest: a.manifest, content_manifest_digest: a.hash, ...overrides };
  await client!.query(`INSERT INTO memory_items(id,account_id,owner_user_id,scope,display_text,original_display_text,
    statement_kind,time_status,created_by_user_id,content_protocol,content_manifest,content_manifest_digest)
    VALUES($1,$2,$3,'self',$4,$5,'fact','unknown',$3,$6,$7::jsonb,$8)`,
  [id, accountID, userID, a.display, a.original, v.content_protocol, sqlJson(v.content_manifest), v.content_manifest_digest]);
  return id;
}
async function insertEvidence(e = evidence(), overrides: Json = {}): Promise<string> {
  const id = randomUUID(), v = { content_protocol: "literal-v2", content_version: 1, content_manifest: e.manifest, content_manifest_digest: e.hash, ...overrides };
  await client!.query(`INSERT INTO memory_item_evidence(id,account_id,memory_item_id,locator,excerpt,content_hash,
    source_session_id,source_message_id,content_protocol,content_version,content_manifest,content_manifest_digest)
    VALUES($1,$2,$3,$4::jsonb,$5,$6,$7::uuid,$8::uuid,$9,$10,$11::jsonb,$12)`,
  [id, accountID, memoryID, json(e.locator), e.excerpt, e.contentHash, e.session, e.message,
    v.content_protocol, v.content_version, sqlJson(v.content_manifest), v.content_manifest_digest]);
  return id;
}
async function rejectsWrite(run: () => Promise<unknown>, constraint?: string, code = "23514"): Promise<void> {
  await client!.query("SAVEPOINT get451_expected_failure");
  let failure: any;
  try { await run(); } catch (error) { failure = error; }
  finally { await client!.query("ROLLBACK TO SAVEPOINT get451_expected_failure"); await client!.query("RELEASE SAVEPOINT get451_expected_failure"); }
  expect(failure, "the actual write must fail, not just a later read/assertion").toBeDefined();
  expect(failure.code).toBe(code);
  if (constraint) expect(failure.constraint).toBe(constraint);
}
async function updateDraft(edited: unknown, decisions: unknown = {}, selected: unknown = [], protocol = "literal-v2"): Promise<void> {
  await client!.query(`UPDATE memory_review_drafts SET content_protocol=$1,edited_text=$2::jsonb,item_decisions=$3::jsonb,
    selected_item_ids=$4::uuid[],revision=revision+1 WHERE account_id=$5 AND id=$6`,
  [protocol, json(edited), json(decisions), selected, accountID, draftID]);
}

suite("GET-451 real canonical migration and bounded literal SQL", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: supplied!, max: 1, connectionTimeoutMillis: 5000,
      statement_timeout: 15000, query_timeout: 16000, application_name: "get451-literal-synthetic-sql" });
    expect((await pool.query("SELECT current_database() AS name")).rows[0]?.name).toBe(databaseName);
    const occupied = await pool.query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'
      AND n.nspname NOT LIKE 'pg_temp_%' AND c.relkind IN ('r','p','v','m','S','f')`);
    if (occupied.rows[0]?.n !== 0) throw new Error("GET-451 refuses a database that is not empty.");
    contentGolden = JSON.parse(await readFile(new URL("../../../../packages/contracts/src/memoryContentGolden.json", import.meta.url), "utf8"));
    acceptedGolden = JSON.parse(await readFile(new URL("../../../../packages/contracts/src/memoryAcceptedContentGolden.json", import.meta.url), "utf8"));
    await applyOldPrefixThenRealMigration();
  }, 120_000);
  afterAll(async () => { await pool?.end(); });
  beforeEach(async () => { client = await pool!.connect(); await client.query("BEGIN"); });
  afterEach(async () => { if (client) { try { await client.query("ROLLBACK"); } finally { client.release(); client = undefined; } } });

  it("upgrades populated legacy rows through migrate() without rewriting or certifying them", async () => {
    expect(migrationChecksum).toBe(expectedChecksum); expect(migrationUpdates).toBe(0);
    expect(legacyAfter).toEqual(legacyBefore);
    for (const table of tables) {
      const row = (await client!.query(`SELECT to_jsonb(t) AS value FROM ${table} t WHERE account_id=$1 LIMIT 1`, [accountID])).rows[0].value;
      expect(row.content_protocol).toBe("legacy-v1");
      if (table !== "memory_review_drafts") { expect(row.content_manifest).toBeNull(); expect(row.content_manifest_digest).toBeNull(); }
      if (table === "memory_item_evidence") expect(row.content_version).toBe(1);
    }
    expect((await client!.query("SELECT original_display_text FROM memory_items WHERE id=$1", [memoryID])).rows[0].original_display_text).toBeNull();
  });

  it("installs and validates all nine named checks on the actual owning tables", async () => {
    const expected = tables.flatMap(table => [`${table}_content_protocol_113`, `${table}_literal_content_113`]);
    expected.push("memory_item_evidence_content_version_113");
    const actual = await client!.query(`SELECT conname,convalidated FROM pg_constraint WHERE conname=ANY($1::text[])`, [expected]);
    expect(actual.rows.map(row => row.conname).sort()).toEqual(expected.sort());
    expect(actual.rows.every(row => row.convalidated === true)).toBe(true);
  });

  it("matches independent Unicode golden SHA, UTF8, UTF16 and scalar counts without normalization", async () => {
    for (const vector of contentGolden.vectors) {
      const actual = (await client!.query("SELECT memory_literal_descriptor_113($1,32768) AS value", [vector.text])).rows[0].value;
      if (vector.text === "") { expect(actual).toBeNull(); continue; }
      const { text: _text, ...expected } = vector; expect(actual).toEqual(expected);
    }
    for (const whitespace of [" ", "\t", "\r\n", "\u00a0", "\u1680", "\u2000", "\u2028", "\u202f", "\u205f", "\u3000", "\ufeff"]) {
      expect((await client!.query("SELECT memory_literal_descriptor_113($1,32768) AS value", [whitespace])).rows[0].value).toBeNull();
    }
    const p = proposal("  Ａe\u0301🙂\r\n "); const id = await insertProposal(p);
    expect((await client!.query("SELECT encode(convert_to(display_text,'UTF8'),'hex') AS bytes FROM memory_proposal_items WHERE id=$1", [id])).rows[0].bytes)
      .toBe(Buffer.from(p.display).toString("hex"));
  });

  it("matches independent proposal, evidence and accepted digest goldens and persists their exact bytes", async () => {
    const p = proposal(); expect(p.hash).toBe(contentGolden.manifest_digest_sha256);
    expect(await proposalValid(p)).toBe(true); await insertProposal(p);
    for (const vector of contentGolden.evidence_manifests) {
      const input = vector.input, range = input.message_range;
      const e: Evidence = { manifest: { version: "literal-v2", excerpt: vector.excerpt_descriptor,
        source_revision_hash: input.source_revision_hash, source_locator_sha256: input.source_locator_sha256, message_range: range },
      hash: vector.manifest_digest_sha256, excerpt: input.source_excerpt, contentHash: vector.excerpt_descriptor.sha256,
      locator: range ? { kind: "message" } : documentLocator, session: range?.session_id ?? null, message: range?.message_id ?? null };
      expect(await evidenceValid(e)).toBe(true); await insertEvidence(e);
    }
    for (const vector of acceptedGolden.vectors) {
      const a: Accepted = { manifest: vector.manifest, hash: vector.manifest_digest_sha256,
        display: vector.input.display_text, original: vector.input.original_display_text };
      expect(digest(vector.digest_tuple_ascii)).toBe(a.hash); expect(await acceptedValid(a)).toBe(true);
      const id = await insertAccepted(a);
      const row = (await client!.query("SELECT display_text,original_display_text,content_manifest,content_manifest_digest FROM memory_items WHERE id=$1", [id])).rows[0];
      expect(row).toEqual({ display_text: a.display, original_display_text: a.original, content_manifest: a.manifest, content_manifest_digest: a.hash });
    }
  });

  it("accepts actual shared constructor output independently of the precomputed golden oracle", async () => {
    const input = { display_text: "Exact Ａe\u0301🙂\r\n", original_display_text: "Original e\u0301", original_content_protocol: "literal-v2" as const,
      source_excerpt: "Minimum supporting excerpt🙂", source_revision_hash: revision, source_locator_sha256: locatorHash, message_range: null };
    const pm = await createMemoryContentManifest(input, digest), p = proposal(input.display_text, input.original_display_text, input.source_excerpt);
    p.manifest = pm.content_manifest; p.hash = pm.content_manifest_digest; expect(await proposalValid(p)).toBe(true);
    const em = await createMemoryEvidenceManifest(input, digest), e = evidence(input.source_excerpt);
    e.manifest = em.content_manifest; e.hash = em.content_manifest_digest; expect(await evidenceValid(e)).toBe(true);
    const am = await createMemoryAcceptedContentManifest({ display_text: input.display_text, original_display_text: input.original_display_text,
      original_content_protocol: "literal-v2", reviewed_evidence: [legacyRef()] }, digest), a = accepted(input.display_text, input.original_display_text);
    a.manifest = am.content_manifest; a.hash = am.content_manifest_digest; expect(await acceptedValid(a)).toBe(true);
  });

  it.each(["sql_null", "json_null", "array", "scalar", "missing", "extra", "wrong_version", "hash_array", "hash_uppercase",
    "nested_missing", "nested_extra", "count_null", "count_string", "count_array", "count_zero", "count_negative", "count_fraction", "count_huge", "large_metadata"])(
    "rejects malformed %s for every role without SQL NULL or cast escape", async kind => {
      for (const [base, validate, write, constraint] of [
        [proposal(), proposalValid, insertProposal, "memory_proposal_items_literal_content_113"],
        [evidence(), evidenceValid, insertEvidence, "memory_item_evidence_literal_content_113"],
        [accepted(), acceptedValid, insertAccepted, "memory_items_literal_content_113"],
      ] as const) {
        const item: any = copy(base); let manifest: any = item.manifest;
        if (kind === "sql_null") manifest = SQL_NULL;
        if (kind === "json_null") manifest = null;
        if (kind === "array") manifest = [manifest];
        if (kind === "scalar") manifest = "not a manifest";
        if (kind === "missing") delete manifest.version;
        if (kind === "extra") manifest.unreviewed = true;
        if (kind === "wrong_version") manifest.version = "unknown";
        const d = manifest?.display_text ?? manifest?.excerpt;
        if (kind === "hash_array") d.sha256 = [d.sha256];
        if (kind === "hash_uppercase") d.sha256 = d.sha256.toUpperCase();
        if (kind === "nested_missing") delete d.unicode_scalar_count;
        if (kind === "nested_extra") d.unreviewed = true;
        if (kind === "count_null") d.utf8_bytes = null;
        if (kind === "count_string") d.utf8_bytes = String(d.utf8_bytes);
        if (kind === "count_array") d.utf8_bytes = [d.utf8_bytes];
        if (kind === "count_zero") d.utf8_bytes = 0;
        if (kind === "count_negative") d.utf8_bytes = -1;
        if (kind === "count_fraction") d.utf16_code_units = 1.5;
        if (kind === "count_huge") d.utf16_code_units = 1e100;
        if (kind === "large_metadata") manifest.version = "x".repeat(8193);
        expect(await (validate as Function)(item, manifest)).toBe(false);
        await rejectsWrite(() => (write as Function)(item, { content_manifest: manifest }), constraint);
      }
    });

  it.each(["x", "é", "尾", "🙂"])("keeps exact statement/original byte boundary for %s and rejects +1", async scalar => {
    const text = scalar.repeat(Math.floor(32768 / Buffer.byteLength(scalar))) + "x".repeat(32768 % Buffer.byteLength(scalar));
    const p = proposal(text, text); expect(Buffer.byteLength(text)).toBe(32768); expect(await proposalValid(p)).toBe(true);
    await insertProposal(p); expect(await acceptedValid(accepted(text, text))).toBe(true);
    const over = proposal(text + "x", text); expect(await proposalValid(over)).toBe(false);
    await rejectsWrite(() => insertProposal(over), "memory_proposal_items_literal_content_113");
    expect(await proposalValid(proposal(text, text + "x"))).toBe(false);
    const a = accepted(text + "x", text); expect(await acceptedValid(a)).toBe(false);
    await rejectsWrite(() => insertAccepted(a), "memory_items_literal_content_113");
  });

  it("retains the separate 64KiB excerpt boundary and finite uncertified previous text", async () => {
    const excerpt = "🙂".repeat(16384), e = evidence(excerpt), p = proposal("Current", "Original", excerpt);
    expect(await evidenceValid(e)).toBe(true); await insertEvidence(e); expect(await proposalValid(p)).toBe(true); await insertProposal(p);
    const over = evidence(excerpt + "x"); expect(await evidenceValid(over)).toBe(false);
    await rejectsWrite(() => insertEvidence(over), "memory_item_evidence_literal_content_113");
    await insertProposal(proposal(), { previous_text: "x".repeat(32768) });
    await rejectsWrite(() => insertProposal(proposal(), { previous_text: "x".repeat(32769) }), "memory_proposal_items_literal_content_113");
  });

  it("binds actual columns and digest domains, not normalized text or JSONB key order", async () => {
    for (const changed of ["e\u0301", "é ", "é\r\n", "é\n"]) {
      const p = proposal(); p.display = changed; expect(await proposalValid(p)).toBe(false);
      // Evidence's default golden is NFD. Use an explicit NFC baseline so
      // every listed mutation actually differs from its admitted bytes.
      const e = evidence("é"); expect(await evidenceValid(e)).toBe(true);
      expect(changed).not.toBe(e.excerpt); e.excerpt = changed; expect(await evidenceValid(e)).toBe(false);
      const a = accepted(); a.display = changed; expect(await acceptedValid(a)).toBe(false);
    }
    const p = proposal(), e = evidence(), a = accepted();
    expect(await proposalValid({ ...p, hash: e.hash })).toBe(false);
    expect(await evidenceValid({ ...e, hash: a.hash })).toBe(false);
    expect(await acceptedValid({ ...a, hash: p.hash })).toBe(false);
    expect(await proposalValid({ ...p, revision: "c".repeat(64) })).toBe(false);
    expect(await proposalValid({ ...p, excerptHash: "c".repeat(64) })).toBe(false);
    expect(await evidenceValid({ ...e, contentHash: "c".repeat(64) })).toBe(false);
    const reordered = Object.fromEntries(Object.entries(p.manifest).reverse()); expect(await proposalValid(p, reordered)).toBe(true);
    expect(await proposalValid(p, { ...p.manifest, source_revision_hash: [revision] })).toBe(false);
    expect(await proposalValid(p, { ...p.manifest, source_locator_sha256: [locatorHash] })).toBe(false);
  });

  it("checks message physical binding and safe numeric ranges without treating them as source admission", async () => {
    const vector = contentGolden.evidence_manifests.find((entry: Json) => entry.name === "message-range"), input = vector.input;
    const e: Evidence = { manifest: { version: "literal-v2", excerpt: vector.excerpt_descriptor, source_revision_hash: revision,
      source_locator_sha256: locatorHash, message_range: input.message_range }, hash: vector.manifest_digest_sha256,
    excerpt: input.source_excerpt, contentHash: vector.excerpt_descriptor.sha256, locator: { kind: "message" }, session: fixedSession, message: fixedMessage };
    expect(await evidenceValid(e)).toBe(true);
    const malformed: Array<[string, unknown]> = [["character_start", "2"], ["character_start", []], ["character_start", -1],
      ["character_end", 7.5], ["character_end", 1e100], ["character_end", 9007199254740992], ["character_end", 2],
      ["offset_unit", "unicode_scalar"], ["representation", "rendered"], ["range_version", 2],
      ["source_revision_hash", "c".repeat(64)], ["excerpt_sha256", "c".repeat(64)], ["message_id", [fixedMessage]]];
    for (const [key, value] of malformed) {
      const changed = copy(e); changed.manifest.message_range[key] = value;
      expect(await evidenceValid(changed)).toBe(false); // no cast exception is acceptable
    }
    expect(await evidenceValid({ ...e, session: null })).toBe(false);
    expect(await evidenceValid({ ...e, message: randomUUID() })).toBe(false);
    expect(await evidenceValid({ ...e, locator: { kind: "image_region" } })).toBe(false);
    expect(await evidenceValid({ ...e, manifest: { ...e.manifest, message_range: null } })).toBe(false);
    const noRange = evidence(); expect(await evidenceValid({ ...noRange, locator: { kind: "message" } })).toBe(false);
    // A structurally valid range does not prove the original substring or
    // canonical locator hash. Current source owners must still check those.
    const p = proposal("Claim", "Claim", e.excerpt); p.manifest.message_range = copy(input.message_range);
    p.locator = { kind: "message" }; p.session = fixedSession; p.message = fixedMessage; p.hash = proposalDigest(p.manifest);
    expect(await proposalValid(p)).toBe(true);
  });

  it("keeps accepted original provenance and finite ordered independently versioned evidence refs", async () => {
    expect(await acceptedValid(accepted("Corrected", null))).toBe(true);
    const fake = accepted("Corrected", null); fake.manifest.original_content_protocol = "literal-v2"; fake.hash = acceptedDigest(fake.manifest);
    expect(await acceptedValid(fake)).toBe(false);
    const refs = Array.from({ length: 10 }, (_, n) => legacyRef(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`));
    const full = accepted("Final", null, refs); expect(await acceptedValid(full)).toBe(true);
    for (const changed of [[], [...refs, legacyRef("ffffffff-ffff-4fff-8fff-ffffffffffff")], [...refs].reverse(),
      [refs[0], refs[0]], [{ ...refs[0], evidence_id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" }],
      [{ ...refs[0], content_version: 2 }], [{ ...refs[0], content_manifest_digest: "c".repeat(64) }],
      [{ ...refs[0], content_protocol: "literal-v2", content_manifest_digest: null }]]) {
      const a = copy(full); a.manifest.reviewed_evidence = changed; a.hash = acceptedDigest(a.manifest); expect(await acceptedValid(a)).toBe(false);
    }
    const e = evidence("Previously accepted proof"), before = json(e.manifest), id = await insertEvidence(e), copiedID = randomUUID();
    const meta = await createMemoryAcceptedContentManifest({ display_text: "New human correction", original_display_text: null,
      original_content_protocol: "legacy-v1", reviewed_evidence: [{ evidence_id: copiedID, content_protocol: "literal-v2", content_version: 1,
        content_manifest_digest: e.hash }, legacyRef()] }, digest);
    const a: Accepted = { display: "New human correction", original: null, manifest: meta.content_manifest, hash: meta.content_manifest_digest };
    const correctedID = await insertAccepted(a);
    await client!.query(`INSERT INTO memory_item_evidence(id,account_id,memory_item_id,capture_id,source_resource_id,
      evidence_fragment_id,source_session_id,source_message_id,source_task_id,locator,excerpt,content_hash,
      source_artifact_id,source_authorization_revision,source_capture_version,content_protocol,content_version,
      content_manifest,content_manifest_digest)
      SELECT $1,account_id,$2,capture_id,source_resource_id,evidence_fragment_id,source_session_id,source_message_id,
        source_task_id,locator,excerpt,content_hash,source_artifact_id,source_authorization_revision,source_capture_version,
        content_protocol,content_version,content_manifest,content_manifest_digest
      FROM memory_item_evidence WHERE account_id=$3 AND id=$4`, [copiedID, correctedID, accountID, id]);
    const rows = (await client!.query(`SELECT id,memory_item_id,to_jsonb(e)-ARRAY['id','memory_item_id','created_at']::text[] AS proof
      FROM memory_item_evidence e WHERE account_id=$1 AND id=ANY($2::uuid[])`, [accountID, [id, copiedID]])).rows;
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.id === copiedID)?.memory_item_id).toBe(correctedID);
    expect(rows.find(row => row.id === copiedID)?.proof).toEqual(rows.find(row => row.id === id)?.proof);
    expect(json(e.manifest)).toBe(before);
    expect((await client!.query("SELECT content_manifest,content_manifest_digest FROM memory_item_evidence WHERE id=$1", [id])).rows[0])
      .toEqual({ content_manifest: e.manifest, content_manifest_digest: e.hash });
    // This integrity-only SQL accepts syntactically valid references with no
    // membership lookup. They are NOT foreign keys, access grants or evidence
    // availability checks; the real commit/current reader must resolve rows.
  });

  it("rejects unknown protocols, missing v2 proof and invalid evidence versions at every owning table", async () => {
    await rejectsWrite(() => insertProposal(proposal(), { content_protocol: "unknown" }), "memory_proposal_items_content_protocol_113");
    await rejectsWrite(() => insertAccepted(accepted(), { content_protocol: "unknown" }), "memory_items_content_protocol_113");
    await rejectsWrite(() => insertEvidence(evidence(), { content_protocol: "unknown" }), "memory_item_evidence_content_protocol_113");
    await rejectsWrite(() => updateDraft({}, {}, [], "unknown"), "memory_review_drafts_content_protocol_113");
    await rejectsWrite(() => insertEvidence(evidence(), { content_version: 2 }), "memory_item_evidence_content_version_113");
    await rejectsWrite(() => insertProposal(proposal(), { content_manifest: SQL_NULL, content_manifest_digest: null }), "memory_proposal_items_literal_content_113");
    await rejectsWrite(() => insertAccepted(accepted(), { content_manifest: SQL_NULL, content_manifest_digest: null }), "memory_items_literal_content_113");
    await rejectsWrite(() => insertEvidence(evidence(), { content_manifest: SQL_NULL, content_manifest_digest: null }), "memory_item_evidence_literal_content_113");
    await rejectsWrite(() => insertAccepted(accepted(), { content_protocol: "legacy-v1" }), "memory_items_literal_content_113");
    await rejectsWrite(() => insertProposal(proposal(), { content_protocol: "legacy-v1" }), "memory_proposal_items_literal_content_113");
    await rejectsWrite(() => insertEvidence(evidence(), { content_protocol: "legacy-v1" }), "memory_item_evidence_literal_content_113");
  });

  it("preserves empty and exact 32KiB unfinished draft values with all five known decisions", async () => {
    const entries = Object.fromEntries(["", " \t\r\n", "🙂".repeat(8192)].map(text => [randomUUID(), text]));
    const decisions = Object.fromEntries(["accept", "keep_old", "accept_new", "retain_conflict", "skip"].map(value => [randomUUID(), value]));
    await updateDraft(entries, decisions, [proposalItemID]);
    const row = (await client!.query("SELECT edited_text,item_decisions,selected_item_ids,content_protocol FROM memory_review_drafts WHERE id=$1", [draftID])).rows[0];
    expect(row).toEqual({ edited_text: entries, item_decisions: decisions, selected_item_ids: [proposalItemID], content_protocol: "literal-v2" });
    expect(row).not.toHaveProperty("content_manifest");
    const all = Object.fromEntries(Array.from({ length: 200 }, () => [randomUUID(), "x"]));
    await updateDraft(all); expect(Object.keys((await client!.query("SELECT edited_text FROM memory_review_drafts WHERE id=$1", [draftID])).rows[0].edited_text)).toHaveLength(200);
  });

  it.each(["over_value", "over_keys", "bad_key", "nonstring", "bad_decision", "over_decisions", "over_selected", "null_selected", "nested_selected"])(
    "rejects draft %s atomically and preserves the existing scopes and exact bytes", async kind => {
      const kept = { [randomUUID()]: "Old scope exact Ａe\u0301🙂\r\n" }; await updateDraft(kept);
      const before = (await client!.query("SELECT to_jsonb(d) AS row FROM memory_review_drafts d WHERE id=$1", [draftID])).rows[0].row;
      let edits: unknown = kept, decisions: unknown = {}, selected: unknown = [];
      if (kind === "over_value") edits = { ...kept, [randomUUID()]: "x".repeat(32769) };
      if (kind === "over_keys") edits = Object.fromEntries(Array.from({ length: 201 }, () => [randomUUID(), "x"]));
      if (kind === "bad_key") edits = { ...kept, not_an_item: "x" };
      if (kind === "nonstring") edits = { ...kept, [randomUUID()]: ["x"] };
      if (kind === "bad_decision") decisions = { [randomUUID()]: "auto_accept" };
      if (kind === "over_decisions") decisions = Object.fromEntries(Array.from({ length: 201 }, () => [randomUUID(), "skip"]));
      if (kind === "over_selected") selected = Array.from({ length: 201 }, () => randomUUID());
      if (kind === "null_selected") selected = [null];
      if (kind === "nested_selected") selected = [[proposalItemID]];
      await rejectsWrite(() => updateDraft(edits, decisions, selected), "memory_review_drafts_literal_content_113");
      expect((await client!.query("SELECT to_jsonb(d) AS row FROM memory_review_drafts d WHERE id=$1", [draftID])).rows[0].row).toEqual(before);
    });

  it("accumulates multiple bounded saves beyond 256KiB without treating the request cap as a durable row cap", async () => {
    const kept = { [randomUUID()]: "Other scope retained\r\n" }; await updateDraft(kept);
    let expected = { ...kept };
    for (let round = 0; round < 3; round += 1) {
      const patch = Object.fromEntries(Array.from({ length: 3 }, () => [randomUUID(), "🙂".repeat(8192)]));
      // Each synthetic merge is below 256KiB; this direct SQL does not prove
      // HTTP preflight, authorization, scope merge or confirmation behavior.
      expect(Buffer.byteLength(json(patch))).toBeLessThan(256 * 1024);
      await client!.query(`UPDATE memory_review_drafts SET content_protocol='literal-v2',edited_text=edited_text||$1::jsonb,
        revision=revision+1 WHERE id=$2`, [json(patch), draftID]); expected = { ...expected, ...patch };
    }
    expect(Buffer.byteLength(Object.values(expected).join(""))).toBeGreaterThan(256 * 1024);
    const before = (await client!.query("SELECT edited_text,revision FROM memory_review_drafts WHERE id=$1", [draftID])).rows[0];
    expect(before.edited_text).toEqual(expected);
    await rejectsWrite(() => client!.query(`UPDATE memory_review_drafts SET edited_text=edited_text||$1::jsonb,revision=revision+1 WHERE id=$2`,
      [json({ [randomUUID()]: "x".repeat(32769) }), draftID]), "memory_review_drafts_literal_content_113");
    expect((await client!.query("SELECT edited_text,revision FROM memory_review_drafts WHERE id=$1", [draftID])).rows[0]).toEqual(before);
  });

  it("rejects NUL and an unpaired surrogate at PostgreSQL input, not by claiming a CHECK examined impossible text", async () => {
    await rejectsWrite(() => client!.query("SELECT $1::jsonb", ['{"literal":"\\u0000"}']), undefined, "22P05");
    await rejectsWrite(() => client!.query("SELECT $1::jsonb", ['{"literal":"\\ud800"}']), undefined, "22P02");
    await rejectsWrite(() => client!.query("SELECT $1::text", ["before\0after"]), undefined, "22021");
  });
});
