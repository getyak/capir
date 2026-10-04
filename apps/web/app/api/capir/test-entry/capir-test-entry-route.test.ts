/**
 * Private POST one-use Web handoff exchange route: exact origin checks, no
 * token in any URL, fail-closed replay and only the target test session in
 * the cookie jar.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

afterAll(() => vi.unstubAllGlobals());

const jar = vi.hoisted(() => new Map<string, string>());
const jarOptions = vi.hoisted(() => new Map<string, { maxAge?: number }>());
const state = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (key: string) => (jar.has(key) ? { value: jar.get(key) } : undefined),
    set: (key: string, value: string, options?: { maxAge?: number }) => {
      jar.set(key, value);
      jarOptions.set(key, options ?? {});
    },
    delete: (key: string) => jar.delete(key),
  }),
}));
vi.stubGlobal("fetch", state.fetch);

import { POST } from "./route";
import { AUTH_SESSION_COOKIE } from "@/lib/server/backendAuth";
import { TEST_WORKSPACE_COOKIE } from "@/lib/server/testWorkspaceSession";

const WEB_ORIGIN = "https://web.example.test";
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const SECRET = "h".repeat(43);

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

const run = {
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
};

function request(origin: string | null, body: unknown = { handoff_secret: SECRET, run_id: RUN_ID }) {
  return new Request(`${WEB_ORIGIN}/api/capir/test-entry`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify(body),
  });
}

function okBackend() {
  state.fetch.mockImplementation(async (_url: unknown, init?: RequestInit) => {
    const body = String(init?.body ?? "");
    const json = body.includes("handoff_secret")
      ? { schema_version: "capir-test.v1", session, entry_path: "/capir/test-entry", run_id: RUN_ID }
      : { run };
    return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
  });
}

beforeEach(() => {
  process.env.CAPIR_TEST_WEB_ORIGIN = WEB_ORIGIN;
  process.env.CAPIR_TEST_WEB_CONSUMER_KEY = "consumer-key";
  jar.clear();
  jarOptions.clear();
  state.fetch.mockReset();
});
afterEach(() => {
  delete process.env.CAPIR_TEST_WEB_ORIGIN;
  delete process.env.CAPIR_TEST_WEB_CONSUMER_KEY;
});

describe("capir test entry exchange route", () => {
  it("cross_origin_handoff_no_cookie", async () => {
    okBackend();
    const response = await POST(request("https://evil.example.test"));
    expect(response.status).toBe(403);
    expect(jar.has(AUTH_SESSION_COOKIE)).toBe(false);
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("exchanges a verified handoff with a private POST and no token in the URL", async () => {
    okBackend();
    const response = await POST(request(WEB_ORIGIN));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/workspace");
    expect(String(response.url ?? "")).not.toContain(SECRET);
    expect(jar.has(AUTH_SESSION_COOKIE)).toBe(true);
    // The session cookie is sealed, never a raw bearer value.
    expect(jar.get(AUTH_SESSION_COOKIE)).not.toContain("test-session-token-0123456789abcdef");
    // Entry installs ONLY the test session: the human primary selection cookie
    // is never adopted or fabricated.
    expect(jar.has(TEST_WORKSPACE_COOKIE)).toBe(false);
  });

  it("replayed_handoff_fails_closed_without_cookie", async () => {
    okBackend();
    const first = await POST(request(WEB_ORIGIN));
    expect(first.status).toBe(303);
    jar.clear();
    state.fetch.mockImplementation(async () =>
      new Response(
        JSON.stringify({ error: { code: "CAPIR_TEST_HANDOFF_CONSUMED", message: "consumed" } }),
        { status: 410, headers: { "content-type": "application/json" } },
      ),
    );
    const replay = await POST(request(WEB_ORIGIN));
    expect(replay.status).toBe(410);
    expect(jar.has(AUTH_SESSION_COOKIE)).toBe(false);
  });

  it("cross_target_run_id_fails_closed_without_cookie", async () => {
    const foreignRunId = "55555555-5555-4555-8555-555555555555";
    state.fetch.mockImplementation(async (_url: unknown, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      const json = body.includes("handoff_secret")
        ? { schema_version: "capir-test.v1", session, entry_path: "/capir/test-entry", run_id: foreignRunId }
        : { run: { ...run, id: foreignRunId } };
      return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
    });
    const response = await POST(request(WEB_ORIGIN, { handoff_secret: SECRET, run_id: RUN_ID }));
    expect(response.status).toBe(403);
    expect(jar.has(AUTH_SESSION_COOKIE)).toBe(false);
  });

  it("clamps the session cookie to the run deadline", async () => {
    const nearExpiry = new Date(Date.now() + 30 * 60_000).toISOString();
    state.fetch.mockImplementation(async (_url: unknown, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      const json = body.includes("handoff_secret")
        ? { schema_version: "capir-test.v1", session, entry_path: "/capir/test-entry", run_id: RUN_ID }
        : { run: { ...run, expires_at: nearExpiry } };
      return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
    });
    const response = await POST(request(WEB_ORIGIN));
    expect(response.status).toBe(303);
    const maxAge = jarOptions.get(AUTH_SESSION_COOKIE)?.maxAge ?? 0;
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(30 * 60);
  });

  it("rejects malformed bodies without touching the backend", async () => {
    okBackend();
    const response = await POST(request(WEB_ORIGIN, { handoff_secret: "short" }));
    expect(response.status).toBe(400);
    expect(jar.has(AUTH_SESSION_COOKIE)).toBe(false);
    expect(state.fetch).not.toHaveBeenCalled();
  });
});
