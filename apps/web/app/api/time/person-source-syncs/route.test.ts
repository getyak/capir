import { beforeEach, describe, expect, it, vi } from "vitest";
import { TalentSignalHttpError } from "@talent-signal/contracts";
import { CONTRACT_VERSION } from "@talent-signal/contracts";
const mock = vi.hoisted(() => ({
  claims: vi.fn(),
  origin: vi.fn(),
  list: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
  runs: vi.fn(),
}));
vi.mock("@/lib/server/backendAuth", () => ({ readBackendSessionClaims: mock.claims }));
vi.mock("@/lib/request-origin", () => ({ isAllowedMutationOrigin: mock.origin }));
vi.mock("@/lib/server/workspaceSessions", () => ({
  workspaceSessionsBinding: () => "binding",
  isWorkspaceSessionId: (id: string) => /^[0-9a-f-]{36}$/iu.test(id),
}));
vi.mock("@/lib/server/timeWorkspace", () => ({
  loadPersonSourceSyncs: mock.list,
  loadPersonSourceSync: mock.read,
  savePersonSourceSync: mock.save,
  removePersonSourceSync: mock.remove,
  loadPersonSourceSyncRuns: mock.runs,
}));
import { GET as listSyncs } from "./route";
import { GET, PUT, DELETE } from "./[id]/route";
import { GET as readRuns } from "./[id]/runs/route";

const syncId = "b1000000-0000-4000-8000-000000000001";
const personId = "b1000000-0000-4000-8000-000000000002";
const contextId = "b1000000-0000-4000-8000-000000000003";
const seedId = "b1000000-0000-4000-8000-000000000004";
const sync = {
  id: syncId,
  revision: 1,
  last_operation_id: syncId,
  created_at: "2026-10-18T00:00:00.000Z",
  updated_at: "2026-10-18T00:00:00.000Z",
  status: "active",
  effective_state: "active",
  content_available: true,
  person_id: personId,
  person_label: "Synthetic Person",
  relationship_context_id: contextId,
  seed_resource_id: seedId,
  source_url: "https://profile.example/person",
  allowed_domain: "profile.example",
  purpose: "Owner-confirmed periodic re-read of one bound public source for one person.",
  time_zone: "Asia/Shanghai",
  interval_seconds: 86_400,
  expires_at: "2026-11-17T00:00:00.000Z",
  next_due_at: "2026-10-18T00:00:00.000Z",
  authority: "user_authored",
  external_effect: "none",
};
const mutation = {
  expected_revision: 0,
  idempotency_key: syncId,
  person_id: personId,
  relationship_context_id: contextId,
  seed_resource_id: seedId,
  source_url: "https://profile.example/person",
  time_zone: "Asia/Shanghai",
  interval_seconds: 86_400,
  expires_at: "2026-11-17T00:00:00.000Z",
  status: "active",
  confirmation: "periodic_public_source_re_read",
};
const context = { params: Promise.resolve({ id: syncId }) };
function request(method: string, body?: unknown, binding = "binding", query = "") {
  return new Request(`http://localhost:3000/api/time/person-source-syncs${query}`, {
    method,
    headers: { "content-type": "application/json", "x-workspace-session": binding },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.origin.mockReturnValue(true);
  mock.claims.mockResolvedValue({ backendExpiresAt: "2099-01-01T00:00:00.000Z" });
  mock.list.mockResolvedValue({ contract_version: CONTRACT_VERSION, syncs: [sync] });
  mock.read.mockResolvedValue({ contract_version: CONTRACT_VERSION, sync });
  mock.save.mockResolvedValue({ contract_version: CONTRACT_VERSION, sync });
  mock.remove.mockResolvedValue({ contract_version: CONTRACT_VERSION, sync });
  mock.runs.mockResolvedValue({ contract_version: CONTRACT_VERSION, grant_id: syncId, runs: [], complete: true });
});

describe("person source sync browser/server boundary", () => {
  it("requires the current account binding on reads and writes", async () => {
    expect((await listSyncs(request("GET", undefined, "old", `?person_id=${personId}&relationship_context_id=${contextId}`))).status).toBe(409);
    expect((await GET(request("GET", undefined, "old"), context)).status).toBe(409);
    expect((await PUT(request("PUT", mutation, "old"), context)).status).toBe(409);
    expect(mock.list).not.toHaveBeenCalled();
    expect(mock.save).not.toHaveBeenCalled();
    mock.claims.mockResolvedValue(null);
    expect((await listSyncs(request("GET", undefined, "binding", `?person_id=${personId}&relationship_context_id=${contextId}`))).status).toBe(401);
  });

  it("serves only exact person/context lookups and rejects unknown keys", async () => {
    expect((await listSyncs(request("GET", undefined, "binding", "?person_id=x"))).status).toBe(400);
    expect((await listSyncs(request("GET", undefined, "binding", `?person_id=${personId}&relationship_context_id=${contextId}&account_id=${syncId}`))).status).toBe(400);
    expect((await listSyncs(request("GET", undefined, "binding", `?person_id=${personId}&relationship_context_id=${contextId}&person_id=${personId}`))).status).toBe(400);
    expect(mock.list).not.toHaveBeenCalled();
    const result = await listSyncs(request("GET", undefined, "binding", `?person_id=${personId}&relationship_context_id=${contextId}&seed_resource_id=${seedId}`));
    expect(result.status).toBe(200);
    expect(mock.list).toHaveBeenCalledWith({
      person_id: personId,
      relationship_context_id: contextId,
      seed_resource_id: seedId,
    });
    expect(result.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects cross-origin mutations and forwards exact revision/idempotency inputs", async () => {
    mock.origin.mockReturnValue(false);
    expect((await PUT(request("PUT", mutation), context)).status).toBe(403);
    mock.origin.mockReturnValue(true);
    expect((await PUT(request("PUT", { ...mutation, account_id: syncId }), context)).status).toBe(400);
    expect(mock.save).not.toHaveBeenCalled();

    const result = await PUT(request("PUT", mutation), context);
    expect(mock.save).toHaveBeenCalledWith(syncId, mutation);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(await result.json()).toMatchObject({ session_version: "binding", sync: { id: syncId } });

    const deletion = { expected_revision: 1, idempotency_key: syncId };
    await DELETE(request("DELETE", deletion), context);
    expect(mock.remove).toHaveBeenCalledWith(syncId, deletion);
  });

  it("never rewrites the separate periodic confirmation", async () => {
    expect((await PUT(request("PUT", { ...mutation, confirmation: "approve_public_research" }), context)).status).toBe(400);
    expect((await PUT(request("PUT", { ...mutation, interval_seconds: 3600 }), context)).status).toBe(400);
    expect(mock.save).not.toHaveBeenCalled();
  });

  it("returns honest run status readbacks without fabricating success", async () => {
    mock.runs.mockResolvedValue({
      contract_version: CONTRACT_VERSION,
      grant_id: syncId,
      runs: [{
        id: syncId,
        grant_id: syncId,
        cycle_due_at: "2026-10-18T00:00:00.000Z",
        created_at: "2026-10-18T00:00:00.000Z",
        started_at: null,
        completed_at: null,
        status: "unknown",
        settled: false,
        attempt_count: 1,
        attempt_limit: 3,
        deadline_at: "2026-10-18T00:15:00.000Z",
        task_id: null,
        new_observations: 0,
        content_available: true,
        source_url: "https://profile.example/person",
        observed_canonical_url: null,
        warning_codes: ["PERSON_SOURCE_SYNC_RECONCILIATION_UNRESOLVED"],
        stop_reason: null,
        authority: "unconfirmed",
        external_effect: "none",
      }],
      complete: true,
    });
    const result = await readRuns(request("GET"), context);
    expect(result.status).toBe(200);
    const body = await result.json();
    expect(body.runs[0]).toMatchObject({ status: "unknown", settled: false, attempt_limit: 3 });
    expect(result.headers.get("cache-control")).toBe("no-store");
  });

  it("maps boundary failures to readable messages without leaking internals", async () => {
    mock.read.mockRejectedValue(new TalentSignalHttpError(409, "PERSON_SOURCE_SYNC_GRANT_EXPIRED", "internal detail", null));
    const result = await GET(request("GET"), context);
    expect(result.status).toBe(409);
    expect(await result.text()).not.toContain("internal detail");
  });
});
