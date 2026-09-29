import { TalentSignalHttpError } from "@talent-signal/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  claims: vi.fn(),
  origin: vi.fn(),
  read: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/server/backendAuth", () => ({ readBackendSessionClaims: mocked.claims }));
vi.mock("@/lib/request-origin", () => ({ isAllowedMutationOrigin: mocked.origin }));
vi.mock("@/lib/server/meetingDrafts", () => ({
  readMeetingDraft: mocked.read,
  updateMeetingDraft: mocked.update,
}));
vi.mock("@/lib/server/workspaceSessions", () => ({
  isWorkspaceSessionId: (value: unknown) =>
    typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value),
  workspaceSessionsBinding: () => "binding",
}));

import { GET, POST, PUT } from "./route";

const draftId = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000002";
const context = { params: Promise.resolve({ id: draftId }) };
const activeDraft = {
  id: draftId,
  status: "needs_review",
  content_available: true,
  revision: 2,
};

function request(method: "POST" | "PUT", body: unknown, binding = "binding") {
  return new Request(`http://localhost:3000/api/meeting-drafts/${draftId}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      "x-workspace-session": binding,
      host: "localhost:3000",
      origin: "http://localhost:3000",
    },
    method,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.claims.mockResolvedValue({ backendExpiresAt: "2099-01-01T00:00:00.000Z" });
  mocked.origin.mockReturnValue(true);
  mocked.read.mockResolvedValue(activeDraft);
  mocked.update.mockResolvedValue(activeDraft);
});

describe("meeting draft edit and export authority route", () => {
  it("reads one current draft for the bound Session without requiring a mutation header", async () => {
    const response = await GET(new Request(`http://localhost:3000/api/meeting-drafts/${draftId}`, {
      headers: { "x-workspace-session": "binding" },
    }), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ draft: activeDraft, session_version: "binding" });
    expect(mocked.read).toHaveBeenCalledWith(draftId);
    mocked.read.mockClear();
    const stale = await GET(new Request(`http://localhost:3000/api/meeting-drafts/${draftId}`, {
      headers: { "x-workspace-session": "stale" },
    }), context);
    expect(stale.status).toBe(409);
    expect(mocked.read).not.toHaveBeenCalled();
  });
  it("persists the exact optimistic edit and idempotency identity", async () => {
    const body = {
      expected_revision: 1,
      idempotency_key: requestId,
      title: "与陈夏会谈",
      starts_at: "2026-09-17T01:30:00.000Z",
      ends_at: "2026-09-17T02:00:00.000Z",
    };
    const response = await PUT(request("PUT", body), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocked.update).toHaveBeenCalledWith(draftId, body);
  });

  it("re-reads current authority and rejects a stale export revision", async () => {
    const response = await POST(request("POST", { expected_revision: 1 }), context);
    expect(mocked.read).toHaveBeenCalledWith(draftId);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "MEETING_DRAFT_EXPORT_CONFLICT",
    });
  });

  it("rejects export when the source was redacted after the page opened", async () => {
    mocked.read.mockResolvedValue({
      ...activeDraft,
      content_available: false,
      revision: 3,
      status: "redacted",
    });
    const response = await POST(request("POST", { expected_revision: 3 }), context);
    expect(response.status).toBe(409);
    expect(mocked.update).not.toHaveBeenCalled();
  });

  it("preserves backend conflicts and rejects stale browser bindings", async () => {
    mocked.update.mockRejectedValue(
      new TalentSignalHttpError(409, "MEETING_DRAFT_REVISION_CONFLICT", "请刷新", null),
    );
    const conflict = await PUT(request("PUT", {
        expected_revision: 1,
        idempotency_key: requestId,
        title: "会谈",
        starts_at: "2026-09-17T01:30:00.000Z",
        ends_at: "2026-09-17T02:00:00.000Z",
      }), context);
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      code: "MEETING_DRAFT_REVISION_CONFLICT",
      draft: activeDraft,
    });
    expect((await POST(request("POST", { expected_revision: 2 }, "stale"), context)).status).toBe(409);
  });
});
