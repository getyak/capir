import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION } from "@talent-signal/contracts";
import type { BackendSessionClaims } from "@/lib/server/backendAuth";

const boundary = vi.hoisted(() => ({ jar: new Map<string, string>(), complete: vi.fn(), read: vi.fn(), primary: vi.fn(), effective: vi.fn(), cookieWrite: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "next-action": "synthetic-action" }),
  cookies: async () => ({
    get: (name: string) => boundary.jar.has(name) ? { value: boundary.jar.get(name)! } : undefined,
    set: (name: string, value: string) => { boundary.cookieWrite("set", name); boundary.jar.set(name, value); },
    delete: (name: string) => { boundary.cookieWrite("delete", name); boundary.jar.delete(name); },
  }),
}));
vi.mock("@/lib/server/backendAuth", () => ({
  authSecret: () => "synthetic-password-outcome-cookie-secret",
  readPrimaryBackendSessionClaims: boundary.primary,
  readBackendSessionClaims: boundary.effective,
  authenticatedBackendClient: vi.fn(),
}));
vi.mock("@/lib/server/loginMethods", () => ({
  completeLoginMethodChange: boundary.complete, readLoginMethodChangeResult: boundary.read,
  startLoginMethodChange: vi.fn(),
}));
vi.mock("@/lib/server/apple-session", () => ({ bindAppleNonce: vi.fn() }));
vi.mock("@/lib/server/google-session", () => ({ bindGoogleNonce: vi.fn() }));
vi.mock("@/auth", () => ({ signIn: vi.fn() }));
import { completeStagedPassword } from "./actions";
import { readAuthOperation, sealAuthOperation, sessionFingerprint, type AuthOperation } from "@/lib/server/stagedAuth";

const accountId = "10000000-0000-4000-8000-000000000001";
const userId = "20000000-0000-4000-8000-000000000002";
const ref = "60000000-0000-4000-8000-000000000006";
const secret = "synthetic-attempt-secret-must-remain-server-only";
const session: BackendSessionClaims = {
  backendSessionId: "30000000-0000-4000-8000-000000000003", backendAccessToken: "synthetic-access-token",
  backendAccountId: accountId, backendAccountName: "Synthetic account", backendAccountSlug: "synthetic-account",
  backendExpiresAt: "2026-11-01T01:00:00.000Z", backendRole: "member", backendUserId: userId, backendUsername: null,
};
const operation: AuthOperation = {
  ref, intent: "change_password", accountId, userId, accountRevision: 2, userRevision: 3,
  reauthProvider: "google", reauthChallengeId: "50000000-0000-4000-8000-000000000005", clientLabel: "talent-signal-web",
  sessionFingerprint: sessionFingerprint(session), step: "awaiting-reauth", createdAt: "2026-11-01T00:00:00.000Z",
  attempt: { attempt_id: "40000000-0000-4000-8000-000000000004", attempt_secret: secret,
    challenge_id: "50000000-0000-4000-8000-000000000005", challenge_nonce: "synthetic-provider-nonce" },
};
const applied = {
  contract_version: CONTRACT_VERSION, attempt_id: operation.attempt!.attempt_id, intent: "change_password" as const,
  state: "applied" as const, outcome: "password_set" as const, account_id: accountId, user_id: userId,
  revision_before: 2, revision_after: 3, expires_at: "2026-11-01T00:05:00.000Z", consumed_at: "2026-11-01T00:01:00.000Z",
};
function form(mode = "check") {
  const data = new FormData();
  for (const [key, value] of Object.entries({ operationRef: ref, accountId, userId, accountRevision: "2", userRevision: "3", passwordMode: mode })) data.set(key, value);
  return data;
}
function expectPrivate(state: unknown) {
  const text = JSON.stringify(state);
  for (const value of [secret, session.backendAccessToken, operation.attempt!.challenge_nonce, "synthetic-new-password"]) expect(text).not.toContain(value);
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse("2026-11-01T00:01:00.000Z"));
  boundary.jar.clear(); boundary.complete.mockReset(); boundary.read.mockReset(); boundary.primary.mockReset(); boundary.effective.mockReset();
  boundary.primary.mockResolvedValue(session); boundary.effective.mockResolvedValue(session); boundary.read.mockResolvedValue(applied);
  await sealAuthOperation(operation, false);
  boundary.cookieWrite.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("bounded staged password check", () => {
  it("reads the exact original operation after its own revision increment, without any mutation or cookie rewrite", async () => {
    const before = [...boundary.jar];
    const state = await completeStagedPassword({}, form());
    expect(boundary.read).toHaveBeenCalledExactlyOnceWith({ attempt_id: operation.attempt!.attempt_id, attempt_secret: secret, intent: "change_password" });
    expect(boundary.complete).not.toHaveBeenCalled();
    expect(state).toMatchObject({ passwordResult: { ref, state: "applied" }, saved: true });
    expect([...boundary.jar]).toEqual(before); expect(boundary.cookieWrite).not.toHaveBeenCalled(); expect(await readAuthOperation()).toMatchObject({ ref, createdAt: operation.createdAt }); expectPrivate(state);
  });
  it.each(["pending", "unknown", "invalid"] as const)("projects %s without granting another password mutation", async (state) => {
    boundary.read.mockResolvedValue({ contract_version: CONTRACT_VERSION, attempt_id: applied.attempt_id, intent: applied.intent, state, ...(state === "invalid" ? {} : { expires_at: applied.expires_at }) });
    const result = await completeStagedPassword({}, form());
    expect(boundary.read).toHaveBeenCalledTimes(1); expect(boundary.complete).not.toHaveBeenCalled();
    expect(result).toMatchObject({ passwordResult: { ref, state } }); expect(result.saved).not.toBe(true); expectPrivate(result);
  });
  it.each(["account", "user", "revision", "attempt", "intent"])("does not confirm an applied receipt with a different %s", async (kind) => {
    const receipt = { ...applied };
    if (kind === "account") receipt.account_id = "70000000-0000-4000-8000-000000000007";
    if (kind === "user") receipt.user_id = "70000000-0000-4000-8000-000000000007";
    if (kind === "revision") { receipt.revision_before = 4; receipt.revision_after = 5; }
    if (kind === "attempt") receipt.attempt_id = "70000000-0000-4000-8000-000000000007";
    if (kind === "intent") Object.assign(receipt, { intent: "set_password" });
    boundary.read.mockResolvedValue(receipt);
    const state = await completeStagedPassword({}, form());
    expect(boundary.read).toHaveBeenCalledTimes(1); expect(boundary.complete).not.toHaveBeenCalled();
    expect(state.saved).not.toBe(true); expect(state).toMatchObject({ passwordResult: { ref, state: "unknown" } }); expectPrivate(state);
  });
  it("keeps transport failure unknown and never returns the backend error payload", async () => {
    boundary.read.mockRejectedValue(new Error(secret));
    const state = await completeStagedPassword({}, form());
    expect(boundary.read).toHaveBeenCalledTimes(1); expect(boundary.complete).not.toHaveBeenCalled();
    expect(state).toMatchObject({ passwordResult: { ref, state: "unknown" } }); expectPrivate(state);
  });
  it("ignores forged previous success and performs a real read", async () => {
    boundary.read.mockResolvedValue({ contract_version: CONTRACT_VERSION, attempt_id: applied.attempt_id, intent: applied.intent, state: "pending", expires_at: applied.expires_at });
    const state = await completeStagedPassword({ saved: true }, form());
    expect(boundary.read).toHaveBeenCalledTimes(1); expect(state.saved).not.toBe(true);
    expect(state).toMatchObject({ passwordResult: { ref, state: "pending" } });
  });
  it("preserves stable-session identity across access rotation", async () => {
    const renewed = { ...session, backendAccessToken: "synthetic-renewed-access-token" };
    boundary.primary.mockResolvedValue(renewed); boundary.effective.mockResolvedValue(renewed);
    const state = await completeStagedPassword({}, form());
    expect(boundary.read).toHaveBeenCalledTimes(1); expect(state).toMatchObject({ passwordResult: { ref, state: "applied" } });
  });
  it.each(["old-ref", "foreign-account", "foreign-user", "sibling-session", "effective-lab", "expired-flow", "wrong-intent"])("rejects %s before read or mutation", async (kind) => {
    const data = form();
    if (kind === "old-ref") data.set("operationRef", "70000000-0000-4000-8000-000000000007");
    if (kind === "foreign-account") boundary.primary.mockResolvedValue({ ...session, backendAccountId: "70000000-0000-4000-8000-000000000007" });
    if (kind === "foreign-user") boundary.primary.mockResolvedValue({ ...session, backendUserId: "70000000-0000-4000-8000-000000000007" });
    if (kind === "sibling-session") { const sibling = { ...session, backendSessionId: "70000000-0000-4000-8000-000000000007" }; boundary.primary.mockResolvedValue(sibling); boundary.effective.mockResolvedValue(sibling); }
    if (kind === "effective-lab") boundary.effective.mockResolvedValue({ ...session, backendAccountId: "70000000-0000-4000-8000-000000000007" });
    if (kind === "expired-flow") vi.setSystemTime(Date.parse("2026-11-01T00:11:00.000Z"));
    if (kind === "wrong-intent") await sealAuthOperation({ ...operation, intent: "unlink_provider" }, false);
    boundary.cookieWrite.mockClear();
    const before = [...boundary.jar]; const state = await completeStagedPassword({}, data);
    expect(boundary.read).not.toHaveBeenCalled(); expect(boundary.complete).not.toHaveBeenCalled();
    expect(state.saved).not.toBe(true); expect(state).toMatchObject({ passwordResult: { ref: String(data.get("operationRef")), state: "invalid" } }); expect([...boundary.jar]).toEqual(before); expect(boundary.cookieWrite).not.toHaveBeenCalled(); expectPrivate(state);
  });
  it("does not use check mode as permission to save even if a password is posted", async () => {
    const data = form(); data.set("newPassword", "synthetic-new-password");
    await completeStagedPassword({}, data);
    expect(boundary.read).toHaveBeenCalledTimes(1); expect(boundary.complete).not.toHaveBeenCalled();
  });
  it.each(["old-ref", "effective-lab"])("does not reset editing for a short password with %s", async (kind) => {
    const data = form("save"); data.set("newPassword", "short");
    if (kind === "old-ref") data.set("operationRef", "70000000-0000-4000-8000-000000000007");
    else boundary.effective.mockResolvedValue({ ...session, backendAccountId: "70000000-0000-4000-8000-000000000007" });
    const state = await completeStagedPassword({}, data);
    expect(boundary.complete).not.toHaveBeenCalled(); expect(boundary.read).not.toHaveBeenCalled(); expect(boundary.cookieWrite).not.toHaveBeenCalled();
    expect(state).toMatchObject({ passwordResult: { ref: String(data.get("operationRef")), state: "invalid" } }); expectPrivate(state);
  });
  it("restores editing only for a correlated known-before-dispatch local rejection", async () => {
    const data = form("save"); data.set("newPassword", "short");
    const state = await completeStagedPassword({}, data);
    expect(boundary.complete).not.toHaveBeenCalled(); expect(boundary.read).not.toHaveBeenCalled();
    expect(state).toMatchObject({ passwordResult: { ref, state: "editing" } }); expectPrivate(state);
  });
});
