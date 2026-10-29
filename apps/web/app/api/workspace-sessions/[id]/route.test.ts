import { beforeEach, describe, expect, it, vi } from "vitest";
import { TalentSignalHttpError } from "@talent-signal/contracts";

const mocked = vi.hoisted(() => ({
  claims: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  rename: vi.fn(),
  remove: vi.fn(),
  origin: vi.fn(),
}));

vi.mock("@/lib/server/backendAuth", () => ({ readBackendSessionClaims: mocked.claims }));
vi.mock("@/lib/request-origin", () => ({ isAllowedMutationOrigin: mocked.origin }));
vi.mock("@/lib/server/workspaceSessions", () => ({
  boundedComposerDraft: (value: string) => value.slice(0, 12_000),
  deleteWorkspaceSession: mocked.remove,
  isWorkspaceSessionId: (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value),
  isWorkspaceSessionTimestamp: (value: unknown) => value === "2026-09-16T00:00:00.000Z",
  loadWorkspaceSession: mocked.load,
  saveWorkspaceSessionDraft: mocked.save,
  renameWorkspaceSession: mocked.rename,
  workspaceSessionDetailWire: (value: unknown) => value,
  workspaceSessionsBinding: () => "binding",
}));

import { DELETE, PUT, PATCH } from "./route";

const claims = { backendExpiresAt: "2099-01-01T00:00:00.000Z" };
const sessionId = "10000000-0000-4000-8000-000000000001";
const requestId = "10000000-0000-4000-8000-000000000002";
const updatedAt = "2026-09-16T00:00:00.000Z";
const context = { params: Promise.resolve({ id: sessionId }) };

function request(method: "PUT" | "DELETE" | "PATCH", body: unknown, binding = "binding") {
  return new Request(`http://localhost:3000/api/workspace-sessions/${sessionId}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-workspace-session": binding, host: "localhost:3000", origin: "http://localhost:3000" },
    method,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.claims.mockResolvedValue(claims);
  mocked.origin.mockReturnValue(true);
  mocked.save.mockResolvedValue({ revision: 4 });
  mocked.remove.mockResolvedValue({ state: "deleted" });
});

describe("workspace Session detail route", () => {
  it("forwards exact revision, retry identity, and bounded draft", async () => {
    const response = await PUT(request("PUT", {
      composer_draft: "保留草稿",
      composer_draft_updated_at: updatedAt,
      expected_revision: 3,
      idempotency_key: requestId,
    }), context);
    expect(response.status).toBe(200);
    expect(mocked.save).toHaveBeenCalledWith({
      composerDraft: "保留草稿",
      composerDraftUpdatedAt: updatedAt,
      expectedRevision: 3,
      idempotencyKey: requestId,
      sessionId,
    });
  });

  it("preserves backend 409 conflict without retrying", async () => {
    mocked.save.mockRejectedValue(new TalentSignalHttpError(409, "AGENT_SESSION_REVISION_CONFLICT", "另一端已更新", null));
    const response = await PUT(request("PUT", {
      composer_draft: "本地草稿",
      composer_draft_updated_at: updatedAt,
      expected_revision: 3,
      idempotency_key: requestId,
    }), context);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("AGENT_SESSION_REVISION_CONFLICT");
    expect(mocked.save).toHaveBeenCalledTimes(1);
  });

  it("requires same-origin and current UI binding for mutations", async () => {
    mocked.origin.mockReturnValue(false);
    expect((await PUT(request("PUT", {}), context)).status).toBe(403);
    expect(mocked.claims).not.toHaveBeenCalled();
    mocked.origin.mockReturnValue(true);
    expect((await PUT(request("PUT", {}, "stale"), context)).status).toBe(409);
    expect(mocked.save).not.toHaveBeenCalled();
  });

  it("maps explicit tombstone deletion with exact revision and identity", async () => {
    const response = await DELETE(request("DELETE", {
      expected_revision: 3,
      idempotency_key: requestId,
    }), context);
    expect(response.status).toBe(200);
    expect(mocked.remove).toHaveBeenCalledWith({
      expectedRevision: 3,
      idempotencyKey: requestId,
      sessionId,
    });
  });
});


it("renames through the authenticated same-origin revision boundary", async () => {
  mocked.rename.mockResolvedValue({ session_id: sessionId, title: "Reviewed title" });
  const body = { title: "Reviewed title", expected_revision: 3, idempotency_key: requestId };
  expect((await PATCH(request("PATCH", body), context)).status).toBe(200);
  expect(mocked.rename).toHaveBeenCalledExactlyOnceWith({ sessionId, title: body.title, expectedRevision: 3, idempotencyKey: requestId });
  mocked.rename.mockClear();
  expect((await PATCH(request("PATCH", body, "stale"), context)).status).toBe(409);
  expect((await PATCH(request("PATCH", null), context)).status).toBe(400);
  expect((await PATCH(request("PATCH", { ...body, title: 123 }), context)).status).toBe(400);
  mocked.origin.mockReturnValue(false);
  expect((await PATCH(request("PATCH", body), context)).status).toBe(403);
  expect(mocked.rename).not.toHaveBeenCalled();
});
