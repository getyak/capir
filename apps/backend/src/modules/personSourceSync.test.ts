import { describe, expect, it, vi } from "vitest";

import type { PersonSourceSyncMutationRequest } from "@talent-signal/contracts";
import {
  PERSON_SOURCE_SYNC_ATTEMPT_LIMIT,
  PERSON_SOURCE_SYNC_INTERVAL_SECONDS,
} from "@talent-signal/contracts";
import type { Pool } from "pg";
import { FormatRegistry } from "@sinclair/typebox";

import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import {
  PERSON_SOURCE_SYNC_DEADLINE_MINUTES,
  PERSON_SOURCE_SYNC_PURPOSE,
  createPersonSourceSyncCycleHooks,
  normalizePersonSourceSyncInput,
  personSourceSyncBodyHash,
  personSourceSyncCycleKey,
  personSourceSyncFrozenRequest,
  personSourceSyncRunStatus,
  personSourceSyncWarningCodes,
  putPersonSourceSync,
  runDuePersonSourceSyncs,
} from "./personSourceSync.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
if (!FormatRegistry.Has("uuid")) {
  FormatRegistry.Set("uuid", (value) => UUID.test(value));
}
if (!FormatRegistry.Has("date-time")) {
  FormatRegistry.Set("date-time", (value) => Number.isFinite(Date.parse(value)));
}

const grantId = "11111111-1111-4111-8111-111111111111";
const personId = "22222222-2222-4222-8222-222222222222";
const contextId = "33333333-3333-4333-8333-333333333333";
const seedId = "44444444-4444-4444-8444-444444444444";

function mutation(
  overrides: Partial<PersonSourceSyncMutationRequest> = {},
): PersonSourceSyncMutationRequest {
  return {
    expected_revision: 0,
    idempotency_key: "55555555-5555-4555-8555-555555555555",
    person_id: personId,
    relationship_context_id: contextId,
    seed_resource_id: seedId,
    source_url: "https://profile.example/person#section",
    time_zone: "Asia/Shanghai",
    interval_seconds: 86_400,
    expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    status: "active",
    confirmation: "periodic_public_source_re_read",
    ...overrides,
  };
}

describe("person source sync deliberate confirmation validation", () => {
  it("freezes the exact canonical URL and the honest 24-hour interval", () => {
    const input = normalizePersonSourceSyncInput(mutation());
    expect(input.source_url).toBe("https://profile.example/person");
    expect(input.interval_seconds).toBe(PERSON_SOURCE_SYNC_INTERVAL_SECONDS);
    expect(input.confirmation).toBe("periodic_public_source_re_read");
  });

  it("rejects anything but the honest 24-hour UTC interval", () => {
    expect(() =>
      normalizePersonSourceSyncInput(mutation({ interval_seconds: 3600 as never })),
    ).toThrow(
      expect.objectContaining({ code: "PERSON_SOURCE_SYNC_INVALID" }),
    );
  });

  it("rejects a missing separate periodic confirmation", () => {
    expect(() =>
      normalizePersonSourceSyncInput(
        mutation({ confirmation: "approve_public_research" as never }),
      ),
    ).toThrow(
      expect.objectContaining({ code: "PERSON_SOURCE_SYNC_INVALID" }),
    );
  });

  it("requires a real future expiry and never accepts an already-expired grant", () => {
    expect(() =>
      normalizePersonSourceSyncInput(
        mutation({ expires_at: new Date(Date.now() - 60_000).toISOString() }),
      ),
    ).toThrow(
      expect.objectContaining({ code: "PERSON_SOURCE_SYNC_EXPIRY_INVALID" }),
    );
    expect(() =>
      normalizePersonSourceSyncInput(
        mutation({
          expires_at: new Date(Date.now() + 400 * 86_400_000).toISOString(),
        }),
      ),
    ).toThrow(
      expect.objectContaining({ code: "PERSON_SOURCE_SYNC_EXPIRY_INVALID" }),
    );
  });

  it("rejects invalid IANA display zones", () => {
    expect(() =>
      normalizePersonSourceSyncInput(mutation({ time_zone: "Not/AZone" })),
    ).toThrow(
      expect.objectContaining({ code: "PERSON_SOURCE_SYNC_INVALID" }),
    );
  });

  it("rejects non-HTTPS confirmed URLs", () => {
    expect(() =>
      normalizePersonSourceSyncInput(
        mutation({ source_url: "http://profile.example/person" }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: "PERSON_SOURCE_SYNC_SOURCE_SCOPE_CHANGED",
      }),
    );
  });
});

describe("person source sync immutable cycle request", () => {
  it("builds the request only from frozen grant-time values", () => {
    const request = personSourceSyncFrozenRequest({
      cycleKey: personSourceSyncCycleKey(grantId, new Date("2026-10-18T08:00:00.000Z")),
      personId,
      relationshipContextId: contextId,
      seedResourceId: seedId,
      sourceUrl: "https://profile.example/person",
      allowedDomain: "profile.example",
    });
    expect(request.idempotency_key).toBe(
      `person-source-sync:${grantId}:2026-10-18T08:00:00.000Z`,
    );
    expect(request.expected_seed_url).toBe("https://profile.example/person");
    expect(request.authorization.allowed_domain).toBe("profile.example");
    // Exactly one approved URL per due cycle.
    expect(request.authorization.maximum_page_count).toBe(1);
    expect(request.authorization.maximum_link_depth).toBe(0);
    expect(request.purpose).toBe(PERSON_SOURCE_SYNC_PURPOSE);
    expect(request.idempotency_key.length).toBeLessThanOrEqual(128);
  });

  it("gives every cycle of one due time the same durable cycle key", () => {
    const due = new Date("2026-10-18T08:00:00.000Z");
    expect(personSourceSyncCycleKey(grantId, due)).toBe(
      personSourceSyncCycleKey(grantId, new Date(due.toISOString())),
    );
    expect(personSourceSyncCycleKey(grantId, due)).not.toBe(
      personSourceSyncCycleKey(grantId, new Date("2026-10-19T08:00:00.000Z")),
    );
  });
});

describe("person source sync cross-cycle unchanged dedup hash", () => {
  it("hashes the stable extracted body, not volatile fetch metadata", () => {
    const text = "Public professional profile excerpt.";
    expect(personSourceSyncBodyHash(text)).toBe(personSourceSyncBodyHash(text));
    expect(personSourceSyncBodyHash(text)).toMatch(/^[a-f0-9]{64}$/);
    expect(personSourceSyncBodyHash("Changed body text.")).not.toBe(
      personSourceSyncBodyHash(text),
    );
  });
});

describe("person source sync honest run readback", () => {
  const now = new Date("2026-10-18T08:00:00.000Z");

  it("keeps a live lease as running and an expired lease as unknown", () => {
    expect(
      personSourceSyncRunStatus(
        {
          status: "dispatched",
          lease_expires_at: new Date(now.valueOf() + 60_000),
        },
        now,
      ),
    ).toEqual({ status: "running", settled: false });
    expect(
      personSourceSyncRunStatus(
        {
          status: "dispatched",
          lease_expires_at: new Date(now.valueOf() - 60_000),
        },
        now,
      ),
    ).toEqual({ status: "unknown", settled: false });
  });

  it("never claims a settled outcome it did not observe", () => {
    expect(personSourceSyncRunStatus({ status: "pending", lease_expires_at: null }, now)).toEqual({
      status: "pending",
      settled: false,
    });
    expect(
      personSourceSyncRunStatus({ status: "completed", lease_expires_at: null }, now),
    ).toEqual({ status: "completed", settled: true });
    expect(
      personSourceSyncRunStatus({ status: "unknown", lease_expires_at: null }, now),
    ).toEqual({ status: "unknown", settled: true });
    expect(
      personSourceSyncRunStatus({ status: "skipped", lease_expires_at: null }, now),
    ).toEqual({ status: "skipped", settled: true });
  });
});

describe("person source sync fixed diagnostics", () => {
  it("keeps only fixed content-free warning codes, never raw text", () => {
    expect(
      personSourceSyncWarningCodes([
        "https://profile.example/person: PUBLIC_RESEARCH_FETCH_FAILED",
        "SECRET_RAW_EXCEPTION_TEXT",
        "https://profile.example/x: SECRET_SUFFIX_CANARY",
        "https://profile.example/person: PERSON_SOURCE_SYNC_UNCHANGED",
      ]),
    ).toEqual([
      "PUBLIC_RESEARCH_FETCH_FAILED",
      "PERSON_SOURCE_SYNC_UNCHANGED",
    ]);
  });
});

describe("person source sync attempt budget bounds", () => {
  it("is three total attempts inside a fifteen-minute absolute deadline", () => {
    expect(PERSON_SOURCE_SYNC_ATTEMPT_LIMIT).toBe(3);
    expect(PERSON_SOURCE_SYNC_DEADLINE_MINUTES).toBe(15);
    expect(PERSON_SOURCE_SYNC_INTERVAL_SECONDS).toBe(86_400);
  });

  it("surfaces API errors with their fixed code and no invented approval", async () => {
    const error = new ApiError(
      409,
      "PERSON_SOURCE_SYNC_GRANT_EXPIRED",
      "expired",
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.statusCode).toBe(409);
  });
});

/* ------------------------------------------------------------------ */
/* Regression harness: real production functions against a recording   */
/* SQL adapter, asserting behavior (writes, ordering, fetches) rather  */
/* than constants.                                                     */
/* ------------------------------------------------------------------ */

interface Recorded {
  phase: string;
  sql: string;
  params: unknown[];
}

interface Harness {
  pool: Pool;
  calls: Recorded[];
  writes: Recorded[];
}

const RUN_ID = "66666666-6666-4666-8666-666666666666";
const GRANT_ID = grantId;
const SEED_RESOURCE = "77777777-7777-4777-8777-777777777777";
const SEED_CAPTURE = "88888888-8888-4888-8888-888888888888";
const ACTOR = "99999999-9999-4999-8999-999999999999";

function dispatchableRun(overrides: Record<string, unknown> = {}) {
  return {
    account_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    id: RUN_ID,
    grant_id: GRANT_ID,
    cycle_key: personSourceSyncCycleKey(GRANT_ID, new Date("2026-10-18T08:00:00.000Z")),
    due_at: new Date("2026-10-18T08:00:00.000Z"),
    status: "dispatched",
    attempt_count: 3,
    lease_owner: "system:person-source-sync-worker:live",
    lease_expires_at: new Date(Date.now() + 60_000),
    frozen_seed_resource_id: SEED_RESOURCE,
    frozen_source_url: "https://8.8.8.8/person",
    frozen_allowed_domain: "8.8.8.8",
    grant_actor_user_id: ACTOR,
    grant_authorization_revision: 1,
    grant_authorized_at: new Date("2026-10-01T00:00:00.000Z"),
    source_capture_version: 1,
    task_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    observed_resource_id: null,
    observed_capture_id: null,
    observed_canonical_url: null,
    observed_body_hash: null,
    new_observations: 0,
    warning_codes: [],
    stop_reason: null,
    created_at: new Date(Date.now() - 60_000),
    updated_at: new Date(),
    started_at: new Date(),
    completed_at: null,
    content_available: true,
    account_slug: "synthetic",
    grant_subject_id: personId,
    grant_assignment_id: contextId,
    seed_capture_id: SEED_CAPTURE,
    root_capture_id: SEED_CAPTURE,
    actor_email: "owner@example.test",
    ...overrides,
  };
}

function harness(
  respond: (sql: string, params: unknown[], phase: string) => unknown,
): Harness {
  const calls: Recorded[] = [];
  let phase = "pool";
  const query = async (sql: string, params: unknown[] = []) => {
    if (sql === "BEGIN") phase = `tx${calls.length}`;
    calls.push({ phase, sql, params });
    return respond(sql, params, phase);
  };
  const client = { query: vi.fn(query), release: vi.fn() };
  const pool = {
    query: vi.fn(query),
    connect: vi.fn(async () => client),
  } as unknown as Pool;
  return {
    pool,
    calls,
    get writes() {
      return calls.filter((call) => /^\s*(INSERT|UPDATE|DELETE|WITH (?:capture_clock|write_clock))/i.test(call.sql));
    },
  };
}

const empty = () => ({ rows: [], rowCount: 0 });
const rows = (value: unknown) => ({ rows: [value], rowCount: 1 });

describe("person source sync live-execution reconciliation (R4)", () => {
  it("never settles a live third attempt from a parallel sweep", async () => {
    const adapter = harness((sql, params) => {
      if (sql.includes("FROM (SELECT run.*")) return (params[0] as string[]).includes(RUN_ID) ? empty() : rows(dispatchableRun());
      if (sql.includes("FOR UPDATE OF run")) {
        return rows({
          ...dispatchableRun(),
          deadline_exceeded: false,
          run_lease_live: true,
        });
      }
      if (sql.includes("FROM research_retrieval_jobs")) {
        return rows({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          task_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          idempotency_record_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          status: "running",
          job_lease_live: true,
        });
      }
      return empty();
    });

    const result = await runDuePersonSourceSyncs(adapter.pool, {
      loadPage: async () => {
        throw new Error("must not fetch");
      },
    });

    // A live third execution is never finalized or cleared; its lease stays
    // intact and no receipt is rewritten.
    expect(result).toMatchObject({
      dispatched: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      unresolved: 0,
    });
    expect(adapter.writes).toEqual([]);
  });

  it("settles an expired third execution with bounded receipts and no fetch", async () => {
    const adapter = harness((sql, params) => {
      if (sql.includes("FROM (SELECT run.*")) return (params[0] as string[]).includes(RUN_ID) ? empty() : rows(dispatchableRun());
      if (sql.includes("FOR UPDATE OF run")) {
        return rows({
          ...dispatchableRun(),
          lease_owner: "system:person-source-sync-worker:crashed",
          lease_expires_at: new Date(Date.now() - 60_000),
          deadline_exceeded: false,
          run_lease_live: false,
        });
      }
      if (sql.includes("FROM research_retrieval_jobs")) {
        return rows({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          task_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          idempotency_record_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          status: "running",
          job_lease_live: false,
        });
      }
      return empty();
    });

    const result = await runDuePersonSourceSyncs(adapter.pool, {
      loadPage: async () => {
        throw new Error("must not fetch");
      },
    });

    // Bounded DB-only receipt reconciliation: run outcome, research task,
    // idempotency record and research job — never a fourth fetch.
    expect(result).toMatchObject({ unresolved: 1 });
    const runWrite = adapter.writes.find((call) =>
      call.sql.includes("UPDATE person_source_sync_runs SET"),
    );
    expect(runWrite?.params).toContain("unknown");
    expect(runWrite?.params).toContain("PERSON_SOURCE_SYNC_ATTEMPTS_EXHAUSTED");
    expect(
      adapter.writes.some((call) => call.sql.includes("UPDATE research_tasks")),
    ).toBe(true);
    expect(
      adapter.writes.some((call) => call.sql.includes("UPDATE idempotency_records")),
    ).toBe(true);
    expect(
      adapter.writes.some((call) =>
        call.sql.includes("UPDATE research_retrieval_jobs"),
      ),
    ).toBe(true);
    expect(
      adapter.writes.some((call) => call.sql.includes("INSERT INTO captures")),
    ).toBe(false);
    expect(result.dispatched).toBe(0);
  });
});

describe("person source sync immutable deadline and lease gates (R5)", () => {
  const cycleContext = {
    pool: undefined as unknown as Pool,
    auth: {
      accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      accountSlug: "synthetic",
      userId: ACTOR,
      userEmail: "owner@example.test",
      userKind: "simulated_human",
      sessionId: "system:person-source-sync-worker:test",
    } as AuthContext,
    runId: RUN_ID,
    grantId: GRANT_ID,
    executionId: "system:person-source-sync-worker:test",
    rootCaptureId: SEED_CAPTURE,
    seedCaptureId: SEED_CAPTURE,
    seedResourceId: SEED_RESOURCE,
    frozenSourceUrl: "https://8.8.8.8/person",
    frozenAllowedDomain: "8.8.8.8",
    sourceCaptureVersion: 1,
    grantActorUserId: ACTOR,
    grantAuthorizationRevision: 1,
    grantAuthorizedAt: new Date("2026-10-01T00:00:00.000Z"),
    deadlineAt: new Date(Date.now() + 15 * 60_000),
  };

  function authorizedGate(sql: string): unknown {
    if (sql.includes("SELECT retired_at FROM accounts")) {
      return rows({ retired_at: null });
    }
    if (sql.includes("UPDATE person_source_sync_runs SET")) {
      // Fenced receipt writes report one affected row in these harnesses.
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("AS grant_status")) {
      return rows({
        grant_status: "active",
        grant_expires_at: new Date(Date.now() + 86_400_000),
        grant_subject_id: personId,
        grant_assignment_id: contextId,
        grant_source_capture_version: 1,
        person_status: "active",
        seed_processing_state: "ready",
        seed_source_locator: "https://8.8.8.8/person",
        capture_status: "active",
        capture_identity_status: "bound",
        capture_subject_id: personId,
        capture_assignment_id: contextId,
        capture_version: 1,
        authorization_state: "authorized",
        authorization_expires_at: null,
      });
    }
    return empty();
  }

  it("refuses a page commit after the absolute cycle deadline", async () => {
    const adapter = harness((sql) => {
      if (sql.includes("AS lease_ok")) {
        return rows({ lease_ok: true, deadline_ok: false, remaining_ms: "0" });
      }
      return authorizedGate(sql);
    });
    const hooks = createPersonSourceSyncCycleHooks({
      ...cycleContext,
      pool: adapter.pool,
    });
    const outcome = await hooks.commitPage(
      {
        canonicalUrl: "https://8.8.8.8/person",
        contentHash: "a".repeat(64),
        retrievedAt: new Date(),
        text: "Late body.",
        links: [],
      },
      { resource: {} } as never,
    );
    expect(outcome).toEqual({ committed: null, unchanged: false, stop: true });
    // No capture is created after the deadline; the receipt records why.
    expect(adapter.writes.some((call) => call.sql.includes("INSERT INTO"))).toBe(false);
    const hint = adapter.writes.find((call) =>
      call.sql.includes("stop_reason=COALESCE(stop_reason,'PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED')"),
    );
    expect(hint).toBeTruthy();
  });

  it("refuses a page commit on an expired or foreign lease", async () => {
    const adapter = harness((sql) => {
      if (sql.includes("AS lease_ok")) {
        return rows({ lease_ok: false, deadline_ok: true, remaining_ms: "1" });
      }
      return authorizedGate(sql);
    });
    const hooks = createPersonSourceSyncCycleHooks({
      ...cycleContext,
      pool: adapter.pool,
    });
    const outcome = await hooks.commitPage(
      {
        canonicalUrl: "https://8.8.8.8/person",
        contentHash: "a".repeat(64),
        retrievedAt: new Date(),
        text: "Stale body.",
        links: [],
      },
      { resource: {} } as never,
    );
    expect(outcome).toEqual({ committed: null, unchanged: false, stop: true });
    expect(adapter.writes.some((call) => call.sql.includes("INSERT INTO"))).toBe(false);
    expect(
      adapter.writes.some((call) =>
        call.sql.includes("PERSON_SOURCE_SYNC_LEASE_LOST"),
      ),
    ).toBe(true);
  });

  it("records a post-deadline finalize as partial/failed, never completed", async () => {
    const adapter = harness((sql, params) => {
      if (sql.includes("RETURNING status,warning_codes")) return rows({ status: params[2], warning_codes: params[4] });
      if (sql.includes("AS lease_ok")) {
        return rows({ lease_ok: true, deadline_ok: false, remaining_ms: "0" });
      }
      return authorizedGate(sql);
    });
    const hooks = createPersonSourceSyncCycleHooks({
      ...cycleContext,
      pool: adapter.pool,
    });
    const outcome = await hooks.finalize(adapter.pool, {
      taskId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      status: "completed",
      committedPages: [
        {
          canonical_url: "https://8.8.8.8/person",
          resource_id: SEED_RESOURCE,
          capture_id: SEED_CAPTURE,
          content_hash: "a".repeat(64),
          retrieved_at: new Date().toISOString(),
        },
      ],
      unchangedPages: 0,
      warnings: [],
    });
    expect(outcome.status).toBe("partial");
    expect(outcome.warnings).toContain("PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED");
    const runWrite = adapter.writes.find((call) =>
      call.sql.includes("UPDATE person_source_sync_runs SET"),
    );
    expect(runWrite?.params).toContain("partial");
    expect(runWrite?.params).toContain("PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED");
    expect(runWrite?.params).not.toContain("completed");
    // The finalize write is owner fenced and lease valid.
    expect(runWrite?.sql).toContain("lease_expires_at > write_gate.instant");
    expect(runWrite?.sql).toContain("created_at <= write_gate.instant");
    expect(runWrite?.sql).toContain("RETURNING status,warning_codes");
  });

  it("aborts finalization for a stale owner before any research row write", async () => {
    const adapter = harness((sql) => {
      if (sql.includes("AS lease_ok")) {
        return rows({ lease_ok: false, deadline_ok: true, remaining_ms: "1" });
      }
      return authorizedGate(sql);
    });
    const hooks = createPersonSourceSyncCycleHooks({
      ...cycleContext,
      pool: adapter.pool,
    });
    await expect(
      hooks.finalize(adapter.pool, {
        taskId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        status: "completed",
        committedPages: [],
        unchangedPages: 0,
        warnings: [],
      }),
    ).rejects.toMatchObject({ code: "PERSON_SOURCE_SYNC_LEASE_LOST" });
    expect(adapter.writes).toEqual([]);
  });
});

describe("person source sync durable counted claim (R7)", () => {
  it("commits the counted claim before authority work and keeps the count on failure", async () => {
    let authorityCalls = 0;
    const adapter = harness((sql, params) => {
      if (sql.includes("FROM (SELECT run.*")) {
        return (params[0] as string[]).includes(RUN_ID) ? empty() : rows(dispatchableRun({ attempt_count: 0, lease_owner: null, lease_expires_at: null }));
      }
      if (sql.includes("status='running' AND lease_expires_at > clock_timestamp()")) {
        return empty();
      }
      if (sql.includes("UPDATE person_source_sync_runs SET")
        && sql.includes("attempt_count=attempt_count+1")) {
        return rows(dispatchableRun({ attempt_count: 1 }));
      }
      if (sql.includes("SELECT retired_at FROM accounts")) {
        return rows({ retired_at: null });
      }
      if (sql.includes("AS grant_status")) {
        // Injected failure during the post-claim authority query.
        authorityCalls += 1;
        throw new Error("synthetic authority read failure");
      }
      return empty();
    });

    const result = await runDuePersonSourceSyncs(adapter.pool, {
      loadPage: async () => {
        throw new Error("must not fetch");
      },
    });

    expect(authorityCalls).toBe(1);
    const claimIndex = adapter.calls.findIndex((call) =>
      call.sql.includes("attempt_count=attempt_count+1"),
    );
    const claim = adapter.calls[claimIndex]!;
    // The counted claim is its own committed transaction, BEFORE any
    // authority query: an early post-claim failure can never roll the count
    // back.
    expect(claim.phase).not.toBe("pool");
    const commitIndex = adapter.calls.findIndex(
      (call) => call.sql === "COMMIT" && call.phase === claim.phase,
    );
    expect(commitIndex).toBeGreaterThan(claimIndex);
    const authorityIndex = adapter.calls.findIndex((call) =>
      call.sql.includes("AS grant_status"),
    );
    expect(authorityIndex).toBeGreaterThan(commitIndex);
    // The failure consumed the attempt: the release keeps the durable count
    // and only clears the lease for a retry inside the same cycle.
    const release = adapter.writes.find(
      (call) =>
        call.sql.includes("UPDATE person_source_sync_runs SET")
        && call.sql.includes("status='pending'"),
    );
    // The durable count is never rolled back or reset by the release.
    expect(release?.sql).not.toContain("attempt_count=");
    expect(result.failed).toBe(1);
    // This cycle is excluded for the rest of the tick, so other grants can
    // continue without burning another attempt on this one.
    const claims = adapter.writes.filter((call) =>
      call.sql.includes("attempt_count=attempt_count+1"),
    );
    expect(claims).toHaveLength(1);
    expect(
      adapter.writes.some((call) => call.sql.includes("INSERT INTO captures")),
    ).toBe(false);
  });
});

describe("person source sync legal initial paused state (R1)", () => {
  it("creates a paused grant exactly as confirmed", async () => {
    const createdRow = {
      account_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      id: grantId,
      created_by_user_id: ACTOR,
      subject_id: personId,
      assignment_id: contextId,
      seed_resource_id: SEED_RESOURCE,
      source_capture_id: SEED_CAPTURE,
      source_capture_version: 1,
      source_url: "https://profile.example/person",
      allowed_domain: "profile.example",
      purpose: "Owner-confirmed periodic re-read of one bound public source for one person.",
      time_zone: "Asia/Shanghai",
      interval_seconds: 86_400,
      expires_at: new Date(Date.now() + 86_400_000),
      next_due_at: new Date(),
      status: "paused",
      revision: 1,
      last_operation_id: "55555555-5555-4555-8555-555555555555",
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
      person_label: "Synthetic Person",
      source_available: true,
    };
    const adapter = harness((sql) => {
      if (sql.includes("FROM person_source_sync_grants sync_grant")) {
        return adapterInsertPhase ? rows(createdRow) : empty();
      }
      if (sql.includes("INSERT INTO person_source_sync_grants")) {
        adapterInsertPhase = true;
        return empty();
      }
      if (sql.includes("SELECT 1 FROM subjects")) return rows({ "?column?": 1 });
      if (sql.includes("FROM source_resources resources")) {
        return rows({
          id: SEED_RESOURCE,
          capture_id: SEED_CAPTURE,
          source_locator: "https://profile.example/person",
          capture_status: "active",
          identity_status: "bound",
          capture_subject_id: personId,
          capture_assignment_id: contextId,
          capture_version: 1,
          authorization_state: "authorized",
          authorization_expires_at: null,
        });
      }
      return empty();
    });
    let adapterInsertPhase = false;

    const result = await putPersonSourceSync(
      adapter.pool,
      authForTest(),
      grantId,
      mutation({ status: "paused" }),
    );

    const insert = adapter.writes.find((call) =>
      call.sql.includes("INSERT INTO person_source_sync_grants"),
    );
    // The legal initial paused state is honored, not rewritten to active.
    expect(insert?.params).toContain("paused");
    expect(result.sync.status).toBe("paused");
  });
});

const authForTest = (): AuthContext => ({
  accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  accountSlug: "synthetic",
  userId: ACTOR,
  userEmail: "owner@example.test",
  userKind: "simulated_human",
  sessionId: "12121212-1212-4121-8121-121212121212",
});
