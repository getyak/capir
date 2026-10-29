import { beforeEach, describe, expect, it, vi } from "vitest";
import { TalentSignalHttpError } from "@talent-signal/contracts";
import type { WorkspaceSessionSummary } from "./workspaceSessions";

vi.mock("server-only", () => ({}));
const load = vi.hoisted(() => vi.fn());
vi.mock("./workspaceSessions", () => ({ loadWorkspaceSessionDirectory: load }));
import { loadPersonRelatedSessions } from "./personRelatedSessions";

const personId = "11111111-1111-4111-8111-111111111111";
const otherPerson = "44444444-4444-4444-8444-444444444444";
const contextId = "22222222-2222-4222-8222-222222222222";
const otherContext = "55555555-5555-4555-8555-555555555555";
const person = { id: personId, contexts: [{ id: contextId }] };
function session(number = 1, overrides: Partial<WorkspaceSessionSummary> = {}): WorkspaceSessionSummary {
  const sessionId = `33333333-3333-4333-8333-${String(number).padStart(12, "0")}`;
  return {
    sessionId, title: `Original conversation ${number}`, updatedAt: "2026-10-29T00:00:00.000Z",
    expiresAt: "2030-01-01T00:00:00.000Z", revision: 1, turnCount: 1, isUnread: false,
    scopeKind: "relationship", personId, relationshipContextId: contextId, personLabel: "Same name", contextLabel: "Reviewed context",
    scope: { kind: "relationship", personId, relationshipContextId: contextId, personLabel: "Same name", contextLabel: "Reviewed context", href: "/workspace" },
    ...overrides,
  };
}
beforeEach(() => { vi.resetAllMocks(); load.mockResolvedValue({ sessions: [], complete: true, nextCursor: null }); });

describe("related conversations belong to an authorized Person and relationship", () => {
  it("represents a successful empty directory without inventing a conversation", async () => {
    expect(await loadPersonRelatedSessions(person)).toEqual({ sessions: [], complete: true });
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("projects the real Session id, original title and observed update time", async () => {
    load.mockResolvedValue({ sessions: [session(1, { title: "用户自己写的题目" })], complete: true, nextCursor: null });
    expect(await loadPersonRelatedSessions(person)).toEqual({ sessions: [{ id: "33333333-3333-4333-8333-000000000001", title: "用户自己写的题目", updatedAt: "2026-10-29T00:00:00.000Z" }], complete: true });
  });
  it("offers every loaded matching conversation instead of silently choosing one", async () => {
    load.mockResolvedValue({ sessions: [session(1), session(2)], complete: true, nextCursor: null });
    const result = await loadPersonRelatedSessions(person);
    expect(result.sessions.map(item => item.id)).toEqual(["33333333-3333-4333-8333-000000000001", "33333333-3333-4333-8333-000000000002"]);
  });
  it("never uses a matching display name as identity or admits another relationship scope", async () => {
    load.mockResolvedValue({ sessions: [
      session(1), session(2, { personId: otherPerson }), session(3, { relationshipContextId: otherContext }),
      session(4, { scopeKind: "identity_review" }), session(5, { scopeKind: "unresolved_intent" }), session(6, { relationshipContextId: null }),
    ], complete: true, nextCursor: null });
    expect((await loadPersonRelatedSessions(person)).sessions.map(item => item.id)).toEqual(["33333333-3333-4333-8333-000000000001"]);
  });
  it("does not collect conversations without an authorized relationship context", async () => {
    expect(await loadPersonRelatedSessions({ id: personId, contexts: [] })).toEqual({ sessions: [], complete: true });
    expect(load).not.toHaveBeenCalled();
  });
  it("keeps an incomplete directory visibly incomplete even when this page has no match", async () => {
    load.mockResolvedValue({ sessions: [session(1, { personId: otherPerson })], complete: false, nextCursor: "opaque-next" });
    expect(await loadPersonRelatedSessions(person)).toEqual({ sessions: [], complete: false });
  });
  it("marks a bounded recent selection incomplete when other matches were omitted", async () => {
    load.mockResolvedValue({ sessions: Array.from({ length: 5 }, (_, index) => session(index + 1)), complete: true, nextCursor: null });
    const result = await loadPersonRelatedSessions(person);
    expect(result.sessions).toHaveLength(4);
    expect(result.complete).toBe(false);
  });
  it("does not expose an expired Session even if the directory provider returns it", async () => {
    load.mockResolvedValue({ sessions: [session(1, { expiresAt: "2000-01-01T00:00:00.000Z" }), session(2, { expiresAt: "invalid" })], complete: true, nextCursor: null });
    expect((await loadPersonRelatedSessions(person)).sessions).toEqual([]);
  });
  it.each([401, 403, 503])("propagates a denied or failed read (%s) instead of returning an empty directory", async status => {
    const error = new TalentSignalHttpError(status, "scoped_read_failed", "Synthetic error", null);
    load.mockRejectedValue(error);
    await expect(loadPersonRelatedSessions(person)).rejects.toBe(error);
  });
});
