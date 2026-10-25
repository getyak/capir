import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ claims: vi.fn(), get: vi.fn(), admit: vi.fn() }));
vi.mock("./backendAuth", () => ({
  authSecret: () => "fixture-binding-secret", backendAuthBaseUrl: () => "http://backend.test",
  readBackendSessionClaims: f.claims,
}));
vi.mock("@talent-signal/contracts", async original => ({
  ...await original<typeof import("@talent-signal/contracts")>(),
  TalentSignalClient: class { getAgentSession = f.get; admitConversationQueueEntry = f.admit; },
}));
import { contactHandoffSessionVersion } from "./contact-handoff-session";
import { workspaceSessionsBinding } from "./workspaceSessions";
import { conversationQueueRoute } from "./conversationQueue";
import { mintMemoryEntryCapability } from "./memoryEntryCapability";

const sid = "72ce7ff4-a5a8-40d0-b1d7-d84a13adcd30";
const mid = "a072ed54-6d56-413d-af4b-3ebc01ba646a";
const original = {
  backendAccessToken: "generation-one", backendAccountId: "account-one", backendUserId: "user-one",
  backendAccountName: "Account", backendAccountSlug: "account", backendRole: "admin" as const,
  backendUsername: null, backendExpiresAt: "2099-01-01T00:00:00.000Z",
  backendSessionId: "11111111-1111-4111-8111-111111111111",
};
const renewed = { ...original, backendAccessToken: "generation-two", backendExpiresAt: "2099-01-02T00:00:00.000Z" };
beforeEach(() => {
  vi.resetAllMocks();
  f.claims.mockResolvedValue(renewed); f.get.mockResolvedValue({});
  f.admit.mockResolvedValue({ message_id: mid });
});
it("keeps exact device-session bindings through bounded access rotation", () => {
  expect(contactHandoffSessionVersion(renewed)).toBe(contactHandoffSessionVersion(original));
  expect(workspaceSessionsBinding(renewed)).toBe(workspaceSessionsBinding(original));
});
it("changes both bindings for a different canonical primary session, even for the same account", () => {
  const different = { ...renewed, backendSessionId: "22222222-2222-4222-8222-222222222222" };
  expect(contactHandoffSessionVersion(different)).not.toBe(contactHandoffSessionVersion(original));
  expect(workspaceSessionsBinding(different)).not.toBe(workspaceSessionsBinding(original));
});
it("preserves the existing exact-access binding policy for ordinary Web sessions", () => {
  expect(contactHandoffSessionVersion({ ...original, backendSessionId: undefined }))
    .not.toBe(contactHandoffSessionVersion({ ...renewed, backendSessionId: undefined }));
  expect(workspaceSessionsBinding({ ...original, backendSessionId: undefined }))
    .not.toBe(workspaceSessionsBinding({ ...renewed, backendSessionId: undefined }));
});
function request() {
  return new Request("http://localhost:3019/api/workspace-sessions/" + sid + "/conversation-queue", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3019",
      host: "localhost:3019", "x-workspace-session": contactHandoffSessionVersion(original),
      "x-memory-entry-capability": mintMemoryEntryCapability(original, { purpose: "chat", sessionId: sid }),
    }, body: JSON.stringify({ session_id: sid, message_id: mid, idempotency_key: mid, objective: "continue existing conversation" }),
  });
}
it("continues the already-open conversation through the actual BFF admission boundary after renewal", async () => {
  const response = await conversationQueueRoute(request(), sid, "admit");
  expect(response.status).toBe(202);
  expect(f.admit).toHaveBeenCalledOnce();
});
it("rejects an old tab after a real new login rather than weakening to account/user", async () => {
  f.claims.mockResolvedValue({ ...renewed, backendSessionId: "22222222-2222-4222-8222-222222222222" });
  const response = await conversationQueueRoute(request(), sid, "admit");
  expect(response.status).toBe(409);
  expect(f.admit).not.toHaveBeenCalled();
});

it("keeps browser consent and staged recovery tied to a canonical login across access renewal", async () => {
  const { primarySessionFingerprint } = await import("./primary-session-binding");
  const { sessionFingerprint } = await import("./stagedAuth");
  const first = { backendAccountId: "account", backendUserId: "user", backendAccessToken: "access-one",
    backendAccountName: "Account", backendAccountSlug: "account", backendExpiresAt: "2099-01-01T00:00:00Z",
    backendRole: "member" as const, backendUsername: null, backendSessionId: "11111111-1111-4111-8111-111111111111" };
  const rotated = { ...first, backendAccessToken: "access-two", backendExpiresAt: "2099-01-02T00:00:00Z" };
  expect(primarySessionFingerprint(first)).toBe(primarySessionFingerprint(rotated));
  expect(sessionFingerprint(first)).toBe(sessionFingerprint(rotated));
  expect(sessionFingerprint(first)).not.toBe(sessionFingerprint({ ...rotated, backendSessionId: "22222222-2222-4222-8222-222222222222" }));
  expect(primarySessionFingerprint({ ...first, backendSessionId: undefined })).not.toBe(primarySessionFingerprint({ ...rotated, backendSessionId: undefined }));
});

it("preserves existing legacy DOM bindings through verified enrollment and later access rotations", async () => {
  const { primarySessionFingerprint } = await import("./primary-session-binding");
  const legacy = { backendAccountId: "account", backendUserId: "user", backendAccessToken: "original-legacy-access",
    backendAccountName: "Account", backendAccountSlug: "account", backendExpiresAt: "2099-01-01T00:00:00Z",
    backendRole: "member" as const, backendUsername: null };
  const upgraded = { ...legacy, backendAccessToken: "renewed-access", backendExpiresAt: "2099-01-02T00:00:00Z",
    backendSessionId: "11111111-1111-4111-8111-111111111111", backendLegacyAccessToken: legacy.backendAccessToken,
    backendLegacyExpiresAt: legacy.backendExpiresAt };
  expect(contactHandoffSessionVersion(upgraded)).toBe(contactHandoffSessionVersion(legacy));
  expect(workspaceSessionsBinding(upgraded)).toBe(workspaceSessionsBinding(legacy));
  expect(primarySessionFingerprint(upgraded)).toBe(primarySessionFingerprint(legacy));
  expect(primarySessionFingerprint({ ...upgraded, backendSessionId: "22222222-2222-4222-8222-222222222222",
    backendLegacyAccessToken: undefined, backendLegacyExpiresAt: undefined })).not.toBe(primarySessionFingerprint(legacy));
});
