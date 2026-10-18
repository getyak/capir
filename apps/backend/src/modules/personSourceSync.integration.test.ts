import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import type {
  PersonSourceSyncMutationRequest,
  PublicResearchRequest,
  ResourceCaptureRequest,
} from "@talent-signal/contracts";
import type { AuthContext } from "./auth.js";
import {
  createPersonSourceSyncCycleHooks,
  deletePersonSourceSync,
  getPersonSourceSync,
  listPersonSourceSyncRuns,
  listPersonSourceSyncs,
  putPersonSourceSync,
  runDuePersonSourceSyncs,
  type PersonSourceSyncCycleContext,
} from "./personSourceSync.js";
import { inTransaction } from "../database/pool.js";
import { runPublicResearch, type CrawledPage, type RecurringResearchCycleHooks } from "./research.js";
import { decideCaptureSourceAuthorization } from "./sourceAuthorization.js";

const database = process.env.TIME_WORKSPACE_TEST_DATABASE_URL;
if (
  database &&
  !["127.0.0.1", "localhost"].includes(new URL(database).hostname)
) {
  throw new Error(
    "Use an isolated local PostgreSQL database for person source sync tests.",
  );
}
const pool = database ? new Pool({ connectionString: database, max: 6 }) : null;
const suite = database ? describe : describe.skip;
const ownedTestAccounts: string[] = [];
afterEach(async () => {
  if (pool && ownedTestAccounts.length) {
    // Retire only fixtures created by THIS case. Keep their uncertain receipts
    // intact; later global sweeps must not dispatch a retired tenant.
    await pool.query("UPDATE accounts SET retired_at=COALESCE(retired_at,clock_timestamp()) WHERE id=ANY($1::uuid[])", [ownedTestAccounts.splice(0)]);
  }
});

afterAll(async () => {
  await pool?.end();
});

async function createAccount(): Promise<AuthContext> {
  const accountId = randomUUID();
  ownedTestAccounts.push(accountId);
  const userId = randomUUID();
  await pool!.query(
    "INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Person source sync proof')",
    [accountId, `pss-${accountId}`],
  );
  await pool!.query(
    `INSERT INTO users(id,account_id,email,display_name,kind)
     VALUES($1,$2,$3,'Sync owner','simulated_human')`,
    [userId, accountId, `${userId}@example.test`],
  );
  return {
    accountId,
    accountSlug: `pss-${accountId}`,
    userId,
    userEmail: `${userId}@example.test`,
    userKind: "simulated_human",
    sessionId: randomUUID(),
  };
}

async function makeContact(
  auth: AuthContext,
  label = "Synthetic Person",
): Promise<{ personId: string; contextId: string }> {
  const personId = randomUUID();
  const contextId = randomUUID();
  await pool!.query(
    `INSERT INTO subjects(id,account_id,external_ref,display_label,status)
     VALUES($1,$2,$3,$4,'active')`,
    [personId, auth.accountId, `pss-person:${personId}`, label],
  );
  await pool!.query(
    `INSERT INTO assignments(id,account_id,subject_id,external_ref,display_label,status)
     VALUES($1,$2,$3,$4,'Public work','active')`,
    [contextId, auth.accountId, personId, `pss-context:${contextId}`],
  );
  return { personId, contextId };
}

interface Seed {
  captureId: string;
  resourceId: string;
  url: string;
}

async function makeSeed(
  auth: AuthContext,
  contact: { personId: string; contextId: string },
  url = "https://8.8.8.8/person",
): Promise<Seed> {
  const captureId = randomUUID();
  const resourceId = randomUUID();
  await pool!.query(
    `INSERT INTO captures(id,account_id,created_by_user_id,subject_id,assignment_id,
       source_kind,source_metadata,identity_status,identity_context,purpose,status)
     VALUES($1,$2,$3,$4,$5,'public_url','{}'::jsonb,'bound','{}'::jsonb,
       'relationship_evidence','active')`,
    [captureId, auth.accountId, auth.userId, contact.personId, contact.contextId],
  );
  await pool!.query(
    `INSERT INTO source_resources(id,account_id,capture_id,created_by_user_id,
       client_resource_id,resource_kind,input_channel,display_name,media_type,
       content_hash,source_locator,observed_at,retention_scope,processing_state)
     VALUES($1,$2,$3,$4,$5,'public_url','chat','Synthetic public profile','text/html',
       $6,$7,now(),'relationship','ready')`,
    [
      resourceId,
      auth.accountId,
      captureId,
      auth.userId,
      `pss-seed-${resourceId}`,
      "b".repeat(64),
      url,
    ],
  );
  await pool!.query(
    `INSERT INTO source_retention_receipts(receipt_id,account_id,capture_id,
       policy_version,requested_mode,effective_mode,source_scope,source_locator,
       source_access_state,source_access_reason,authorization_state,
       authorization_expires_at,retention_until,created_at)
     VALUES($1,$2,$3,'source-retention.v2','ephemeral','ephemeral',
       'reviewed_selected_text',$4,'available','review_completed','authorized',
       NULL,now() + interval '30 days',now())`,
    [randomUUID(), auth.accountId, captureId, url],
  );
  return { captureId, resourceId, url };
}

function mutation(
  auth: AuthContext,
  contact: { personId: string; contextId: string },
  seed: Seed,
  overrides: Partial<PersonSourceSyncMutationRequest> = {},
): PersonSourceSyncMutationRequest {
  return {
    expected_revision: 0,
    idempotency_key: randomUUID(),
    person_id: contact.personId,
    relationship_context_id: contact.contextId,
    seed_resource_id: seed.resourceId,
    source_url: seed.url,
    time_zone: "Asia/Shanghai",
    interval_seconds: 86_400,
    expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    status: "active",
    confirmation: "periodic_public_source_re_read",
    ...overrides,
  };
}

function loaderFor(
  bodyByPath: Record<string, string>,
): (url: URL, allowedHostname: string) => Promise<CrawledPage> {
  return async (url) => {
    const text = bodyByPath[url.pathname];
    if (text === undefined) {
      throw new Error("offline transport: unexpected page");
    }
    return {
      canonicalUrl: url.toString(),
      contentHash: `${url.pathname}0`.padEnd(64, "a").slice(0, 64),
      retrievedAt: new Date(),
      text,
      links: [],
    };
  };
}

async function runRows(auth: AuthContext, grantId: string) {
  return (await listPersonSourceSyncRuns(pool!, auth, grantId)).runs;
}

async function calendarCards(
  auth: AuthContext,
): Promise<Array<{ status: string; authority: string; person_id: string | null }>> {
  const result = await pool!.query<{
    status: string;
    authority: string;
    person_id: string | null;
  }>(
    `SELECT content.status, content.authority, content.person_id
     FROM time_activity_content(
       $1,$2,(now() - interval '1 day')::date,(now() + interval '2 days')::date,
       'UTC',NULL,'public_source_update',NULL
     ) content`,
    [auth.accountId, auth.userId],
  );
  return result.rows;
}

async function captureCount(auth: AuthContext): Promise<number> {
  const result = await pool!.query<{ count: string }>(
    `SELECT count(*)::text AS count
     FROM source_resources
     WHERE account_id=$1 AND client_resource_id LIKE 'research:%'`,
    [auth.accountId],
  );
  return Number(result.rows[0]!.count);
}

suite("person source sync durable cycles (isolated PostgreSQL)", () => {
  it("keeps one live grant per person, freezes the exact source, and runs the first cycle exactly once even with duplicate replicas", async () => {
    const auth = await createAccount();
    const contact = await makeContact(auth);
    const seed = await makeSeed(auth, contact);
    const created = await putPersonSourceSync(
      pool!,
      auth,
      randomUUID(),
      mutation(auth, contact, seed),
    );
    expect(created.sync.status).toBe("active");
    expect(created.sync.effective_state).toBe("active");
    expect(created.sync.source_url).toBe(seed.url);
    expect(created.sync.interval_seconds).toBe(86_400);
    // First cycle is due immediately.
    expect(Date.parse(created.sync.next_due_at!)).toBeLessThanOrEqual(
      Date.now() + 1_000,
    );

    // Duplicate replicas may sweep concurrently; the database facts stay one
    // cycle, one capture.
    const loader = loaderFor({ "/person": "Public professional profile v1." });
    await Promise.all([
      runDuePersonSourceSyncs(pool!, { loadPage: loader }),
      runDuePersonSourceSyncs(pool!, { loadPage: loader }),
    ]);
    const runs = await runRows(auth, created.sync.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("completed");
    expect(runs[0]!.new_observations).toBe(1);
    expect(runs[0]!.attempt_count).toBeGreaterThanOrEqual(1);
    expect(runs[0]!.attempt_count).toBeLessThanOrEqual(3);
    expect(runs[0]!.source_url).toBe(seed.url);
    expect(await captureCount(auth)).toBe(1);
    // The cycle carries the ORIGINAL grant provenance, never a per-cycle
    // approval, and the captured fragment stays proposed evidence.
    const task = await pool!.query<{
      approved_by_user_id: string;
      status: string;
    }>(
      `SELECT approved_by_user_id,status FROM research_tasks WHERE account_id=$1`,
      [auth.accountId],
    );
    expect(task.rows).toHaveLength(1);
    expect(task.rows[0]!.approved_by_user_id).toBe(auth.userId);
    const fragment = await pool!.query<{ review_status: string }>(
      `SELECT fragments.review_status
       FROM evidence_fragments fragments
       WHERE fragments.account_id=$1`,
      [auth.accountId],
    );
    expect(fragment.rows[0]!.review_status).toBe("proposed");
    // No external effects, ever.
    const effects = await pool!.query(
      `SELECT 1 FROM action_proposals WHERE account_id=$1 LIMIT 1`,
      [auth.accountId],
    );
    expect(effects.rowCount).toBe(0);
  });

  it("treats an unchanged later cycle as success with zero observations and no duplicate calendar card", async () => {
    const auth = await createAccount();
    const contact = await makeContact(auth);
    const seed = await makeSeed(auth, contact);
    const created = await putPersonSourceSync(
      pool!,
      auth,
      randomUUID(),
      mutation(auth, contact, seed),
    );
    const loader = loaderFor({ "/person": "Stable public body." });
    await runDuePersonSourceSyncs(pool!, { loadPage: loader });
    expect(await captureCount(auth)).toBe(1);
    expect(await calendarCards(auth)).toHaveLength(1);

    await pool!.query(
      `UPDATE person_source_sync_grants SET next_due_at = now() - interval '1 second'
       WHERE account_id=$1 AND id=$2`,
      [auth.accountId, created.sync.id],
    );
    await runDuePersonSourceSyncs(pool!, { loadPage: loader });
    let runs = await runRows(auth, created.sync.id);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.status).toBe("completed");
    expect(runs[0]!.new_observations).toBe(0);
    // Cross-cycle dedup matched the stable extracted body: no duplicate
    // capture and no duplicate calendar card.
    expect(await captureCount(auth)).toBe(1);
    expect(await calendarCards(auth)).toHaveLength(1);
    expect(runs[0]!.warning_codes).toContain("PERSON_SOURCE_SYNC_UNCHANGED");

    // A genuinely changed body produces exactly one new proposed observation.
    const changed = loaderFor({ "/person": "Stable public body. Changed." });
    await pool!.query(
      `UPDATE person_source_sync_grants SET next_due_at = now() - interval '1 second'
       WHERE account_id=$1 AND id=$2`,
      [auth.accountId, created.sync.id],
    );
    await runDuePersonSourceSyncs(pool!, { loadPage: changed });
    runs = await runRows(auth, created.sync.id);
    expect(runs[0]!.new_observations).toBe(1);
    expect(await captureCount(auth)).toBe(2);
    const cards = await calendarCards(auth);
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      // Additive calendar surfacing stays unconfirmed and non-executing.
      expect(card.status).toBe("needs_review");
      expect(card.authority).toBe("unconfirmed");
      expect(card.person_id).toBe(contact.personId);
    }
  });

  it("pauses at dispatch, resumes only explicitly, and never revives an expired grant", async () => {
    const auth = await createAccount();
    const contact = await makeContact(auth);
    const seed = await makeSeed(auth, contact);
    const grantID = randomUUID();
    const expiresAt = new Date(Date.now() + 2200).toISOString();
    const created = await putPersonSourceSync(
      pool!,
      auth,
      grantID,
      mutation(auth, contact, seed, { expires_at: expiresAt }),
    );
    const paused = await putPersonSourceSync(
      pool!,
      auth,
      grantID,
      mutation(auth, contact, seed, {
        expected_revision: created.sync.revision,
        expires_at: created.sync.expires_at!,
        status: "paused",
      }),
    );
    expect(paused.sync.status).toBe("paused");
    const loader = loaderFor({ "/person": "Paused body." });
    await runDuePersonSourceSyncs(pool!, { loadPage: loader });
    const pausedRuns = await runRows(auth, grantID);
    expect(pausedRuns).toHaveLength(0);
    expect(await captureCount(auth)).toBe(0);

    const resumed = await putPersonSourceSync(
      pool!,
      auth,
      grantID,
      mutation(auth, contact, seed, {
        expected_revision: paused.sync.revision,
        expires_at: created.sync.expires_at!,
        status: "active",
      }),
    );
    expect(resumed.sync.status).toBe("active");
    await runDuePersonSourceSyncs(pool!, { loadPage: loader });
    expect(await captureCount(auth)).toBe(1);

    // Expiry is honest and terminal until a FRESH owner confirmation exists.
    await pool!.query("SELECT pg_sleep_until($1::timestamptz)", [new Date(Date.parse(expiresAt) + 50).toISOString()]);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(expiresAt) - Date.now() + 50)));
    await expect(
      putPersonSourceSync(
        pool!,
        auth,
        grantID,
        mutation(auth, contact, seed, {
          expected_revision: resumed.sync.revision + 1,
          status: "active",
        }),
      ),
    ).rejects.toMatchObject({ code: "PERSON_SOURCE_SYNC_GRANT_EXPIRED" });
    await runDuePersonSourceSyncs(pool!, { loadPage: loader });
    const allRuns = await runRows(auth, grantID);
    expect(allRuns).toHaveLength(1);
    const readback = await getPersonSourceSync(pool!, auth, grantID);
    expect(readback.sync.effective_state).toBe("expired");
  });

  it("refuses a second live grant for the same person and keeps owner/account scope", async () => {
    const auth = await createAccount();
    const contact = await makeContact(auth);
    const seed = await makeSeed(auth, contact);
    const first = await putPersonSourceSync(
      pool!,
      auth,
      randomUUID(),
      mutation(auth, contact, seed),
    );
    await expect(
      putPersonSourceSync(pool!, auth, randomUUID(), mutation(auth, contact, seed)),
    ).rejects.toMatchObject({ code: "PERSON_SOURCE_SYNC_EXISTS" });

    const stranger = await createAccount();
    await expect(
      getPersonSourceSync(pool!, stranger, first.sync.id),
    ).rejects.toMatchObject({ code: "PERSON_SOURCE_SYNC_NOT_FOUND" });
    const list = await listPersonSourceSyncs(pool!, stranger, {
      person_id: contact.personId,
      relationship_context_id: contact.contextId,
    });
    expect(list.syncs).toEqual([]);
    const own = await listPersonSourceSyncs(pool!, auth, {
      person_id: contact.personId,
      relationship_context_id: contact.contextId,
      seed_resource_id: seed.resourceId,
    });
    expect(own.syncs.map((sync) => sync.id)).toEqual([first.sync.id]);
  });

  it("replays the exact same cycle after a crash without a second capture", async () => {
    const auth = await createAccount();
    const contact = await makeContact(auth);
    const seed = await makeSeed(auth, contact);
    const created = await putPersonSourceSync(
      pool!,
      auth,
      randomUUID(),
      mutation(auth, contact, seed),
    );
    const loader = loaderFor({ "/person": "Recovered body." });
    await runDuePersonSourceSyncs(pool!, { loadPage: loader });
    expect(await captureCount(auth)).toBe(1);
    const [first] = await runRows(auth, created.sync.id);

    // Simulate a crash after the capture commit but before finalization: the
    // same cycle row stays nonterminal with a stale lease and the same task.
    await pool!.query(
      `UPDATE person_source_sync_runs
       SET status='dispatched',completed_at=NULL,
           lease_owner='system:person-source-sync-worker:crashed',
           lease_expires_at=now() - interval '1 minute'
       WHERE account_id=$1 AND id=$2`,
      [auth.accountId, first!.id],
    );
    await pool!.query("UPDATE research_tasks SET status='running' WHERE account_id=$1 AND id=$2", [auth.accountId, first!.task_id]);
    await pool!.query("UPDATE idempotency_records SET response_status=202,response_body=jsonb_set(response_body,'{status}','\"running\"'::jsonb),completed_at=NULL WHERE account_id=$1 AND operation_scope='run_public_research'", [auth.accountId]);
    await pool!.query("UPDATE research_retrieval_jobs SET status='running',lease_owner='crashed',lease_expires_at=clock_timestamp()-interval '1 second',completed_at=NULL WHERE account_id=$1", [auth.accountId]);
    await pool!.query("DELETE FROM research_snapshots WHERE account_id=$1", [auth.accountId]);
    await runDuePersonSourceSyncs(pool!, { loadPage: loader });
    const runs = await runRows(auth, created.sync.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("completed");
    // Durable restart recovery re-derives authority and reuses the committed
    // page position: no second capture, no second calendar card.
    expect(await captureCount(auth)).toBe(1);
    expect(await calendarCards(auth)).toHaveLength(1);
    expect(runs[0]!.attempt_count).toBeGreaterThanOrEqual(2);
  });

  it("stops dispatch and late commits after pause, source revoke, person archive or account retirement", async () => {
    const auth = await createAccount();
    const contact = await makeContact(auth);
    const seed = await makeSeed(auth, contact);
    const created = await putPersonSourceSync(
      pool!,
      auth,
      randomUUID(),
      mutation(auth, contact, seed),
    );

    // Late commit gate: pause lands between the fetch and the capture commit.
    const [grantRow] = (
      await pool!.query<{
        source_capture_id: string;
        source_capture_version: number;
        revision: number;
        created_by_user_id: string;
        created_at: Date;
      }>(
        `SELECT source_capture_id,source_capture_version,revision,
                created_by_user_id,created_at
         FROM person_source_sync_grants WHERE account_id=$1 AND id=$2`,
        [auth.accountId, created.sync.id],
      )
    ).rows;
    const runID = randomUUID();
    await pool!.query(
      `INSERT INTO person_source_sync_runs(account_id,id,grant_id,cycle_key,due_at,
         status,attempt_count,lease_owner,lease_expires_at,frozen_seed_resource_id,
         frozen_source_url,frozen_allowed_domain,grant_actor_user_id,
         grant_authorization_revision,grant_authorized_at,source_capture_version)
       VALUES($1,$2,$3,$4,now(),'claimed',1,$5,now() + interval '1 minute',$6,$7,'8.8.8.8',$8,$9,$10,$11)`,
      [
        auth.accountId,
        runID,
        created.sync.id,
        `person-source-sync:${created.sync.id}:late-commit`,
        `system:person-source-sync-worker:late`,
        seed.resourceId,
        seed.url,
        auth.userId,
        grantRow!.revision,
        grantRow!.created_at,
        grantRow!.source_capture_version,
      ],
    );
    const hooks = createPersonSourceSyncCycleHooks({
      pool: pool!,
      auth,
      runId: runID,
      grantId: created.sync.id,
      executionId: `system:person-source-sync-worker:late`,
      rootCaptureId: seed.captureId,
      seedCaptureId: seed.captureId,
      seedResourceId: seed.resourceId,
      frozenSourceUrl: seed.url,
      frozenAllowedDomain: "8.8.8.8",
      sourceCaptureVersion: grantRow!.source_capture_version,
      grantActorUserId: auth.userId,
      grantAuthorizationRevision: grantRow!.revision,
      grantAuthorizedAt: grantRow!.created_at,
      deadlineAt: new Date(
        grantRow!.created_at.valueOf() + 15 * 60_000,
      ),
    } satisfies PersonSourceSyncCycleContext);
    const page: CrawledPage = {
      canonicalUrl: seed.url,
      contentHash: "c".repeat(64),
      retrievedAt: new Date(),
      text: "Late commit body.",
      links: [],
    };
    const request = {
      contract_version: 1,
      idempotency_key: `research:${runID}:0`,
      channel: "api_connector",
      purpose: "Late commit capture",
      captured_at: new Date().toISOString(),
      source_timezone: "UTC",
      person_scope: {
        status: "confirmed",
        person_id: contact.personId,
        relationship_context: {
          status: "existing",
          relationship_context_id: contact.contextId,
        },
        binding_basis: "Owner-confirmed periodic observation test.",
      },
      resource: {
        client_resource_id: `research:${runID}:0`,
        kind: "public_url",
        display_name: "Late commit snapshot",
        media_type: "text/html",
        observed_at: new Date().toISOString(),
        source_timezone: "UTC",
        content_hash: "c".repeat(64),
        source_locator: seed.url,
        discovered_from_resource_id: seed.resourceId,
        retention: {
          requested_mode: "ephemeral",
          source_scope: "reviewed_extracted_text",
        },
      },
      fragments: [
        {
          client_resource_id: `research:${runID}:0`,
          kind: "url_excerpt",
          sequence: 0,
          text: "Late commit body.",
          locator: {
            kind: "url_excerpt",
            canonical_url: seed.url,
            retrieved_at: new Date().toISOString(),
            start_character: 0,
            end_character: 16,
          },
          attribution: { actor_kind: "public_source", status: "confirmed" },
          review_status: "proposed",
          parser: { name: "bounded-public-research", version: "1.0.0" },
        },
      ],
    } as unknown as ResourceCaptureRequest;

    // Authoritative revoke through the real lineage path while the derived
    // commit runs: either the commit landed first and is revoked together with
    // the lineage, or the gate refuses it. Never new evidence after revocation.
    const commit = hooks.commitPage(page, request);
    const revoke = decideCaptureSourceAuthorization(pool!, auth, seed.captureId, {
      idempotency_key: randomUUID(),
      expected_capture_version: grantRow!.source_capture_version,
      decision: "revoke",
      reason: "Synthetic owner revocation for concurrency proof.",
    }).then(
      (outcome) => ({ ok: true as const, outcome }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    const [commitResult, revokeResult] = await Promise.all([commit, revoke]);
    if (!revokeResult.ok) {
      // Only a refusal of the commit is tolerable here; anything else is a
      // real failure of the concurrency proof.
      expect(commitResult.committed).toBeNull();
      expect(commitResult.stop).toBe(true);
    }
    if (commitResult.committed) {
      const receipt = await pool!.query<{ authorization_state: string }>(
        `SELECT authorization_state FROM source_retention_receipts
         WHERE account_id=$1 AND capture_id=$2`,
        [auth.accountId, commitResult.committed.capture_id],
      );
      // The commit landed before the revoke: the real revoke path enumerates
      // descendants and revokes the new evidence together with the lineage.
      expect(revokeResult.ok).toBe(true);
      expect(receipt.rows[0]!.authorization_state).toBe("revoked");
    } else {
      expect(commitResult.stop).toBe(true);
    }
    expect(await captureCount(auth)).toBeLessThanOrEqual(1);

    // The late-commit attempt's execution ended: its expired lease lets the
    // next dispatch re-derive live authority on the same cycle row.
    await pool!.query(
      `UPDATE person_source_sync_runs
       SET lease_expires_at = now() - interval '1 second'
       WHERE account_id=$1 AND id=$2`,
      [auth.accountId, runID],
    );
    // A later dispatch under revoked source access never fetches.
    await pool!.query(
      `UPDATE person_source_sync_grants SET next_due_at = now() - interval '1 second'
       WHERE account_id=$1 AND id=$2`,
      [auth.accountId, created.sync.id],
    );
    let fetched = 0;
    await runDuePersonSourceSyncs(pool!, {
      loadPage: async () => {
        fetched += 1;
        throw new Error("must not fetch");
      },
    });
    expect(fetched).toBe(0);
    const runs = await runRows(auth, created.sync.id);
    const latest = runs[0]!;
    expect(latest.status).toBe("skipped");
    expect(latest.stop_reason).toBe(
      "PERSON_SOURCE_SYNC_SOURCE_AUTHORIZATION_REVOKED",
    );
  });

  it("blocks every later cycle after person archive and after account retirement", async () => {
    const auth = await createAccount();
    const contact = await makeContact(auth);
    const seed = await makeSeed(auth, contact);
    const created = await putPersonSourceSync(
      pool!,
      auth,
      randomUUID(),
      mutation(auth, contact, seed),
    );
    await pool!.query(
      `UPDATE subjects SET status='deleted' WHERE account_id=$1 AND id=$2`,
      [auth.accountId, contact.personId],
    );
    await pool!.query(
      `UPDATE person_source_sync_grants SET next_due_at = now() - interval '1 second'
       WHERE account_id=$1 AND id=$2`,
      [auth.accountId, created.sync.id],
    );
    let fetched = 0;
    await runDuePersonSourceSyncs(pool!, {
      loadPage: async () => {
        fetched += 1;
        throw new Error("must not fetch");
      },
    });
    expect(fetched).toBe(0);
    const runs = await runRows(auth, created.sync.id);
    expect(runs[0]!.status).toBe("skipped");
    expect(runs[0]!.stop_reason).toBe("PERSON_SOURCE_SYNC_PERSON_UNAVAILABLE");

    // Account retirement fences every new account-scoped write.
    await pool!.query(
      `UPDATE accounts SET retired_at = now() WHERE id=$1`,
      [auth.accountId],
    );
    await expect(
      putPersonSourceSync(pool!, auth, randomUUID(), mutation(auth, contact, seed)),
    ).rejects.toThrow();
  });

  it("keeps counted postclaim failures across restarts, caps at three starts and settles exhaustion with zero fetches", async () => {
    const auth = await createAccount();
    const contact = await makeContact(auth);
    // The reserved test name fails the production DNS gate AFTER the durable
    // claim, deterministically and offline.
    const seed = await makeSeed(auth, contact, "https://nonexistent.invalid/person");
    const created = await putPersonSourceSync(
      pool!,
      auth,
      randomUUID(),
      mutation(auth, contact, seed),
    );
    let fetched = 0;
    const loader = async (): Promise<CrawledPage> => {
      fetched += 1;
      throw new Error("must not fetch");
    };
    // Each sweep is one "restart": the counted attempt survives it.
    await runDuePersonSourceSyncs(pool!, { loadPage: loader });
    let runs = await runRows(auth, created.sync.id);
    expect(runs[0]!.attempt_count).toBe(1);
    expect(runs[0]!.status).toBe("pending");
    expect(runs[0]!.settled).toBe(false);
    await runDuePersonSourceSyncs(pool!, { loadPage: loader });
    runs = await runRows(auth, created.sync.id);
    expect(runs[0]!.attempt_count).toBe(2);
    await runDuePersonSourceSyncs(pool!, { loadPage: loader });
    runs = await runRows(auth, created.sync.id);
    expect(runs[0]!.attempt_count).toBe(3);
    // Exhaustion settles with bounded DB receipts only and never starts a
    // fourth attempt.
    await runDuePersonSourceSyncs(pool!, { loadPage: loader });
    runs = await runRows(auth, created.sync.id);
    expect(runs[0]!.attempt_count).toBe(3);
    expect(runs[0]!.status).toBe("failed");
    expect(runs[0]!.warning_codes).toContain(
      "PERSON_SOURCE_SYNC_ATTEMPTS_EXHAUSTED",
    );
    expect(fetched).toBe(0);
    await runDuePersonSourceSyncs(pool!, { loadPage: loader });
    runs = await runRows(auth, created.sync.id);
    expect(runs[0]!.attempt_count).toBe(3);
    expect(fetched).toBe(0);
    expect(await captureCount(auth)).toBe(0);
  });

  it("reports a nonterminal crashed cycle as unsettled unknown and reconciles it before a new one", async () => {
    const auth = await createAccount();
    const contact = await makeContact(auth);
    const seed = await makeSeed(auth, contact);
    const created = await putPersonSourceSync(
      pool!,
      auth,
      randomUUID(),
      mutation(auth, contact, seed),
    );
    await runDuePersonSourceSyncs(pool!, {
      loadPage: loaderFor({ "/person": "Observed body." }),
    });
    const [first] = await runRows(auth, created.sync.id);
    // A crashed attempt leaves an unresolved cycle: readback is honest unknown
    // and the partial unique index blocks any new cycle.
    await pool!.query(
      `UPDATE person_source_sync_runs
       SET status='dispatched',completed_at=NULL,attempt_count=3,
           lease_owner='system:person-source-sync-worker:crashed',
           lease_expires_at=now() - interval '1 minute'
       WHERE account_id=$1 AND id=$2`,
      [auth.accountId, first!.id],
    );
    const readback = await getPersonSourceSync(pool!, auth, created.sync.id);
    expect(readback.sync.status).toBe("active");
    const unsettled = await runRows(auth, created.sync.id);
    expect(unsettled[0]!.status).toBe("unknown");
    expect(unsettled[0]!.settled).toBe(false);

    await pool!.query(
      `UPDATE person_source_sync_grants SET next_due_at = now() - interval '1 second'
       WHERE account_id=$1 AND id=$2`,
      [auth.accountId, created.sync.id],
    );
    await runDuePersonSourceSyncs(pool!, {
      loadPage: loaderFor({ "/person": "Must not be read." }),
    });
    const after = await runRows(auth, created.sync.id);
    // The same original cycle reconciles first; no overlapping or catch-up
    // cycle is materialized beside it.
    expect(after).toHaveLength(1);
  });

  it("redacts frozen source content from grant and run readbacks after source deletion", async () => {
    const auth = await createAccount();
    const contact = await makeContact(auth);
    const seed = await makeSeed(auth, contact);
    const created = await putPersonSourceSync(
      pool!,
      auth,
      randomUUID(),
      mutation(auth, contact, seed),
    );
    await runDuePersonSourceSyncs(pool!, {
      loadPage: loaderFor({ "/person": "Deletable body." }),
    });
    expect((await runRows(auth, created.sync.id))[0]!.source_url).toBe(seed.url);

    await pool!.query(
      `UPDATE source_resources SET processing_state='deleted'
       WHERE account_id=$1 AND id=$2`,
      [auth.accountId, seed.resourceId],
    );
    const grantRead = await getPersonSourceSync(pool!, auth, created.sync.id);
    expect(grantRead.sync.content_available).toBe(false);
    expect(grantRead.sync.source_url).toBeNull();
    expect(grantRead.sync.person_id).toBeNull();
    const runs = await runRows(auth, created.sync.id);
    expect(runs[0]!.content_available).toBe(false);
    expect(runs[0]!.source_url).toBeNull();
    expect(runs[0]!.observed_canonical_url).toBeNull();

    // Deleting the grant keeps an identity-only receipt with its operation id.
    const deleteKey = randomUUID();
    const deleted = await deletePersonSourceSync(pool!, auth, created.sync.id, {
      expected_revision: created.sync.revision,
      idempotency_key: deleteKey,
    });
    expect(deleted.sync.status).toBe("deleted");
    expect(deleted.sync.content_available).toBe(false);
    expect(deleted.sync.last_operation_id).toBe(deleteKey);
    const replay = await deletePersonSourceSync(pool!, auth, created.sync.id, {
      expected_revision: created.sync.revision,
      idempotency_key: deleteKey,
    });
    expect(replay.sync.revision).toBe(deleted.sync.revision);
  });

  it("replays grant mutations by idempotency receipt and rejects intent conflicts", async () => {
    const auth = await createAccount();
    const contact = await makeContact(auth);
    const seed = await makeSeed(auth, contact);
    const grantID = randomUUID();
    const key = randomUUID();
    const original = mutation(auth, contact, seed, { idempotency_key: key });
    const created = await putPersonSourceSync(
      pool!,
      auth,
      grantID,
      original,
    );
    const replay = await putPersonSourceSync(
      pool!,
      auth,
      grantID,
      original,
    );
    expect(replay.sync.revision).toBe(created.sync.revision);

    await expect(
      putPersonSourceSync(
        pool!,
        auth,
        grantID,
        mutation(auth, contact, seed, {
          idempotency_key: key,
          status: "paused",
        }),
      ),
    ).rejects.toMatchObject({ code: "PERSON_SOURCE_SYNC_INTENT_CONFLICT" });

    // Stale revisions never overwrite a newer state.
    await expect(
      putPersonSourceSync(
        pool!,
        auth,
        grantID,
        mutation(auth, contact, seed, {
          expected_revision: created.sync.revision + 5,
          status: "paused",
        }),
      ),
    ).rejects.toMatchObject({ code: "PERSON_SOURCE_SYNC_REVISION_CONFLICT" });
  });

  // ---- B1/B2/B3 repair regressions (real PostgreSQL, controlled barriers) ----

  async function stageOpenRun(
    auth: AuthContext,
    grantID: string,
    seed: Seed,
    options: {
      createdAt?: Date;
      leaseOwner?: string | null;
      leaseExpiresAt?: Date | null;
      attemptCount?: number;
      status?: "pending" | "claimed" | "dispatched";
    } = {},
  ): Promise<string> {
    const runID = randomUUID();
    await pool!.query(
      `INSERT INTO person_source_sync_runs(
         account_id,id,grant_id,cycle_key,due_at,status,attempt_count,
         lease_owner,lease_expires_at,frozen_seed_resource_id,frozen_source_url,
         frozen_allowed_domain,grant_actor_user_id,grant_authorization_revision,
         grant_authorized_at,source_capture_version,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,$14,1,$15,$15)`,
      [
        auth.accountId,
        runID,
        grantID,
        `person-source-sync:${grantID}:${runID}`,
        options.createdAt ?? new Date(),
        options.status ?? "claimed",
        options.attemptCount ?? 1,
        options.leaseOwner === undefined ? `system:person-source-sync-worker:${runID}` : options.leaseOwner,
        options.leaseExpiresAt === undefined ? new Date(Date.now() + 5 * 60_000) : options.leaseExpiresAt,
        seed.resourceId,
        seed.url,
        new URL(seed.url).hostname.toLowerCase(),
        auth.userId,
        options.createdAt ?? new Date(),
        options.createdAt ?? new Date(),
      ],
    );
    return runID;
  }

  function hooksFor(
    auth: AuthContext,
    grantID: string,
    seed: Seed,
    runID: string,
    executionId: string,
    createdAt: Date,
    testPool: Pool = pool!,
  ): RecurringResearchCycleHooks {
    return createPersonSourceSyncCycleHooks({
      pool: testPool,
      auth,
      runId: runID,
      grantId: grantID,
      executionId,
      deadlineAt: new Date(createdAt.valueOf() + 15 * 60_000),
      rootCaptureId: seed.captureId,
      seedCaptureId: seed.captureId,
      seedResourceId: seed.resourceId,
      frozenSourceUrl: seed.url,
      frozenAllowedDomain: new URL(seed.url).hostname.toLowerCase(),
      sourceCaptureVersion: 1,
      grantActorUserId: auth.userId,
      grantAuthorizationRevision: 1,
      grantAuthorizedAt: createdAt,
    } satisfies PersonSourceSyncCycleContext);
  }

  function offlinePage(seed: Seed, text: string): CrawledPage {
    return {
      canonicalUrl: seed.url,
      contentHash: "d".repeat(64),
      retrievedAt: new Date(),
      text,
      links: [],
    };
  }

  function captureRequest(auth: AuthContext, contact: { personId: string; contextId: string }, seed: Seed, text: string): ResourceCaptureRequest {
    const stamp = new Date().toISOString();
    const clientResourceId = `research:${randomUUID()}:0`;
    return {
      contract_version: 1,
      idempotency_key: `research:${randomUUID()}:0`,
      channel: "api_connector",
      purpose: "Barrier capture",
      captured_at: stamp,
      source_timezone: "UTC",
      person_scope: {
        status: "confirmed",
        person_id: contact.personId,
        relationship_context: { status: "existing", relationship_context_id: contact.contextId },
        binding_basis: "Owner-confirmed periodic observation test.",
      },
      resource: {
        client_resource_id: clientResourceId,
        kind: "public_url",
        display_name: "Barrier snapshot",
        media_type: "text/html",
        observed_at: stamp,
        source_timezone: "UTC",
        content_hash: "e".repeat(64),
        source_locator: seed.url,
        discovered_from_resource_id: seed.resourceId,
        retention: { requested_mode: "ephemeral", source_scope: "reviewed_extracted_text" },
      },
      fragments: [
        {
          client_resource_id: clientResourceId,
          kind: "url_excerpt",
          sequence: 0,
          text,
          locator: {
            kind: "url_excerpt",
            canonical_url: seed.url,
            retrieved_at: stamp,
            start_character: 0,
            end_character: text.length,
          },
          attribution: { actor_kind: "public_source", status: "confirmed" },
          review_status: "proposed",
          parser: { name: "bounded-public-research", version: "1.0.0" },
        },
      ],
    } as unknown as ResourceCaptureRequest;
  }

  function delayedQueryPool(pattern: string, after: () => Promise<void>): Pool {
    let delayed = false;
    const wrap = <T extends object>(target: T): T => new Proxy(target, {
      get(object, property) {
        const value: unknown = Reflect.get(object, property);
        if (property === "connect") return async () => wrap(await pool!.connect());
        if (property === "query" && typeof value === "function") return async (...args: unknown[]) => {
          const result = await Reflect.apply(value, object, args);
          if (!delayed && String(args[0]).includes(pattern)) {
            delayed = true;
            await after();
          }
          return result;
        };
        return typeof value === "function" ? value.bind(object) : value;
      },
    });
    return wrap(pool!);
  }

  function researchRequest(contact: { personId: string; contextId: string }, seed: Seed, grantID: string, runID: string): PublicResearchRequest {
    return {
      idempotency_key: `person-source-sync:${grantID}:${runID}`,
      person_id: contact.personId, relationship_context_id: contact.contextId,
      seed_resource_id: seed.resourceId, expected_seed_url: seed.url,
      purpose: "Synthetic owner-confirmed periodic public source proof.",
      authorization: { decision: "approve_public_research", allowed_domain: new URL(seed.url).hostname,
        maximum_page_count: 1, maximum_link_depth: 0 },
    };
  }

  async function waitPast(instant: Date): Promise<void> {
    await pool!.query("SELECT pg_sleep_until($1::timestamptz)", [new Date(instant.valueOf() + 30).toISOString()]);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, instant.valueOf() - Date.now() + 30)));
  }

  it.each(["deadline", "lease", "grant", "source"] as const)("B1 last write rolls back a capture when %s expires inside capture creation", async (boundary) => {
    const auth = await createAccount(); const contact = await makeContact(auth); const seed = await makeSeed(auth, contact);
    const expires = new Date(Date.now() + 900);
    const created = await putPersonSourceSync(pool!, auth, randomUUID(), mutation(auth, contact, seed,
      boundary === "grant" ? { expires_at: expires.toISOString() } : {}));
    if (boundary === "source") await pool!.query("UPDATE source_retention_receipts SET authorization_expires_at=$3 WHERE account_id=$1 AND capture_id=$2", [auth.accountId, seed.captureId, expires]);
    const createdAt = boundary === "deadline" ? new Date(expires.valueOf() - 15 * 60_000) : new Date();
    const owner = `system:person-source-sync-worker:last-write-${boundary}`;
    const runID = await stageOpenRun(auth, created.sync.id, seed, { createdAt, leaseOwner: owner,
      leaseExpiresAt: boundary === "lease" ? expires : new Date(Date.now() + 5 * 60_000) });
    let captureInserted = false;
    const delayed = delayedQueryPool("INSERT INTO captures(", async () => { captureInserted = true; await waitPast(expires); });
    const hooks = hooksFor(auth, created.sync.id, seed, runID, owner, createdAt, delayed);
    await expect(hooks.commitPage(offlinePage(seed, "Last-write expiry proof."), captureRequest(auth, contact, seed, "Last-write expiry proof."))).rejects.toMatchObject({ code: "PERSON_SOURCE_SYNC_LEASE_LOST" });
    expect(captureInserted).toBe(true);
    expect(await captureCount(auth)).toBe(0);
    const row = await pool!.query("SELECT observed_resource_id,new_observations FROM person_source_sync_runs WHERE account_id=$1 AND id=$2", [auth.accountId, runID]);
    expect(row.rows[0]).toMatchObject({ observed_resource_id: null, new_observations: 0 });
  });

  it.each(["AS grant_status", "INSERT INTO idempotency_records"])("B2 rolls back late admission after actual awaited %s", async (pattern) => {
    const auth = await createAccount(); const contact = await makeContact(auth);
    const seed = await makeSeed(auth, contact, "https://profiles.example.com/person");
    const created = await putPersonSourceSync(pool!, auth, randomUUID(), mutation(auth, contact, seed));
    const expires = new Date(Date.now() + 900); const createdAt = new Date(expires.valueOf() - 15 * 60_000);
    const owner = "system:person-source-sync-worker:admission-await";
    const runID = await stageOpenRun(auth, created.sync.id, seed, { createdAt, leaseOwner: owner });
    let reached = false, dnsCalls = 0, transportCalls = 0;
    const delayed = delayedQueryPool(pattern, async () => { reached = true; await waitPast(expires); });
    const hooks = hooksFor(auth, created.sync.id, seed, runID, owner, createdAt, delayed);
    await expect(runPublicResearch(delayed, auth, researchRequest(contact, seed, created.sync.id, runID),
      async () => { transportCalls += 1; return offlinePage(seed, "Must not fetch after admission wait."); },
      { recurring: hooks, recurringRunId: runID, hostnameLookup: async () => { dnsCalls += 1; return [{ address: "8.8.8.8", family: 4 }]; } },
    )).rejects.toMatchObject({ code: "PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED" });
    expect(reached).toBe(true);
    expect(dnsCalls).toBe(pattern === "AS grant_status" ? 0 : 1);
    expect(transportCalls).toBe(0);
    expect((await pool!.query("SELECT id FROM research_retrieval_jobs WHERE account_id=$1", [auth.accountId])).rowCount).toBe(0);
    expect((await pool!.query("SELECT id FROM research_tasks WHERE account_id=$1", [auth.accountId])).rowCount).toBe(0);
    expect((await pool!.query("SELECT id FROM idempotency_records WHERE account_id=$1 AND operation_scope='run_public_research'", [auth.accountId])).rowCount).toBe(0);
  });

  it.each(["available", "deleted", "revoked"] as const)("B3 exhausted recovery preserves partial receipts and respects %s evidence", async (availability) => {
    const auth = await createAccount(); const contact = await makeContact(auth); const seed = await makeSeed(auth, contact);
    const created = await putPersonSourceSync(pool!, auth, randomUUID(), mutation(auth, contact, seed));
    const owner = "system:person-source-sync-worker:crash-before-final"; const createdAt = new Date();
    const runID = await stageOpenRun(auth, created.sync.id, seed, { attemptCount: 3, createdAt, leaseOwner: owner });
    const hooks = hooksFor(auth, created.sync.id, seed, runID, owner, createdAt);
    await expect(runPublicResearch(pool!, auth, researchRequest(contact, seed, created.sync.id, runID),
      async () => offlinePage(seed, "Actually committed before a synthetic crash."),
      { recurringRunId: runID, recurring: { ...hooks, async finalize() { throw new Error("synthetic crash before final transaction commit"); } } },
    )).rejects.toThrow("synthetic crash");
    expect(await captureCount(auth)).toBe(1);
    if (availability === "deleted") await pool!.query("UPDATE source_resources SET processing_state='deleted' WHERE account_id=$1 AND client_resource_id LIKE 'research:%'", [auth.accountId]);
    if (availability === "revoked") await pool!.query("UPDATE source_retention_receipts SET authorization_state='revoked' WHERE account_id=$1 AND capture_id <> $2", [auth.accountId, seed.captureId]);
    await pool!.query("UPDATE person_source_sync_runs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1 AND id=$2", [auth.accountId, runID]);
    await pool!.query("UPDATE research_retrieval_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1 AND recurring_run_id=$2", [auth.accountId, runID]);
    let fetches = 0;
    const sweep = await runDuePersonSourceSyncs(pool!, { loadPage: async () => { fetches += 1; throw new Error("must never fetch a fourth attempt"); } });
    expect(fetches).toBe(0); expect(sweep.partial).toBe(1); expect(sweep.completed).toBe(0);
    const run = (await runRows(auth, created.sync.id))[0]!;
    expect(run.status).toBe("partial"); expect(run.attempt_count).toBe(3);
    const task = await pool!.query("SELECT status FROM research_tasks WHERE account_id=$1", [auth.accountId]);
    expect(task.rows[0].status).toBe("partial");
    const receipt = await pool!.query("SELECT response_body FROM idempotency_records WHERE account_id=$1 AND operation_scope='run_public_research'", [auth.accountId]);
    const body = receipt.rows[0].response_body;
    expect(body.status).toBe("partial"); expect(body.pages).toHaveLength(availability === "available" ? 1 : 0);
    const committed = await pool!.query("SELECT observed_capture_id,observed_resource_id FROM person_source_sync_runs WHERE account_id=$1 AND id=$2", [auth.accountId, runID]);
    if (availability === "available") {
      expect(body.pages[0].capture_id).toBe(committed.rows[0].observed_capture_id);
      expect(body.pages[0].resource_id).toBe(committed.rows[0].observed_resource_id);
    }
    expect(body.warnings).toContain("PERSON_SOURCE_SYNC_ATTEMPTS_EXHAUSTED");
    expect(await calendarCards(auth)).toHaveLength(availability === "available" ? 1 : 0);
  });

  it("B1: a transaction begun before the deadline cannot commit a capture after it (two-client barrier)", async () => {
    const auth = await createAccount();
    const contact = await makeContact(auth);
    const seed = await makeSeed(auth, contact);
    const created = await putPersonSourceSync(pool!, auth, randomUUID(), mutation(auth, contact, seed));
    const createdAt = new Date(Date.now() - (15 * 60 - 1) * 1000); // ~1s of budget
    const executionId = "system:person-source-sync-worker:barrier-b1";
    const runID = await stageOpenRun(auth, created.sync.id, seed, {
      createdAt,
      leaseOwner: executionId,
      leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
    });
    const hooks = hooksFor(auth, created.sync.id, seed, runID, executionId, createdAt);

    // Client A holds the grant row lock across the deadline (a slow revoke).
    const blocker = await pool!.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      `SELECT 1 FROM person_source_sync_grants WHERE account_id=$1 AND id=$2 FOR UPDATE`,
      [auth.accountId, created.sync.id],
    );
    // The commit transaction begins before the deadline, then waits on the lock.
    const commit = hooks.commitPage(
      offlinePage(seed, "Crossing deadline body."),
      captureRequest(auth, contact, seed, "Crossing deadline body."),
    );
    await new Promise((resolve) => setTimeout(resolve, 1200)); // cross the deadline
    await blocker.query("COMMIT");
    blocker.release();
    const outcome = await commit;
    // Post-lock live time (clock_timestamp) refuses the late capture.
    expect(outcome.committed).toBeNull();
    expect(outcome.stop).toBe(true);
    expect(await captureCount(auth)).toBe(0);
    const rows = await runRows(auth, created.sync.id);
    expect(rows[0]!.stop_reason).toBe("PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED");
  });

  it("B1: an execution lease expiring during the lock wait refuses the capture write", async () => {
    const auth = await createAccount();
    const contact = await makeContact(auth);
    const seed = await makeSeed(auth, contact);
    const created = await putPersonSourceSync(pool!, auth, randomUUID(), mutation(auth, contact, seed));
    const createdAt = new Date();
    const executionId = "system:person-source-sync-worker:lease-b1";
    const runID = await stageOpenRun(auth, created.sync.id, seed, {
      createdAt,
      leaseOwner: executionId,
      leaseExpiresAt: new Date(Date.now() + 1000),
    });
    const hooks = hooksFor(auth, created.sync.id, seed, runID, executionId, createdAt);
    const blocker = await pool!.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      `SELECT 1 FROM person_source_sync_grants WHERE account_id=$1 AND id=$2 FOR UPDATE`,
      [auth.accountId, created.sync.id],
    );
    const commit = hooks.commitPage(
      offlinePage(seed, "Lease crossing body."),
      captureRequest(auth, contact, seed, "Lease crossing body."),
    );
    await new Promise((resolve) => setTimeout(resolve, 1400)); // lease expires
    await blocker.query("COMMIT");
    blocker.release();
    const outcome = await commit;
    expect(outcome.committed).toBeNull();
    expect(outcome.stop).toBe(true);
    expect(await captureCount(auth)).toBe(0);
  });

  it("B3: deadline crossing at completion agrees across run, task, idempotency body and API result", async () => {
    const auth = await createAccount();
    const contact = await makeContact(auth);
    const seed = await makeSeed(auth, contact);
    const created = await putPersonSourceSync(pool!, auth, randomUUID(), mutation(auth, contact, seed));
    const createdAt = new Date(Date.now() - (15 * 60 - 1) * 1000);
    const executionId = "system:person-source-sync-worker:b3-deadline";
    const runID = await stageOpenRun(auth, created.sync.id, seed, {
      status: "claimed",
      createdAt,
      leaseOwner: executionId,
      leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
    });
    const hooks = hooksFor(auth, created.sync.id, seed, runID, executionId, createdAt);
    let taskID = "";
    const boundedHooks: RecurringResearchCycleHooks = {
      ...hooks,
      async recordTask(id: string) {
        taskID = id;
        await hooks.recordTask(id);
      },
      async commitPage(page, request) {
        const committed = await hooks.commitPage(page, request);
        expect(committed.committed).not.toBeNull();
        await new Promise((resolve) => setTimeout(resolve, 1200));
        return committed;
      },
    };
    // The page commits inside the deadline, then the completion crosses it.
    const result = await runPublicResearch(
      pool!,
      auth,
      {
        idempotency_key: `person-source-sync:${created.sync.id}:${runID}`,
        person_id: contact.personId,
        relationship_context_id: contact.contextId,
        seed_resource_id: seed.resourceId,
        purpose: "Owner-confirmed periodic re-read of one bound public source for one person.",
        expected_seed_url: seed.url,
        authorization: {
          decision: "approve_public_research",
          allowed_domain: new URL(seed.url).hostname.toLowerCase(),
          maximum_page_count: 1,
          maximum_link_depth: 0,
        },
      },
      async () => {
        return offlinePage(seed, "Committed before completion deadline body.");
      },
      {
        recurring: boundedHooks,
        recurringRunId: runID,
        hostnameLookup: async () => [{ address: "8.8.8.8", family: 4 }],
      },
    );
    const run = (await runRows(auth, created.sync.id))[0]!;
    expect(run.status).toBe("partial");
    expect(run.stop_reason).toBe("PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED");
    expect(result.body.status).toBe("partial");
    expect(result.body.warnings).toContain("PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED");
    const task = await pool!.query<{ status: string }>(
      `SELECT status FROM research_tasks WHERE account_id=$1 AND id=$2`,
      [auth.accountId, taskID],
    );
    expect(task.rows[0]!.status).toBe("partial");
    const idem = await pool!.query<{ response_body: { status: string; warnings: string[] } }>(
      `SELECT response_body FROM idempotency_records WHERE account_id=$1 AND operation_scope='run_public_research'`,
      [auth.accountId],
    );
    expect(idem.rows[0]!.response_body.status).toBe("partial");
    expect(idem.rows[0]!.response_body.warnings).toContain(
      "PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED",
    );
    expect(result.body.status).not.toBe("completed");
    expect(result.body.pages).toHaveLength(1);
    expect(await captureCount(auth)).toBe(1);
  });

  it("B3: authority loss at completion maps to skipped run and never completed receipts", async () => {
    const auth = await createAccount();
    const contact = await makeContact(auth);
    const seed = await makeSeed(auth, contact);
    const created = await putPersonSourceSync(pool!, auth, randomUUID(), mutation(auth, contact, seed));
    const createdAt = new Date();
    const executionId = "system:person-source-sync-worker:b3-authority";
    const runID = await stageOpenRun(auth, created.sync.id, seed, {
      status: "claimed",
      createdAt,
      leaseOwner: executionId,
      leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
    });
    const hooks = hooksFor(auth, created.sync.id, seed, runID, executionId, createdAt);
    const result = await runPublicResearch(
      pool!,
      auth,
      {
        idempotency_key: `person-source-sync:${created.sync.id}:${runID}`,
        person_id: contact.personId,
        relationship_context_id: contact.contextId,
        seed_resource_id: seed.resourceId,
        purpose: "Owner-confirmed periodic re-read of one bound public source for one person.",
        expected_seed_url: seed.url,
        authorization: {
          decision: "approve_public_research",
          allowed_domain: new URL(seed.url).hostname.toLowerCase(),
          maximum_page_count: 1,
          maximum_link_depth: 0,
        },
      },
      async () => {
        // The owner revokes the source while the fetch is in flight.
        await pool!.query(
          `UPDATE source_retention_receipts SET authorization_state='revoked'
           WHERE account_id=$1 AND capture_id=$2`,
          [auth.accountId, seed.captureId],
        );
        return offlinePage(seed, "Revoked mid-flight body.");
      },
      {
        recurring: hooks,
        recurringRunId: runID,
        hostnameLookup: async () => [{ address: "8.8.8.8", family: 4 }],
      },
    );
    const run = (await runRows(auth, created.sync.id))[0]!;
    expect(run.status).toBe("skipped");
    expect(result.body.status).toBe("failed");
    expect(result.body.status).not.toBe("completed");
    expect(result.body.warnings).toContain(
      "PERSON_SOURCE_SYNC_AUTHORITY_LOST_BEFORE_COMPLETION",
    );
    expect(await captureCount(auth)).toBe(0);
  });

  it("B2: expired re-admission after the seed read prevents DNS and any research lease", async () => {
    const auth = await createAccount();
    const contact = await makeContact(auth);
    const seed = await makeSeed(auth, contact);
    const created = await putPersonSourceSync(pool!, auth, randomUUID(), mutation(auth, contact, seed));
    const createdAt = new Date();
    const executionId = "system:person-source-sync-worker:b2-dns";
    const runID = await stageOpenRun(auth, created.sync.id, seed, {
      status: "claimed",
      createdAt,
      leaseOwner: executionId,
      leaseExpiresAt: new Date(Date.now() + 5 * 60_000),
    });
    const hooks = hooksFor(auth, created.sync.id, seed, runID, executionId, createdAt);
    let dnsCalls = 0;
    const expired: RecurringResearchCycleHooks = {
      ...hooks,
      async admit() {
        throw new Error("PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED");
      },
    };
    await expect(
      runPublicResearch(
        pool!,
        auth,
        {
          idempotency_key: `person-source-sync:${created.sync.id}:${runID}`,
          person_id: contact.personId,
          relationship_context_id: contact.contextId,
          seed_resource_id: seed.resourceId,
          purpose: "Owner-confirmed periodic re-read of one bound public source for one person.",
          expected_seed_url: seed.url,
          authorization: {
            decision: "approve_public_research",
            allowed_domain: new URL(seed.url).hostname.toLowerCase(),
            maximum_page_count: 1,
            maximum_link_depth: 0,
          },
        },
        async () => {
          throw new Error("must not fetch");
        },
        {
          recurring: expired,
          recurringRunId: runID,
          hostnameLookup: async () => {
            dnsCalls += 1;
            return [{ address: "8.8.8.8", family: 4 }];
          },
        },
      ),
    ).rejects.toThrow();
    expect(dnsCalls).toBe(0);
    const jobs = await pool!.query(
      `SELECT 1 FROM research_retrieval_jobs WHERE account_id=$1 AND recurring_run_id=$2`,
      [auth.accountId, runID],
    );
    expect(jobs.rowCount).toBe(0);
  });

  it("B2: transport receives only the remaining cycle budget after awaited authority", async () => {
    const auth = await createAccount();
    const contact = await makeContact(auth);
    const seed = await makeSeed(auth, contact);
    const created = await putPersonSourceSync(pool!, auth, randomUUID(), mutation(auth, contact, seed));
    const createdAt = new Date(Date.now() - (15 * 60 - 4) * 1000); // ~4s left
    await stageOpenRun(auth, created.sync.id, seed, {
      status: "pending",
      createdAt,
      attemptCount: 0,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
    await pool!.query(
      `UPDATE person_source_sync_grants SET next_due_at = clock_timestamp() + interval '1 hour'
       WHERE account_id=$1 AND id=$2`,
      [auth.accountId, created.sync.id],
    );
    let observedTimeout = -1;
    await runDuePersonSourceSyncs(pool!, {
      loadPage: async (_url, _host, options) => {
        observedTimeout = options?.timeoutMs ?? -1;
        return offlinePage(seed, "Budget capped body.");
      },
    });
    expect(observedTimeout).toBeGreaterThan(0);
    expect(observedTimeout).toBeLessThanOrEqual(4000);
    expect(observedTimeout).toBeLessThanOrEqual(12000);
  });
  it("replays committed create and pause after expiry without admitting a new expired intent", async () => {
    const auth = await createAccount(); const contact = await makeContact(auth); const seed = await makeSeed(auth, contact);
    const grantID = randomUUID();
    const expires = new Date(Date.now() + 1500).toISOString();
    const original = mutation(auth, contact, seed, { expires_at: expires });
    const created = await putPersonSourceSync(pool!, auth, grantID, original);
    const pause = { ...original, expected_revision: created.sync.revision, idempotency_key: randomUUID(), status: "paused" as const };
    await putPersonSourceSync(pool!, auth, grantID, pause);
    await pool!.query("SELECT pg_sleep_until($1::timestamptz)", [new Date(Date.parse(expires) + 20).toISOString()]);
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Date.parse(expires) - Date.now() + 50)));
    const replayCreate = await putPersonSourceSync(pool!, auth, grantID, original);
    const replayPause = await putPersonSourceSync(pool!, auth, grantID, pause);
    expect(replayCreate.sync.revision).toBe(2); expect(replayPause.sync.revision).toBe(2);
    expect(replayPause.sync.effective_state).toBe("expired");
    expect(replayPause.sync.last_operation_id).toBe(pause.idempotency_key);
    await expect(putPersonSourceSync(pool!, auth, grantID, { ...pause, expected_revision: 2, status: "active", idempotency_key: randomUUID() })).rejects.toMatchObject({ code:"PERSON_SOURCE_SYNC_EXPIRY_INVALID" });
    await expect(putPersonSourceSync(pool!, auth, randomUUID(), { ...original, idempotency_key: randomUUID() })).rejects.toMatchObject({ code:"PERSON_SOURCE_SYNC_EXPIRY_INVALID" });
    const operations = await pool!.query("SELECT count(*)::int AS count FROM person_source_sync_operations WHERE account_id=$1", [auth.accountId]);
    expect(operations.rows[0].count).toBe(2);
    expect(await captureCount(auth)).toBe(0);
  });

  it("does not spend a bounded dispatch slot on a different live third attempt", async () => {
    const authA=await createAccount(); const personA=await makeContact(authA); const seedA=await makeSeed(authA,personA);
    const a=await putPersonSourceSync(pool!,authA,randomUUID(),mutation(authA,personA,seedA));
    await stageOpenRun(authA,a.sync.id,seedA,{status:"dispatched",attemptCount:3});
    const authB=await createAccount(); const personB=await makeContact(authB); const seedB=await makeSeed(authB,personB);
    const b=await putPersonSourceSync(pool!,authB,randomUUID(),mutation(authB,personB,seedB));
    await runDuePersonSourceSyncs(pool!,{limit:1,loadPage:loaderFor({"/person":"Independent due person."})});
    expect((await runRows(authA,a.sync.id))[0]!.status).toBe("running");
    expect((await runRows(authA,a.sync.id))[0]!.attempt_count).toBe(3);
    expect((await runRows(authB,b.sync.id))[0]!.status).toBe("completed");
    expect(await captureCount(authA)).toBe(0);expect(await captureCount(authB)).toBe(1);
  });

});
