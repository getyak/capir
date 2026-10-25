// @vitest-environment happy-dom
import { createRequire } from "node:module";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { encode } from "next-auth/jwt";
const state = vi.hoisted(() => { process.env.AUTH_SECRET = "actual-signout-boundary-fixture"; return { jar: new Map<string, string>(), claims: null as unknown, logout: vi.fn() }; });
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3000", "x-forwarded-proto": "http", cookie: [...state.jar].map(([key, value]) => `${key}=${value}`).join("; ") }),
  cookies: async () => ({ get: (name: string) => state.jar.has(name) ? { name, value: state.jar.get(name)! } : undefined, getAll: () => [...state.jar].map(([name, value]) => ({ name, value })), set: (name: string, value: string) => state.jar.set(name, value), delete: (name: string) => state.jar.delete(name) }),
}));
vi.mock("@/lib/server/backendAuth", async () => ({ ...await vi.importActual("@/lib/server/backendAuth"), readBackendSessionClaims: async () => state.claims, readPrimaryBackendSessionClaims: async () => state.claims, authenticatedBackendClient: async () => ({ logout: state.logout }) }));
import { AUTH_SESSION_COOKIE, type BackendSessionClaims } from "@/lib/server/backendAuth";
import { TEST_WORKSPACE_COOKIE } from "@/lib/server/testWorkspaceSession";
import { workspaceSessionsBinding } from "@/lib/server/workspaceSessions";
import { loadWorkspaceDirectory, readCachedWorkspaceDirectory, invalidateWorkspaceDirectory } from "@/lib/workspace-directory-cache";
import { writeConversationDraft, readConversationDraft } from "@/lib/conversation-local";
import { LocaleProvider } from "@/components/locale-provider";
import { WorkspaceSessionBoundary } from "@/components/workspace-session-boundary";
import { WorkspaceAccountMenu } from "@/components/workspace-account-menu";
import { signOutFromAccountMenu } from "./actions";
// Server Auth.js must receive server Fetch classes; happy-dom intentionally
// strips browser-forbidden Cookie headers from its Request implementation.
const serverFetch = createRequire(import.meta.url)("next/dist/compiled/@edge-runtime/primitives/fetch") as Pick<typeof globalThis, "Request" | "Headers" | "Response">;
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => { await cleanup?.(); cleanup = undefined; delete window.talentSignalDesktop; localStorage.clear(); sessionStorage.clear(); invalidateWorkspaceDirectory(undefined, "discard"); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("fences private DOM using the actual Auth.js completion after backend deadlines, with the exact native signout GET when navigation fails", async () => {
  vi.stubGlobal("Request", serverFetch.Request); vi.stubGlobal("Headers", serverFetch.Headers); vi.stubGlobal("Response", serverFetch.Response);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const claims: BackendSessionClaims = { backendSessionId: "persistent-mac", backendAccessToken: "synthetic-access", backendAccountId: "account", backendAccountName: "Workspace", backendAccountSlug: "workspace", backendExpiresAt: "2030-01-01T00:00:00Z", backendRole: "member", backendUserId: "member", backendUsername: null };
  state.claims = claims; state.jar.clear(); state.logout.mockReset().mockImplementation(() => new Promise(() => {})); vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  const token = await encode({ secret: process.env.AUTH_SECRET!, salt: AUTH_SESSION_COOKIE, token: { sub: claims.backendUserId } }); state.jar.set(AUTH_SESSION_COOKIE, token); state.jar.set(TEST_WORKSPACE_COOKIE, "synthetic-selection");
  const binding = workspaceSessionsBinding(claims), session = "11111111-1111-4111-8111-111111111111";
  writeConversationDraft(binding, session, { value: "Original local draft", writer: "tab", updatedAt: new Date().toISOString(), expiresAt: Date.now() + 60000 });
  await loadWorkspaceDirectory(binding, async () => ({ people: { people: [{ display_label: "Private cached name" }] }, sessions: { sessions: [] } }));
  window.talentSignalDesktop = { protocolVersion: 1, availableVersion: null };
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host); cleanup = async () => { await act(async () => root.unmount()); host.remove(); };
  const loading = { status: "loading" as const }; const usage = { subscribe: () => () => {}, getSnapshot: () => loading, dispose() {}, refresh() {} };
  let producer: ReturnType<typeof signOutFromAccountMenu> | undefined;
  const actualAction = (data: FormData) => { producer = signOutFromAccountMenu(data); return producer; };
  const navigate = vi.spyOn(window.location, "assign").mockImplementation(() => { expect(host.textContent).not.toContain("Private sibling"); throw new DOMException("blocked", "SecurityError"); });
  await act(async () => root.render(<LocaleProvider locale="en"><WorkspaceSessionBoundary binding={binding}><p>Private sibling</p><WorkspaceAccountMenu accountName="Owner" workspaceName="Workspace" usageBinding={binding} usage={usage} signOutAction={actualAction} /></WorkspaceSessionBoundary></LocaleProvider>));
  await act(async () => host.querySelector<HTMLButtonElement>("[data-slot=account-trigger]")!.click());
  await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(host.textContent).toContain("Private sibling"); expect(readConversationDraft(binding, session)?.value).toBe("Original local draft");
  await act(async () => { await vi.advanceTimersByTimeAsync(3001); await producer; });
  expect([...state.jar].some(([name, value]) => (name === AUTH_SESSION_COOKIE || name === TEST_WORKSPACE_COOKIE) && value)).toBe(false);
  expect(state.logout).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain("Private sibling"); expect(readCachedWorkspaceDirectory(binding)).toBeNull(); expect(readConversationDraft(binding, session)).toBeNull();
  expect(host.querySelector("a")?.getAttribute("href")).toBe("/login?callbackUrl=%2Fworkspace&intent=sign-out"); expect(navigate).toHaveBeenCalledOnce();
});
