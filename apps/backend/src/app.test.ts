import type { Pool, PoolClient } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp as buildAppWithWorkers, type AppDependencies } from "./app.js";
import type { BackendConfig } from "./config.js";
import { RELATIONSHIP_WIKI_COMPILATION_FAILED } from "./modules/sourceAuthorization.js";
import { REQUIRED_SYSTEM_MIGRATIONS } from "./modules/systemHealth.js";
import type { VoiceTranscriptionServing } from "./modules/voiceTranscription.js";

const config: BackendConfig = {
  allowedOrigins: ["http://localhost:3000"],
  appleSignInAudiences: ["com.talentsignal.app"],
  appleSignInEnabled: true,
  databaseUrl: "postgresql://synthetic-only",
  host: "127.0.0.1",
  passwordAuthEnabled: true,
  passwordRegistrationEnabled: true,
  port: 4317,
  retentionSweepIntervalMs: 60_000,
  sessionTtlSeconds: 28_800,
  simulatedAuthEnabled: true,
};

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

// These route-boundary tests measure their own database calls. Queue worker
// execution is independently covered with a real disposable database.
const buildApp = (dependencies: AppDependencies) => buildAppWithWorkers({
  ...dependencies, conversationQueueWorkerEnabled: false,
});

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("readiness rate limiting", () => {
  it("keeps liveness database-free and returns the exact readiness contract", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: REQUIRED_SYSTEM_MIGRATIONS.map((version) => ({ version })),
    });
    const app = await buildApp({
      config,
      pool: { query } as unknown as Pool,
    });
    apps.push(app);

    const live = await app.inject({ method: "GET", url: "/health/live" });
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({
      status: "ok",
      service: "talent-signal-backend",
    });
    expect(query).not.toHaveBeenCalled();

    const ready = await app.inject({ method: "GET", url: "/health/ready" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      status: "ready",
      database: "ready",
      migration: REQUIRED_SYSTEM_MIGRATIONS.at(-1),
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("bounds repeated public database readiness probes", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: REQUIRED_SYSTEM_MIGRATIONS.map((version) => ({ version })),
    });
    const app = await buildApp({
      config,
      pool: { query } as unknown as Pool,
    });
    apps.push(app);

    for (let index = 0; index < 60; index += 1) {
      const response = await app.inject({
        method: "GET",
        url: "/health/ready",
      });
      expect(response.statusCode).toBe(200);
    }

    const limited = await app.inject({
      method: "GET",
      url: "/health/ready",
    });

    expect(limited.statusCode).toBe(429);
    expect(query).toHaveBeenCalledTimes(60);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("ANY"), [
      REQUIRED_SYSTEM_MIGRATIONS,
    ]);
  }, 10_000);

  it("keeps the image path unavailable until the queue clock migration is applied", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: REQUIRED_SYSTEM_MIGRATIONS.filter(version => version !== "103_conversation_queue_session_expiry").map(version => ({ version })),
    });
    const app = await buildApp({ config, pool: { query } as unknown as Pool });
    apps.push(app);
    expect((await app.inject({ method: "GET", url: "/health/ready" })).statusCode).toBe(503);
  });

  it.each(REQUIRED_SYSTEM_MIGRATIONS)(
    "stays unavailable when required migration %s is missing",
    async missing => {
      const query = vi.fn().mockResolvedValue({
        rows: REQUIRED_SYSTEM_MIGRATIONS.filter(version => version !== missing).map(version => ({ version })),
      });
      const app = await buildApp({ config, pool: { query } as unknown as Pool });
      apps.push(app);
      const response = await app.inject({ method: "GET", url: "/health/ready" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: "not_ready", database: "unavailable" });
    },
  );
});

describe("Talent Signal Lab capability policy", () => {
  it("returns a disabled manifest and performs no Lab read in a non-internal build", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          account_id: "30000000-0000-4000-8000-000000000001",
          account_slug: "fixture-alpha",
          user_id: "40000000-0000-4000-8000-000000000001",
          user_email: "recruiter@example.test",
          user_kind: "simulated_human",
          session_id: "50000000-0000-4000-8000-000000000001",
        },
      ],
    });
    const app = await buildApp({
      config: { ...config, internalLabEnabled: false },
      pool: { query } as unknown as Pool,
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/v1/lab",
      headers: { authorization: "Bearer synthetic-session" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      capability: {
        enabled: false,
        canonical_write_access: false,
        external_effect_access: false,
        production_data_access: false,
      },
      scenarios: [],
      active_session: null,
      latest_run: null,
      eval_cases: [],
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("denies real experiments before reading experiment state when disabled", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{
      account_id: "30000000-0000-4000-8000-000000000001", account_slug: "fixture-alpha",
      user_id: "40000000-0000-4000-8000-000000000001", user_email: "reviewer@example.test",
      user_kind: "simulated_human", session_id: "50000000-0000-4000-8000-000000000001",
    }] });
    const app = await buildApp({ config: { ...config, internalLabEnabled: false }, pool: { query } as unknown as Pool });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/v1/lab/experiments",
      headers: { authorization: "Bearer synthetic-session" } });
    expect(response.statusCode).toBe(403);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("denies feature configuration before reading override state when disabled", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{
      account_id: "30000000-0000-4000-8000-000000000001", account_slug: "fixture-alpha",
      user_id: "40000000-0000-4000-8000-000000000001", user_email: "reviewer@example.test",
      user_kind: "simulated_human", session_id: "50000000-0000-4000-8000-000000000001",
    }] });
    const app = await buildApp({ config: { ...config, internalLabEnabled: false }, pool: { query } as unknown as Pool });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/v1/lab/feature-configuration",
      headers: { authorization: "Bearer synthetic-session" } });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "LAB_CAPABILITY_DENIED" } });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("denies Lab mutation when the backend capability is disabled", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          account_id: "30000000-0000-4000-8000-000000000001",
          account_slug: "personal-ava",
          user_id: "40000000-0000-4000-8000-000000000001",
          user_email: "recruiter@example.test",
          user_kind: "password_human",
          session_id: "50000000-0000-4000-8000-000000000001",
        },
      ],
    });
    const app = await buildApp({
      config: { ...config, internalLabEnabled: false },
      pool: { query } as unknown as Pool,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/lab/sessions",
      headers: { authorization: "Bearer synthetic-session" },
      payload: {
        scenario_id: "ambiguous-identity",
        idempotency_key: "internal-lab-disabled",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: "LAB_CAPABILITY_DENIED" },
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("voice transcription route", () => {
  const audioBase64 = (() => {
    const audio = Buffer.alloc(48);
    audio.write("RIFF", 0, "ascii");
    audio.write("WAVE", 8, "ascii");
    return audio.toString("base64");
  })();

  it("requires an authenticated account before audio reaches the provider", async () => {
    const transcribe = vi.fn();
    const app = await buildApp({
      config,
      pool: { query: vi.fn() } as unknown as Pool,
      voiceTranscriber: { transcribe } as VoiceTranscriptionServing,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/voice-transcriptions",
      payload: {
        audio_base64: audioBase64,
        client_request_id: "10000000-0000-4000-8000-000000000001",
        mime_type: "audio/wav",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("returns only an editable draft receipt from the authenticated provider", async () => {
    const transcribe = vi.fn().mockResolvedValue({
      client_request_id: "10000000-0000-4000-8000-000000000001",
      model: "bigmodel",
      provider: "doubao",
      provider_request_id: "20000000-0000-4000-8000-000000000001",
      status: "draft",
      temporary_audio_stored_by_talent_signal: false,
      transcript: "Prepare the smallest safe next step.",
    });
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          account_id: "30000000-0000-4000-8000-000000000001",
          account_slug: "synthetic-workspace",
          user_id: "40000000-0000-4000-8000-000000000001",
          user_email: "recruiter@example.test",
          user_kind: "password_human",
          session_id: "50000000-0000-4000-8000-000000000001",
        },
      ],
    });
    const app = await buildApp({
      config,
      pool: { query } as unknown as Pool,
      voiceTranscriber: { transcribe } as VoiceTranscriptionServing,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/v1/voice-transcriptions",
      headers: { authorization: "Bearer synthetic-session" },
      payload: {
        audio_base64: audioBase64,
        client_request_id: "10000000-0000-4000-8000-000000000001",
        mime_type: "audio/wav",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "draft",
      temporary_audio_stored_by_talent_signal: false,
      transcript: "Prepare the smallest safe next step.",
    });
    expect(transcribe).toHaveBeenCalledWith({
      audioBase64,
      clientRequestId: "10000000-0000-4000-8000-000000000001",
      mimeType: "audio/wav",
    });
  });
});

// The private boundary uses the real application hooks and authentication. Any
// additional query (Session, observation reconciliation, Lab, etc.) fails here.
describe("private conversation persistence boundary", () => {
  it("runs only authentication SQL and never sends transient text to the pool", async () => {
    const query = vi.fn(async (sql: string) => {
      expect(sql).toContain("FROM sessions");
      expect(sql).toContain("sessions.token_hash = $1");
      expect(sql.trimStart()).toMatch(/^SELECT/u);
      return { rows: [{ account_id: "30000000-0000-4000-8000-000000000001",
        account_slug: "fixture-alpha", user_id: "40000000-0000-4000-8000-000000000001",
        user_email: "synthetic@example.test", user_kind: "simulated_human",
        session_id: "50000000-0000-4000-8000-000000000001" }] };
    });
    const app = await buildApp({ config, pool: { query } as unknown as Pool,
      privateConversationProvider: { providerId: "claude", model: "synthetic", async *stream() { yield "synthetic answer"; } },
    });
    apps.push(app);
    const response = await app.inject({ method: "POST", url: "/v1/private-conversation",
      headers: { authorization: "Bearer synthetic-session" },
      payload: { messages: [{ role: "user", content: "private-boundary-canary" }] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"type":"done"');
    expect(query).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(query.mock.calls)).not.toContain("private-boundary-canary");
  });
});

// The shipped global error handler must return a fixed internal-error contract
// and never echo private error content to the client, while keeping request
// correlation. Log-side policy is measured on the real stream in
// lib/requestLogger.integration.test.ts.
describe("unhandled request failure contract", () => {
  it("returns the fixed internal error shape without echoing error content", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const app = await buildApp({ config, pool: { query } as unknown as Pool });
    apps.push(app);
    app.get("/synthetic/throwing-route", async () => {
      const cause = new Error("cause-private-canary");
      const error = new Error("message-private-canary") as Error &
        Record<string, unknown>;
      error.name = "name-private-canary";
      error.stack =
        "name-private-canary: message-private-canary\n    at stack-private-canary";
      error.cause = cause;
      error.code = "PRIVATE_CODE_CANARY";
      error.detail = "db-detail-private-canary";
      error.query = "db-query-private-canary";
      error.providerBody = "provider-body-private-canary";
      throw error;
    });

    const response = await app.inject({
      method: "GET",
      url: "/synthetic/throwing-route?state=url-private-canary",
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        request_id: expect.any(String),
      },
    });
    for (const canary of [
      "message-private-canary",
      "stack-private-canary",
      "cause-private-canary",
      "name-private-canary",
      "PRIVATE_CODE_CANARY",
      "db-detail-private-canary",
      "db-query-private-canary",
      "provider-body-private-canary",
      "url-private-canary",
    ]) {
      expect(response.body).not.toContain(canary);
    }
  });
});

// The shipped source-authorization route keeps the raw Wiki recompilation
// exception out of the durable response body and every database parameter
// while the compilation stays null and the job remains retryable.
describe("source authorization compile fallback diagnostics", () => {
  const captureId = "11111111-1111-4111-8111-111111111111";
  const subjectId = "22222222-2222-4222-8222-222222222222";
  const assignmentId = "33333333-3333-4333-8333-333333333333";
  const userId = "44444444-4444-4444-8444-444444444444";

  it("responds with the fixed diagnostic and persists only bounded metadata", async () => {
    const canary = Object.assign(new Error("SECRET_ROUTE_MESSAGE_CANARY"), {
      name: "SECRET_ROUTE_NAME_CANARY",
      stack: "Error: SECRET_ROUTE_MESSAGE_CANARY\n    at SECRET_ROUTE_STACK_CANARY",
      cause: new Error("SECRET_ROUTE_CAUSE_CANARY"),
    });
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const rootRow = {
      id: captureId,
      created_by_user_id: userId,
      subject_id: subjectId,
      assignment_id: assignmentId,
      identity_status: "bound",
      status: "active",
      version: 1,
      authorization_state: "authorized",
      authorization_expires_at: null,
    };
    const dispatch = async (sql: string, params: unknown[] = []): Promise<unknown> => {
      calls.push({ sql, params });
      if (sql.includes("FROM sessions")) {
        return {
          rows: [{
            account_id: "55555555-5555-5555-8555-555555555555",
            account_slug: "synthetic-workspace",
            user_id: userId,
            user_email: "recruiter@example.test",
            user_kind: "simulated_human",
            session_id: "66666666-6666-6666-8666-666666666666",
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FOR UPDATE OF captures, receipts")) {
        return { rows: [rootRow], rowCount: 1 };
      }
      if (sql.includes("WITH RECURSIVE resource_lineage")) {
        return { rows: [{ capture_id: captureId }], rowCount: 1 };
      }
      if (sql.includes("receipts.authorization_expires_at")) {
        // Authorization expiry pre-check: not due.
        return {
          rows: [{ version: 1, authorization_state: "authorized", authorization_expires_at: null }],
          rowCount: 1,
        };
      }
      if (sql.includes("INSERT INTO idempotency_records")) {
        if (params[3] === "compile_relationship_wiki") {
          // The Relationship Wiki recompilation fails with raw private content.
          throw canary;
        }
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("source_authorization_compilation_jobs") && sql.includes("RETURNING id")) {
        return { rows: [{ id: "77777777-7777-7777-8777-777777777777" }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    };
    const client: Pick<PoolClient, "query" | "release"> = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => dispatch(sql, params)),
      release: vi.fn(),
    } as unknown as PoolClient;
    const pool = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => dispatch(sql, params)),
      connect: vi.fn(async () => client),
    } as unknown as Pool;
    const app = await buildApp({ config, pool });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: `/v1/captures/${captureId}/source-authorization-decisions`,
      headers: { authorization: "Bearer synthetic-session" },
      payload: {
        idempotency_key: "synthetic-compile-fallback",
        expected_capture_version: 1,
        decision: "revoke",
        reason: "Synthetic revocation for compile fallback diagnostics.",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      decision: "revoke",
      compilation: null,
      compilation_error: RELATIONSHIP_WIKI_COMPILATION_FAILED,
    });
    expect(RELATIONSHIP_WIKI_COMPILATION_FAILED).toBe(
      "Relationship Wiki recompilation failed.",
    );

    // The compilation job records the retry with its lease released and only
    // the fixed diagnostic in last_error.
    const jobWrite = calls.find(
      (call) => call.sql.includes("source_authorization_compilation_jobs") && call.sql.includes("RETURNING id"),
    );
    expect(jobWrite?.sql).toContain("lease_owner");
    expect(jobWrite?.params).toEqual([
      expect.any(String),
      null,
      false,
      true,
      null,
      RELATIONSHIP_WIKI_COMPILATION_FAILED,
    ]);
    const recordWrite = calls.find(
      (call) => call.sql.includes("SET response_body = $2"),
    );
    expect(recordWrite?.params?.[1]).toMatchObject({
      compilation: null,
      compilation_error: RELATIONSHIP_WIKI_COMPILATION_FAILED,
    });

    // No raw message, name, stack, or cause reaches the response or any
    // database parameter.
    for (const canaryPart of [
      "SECRET_ROUTE_MESSAGE_CANARY",
      "SECRET_ROUTE_NAME_CANARY",
      "SECRET_ROUTE_STACK_CANARY",
      "SECRET_ROUTE_CAUSE_CANARY",
    ]) {
      expect(response.body).not.toContain(canaryPart);
      expect(JSON.stringify(calls)).not.toContain(canaryPart);
    }
  });
});


describe("exact person detail route", () => {
  const personId = "70000000-0000-4000-8000-000000000001";
  const accountId = "30000000-0000-4000-8000-000000000001";
  const authRow = { account_id: accountId, account_slug: "fixture-alpha",
    user_id: "40000000-0000-4000-8000-000000000001", user_email: "synthetic@example.test",
    user_kind: "simulated_human", session_id: "50000000-0000-4000-8000-000000000001" };

  it("requires authentication and validates the person ID before fetching detail", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [authRow] });
    const app = await buildApp({ config, pool: { query } as unknown as Pool });
    apps.push(app);
    const unauthorized = await app.inject({ method: "GET", url: `/v1/people/${personId}` });
    expect(unauthorized.statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
    const invalid = await app.inject({ method: "GET", url: "/v1/people/not-a-uuid",
      headers: { authorization: "Bearer synthetic-session" } });
    expect(invalid.statusCode).toBe(400);
    expect(query.mock.calls.every(([sql]) => String(sql).includes("FROM sessions"))).toBe(true);
  });

  it("returns the exact detail contract through real authentication and serialization", async () => {
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes("FROM sessions")) return { rows: [authRow] };
      if (sql.includes("AS context_count")) {
        expect(params).toEqual([accountId, "", null, null, personId]);
        return { rows: [{ id: personId, display_label: "Synthetic contact", context_count: 0,
          capture_count: 0, confirmed_identity_count: 0, last_activity_at: new Date("2026-10-13T02:00:00Z"), contexts: [] }] };
      }
      return { rows: [] };
    });
    const app = await buildApp({ config, pool: { query } as unknown as Pool });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: `/v1/people/${personId}`,
      headers: { authorization: "Bearer synthetic-session" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ contract_version: expect.any(String),
      person: { id: personId, display_label: "Synthetic contact", context_count: 0,
        capture_count: 0, confirmed_identity_count: 0, last_activity_at: "2026-10-13T02:00:00.000Z",
        contexts: [], profile: null, avatar: null, identity_matches: [] }, basic_fields: [], contact_points: [] });
  });

  it("returns a bounded 404 when an authenticated account cannot read that person", async () => {
    const query = vi.fn(async (sql: string) => ({ rows: sql.includes("FROM sessions") ? [authRow] : [] }));
    const app = await buildApp({ config, pool: { query } as unknown as Pool });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: `/v1/people/${personId}`,
      headers: { authorization: "Bearer synthetic-session" } });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "PERSON_NOT_FOUND" } });
    expect(query).toHaveBeenCalledTimes(2);
  });
});
