import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ claims: vi.fn() }));
vi.mock("@/lib/server/backendAuth", () => ({
  authSecret: () => "synthetic-form-secret",
  backendAuthBaseUrl: () => "http://127.0.0.1:4317",
  readPrimaryBackendSessionClaims: fixture.claims,
}));
import AuthorizePage from "./page";

const claims = {
  backendAccessToken: "synthetic-primary-token",
  backendAccountId: "synthetic-account", backendUserId: "synthetic-user",
  backendAccountName: "Synthetic account", backendAccountSlug: "synthetic",
  backendExpiresAt: "2099-01-01T00:00:00Z", backendRole: "admin", backendUsername: null,
};
const params = {
  schema_version: "capir-auth.v2",
  web_origin: "https://web.test.invalid", backend_origin: "https://api.test.invalid",
  redirect_uri: "http://127.0.0.1:49381/capir/callback",
  state: "s".repeat(43), code_challenge: "p".repeat(43),
  code_challenge_method: "S256", client_label: "Synthetic CLI",
};

beforeEach(() => {
  vi.restoreAllMocks();
  fixture.claims.mockResolvedValue(claims);
  process.env.CAPIR_AUTH_WEB_ORIGIN = params.web_origin;
  process.env.CAPIR_AUTH_BACKEND_ORIGIN = params.backend_origin;
});

function assertSameRequest(target: string) {
  const url = new URL(target, params.web_origin);
  expect(url.origin).toBe(params.web_origin);
  expect(url.pathname).toBe("/capir/authorize");
  for (const [key, value] of Object.entries(params)) {
    expect(url.searchParams.get(key)).toBe(value);
  }
  expect(target).not.toContain(claims.backendAccessToken);
}

it("a revoked backend session reaches ordinary reauthentication with the exact validated CLI request", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 401 }));
  const caught = await AuthorizePage({ searchParams: Promise.resolve(params) }).then(
    () => null, (error: unknown) => error as { digest: string },
  );
  expect(caught).toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;/) });
  const target = new URL(caught!.digest.split(";")[2]!, params.web_origin);
  expect(target.pathname).toBe("/login");
  expect(target.searchParams.get("reason")).toBe("backend_session_expired");
  assertSameRequest(target.searchParams.get("callbackUrl")!);
});

it("an unavailable service offers a deliberate same-request retry without claiming the session expired", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("private-backend-detail", { status: 503 }));
  const document = new Window().document;
  document.body.innerHTML = renderToStaticMarkup(await AuthorizePage({ searchParams: Promise.resolve(params) }));
  const retry = [...document.querySelectorAll("a")].find(link => link.getAttribute("href")?.startsWith("/capir/authorize?"));
  expect(retry).toBeDefined();
  assertSameRequest(retry!.getAttribute("href")!);
  expect(document.querySelector("form")).toBeNull();
  expect(document.body.textContent).not.toContain("private-backend-detail");
  expect(document.querySelector('a[href*="backend_session_expired"]')).toBeNull();
});

it("an invalid callback never reaches the backend or exposes primary identity or an authority-bearing form", async () => {
  const transport = vi.spyOn(globalThis, "fetch");
  const document = new Window().document;
  document.body.innerHTML = renderToStaticMarkup(await AuthorizePage({ searchParams: Promise.resolve({ ...params, redirect_uri: "https://foreign.invalid/callback" }) }));
  expect(transport).not.toHaveBeenCalled();
  expect(document.querySelector("form")).toBeNull();
  expect(document.body.textContent).not.toContain(claims.backendAccountName);
  expect([...document.querySelectorAll("a")].some(link => link.href.includes("foreign.invalid"))).toBe(false);
});

it("verified consent still needs the explicit form decision and a GET issues no grant", async () => {
  const transport = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
    scopes: ["grants.read", "grants.revoke"],
    identity: { account_id: claims.backendAccountId, user_id: claims.backendUserId },
  }));
  const document = new Window().document;
  document.body.innerHTML = renderToStaticMarkup(await AuthorizePage({ searchParams: Promise.resolve(params) }));
  expect(document.querySelector('button[name="decision"][value="approve"]')).not.toBeNull();
  expect(document.querySelector('button[name="decision"][value="deny"]')).not.toBeNull();
  expect(document.body.textContent).toContain(claims.backendAccountName);
  expect(transport.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
});

it("a changed backend identity exposes neither the old account label nor an authorization form", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
    scopes: ["grants.read", "grants.revoke"],
    identity: { account_id: "another-account", user_id: "another-user" },
  }));
  const document = new Window().document;
  document.body.innerHTML = renderToStaticMarkup(await AuthorizePage({ searchParams: Promise.resolve(params) }));
  expect(document.querySelector("form")).toBeNull();
  expect(document.body.textContent).not.toContain(claims.backendAccountName);
  expect(document.body.textContent).not.toContain("another-account");
});
