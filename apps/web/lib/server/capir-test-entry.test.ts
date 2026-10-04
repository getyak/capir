/**
 * Private one-use Web handoff entry and the canonical test-run banner source.
 *
 * The exchange installs ONLY the target test session after exact origin,
 * account, run, username, preset/counts and expiry verification against the
 * live canonical operator-owned run. Expired, rotated, revoked, replayed or
 * foreign handoffs fail closed without any real-account fallback, and the
 * banner derives from the canonical run readback — never from a cookie or an
 * account name.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterAll(() => vi.unstubAllGlobals());

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.stubGlobal("fetch", state.fetch);

import {
  assertTrustedWebOrigin,
  clampedSessionMaxAgeSeconds,
  exchangeCapirTestHandoff,
  loadCapirTestBanner,
  presetExpectedCounts,
  verifyCapirTestRun,
} from "@/lib/server/capir-test-entry";
import type { BackendSessionClaims } from "@/lib/server/backendAuth";

const WEB_ORIGIN = "https://web.example.test";
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";

const claims: BackendSessionClaims = {
  backendAccessToken: "session-token",
  backendAccountId: ACCOUNT_ID,
  backendAccountName: "qa-1",
  backendAccountSlug: "qa-1",
  backendExpiresAt: "2099-01-01T00:00:00Z",
  backendRole: "member",
  backendUserId: USER_ID,
  backendUsername: "qa-1",
};

function runFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    request_id: "44444444-4444-4444-8444-444444444444",
    account_id: ACCOUNT_ID,
    user_id: USER_ID,
    username: "qa-1",
    email: "qa-1@lab.invalid",
    preset: "daily",
    preset_version: "1",
    preset_digest: "a".repeat(64),
    counts: { contacts: 12, observations: 30, tasks: 4 },
    state: "ready",
    expires_at: "2099-01-01T00:00:00Z",
    cleanup_error: null,
    login_url: `${WEB_ORIGIN}/capir/test-entry?run=${RUN_ID}`,
    ...overrides,
  };
}

const session = {
  contract_version: "2026-08-24.10",
  access_token: "test-session-token-0123456789abcdef",
  expires_at: "2099-01-01T00:00:00Z",
  account: { id: ACCOUNT_ID, name: "qa-1", slug: "qa-1" },
  user: {
    id: USER_ID,
    email: "qa-1@lab.invalid",
    display_name: "qa-1",
    kind: "lab_human",
    role: "member",
    username: "qa-1",
  },
};

function jsonResponse(status: number, json: unknown) {
  return new Response(JSON.stringify(json), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  process.env.CAPIR_TEST_WEB_ORIGIN = WEB_ORIGIN;
  process.env.CAPIR_TEST_WEB_CONSUMER_KEY = "consumer-key";
  state.fetch.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env.CAPIR_TEST_WEB_ORIGIN;
  delete process.env.CAPIR_TEST_WEB_CONSUMER_KEY;
});

describe("canonical run verification", () => {
  it("accepts only the exact live account, user and username of a ready run", () => {
    const identity = { accountId: ACCOUNT_ID, userId: USER_ID, username: "qa-1" };
    expect(verifyCapirTestRun(runFixture(), identity).ok).toBe(true);
    for (const broken of [
      runFixture({ state: "expired" }),
      runFixture({ state: "revoked" }),
      runFixture({ state: "deleting" }),
      runFixture({ account_id: "99999999-9999-4999-8999-999999999999" }),
      runFixture({ user_id: "99999999-9999-4999-8999-999999999999" }),
      runFixture({ username: "someone-else" }),
      runFixture({ expires_at: "2020-01-01T00:00:00Z" }),
      runFixture({ counts: { contacts: 11, observations: 30, tasks: 4 } }),
      runFixture({ preset_digest: "z".repeat(64) }),
      runFixture({ preset_version: "" }),
      { nonsense: true },
    ]) {
      expect(verifyCapirTestRun(broken, identity).ok).toBe(false);
    }
    // Username matching is normalized exactly like the backend handle rule.
    expect(verifyCapirTestRun(runFixture({ username: "QA-1" }), identity).ok).toBe(true);
  });

  it("derives the dataset state from the preset expectation", () => {
    expect(presetExpectedCounts("daily")).toEqual({ contacts: 12, observations: 30, tasks: 4 });
    expect(presetExpectedCounts("empty")).toEqual({ contacts: 0, observations: 0, tasks: 0 });
  });
});

it("keeps loopback transport separate from the registered backend origin", async () => {
  vi.stubEnv("TALENT_SIGNAL_BACKEND_URL", "http://127.0.0.1:4317");
  vi.stubEnv("CAPIR_TEST_BACKEND_ORIGIN", "https://backend.example.test");
  state.fetch.mockImplementation(async (_url: unknown, init?: RequestInit) => {
    if (String(init?.body ?? "").includes("handoff_secret")) {
      return jsonResponse(200, { schema_version: "capir-test.v1", session, entry_path: "/capir/test-entry", run_id: RUN_ID });
    }
    return jsonResponse(200, { run: runFixture() });
  });
  await exchangeCapirTestHandoff({ handoffSecret: "h".repeat(43), requestOrigin: WEB_ORIGIN, expectedRunId: RUN_ID });
  expect(String(state.fetch.mock.calls[0][0])).toContain("http://127.0.0.1:4317/");
  expect(new Headers(state.fetch.mock.calls[0][1]?.headers).get("x-capir-backend-origin")).toBe("https://backend.example.test");
});

describe("private one-use handoff exchange", () => {
  it("rejects a cross-origin request before any exchange and yields no session", async () => {
    await expect(
      exchangeCapirTestHandoff({ handoffSecret: "h".repeat(43), requestOrigin: "https://evil.example.test" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed handoff secrets without a request", async () => {
    await expect(
      exchangeCapirTestHandoff({ handoffSecret: "not-a-secret", requestOrigin: WEB_ORIGIN }),
    ).rejects.toMatchObject({ status: 400 });
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("fails closed on a consumed, replayed or foreign handoff", async () => {
    state.fetch.mockImplementation(async () =>
      jsonResponse(410, {
        error: {
          code: "CAPIR_TEST_HANDOFF_CONSUMED",
          message: "untrusted server text with a fake secret zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
        },
      }),
    );
    const attempt = exchangeCapirTestHandoff({ handoffSecret: "h".repeat(43), requestOrigin: WEB_ORIGIN });
    await expect(attempt).rejects.toMatchObject({ status: 410 });
    await expect(
      exchangeCapirTestHandoff({ handoffSecret: "h".repeat(43), requestOrigin: WEB_ORIGIN }),
    ).rejects.toMatchObject({ status: 410 });
  });

  it("never prints untrusted response bodies in errors", async () => {
    state.fetch.mockImplementation(async () =>
      jsonResponse(500, {
        error: { code: "CAPIR_TEST_INTERNAL", message: "hostile body hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh" },
      }),
    );
    const error = await exchangeCapirTestHandoff({
      handoffSecret: "h".repeat(43),
      requestOrigin: WEB_ORIGIN,
    }).then(() => null, (caught: Error) => caught);
    expect(error).toBeTruthy();
    expect(error!.message).not.toContain("hhhh");
    expect(error!.message).not.toContain("hostile body");
  });

  it("rejects runtime-invalid success instead of trusting it", async () => {
    state.fetch.mockImplementation(async () => jsonResponse(200, { schema_version: "wrong", run_id: RUN_ID }));
    await expect(
      exchangeCapirTestHandoff({ handoffSecret: "h".repeat(43), requestOrigin: WEB_ORIGIN }),
    ).rejects.toMatchObject({ status: 502 });
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a foreign run of the same account with the same preset and expiry", async () => {
    const foreignRunId = "55555555-5555-4555-8555-555555555555";
    state.fetch.mockImplementation(async (_url: unknown, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      if (body.includes("handoff_secret")) {
        return jsonResponse(200, {
          schema_version: "capir-test.v1",
          session,
          entry_path: "/capir/test-entry",
          run_id: foreignRunId,
        });
      }
      // Same account, user, preset and expiry — a different live run.
      return jsonResponse(200, { run: runFixture({ id: foreignRunId }) });
    });
    await expect(
      exchangeCapirTestHandoff({
        handoffSecret: "h".repeat(43),
        requestOrigin: WEB_ORIGIN,
        expectedRunId: RUN_ID,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects an exchanged session whose canonical run does not match", async () => {
    state.fetch.mockImplementation(async (_url: unknown, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      if (body.includes("handoff_secret")) {
        return jsonResponse(200, {
          schema_version: "capir-test.v1",
          session,
          entry_path: "/capir/test-entry",
          run_id: RUN_ID,
        });
      }
      return jsonResponse(200, { run: runFixture({ account_id: "99999999-9999-4999-8999-999999999999" }) });
    });
    await expect(
      exchangeCapirTestHandoff({ handoffSecret: "h".repeat(43), requestOrigin: WEB_ORIGIN }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("installs only the target test session for a verified run", async () => {
    state.fetch.mockImplementation(async (_url: unknown, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      if (body.includes("handoff_secret")) {
        return jsonResponse(200, {
          schema_version: "capir-test.v1",
          session,
          entry_path: "/capir/test-entry",
          run_id: RUN_ID,
        });
      }
      return jsonResponse(200, { run: runFixture() });
    });
    const result = await exchangeCapirTestHandoff({
      handoffSecret: "h".repeat(43),
      requestOrigin: WEB_ORIGIN,
      expectedRunId: RUN_ID,
    });
    expect(result.claims.backendAccountId).toBe(ACCOUNT_ID);
    expect(result.claims.backendUserId).toBe(USER_ID);
    expect(result.claims.backendUsername).toBe("qa-1");
    expect(result.run.id).toBe(RUN_ID);
    expect(result.runId).toBe(RUN_ID);
    // The trusted consumer key is server-only and travels in a private header.
    const exchangeCall = state.fetch.mock.calls[0]!;
    const headers = exchangeCall[1]?.headers as Record<string, string>;
    expect(headers["x-capir-web-consumer-key"]).toBe("consumer-key");
  });
});

describe("canonical test banner source", () => {
  it("shows the same banner after direct password login and private handoff", async () => {
    state.fetch.mockImplementation(async () => jsonResponse(200, { run: runFixture() }));
    const banner = await loadCapirTestBanner(claims);
    expect(banner).not.toBeNull();
    expect(banner!.run.id).toBe(RUN_ID);
    expect(banner!.sessionState).toBe("active");
    expect(banner!.datasetState).toBe("ready");
    expect(banner!.counts).toEqual({ contacts: 12, observations: 30, tasks: 4 });
    expect(banner!.expiresAt).toBe("2099-01-01T00:00:00Z");
  });

  it("fails closed without a real-account fallback when no canonical run exists", async () => {
    state.fetch.mockImplementation(async () => jsonResponse(404, { error: { code: "CAPIR_TEST_NOT_FOUND", message: "no run" } }));
    expect(await loadCapirTestBanner(claims)).toBeNull();
  });

  it("never infers operator authority from an account name or cookie", async () => {
    state.fetch.mockImplementation(async () =>
      jsonResponse(200, { run: runFixture({ user_id: "99999999-9999-4999-8999-999999999999" }) }),
    );
    // The live session user does not match the canonical run: no banner.
    expect(await loadCapirTestBanner({ ...claims, backendAccountName: "looks-like-a-test" })).toBeNull();
  });

  it("reports a dataset error instead of a false empty dataset on partial seeds", async () => {
    state.fetch.mockImplementation(async () =>
      jsonResponse(200, { run: runFixture({ counts: { contacts: 12, observations: 30, tasks: 3 } }) }),
    );
    const banner = await loadCapirTestBanner(claims);
    expect(banner!.datasetState).toBe("error");
  });
});

describe("web origin gate", () => {
  it("requires the exact configured origin", () => {
    expect(() => assertTrustedWebOrigin(WEB_ORIGIN)).not.toThrow();
    expect(() => assertTrustedWebOrigin(null)).toThrow();
    expect(() => assertTrustedWebOrigin("https://evil.example.test")).toThrow();
    expect(() => assertTrustedWebOrigin(`${WEB_ORIGIN}/capir/test-entry`)).toThrow();
  });
});


describe("session cookie lifetime", () => {
  it("clamps the private cookie to the backend session and run deadlines", () => {
    const now = Date.parse("2026-10-04T12:00:00.000Z");
    expect(
      clampedSessionMaxAgeSeconds({
        sessionExpiresAt: "2099-01-01T00:00:00Z",
        runExpiresAt: "2099-01-01T00:00:00Z",
        now,
      }),
    ).toBe(60 * 60 * 8);
    expect(
      clampedSessionMaxAgeSeconds({
        sessionExpiresAt: "2026-10-04T14:00:00.000Z",
        runExpiresAt: "2099-01-01T00:00:00Z",
        now,
      }),
    ).toBe(60 * 60 * 2);
    expect(
      clampedSessionMaxAgeSeconds({
        sessionExpiresAt: "2099-01-01T00:00:00Z",
        runExpiresAt: "2026-10-04T12:30:00.000Z",
        now,
      }),
    ).toBe(60 * 30);
    // An already expired run grants no cookie authority at all.
    expect(
      clampedSessionMaxAgeSeconds({
        sessionExpiresAt: "2026-10-04T11:00:00.000Z",
        runExpiresAt: "2026-10-04T11:30:00.000Z",
        now,
      }),
    ).toBe(0);
  });
});
