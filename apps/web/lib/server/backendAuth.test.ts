import { afterEach, describe, expect, it, vi } from "vitest";

const { getToken, expected } = vi.hoisted(() => ({ getToken: vi.fn(), expected: { value: "" } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers(expected.value ? {"x-talent-signal-workspace":expected.value} : {}), cookies: async () => ({ get: () => undefined }) }));
vi.mock("next-auth/jwt", () => ({ getToken }));

import { authenticatedBackendClient, readBackendSessionClaims, registerBackendAccount, signInBackendAccount, BACKEND_AUTH_REQUEST_TIMEOUT_MS } from "./backendAuth";
import { AuthRequestTimeoutError } from "@/lib/auth-request-timeout";

const sessionPayload = {
  contract_version: "2026-08-24.10",
  access_token: "t".repeat(40),
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  account: { id: "acc-1", slug: "acc-1", name: "Account" },
  user: {
    id: "user-1",
    email: "recruiter@example.com",
    display_name: "Recruiter",
    kind: "password_human",
    role: "member",
    username: "recruiter",
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function claims(account: string, expiresAt: string) {
  return {
    backendAccessToken: `synthetic-${account}`, backendAccountId: account,
    backendAccountName: account, backendAccountSlug: `fixture-${account}`,
    backendExpiresAt: expiresAt, backendRole: "member", backendUserId: account,
    backendUsername: null,
  };
}

describe("request-only identity memoization", () => {
  it("retains the verified canonical Mac session ID through primary JWT readback", async () => {
    const binding = "11111111-1111-4111-8111-111111111111";
    getToken.mockResolvedValue({ ...claims("mac", new Date(Date.now() + 60000).toISOString()), backendSessionId: binding });
    expect((await readBackendSessionClaims())?.backendSessionId).toBe(binding);
  });
  afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); expected.value = ""; });

  it("does not reuse identity outside a React server render", async () => {
    const expiry = new Date(Date.now() + 60000).toISOString();
    getToken.mockResolvedValueOnce(claims("a", expiry)).mockResolvedValueOnce(claims("b", expiry)).mockResolvedValueOnce(null);
    expect((await readBackendSessionClaims())?.backendAccountId).toBe("a");
    expect((await readBackendSessionClaims())?.backendAccountId).toBe("b");
    expect(await readBackendSessionClaims()).toBeNull();
  });

  it("rejects a stale rendered test workspace after another tab returns to owner", async () => {
    expected.value = "old-test";
    getToken.mockResolvedValue(claims("owner", new Date(Date.now()+60000).toISOString()));
    await expect(readBackendSessionClaims()).rejects.toMatchObject({ code: "backend_session_expired" });
  });

  it("rejects a bound request after backend claims disappear instead of enabling fixture fallback", async () => {
    expected.value = "old-test";
    getToken.mockResolvedValue(null);
    await expect(authenticatedBackendClient()).rejects.toMatchObject({ code: "backend_session_expired" });
    expected.value = "";
    expect(await authenticatedBackendClient()).toBeNull();
  });

  it("checks expiry at client use time even when the decoded token is unchanged", async () => {
    vi.useFakeTimers();
    const start = Date.now();
    getToken.mockResolvedValue(claims("a", new Date(start + 60000).toISOString()));
    expect(await authenticatedBackendClient()).not.toBeNull();
    vi.setSystemTime(start + 120000);
    await expect(authenticatedBackendClient()).rejects.toMatchObject({ code: "backend_session_expired" });
  });
});

describe("bounded backend password auth", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("sends the password sign-in request with a web client label and an abort signal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sessionPayload));
    vi.stubGlobal("fetch", fetchMock);

    const session = await signInBackendAccount({
      identifier: "recruiter@example.com",
      password: "correct horse battery",
    });

    expect(session.access_token).toBe(sessionPayload.access_token);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:4317/v1/auth/password/login");
    expect(init.method).toBe("POST");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init.body))).toMatchObject({
      client_label: "talent-signal-web",
      identifier: "recruiter@example.com",
    });
  });

  it("routes registration to the registration endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(sessionPayload));
    vi.stubGlobal("fetch", fetchMock);

    await registerBackendAccount({
      username: "recruiter",
      email: "recruiter@example.com",
      display_name: "Recruiter",
      password: "correct horse battery",
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:4317/v1/auth/password/register",
    );
  });

  it("preserves the backend error envelope for rate limiting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: "RATE_LIMITED", message: "Too many requests." } }, 429),
      ),
    );

    await expect(
      signInBackendAccount({ identifier: "a@b.c", password: "secret" }),
    ).rejects.toMatchObject({
      name: "TalentSignalHttpError",
      code: "RATE_LIMITED",
      status: 429,
    });
  });

  it("aborts the underlying fetch when the backend does not answer in time", async () => {
    vi.useFakeTimers();
    let observedSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", (_url: string, init: RequestInit) => {
      observedSignal = init.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    });

    const pending = signInBackendAccount({
      identifier: "a@b.c",
      password: "secret",
    });
    const assertion = expect(pending).rejects.toBeInstanceOf(
      AuthRequestTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(BACKEND_AUTH_REQUEST_TIMEOUT_MS);
    await assertion;
    expect(observedSignal?.aborted).toBe(true);
  });
});
