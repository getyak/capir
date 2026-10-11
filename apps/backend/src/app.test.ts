import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp as buildAppWithWorkers, type AppDependencies } from "./app.js";
import type { BackendConfig } from "./config.js";
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
      rows: [
        {
          version: "065_screenshot_directory_authority",
        },
        { version: "058_account_management" },
        { version: "069_account_access_event_details" },
        { version: "070_meeting_drafts" },
        { version: "071_agent_session_list_snapshots" },
        { version: "072_mcp_extensions" },
        { version: "073_conversation_queue" },
        { version: "073_account_onboarding" },
        { version: "074_time_workspace" },
        { version: "075_conversation_message_images" },
        { version: "076_memory_review" },
        { version: "077_memory_review_corrections" },
        { version: "078_memory_review_hardening" },
        { version: "079_memory_source_authority" },
      ],
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

  it.each(REQUIRED_SYSTEM_MIGRATIONS)(
    "stays unavailable when required migration %s is missing",
    async missing => {
      const query = vi.fn().mockResolvedValue({
        rows: [
          "065_screenshot_directory_authority",
          "058_account_management",
          "069_account_access_event_details",
          "070_meeting_drafts",
          "071_agent_session_list_snapshots",
          "072_mcp_extensions",
          "073_conversation_queue",
          "073_account_onboarding",
          "074_time_workspace",
          "075_conversation_message_images",
          "076_memory_review",
          "077_memory_review_corrections",
          "078_memory_review_hardening",
          "079_memory_source_authority",
        ]
          .filter(version => version !== missing).map(version => ({ version })),
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
