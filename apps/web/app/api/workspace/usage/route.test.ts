import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { claims: readClaims, loadWeeklyUsage } = vi.hoisted(() => ({
  claims: vi.fn(),
  loadWeeklyUsage: vi.fn(),
}));
vi.mock("@/lib/server/backendAuth", () => ({
  readBackendSessionClaims: readClaims,
  backendAuthBaseUrl: () => "http://127.0.0.1:4317",
  authSecret: () => "synthetic-test-secret",
}));
vi.mock("@/lib/server/weeklyUsage", () => ({ loadWeeklyUsage }));

import { GET } from "./route";
import { workspaceSessionsBinding } from "@/lib/server/workspaceSessions";

const claims = {
  backendAccountId: "account-a",
  backendUserId: "user-a",
  backendAccessToken: "synthetic-token-a",
  backendExpiresAt: "2099-01-01T00:00:00Z",
  backendAccountName: "a",
  backendAccountSlug: "a",
  backendRole: "member" as const,
  backendUsername: null,
};

const usage = {
  contract_version: "2026-08-24.10",
  schema_version: "workspace-weekly-usage.v1",
  window: {
    start: "2026-09-27T16:00:00.000Z",
    end: "2026-10-04T16:00:00.000Z",
    timezone: "Asia/Shanghai",
  },
  count: 12,
  allowance: 1000,
  computed_at: "2026-09-30T02:00:00.000Z",
};

const request = (headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3000/api/workspace/usage", {
    method: "GET",
    headers: { host: "localhost:3000", "x-talent-signal-workspace": claims.backendAccountId,
      "x-talent-signal-usage-binding": workspaceSessionsBinding(claims), ...headers },
  });

beforeEach(() => {
  vi.clearAllMocks();
  readClaims.mockResolvedValue(claims);
});

describe("weekly usage proxy boundary", () => {
  it.each<Record<string, string>>([
    { "x-talent-signal-workspace": "" },
    { "x-talent-signal-usage-binding": "" },
    { "x-talent-signal-workspace": "other-account" },
  ])("fails closed for missing or mismatched scope %j", async (headers) => {
    expect((await GET(request(headers))).status).toBe(401);
    expect(loadWeeklyUsage).not.toHaveBeenCalled();
  });
  it.each([
    { backendUserId: "different-member-same-labels" },
    { backendAccountId: "other-account" },
    { backendAccessToken: "new-session" },
  ])("rejects an old tab binding after cookie identity changes %j", async (change) => {
    readClaims.mockResolvedValue({ ...claims, ...change });
    expect((await GET(request())).status).toBe(401);
    expect(loadWeeklyUsage).not.toHaveBeenCalled();
  });
  it("denies unauthenticated reads before contacting the backend", async () => {
    readClaims.mockResolvedValue(null);
    const result = await GET(request());
    expect(result.status).toBe(401);
    expect(loadWeeklyUsage).not.toHaveBeenCalled();
  });

  it("returns the exact aggregate as private no-store data", async () => {
    loadWeeklyUsage.mockResolvedValue(usage);
    const result = await GET(request());
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("pragma")).toBe("no-cache");
    expect(await result.json()).toEqual(usage);
  });

  it("never turns a read failure into a zero count", async () => {
    loadWeeklyUsage.mockRejectedValue(new Error("backend offline"));
    const result = await GET(request());
    expect(result.status).toBe(503);
    const body = (await result.json()) as { code?: string; count?: number };
    expect(body.code).toBe("weekly_usage_unavailable");
    expect(body.count).toBeUndefined();
  });

  it("maps a backend session expiry to sign-in, not to usage", async () => {
    loadWeeklyUsage.mockRejectedValue(
      Object.assign(new Error("expired"), { name: "BackendSessionExpiredError" }),
    );
    const result = await GET(request());
    expect(result.status).toBe(401);
  });

  it("reports an expired backend session as unauthenticated", async () => {
    readClaims.mockResolvedValue({ ...claims, backendExpiresAt: "2020-01-01T00:00:00Z" });
    const result = await GET(request());
    expect(result.status).toBe(401);
    expect(loadWeeklyUsage).not.toHaveBeenCalled();
  });
});
