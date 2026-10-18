import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthContext } from "./auth.js";
import { getPerson, listPeople } from "./people.js";

const url = process.env.CONTACT_AGENT_TEST_DATABASE_URL;
const pool = url ? new Pool({ connectionString: url, idleTimeoutMillis: 0, max: 1 }) : null;
let client: PoolClient;
const auth: AuthContext = {
  accountId: randomUUID(), accountSlug: `person-detail-${randomUUID()}`,
  userId: randomUUID(), userEmail: `person-detail-${randomUUID()}@synthetic.local`,
  userKind: "simulated_human", sessionId: randomUUID(),
};
const personId = randomUUID();
const contextId = randomUUID();
const captureId = randomUUID();
const resourceId = randomUUID();
const otherPersonId = randomUUID();
let fragmentSequence = 0;

async function field(input: { field?: string; value?: string; review?: string; actor?: string; attribution?: string; kind?: string } = {}) {
  const id = randomUUID();
  await client.query(
    `INSERT INTO evidence_fragments(id,account_id,capture_id,resource_id,fragment_kind,sequence,text_content,content_hash,locator,attributed_actor,attribution_status,parser_name,parser_version,status,review_status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,'human-profile-review','1','active',$12)`,
    [id, auth.accountId, captureId, resourceId, input.kind ?? "contact_field", fragmentSequence++, input.value ?? "Northstar",
      `synthetic-hash-${id}`, JSON.stringify({ kind: input.kind ?? "contact_field", field: input.field ?? "company", source_record_version: "fixture:1" }),
      input.actor ?? "recruiter", input.attribution ?? "confirmed", input.review ?? "reviewed"],
  );
  return id;
}

beforeAll(async () => {
  expect(url, "CONTACT_AGENT_TEST_DATABASE_URL must point at the synthetic test database").toBeTruthy();
  client = await pool!.connect();
  await client.query("BEGIN");
  await client.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Exact person synthetic fixture')", [auth.accountId, auth.accountSlug]);
  await client.query("INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,'Synthetic owner','simulated_human')", [auth.userId, auth.accountId, auth.userEmail]);
  await client.query(
    `INSERT INTO subjects(id,account_id,external_ref,display_label,status,created_at)
     VALUES($1,$2,$3,'Same display name','active','2020-01-01')`, [personId, auth.accountId, `detail-${personId}`],
  );
  // 201 more recent identities deliberately push the requested person outside
  // the list endpoint's first 200; the exact endpoint must still find it.
  await client.query(
    `INSERT INTO subjects(id,account_id,external_ref,display_label,status)
     SELECT gen_random_uuid(),$1,'newer-' || n,'Same display name','active' FROM generate_series(1,201) n`, [auth.accountId],
  );
  await client.query("INSERT INTO assignments(id,account_id,subject_id,external_ref,display_label,status) VALUES($1,$2,$3,$4,'Synthetic relationship','active')", [contextId, auth.accountId, personId, `detail-context-${contextId}`]);
  await client.query(
    `INSERT INTO captures(id,account_id,created_by_user_id,subject_id,assignment_id,source_kind,source_metadata,identity_status,identity_context,purpose,status,created_at)
     VALUES($1,$2,$3,$4,$5,'contact_record','{}','bound','{}','Explicitly reviewed contact fields','active','2020-01-02')`,
    [captureId, auth.accountId, auth.userId, personId, contextId],
  );
  await client.query(
    `INSERT INTO source_resources(id,account_id,capture_id,created_by_user_id,client_resource_id,resource_kind,input_channel,display_name,media_type,observed_at,retention_scope,processing_state)
     VALUES($1,$2,$3,$4,$5,'contact_record','chat','Human reviewed contact profile','application/json','2026-10-12','reviewed_extracted_text','ready')`,
    [resourceId, auth.accountId, captureId, auth.userId, `detail-resource-${resourceId}`],
  );
  await client.query(
    `INSERT INTO source_retention_receipts(receipt_id,account_id,capture_id,policy_version,requested_mode,effective_mode,source_scope,source_access_state,source_access_reason,retention_until,created_at)
     VALUES($1,$2,$3,'source-retention.v2','full_source','full_source','full_reviewed_source','available','review_completed',now() + interval '30 days',now())`,
    [randomUUID(), auth.accountId, captureId],
  );
  await field();
  await field({ value: "Another company" });
  await field({ field: "job_title", value: "Product lead" });
  await field({ value: "Unreviewed company", review: "proposed" });
  await field({ value: "Model attribution", attribution: "proposed" });
  await field({ value: "Other person statement", actor: "candidate" });
  await field({ value: "Rejected company", review: "rejected" });
  await field({ field: "handle", value: "never-expose-raw-handle" });
  await field({ field: "email", value: "never-expose-raw-email@example.test" });
  await field({ kind: "message", value: "Works at Inferred Company as CEO" });
  await client.query(
    `INSERT INTO identity_handles(id,account_id,subject_id,handle_type,normalized_value_hash,display_hint,source_resource_id,status,confirmed_by_user_id,valid_from,valid_until,freshness_policy_version,validity_basis)
     VALUES($1,$2,$3,'email',$4,'s•••@example.test',$5,'confirmed',$6,now() - interval '1 day',now() + interval '364 days','identity-freshness-2026-08-07.v1','policy_default')`,
    [randomUUID(), auth.accountId, personId, `synthetic-email-${randomUUID()}`, resourceId, auth.userId],
  );
  const otherAccountId = randomUUID();
  await client.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Other account')", [otherAccountId, `other-${otherAccountId}`]);
  await client.query("INSERT INTO subjects(id,account_id,external_ref,display_label,status) VALUES($1,$2,$3,'Same display name','active')", [otherPersonId, otherAccountId, `other-${otherPersonId}`]);
}, 20_000);

afterAll(async () => {
  if (client) {
    await client.query("ROLLBACK");
    client.release();
  }
  await pool?.end();
});

describe.skipIf(!pool)("real exact person projection", () => {
  it("reads the 202nd same-name person by exact identity and keeps every reviewed conflict", async () => {
    const directory = await listPeople(client, auth);
    expect(directory.people).toHaveLength(200);
    expect(directory.people.map(person => person.id)).not.toContain(personId);
    const detail = await getPerson(client, auth, personId);
    expect(detail.person.id).toBe(personId);
    expect(detail.basic_fields.map(item => item.value).sort()).toEqual(["Another company", "Northstar", "Product lead"]);
    expect(detail.basic_fields.every(item => item.capture_id === captureId && item.source_resource_id === resourceId && item.relationship_context_id === contextId)).toBe(true);
    expect(detail.contact_points.map(point => point.display_hint)).toEqual(["s•••@example.test"]);
    expect(JSON.stringify(detail)).not.toContain("never-expose-raw");
    expect(JSON.stringify(detail)).not.toContain("Inferred Company");
  });

  it("does not confuse same-name identity with an unknown or other-account person", async () => {
    await expect(getPerson(client, auth, otherPersonId)).rejects.toMatchObject({ statusCode: 404, code: "PERSON_NOT_FOUND" });
    await expect(getPerson(client, auth, randomUUID())).rejects.toMatchObject({ statusCode: 404, code: "PERSON_NOT_FOUND" });
  });

  it("keeps reviewed text and masked handles after raw transport is purged", async () => {
    await client.query("SAVEPOINT raw_purge");
    try {
      await client.query("UPDATE source_retention_receipts SET source_access_state='purged' WHERE account_id=$1 AND capture_id=$2", [auth.accountId, captureId]);
      const detail = await getPerson(client, auth, personId);
      expect(detail.basic_fields).toHaveLength(3);
      expect(detail.contact_points).toHaveLength(1);
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT raw_purge");
    }
  });

  it.each([
    ["revoked source", "UPDATE source_retention_receipts SET authorization_state='revoked' WHERE capture_id=$1"],
    ["expired source authorization", "UPDATE source_retention_receipts SET authorization_expires_at=now() - interval '1 minute' WHERE capture_id=$1"],
    ["expired reviewed evidence retention", "UPDATE source_retention_receipts SET retention_until=now() - interval '1 minute' WHERE capture_id=$1"],
    ["deleted source receipt", "UPDATE source_retention_receipts SET source_access_state='deleted' WHERE capture_id=$1"],
    ["deleted capture", "UPDATE captures SET status='deleted' WHERE id=$1"],
    ["unbound capture identity", "UPDATE captures SET identity_status='unbound' WHERE id=$1"],
    ["deleted source resource", "UPDATE source_resources SET processing_state='deleted' WHERE capture_id=$1"],
    ["expired source resource retention", "UPDATE source_resources SET retention_until=now() - interval '1 minute' WHERE capture_id=$1"],
    ["inactive context", "UPDATE assignments SET status='deleted' WHERE id=(SELECT assignment_id FROM captures WHERE id=$1)"],
    ["context assigned to a different person", "UPDATE assignments SET subject_id=(SELECT id FROM subjects WHERE account_id=(SELECT account_id FROM captures WHERE id=$1) AND id<>(SELECT subject_id FROM captures WHERE id=$1) LIMIT 1) WHERE id=(SELECT assignment_id FROM captures WHERE id=$1)"],
  ])("withdraws fields and handles for %s", async (_label, sql) => {
    await client.query("SAVEPOINT lifecycle_change");
    try {
      await client.query(sql, [captureId]);
      const detail = await getPerson(client, auth, personId);
      expect(detail.basic_fields).toEqual([]);
      expect(detail.contact_points).toEqual([]);
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT lifecycle_change");
    }
  });

  it("withdraws purged fragments and expired handles independently", async () => {
    await client.query("SAVEPOINT item_expiry");
    try {
      await client.query("UPDATE evidence_fragments SET status='purged' WHERE capture_id=$1", [captureId]);
      await client.query("UPDATE identity_handles SET valid_until=now() - interval '1 minute' WHERE subject_id=$1", [personId]);
      const detail = await getPerson(client, auth, personId);
      expect(detail.basic_fields).toEqual([]);
      expect(detail.contact_points).toEqual([]);
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT item_expiry");
    }
  });

  it("returns 404 after the exact person becomes inactive", async () => {
    await client.query("SAVEPOINT person_delete");
    try {
      await client.query("UPDATE subjects SET status='deleted' WHERE id=$1", [personId]);
      await expect(getPerson(client, auth, personId)).rejects.toMatchObject({ statusCode: 404, code: "PERSON_NOT_FOUND" });
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT person_delete");
    }
  });
});
