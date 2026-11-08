import { CONTRACT_VERSION, TalentSignalClient, type CurrentSessionResponse } from "@talent-signal/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), backendClient: vi.fn(), redirect: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/server/backendAuth", () => ({ authenticatedBackendClient: mocks.backendClient }));
vi.mock("@/lib/server/marketing-locale", () => ({ getMarketingLocale: async () => "en" }));
vi.mock("@/components/people-directory-app", () => ({ PeopleDirectoryApp: () => null }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

// Keep PeoplePage -> localBackend -> TalentSignalClient real. Only credential
// delivery and backend HTTP responses are synthetic; this is not RSC/browser
// rendering or proof of live authentication, HTTP URI capacity or identity SQL.
import PeoplePage from "./page";

const backendOrigin = "http://127.0.0.1:4317";
const webOrigin = "https://app.example.test";
const sessionId = "33333333-3333-4333-8333-333333333333";
const emailPrefix = `reader.${"a".repeat(48)}@${"b".repeat(60)}.${"c".repeat(55)}`;
const profilePrefix = `https://profiles.example.invalid/people/${"a".repeat(145)}`;
const admittedPairs = [
  { kind: "email", first: `${emailPrefix}.first.example.invalid`, second: `${emailPrefix}.second.example.invalid` },
  { kind: "profile URL", first: `${profilePrefix}/first`, second: `${profilePrefix}/second` },
];
let requests: { path: string; method: string; body: unknown }[];
let backendSessionExpired: boolean;

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}
async function page(query?: string | string[]) {
  return PeoplePage({ searchParams: Promise.resolve({ query, session: sessionId }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TALENT_SIGNAL_INTEGRATION_MODE", "true");
  mocks.auth.mockResolvedValue({ user: { id: "synthetic-directory-owner" } });
  mocks.backendClient.mockResolvedValue(new TalentSignalClient(backendOrigin, "synthetic-directory-access"));
  mocks.redirect.mockImplementation(() => { throw new Error("SYNTHETIC_DIRECTORY_REDIRECT"); });
  requests = []; backendSessionExpired = false;
  const session: CurrentSessionResponse = {
    contract_version: CONTRACT_VERSION, session_id: sessionId,
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    account: { id: "11111111-1111-4111-8111-111111111111", slug: "synthetic-directory", name: "Synthetic directory" },
    user: { id: "22222222-2222-4222-8222-222222222222", email: "directory@example.invalid",
      display_name: "Synthetic owner", kind: "password_human", role: "member", username: null },
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    requests.push({ path: url.pathname, method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    if (url.origin !== backendOrigin) throw new Error("Unexpected synthetic backend origin.");
    if (url.pathname === "/v1/auth/session") return backendSessionExpired
      ? json({ error: { code: "SESSION_EXPIRED", message: "Synthetic session expired." } }, 401) : json(session);
    if (url.pathname === "/v1/people" || url.pathname === "/v1/people/search") {
      return json({ contract_version: CONTRACT_VERSION, people: [] });
    }
    throw new Error("Unexpected synthetic directory endpoint.");
  }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("uses the actual signed-in adapter and typed POST for an ordinary query", async () => {
  const rendered = await page("  Reader  ");
  expect(requests).toEqual([
    { path: "/v1/auth/session", method: "GET", body: null },
    { path: "/v1/people/search", method: "POST", body: { query: "Reader" } },
  ]);
  expect(rendered.props).toMatchObject({ query: "Reader", queryInvalid: false, error: null });
});

it.each(admittedPairs)("keeps distinguishable $kind tails through the real SSR adapter and typed request", async ({ first, second }) => {
  expect(first.length).toBeGreaterThan(160);
  expect(first.slice(0, 160)).toBe(second.slice(0, 160));
  expect(first).not.toBe(second);
  for (const query of [first, second]) {
    const rendered = await page(query);
    expect(requests.at(-1)).toEqual({ path: "/v1/people/search", method: "POST", body: { query } });
    expect(rendered.props).toMatchObject({ query, queryInvalid: false, error: null });
  }
});

it.each([
  { label: "ASCII", query: "a".repeat(500) },
  { label: "supplementary Unicode", query: "😀".repeat(500) },
])("admits complete 500-scalar $label without treating UTF16 as the budget", async ({ query }) => {
  const rendered = await page(query);
  expect(requests.at(-1)).toEqual({ path: "/v1/people/search", method: "POST", body: { query } });
  expect(rendered.props).toMatchObject({ query, queryInvalid: false, error: null });
});

it.each([
  { label: "raw length", query: "a".repeat(501) },
  { label: "raw whitespace before trim", query: `${" ".repeat(500)}a` },
  { label: "NFKC expansion", query: "ﬃ".repeat(170) },
  { label: "NUL", query: "reader\0tail" },
  { label: "unpaired surrogate", query: "reader\ud800tail" },
])("explicitly rejects $label before search or broad-list fallback", async ({ query }) => {
  const rendered = await page(query);
  expect(requests).toEqual([]);
  expect(rendered.props.queryInvalid).toBe(true);
  expect(rendered.props.error).toEqual(expect.any(String));
  expect(rendered.props.error).not.toBe("");
  expect(rendered.props.people).toEqual([]);
});

it("keeps the complete admitted query and return Session through the actual login callback", async () => {
  mocks.auth.mockResolvedValue(null);
  const query = admittedPairs[0]!.second;
  await expect(page(query)).rejects.toThrow("SYNTHETIC_DIRECTORY_REDIRECT");
  expect(requests).toEqual([]);
  const destination = new URL(mocks.redirect.mock.calls[0]![0] as string, webOrigin);
  const callback = new URL(destination.searchParams.get("callbackUrl")!, webOrigin);
  expect(destination.pathname).toBe("/login");
  expect(callback.pathname).toBe("/workspace/people");
  expect(callback.searchParams.get("query")).toBe(query);
  expect(callback.searchParams.get("session")).toBe(sessionId);
});

it("keeps the complete admitted query when the real backend adapter reports an expired login", async () => {
  backendSessionExpired = true;
  const query = admittedPairs[1]!.second;
  const rendered = await page(query);
  expect(requests).toEqual([{ path: "/v1/auth/session", method: "GET", body: null }]);
  const recovery = new URL(rendered.props.sessionRecoveryHref as string, webOrigin);
  const callback = new URL(recovery.searchParams.get("callbackUrl")!, webOrigin);
  expect(recovery.searchParams.get("reason")).toBe("backend_session_expired");
  expect(callback.searchParams.get("query")).toBe(query);
  expect(callback.searchParams.get("session")).toBe(sessionId);
});

it("retains the existing no-query list and refuses duplicate query parameters", async () => {
  const ordinary = await page();
  expect(ordinary.props).toMatchObject({ query: "", queryInvalid: false, error: null });
  expect(requests.at(-1)).toEqual({ path: "/v1/people", method: "GET", body: null });
  requests = [];
  const invalid = await page(["first", "second"]);
  expect(requests).toEqual([]);
  expect(invalid.props.queryInvalid).toBe(true);
  expect(invalid.props.error).toEqual(expect.any(String));
});
