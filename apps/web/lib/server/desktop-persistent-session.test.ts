import { beforeEach, expect, it, vi } from "vitest";

vi.mock("./backendAuth", () => ({
  backendAuthBaseUrl: () => "http://backend.test",
  authSecret: () => "fixture-secret",
  AUTH_SESSION_COOKIE: "talent-signal.session-v2",
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import {
  authorizeDesktopPersistentSession,
  desktopPersistentPostFields,
  DesktopPersistentSessionError,
  readDesktopPersistentStatus,
} from "./desktop-persistent-session";

const account = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const session = "33333333-3333-4333-8333-333333333333";
const secret = "p".repeat(43);
const fetcher = vi.fn();
const fields = { action: "renew", device_secret: secret, account_id: account, user_id: user };
const backend = {
  contract_version: "2026-01-01",
  access_token: "access-token",
  session_id: session,
  expires_at: "2099-01-01T00:00:00.000Z",
  account: { id: account, name: "Space", slug: "space" },
  user: { id: user, email: "fixture@example.test", display_name: "Fixture", role: "admin", username: null },
};

beforeEach(() => {
  process.env.AUTH_URL = "https://web.test";
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
});

function request(extra: Record<string, string> = {}, body = fields) {
  return new Request("https://web.test/api/desktop-auth/persistent", {
    method: "POST",
    headers: { "content-type": "application/json", "x-capri-desktop-session": "1", ...extra },
    body: JSON.stringify(body),
  });
}

it("accepts a bounded native JSON POST without an ambient browser Origin", async () => {
  expect(await desktopPersistentPostFields(request())).toEqual(fields);
});

it.each<Record<string, string>>([
  { origin: "https://evil.test" },
  { origin: "null" },
  { "sec-fetch-site": "cross-site" },
  { "sec-fetch-site": "same-site" },
  { "x-capri-desktop-session": "" },
  { "content-type": "text/plain" },
])("rejects browser CSRF before touching any credential: %j", async (headers) => {
  await expect(desktopPersistentPostFields(request(headers))).rejects.toMatchObject({ status: 403 });
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects an oversized actual body even without Content-Length", async () => {
  const r = new Request("https://web.test/api/desktop-auth/persistent", {
    method: "POST", headers: { "content-type": "application/json", "x-capri-desktop-session": "1" },
    body: JSON.stringify({ ...fields, unexpected: "x".repeat(5000) }),
  });
  await expect(desktopPersistentPostFields(r)).rejects.toMatchObject({ status: 400 });
});

it("derives the backend origin server side and keeps the device secret out of JWT claims", async () => {
  fetcher.mockResolvedValue(new Response(JSON.stringify(backend)));
  const result = await authorizeDesktopPersistentSession(fields);
  expect(fetcher).toHaveBeenCalledWith("http://backend.test/v1/desktop-persistent-session/renew",
    expect.objectContaining({ method: "POST", redirect: "error", cache: "no-store" }));
  const options = fetcher.mock.calls[0][1];
  expect(JSON.parse(options.body)).toEqual({ device_secret: secret, account_id: account, user_id: user, web_origin: "https://web.test" });
  expect(result).toMatchObject({ id: user, backendSessionId: session, backendAccessToken: "access-token" });
  expect(JSON.stringify(result)).not.toContain(secret);
});

it("does not authorize a returned identity different from the Keychain binding", async () => {
  fetcher.mockResolvedValue(new Response(JSON.stringify({ ...backend, account: { ...backend.account, id: user } })));
  await expect(authorizeDesktopPersistentSession(fields)).rejects.toMatchObject({ status: 503 });
});

it("keeps backend outages distinct from terminal revocation without retaining an error body", async () => {
  fetcher.mockResolvedValue(new Response(JSON.stringify({ secret }), { status: 503 }));
  try { await authorizeDesktopPersistentSession(fields); } catch (e) {
    expect(e).toBeInstanceOf(DesktopPersistentSessionError);
    expect(e).toMatchObject({ status: 503 });
    expect(String(e)).not.toContain(secret);
  }
  fetcher.mockResolvedValue(new Response(JSON.stringify({ error: { code: "DESKTOP_SESSION_REVOKED" } }), { status: 401 }));
  await expect(authorizeDesktopPersistentSession(fields)).rejects.toMatchObject({ status: 401 });
});

it.each([
  [403, "DEPLOYMENT_WORKSPACE_NOT_ADMITTED"],
  [403, "DESKTOP_BROWSER_LOGIN_ORIGIN_NOT_ALLOWED"],
  [401, "SESSION_INVALID"],
  [400, "DESKTOP_SESSION_PROOF_INVALID"],
])("preserves device proof on configuration/protocol refusal %s %s", async (status, code) => {
  fetcher.mockResolvedValue(new Response(JSON.stringify({ error: { code, message: secret } }), { status }));
  await expect(authorizeDesktopPersistentSession(fields)).rejects.toMatchObject({ status: 503 });
});

it("recognizes only an explicit server refusal as terminal enrollment ineligibility", async () => {
  fetcher.mockResolvedValue(new Response(JSON.stringify({ error: { code: "DESKTOP_SESSION_INELIGIBLE" } }), { status: 403 }));
  await expect(authorizeDesktopPersistentSession({ ...fields, action: "enroll", backend_access_token: "old" }))
    .rejects.toMatchObject({ status: 403 });
});

it("requires server-owned current access for enrollment and never sends it in the body", async () => {
  await expect(authorizeDesktopPersistentSession({ ...fields, action: "enroll" })).rejects.toMatchObject({ status: 401 });
  fetcher.mockResolvedValue(new Response(JSON.stringify(backend)));
  await authorizeDesktopPersistentSession({ ...fields, action: "enroll", backend_access_token: "old-access" });
  const options = fetcher.mock.calls.at(-1)![1];
  expect(options.headers.authorization).toBe("Bearer old-access");
  expect(options.body).not.toContain("old-access");
});

it("uses live backend readback for status and returns no access credential", async () => {
  const status = { status: "authenticated", account_id: account, user_id: user, session_id: session, session_expires_at: backend.expires_at };
  fetcher.mockResolvedValue(new Response(JSON.stringify({ ...status, access_token: "must-not-escape" })));
  expect(await readDesktopPersistentStatus("access-token")).toEqual(status);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "GET", cache: "no-store" });
});
