import { CONTRACT_VERSION, TalentSignalClient } from "@talent-signal/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readClaims } = vi.hoisted(() => ({ readClaims: vi.fn() }));
vi.mock("@/lib/server/backendAuth", () => ({
  readBackendSessionClaims: readClaims,
  backendAuthBaseUrl: () => "http://127.0.0.1:4317",
}));

import { GET } from "./route";

const claims = {
  backendAccessToken: "synthetic-token",
  backendAccountId: "account-a",
  backendAccountName: "Account A",
  backendAccountSlug: "account-a",
  backendExpiresAt: "2099-01-01T00:00:00.000Z",
  backendRole: "member" as const,
  backendUserId: "user-a",
  backendUsername: null,
};

const backendHealth = vi.spyOn(TalentSignalClient.prototype, "systemHealth");

beforeEach(() => {
  vi.clearAllMocks();
  readClaims.mockResolvedValue(claims);
});
afterEach(() => vi.useRealTimers());

describe("system health workspace proxy", () => {
  it("requires a current backend session before observing dependencies", async () => {
    readClaims.mockResolvedValue(null);
    const result = await GET();
    expect(result.status).toBe(401);
    expect(await result.json()).toMatchObject({ code: "backend_session_expired" });
    expect(backendHealth).not.toHaveBeenCalled();
  });

  it("preserves stale workspace binding as a session failure", async () => {
    readClaims.mockRejectedValue(
      Object.assign(new Error("expired"), {
        name: "BackendSessionExpiredError",
      }),
    );
    const result = await GET();
    expect(result.status).toBe(401);
    expect(await result.json()).toMatchObject({ code: "backend_session_expired" });
    expect(backendHealth).not.toHaveBeenCalled();
  });

  it("adds the Web observation to the authenticated backend result", async () => {
    backendHealth.mockResolvedValue({
      contract_version: CONTRACT_VERSION,
      schema_version: "system-health.v1",
      status: "healthy",
      observed_at: "2026-09-14T09:00:00.000Z",
      components: [
        { id: "backend", label: "Backend API", kind: "service", required: true, status: "healthy", duration_ms: 2, detail_code: "request_completed" },
        { id: "database", label: "PostgreSQL", kind: "database", required: true, status: "healthy", duration_ms: 3, detail_code: "query_completed" },
        { id: "migrations", label: "Database schema", kind: "schema", required: true, status: "healthy", duration_ms: 1, detail_code: "required_migrations_applied" },
      ],
    });

    const result = await GET();
    const body = await result.json();
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(body.components.map((item: { id: string }) => item.id)).toEqual([
      "web",
      "backend",
      "database",
      "migrations",
    ]);
  });

  it("forwards a validated backend revision and omits an absent one", async () => {
    backendHealth.mockResolvedValueOnce({
      contract_version: CONTRACT_VERSION,
      schema_version: "system-health.v1",
      status: "healthy",
      observed_at: "2026-09-14T09:00:00.000Z",
      backend_revision: "26a664bb",
      components: [
        { id: "backend", label: "Backend API", kind: "service", required: true, status: "healthy", duration_ms: 2, detail_code: "request_completed" },
        { id: "database", label: "PostgreSQL", kind: "database", required: true, status: "healthy", duration_ms: 3, detail_code: "query_completed" },
        { id: "migrations", label: "Database schema", kind: "schema", required: true, status: "healthy", duration_ms: 1, detail_code: "required_migrations_applied" },
      ],
    });
    const withRevision = await GET();
    expect((await withRevision.json()).backend_revision).toBe("26a664bb");

    backendHealth.mockResolvedValueOnce({
      contract_version: CONTRACT_VERSION,
      schema_version: "system-health.v1",
      status: "healthy",
      observed_at: "2026-09-14T09:00:00.000Z",
      components: [
        { id: "backend", label: "Backend API", kind: "service", required: true, status: "healthy", duration_ms: 2, detail_code: "request_completed" },
        { id: "database", label: "PostgreSQL", kind: "database", required: true, status: "healthy", duration_ms: 3, detail_code: "query_completed" },
        { id: "migrations", label: "Database schema", kind: "schema", required: true, status: "healthy", duration_ms: 1, detail_code: "required_migrations_applied" },
      ],
    });
    const withoutRevision = await GET();
    expect("backend_revision" in (await withoutRevision.json())).toBe(false);
  });

  it("keeps downstream state unknown when the backend cannot answer", async () => {
    backendHealth.mockRejectedValue(new Error("synthetic secret-bearing error"));
    const result = await GET();
    const body = await result.json();
    expect(result.status).toBe(503);
    expect(body).toMatchObject({
      status: "unavailable",
      components: [
        { id: "web", status: "healthy" },
        { id: "backend", status: "unavailable" },
        { id: "database", status: "unknown" },
        { id: "migrations", status: "unknown" },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("secret-bearing");
  });

  it("settles a backend request that never returns", async () => {
    vi.useFakeTimers();
    backendHealth.mockImplementation(() => new Promise(() => {}));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(4_000);
    const result = await pending;
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({
      status: "unavailable",
      components: [
        { id: "web", status: "healthy" },
        { id: "backend", status: "unavailable" },
        { id: "database", status: "unknown" },
        { id: "migrations", status: "unknown" },
      ],
    });
  });
});
