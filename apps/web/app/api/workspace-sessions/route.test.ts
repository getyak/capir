import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  claims: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  origin: vi.fn(),
}));

vi.mock("@/lib/server/backendAuth", () => ({ readBackendSessionClaims: mocked.claims }));
vi.mock("@/lib/request-origin", () => ({ isAllowedMutationOrigin: mocked.origin }));
vi.mock("@/lib/server/workspaceSessions", () => ({
  createUnscopedWorkspaceSession: mocked.create,
  isWorkspaceSessionCursor: (value: unknown) => value === "opaque_cursor",
  isWorkspaceSessionId: (value: unknown) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value),
  isWorkspaceSessionTimestamp: (value: unknown) => value === "2026-09-16T00:00:00.000Z",
  loadWorkspaceSessionDirectory: mocked.list,
  workspaceSessionDetailWire: (value: unknown) => value,
  workspaceSessionSummaryWire: (value: unknown) => value,
  workspaceSessionsBinding: () => "binding",
}));

import { GET, POST } from "./route";

const claims = { backendExpiresAt: "2099-01-01T00:00:00.000Z" };
const sessionId = "10000000-0000-4000-8000-000000000001";
const updatedAt = "2026-09-16T00:00:00.000Z";

function post(binding = "binding", origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/workspace-sessions", {
    body: JSON.stringify({ session_id: sessionId, updated_at: updatedAt }),
    headers: { "content-type": "application/json", "x-workspace-session": binding, host: "localhost:3000", origin },
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.claims.mockResolvedValue(claims);
  mocked.origin.mockReturnValue(true);
  mocked.list.mockResolvedValue({ complete: true, nextCursor: null, sessions: [] });
  mocked.create.mockResolvedValue({ session_id: sessionId });
});

describe("workspace Session directory route", () => {
  it("requires authenticated identity for reads", async () => {
    mocked.claims.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost:3000/api/workspace-sessions"))).status).toBe(401);
    expect(mocked.list).not.toHaveBeenCalled();
  });

  it("returns a no-store canonical directory", async () => {
    const response = await GET(
      new Request("http://localhost:3000/api/workspace-sessions?cursor=opaque_cursor"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect((await response.json()).complete).toBe(true);
    expect(mocked.list).toHaveBeenCalledWith({ cursor: "opaque_cursor" });
  });

  it("rejects a malformed pagination cursor", async () => {
    const response = await GET(
      new Request("http://localhost:3000/api/workspace-sessions?cursor=not.valid"),
    );
    expect(response.status).toBe(400);
    expect(mocked.list).not.toHaveBeenCalled();
  });

  it("rejects cross-origin creation before auth or backend access", async () => {
    mocked.origin.mockReturnValue(false);
    expect((await POST(post("binding", "https://other.invalid"))).status).toBe(403);
    expect(mocked.claims).not.toHaveBeenCalled();
    expect(mocked.create).not.toHaveBeenCalled();
  });

  it("rejects stale UI binding and creates only an unscoped Session", async () => {
    expect((await POST(post("stale"))).status).toBe(409);
    expect(mocked.create).not.toHaveBeenCalled();
    const response = await POST(post());
    expect(response.status).toBe(201);
    expect(mocked.create).toHaveBeenCalledWith({
      sessionId,
      title: undefined,
      updatedAt,
    });
  });

  it("rejects creation without a caller-owned retry timestamp", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/workspace-sessions", {
        body: JSON.stringify({ session_id: sessionId }),
        headers: {
          "content-type": "application/json",
          "x-workspace-session": "binding",
          host: "localhost:3000",
          origin: "http://localhost:3000",
        },
        method: "POST",
      }),
    );
    expect(response.status).toBe(400);
    expect(mocked.create).not.toHaveBeenCalled();
  });
});

it("publishes expiry metadata before a client can cancel the response body", async () => {
  mocked.claims.mockResolvedValue(null);
  const response = await GET(new Request("http://localhost:3000/api/workspace-sessions"));
  expect(response.status).toBe(401);
  expect(response.headers.get("X-Talent-Signal-Session-Status")).toBe("expired");
  expect(await response.json()).toMatchObject({ code: "backend_session_expired" });
});
