import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTRACT_VERSION,
  TalentSignalHttpError,
  type PersonSourceSyncRecord,
} from "@talent-signal/contracts";

const mock = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("./backendAuth", () => ({ authenticatedBackendClient: mock.client }));

import {
  loadPersonSourceSync,
  loadPersonSourceSyncRuns,
  loadPersonSourceSyncs,
  removePersonSourceSync,
  savePersonSourceSync,
} from "./timeWorkspace";

const syncId = "b1000000-0000-4000-8000-000000000001";
const personId = "b1000000-0000-4000-8000-000000000002";
const contextId = "b1000000-0000-4000-8000-000000000003";
const seedId = "b1000000-0000-4000-8000-000000000004";
const sync: PersonSourceSyncRecord = {
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
  interval_seconds: 86_400 as const,
  expires_at: "2026-11-17T00:00:00.000Z",
  status: "active" as const,
  confirmation: "periodic_public_source_re_read" as const,
};

function client() {
  return {
    listPersonSourceSyncs: vi.fn(async (): Promise<unknown> => ({ contract_version: CONTRACT_VERSION, syncs: [sync] })),
    getPersonSourceSync: vi.fn(async (): Promise<unknown> => ({ contract_version: CONTRACT_VERSION, sync })),
    putPersonSourceSync: vi.fn(async (): Promise<unknown> => ({ contract_version: CONTRACT_VERSION, sync })),
    deletePersonSourceSync: vi.fn(async (): Promise<unknown> => ({ contract_version: CONTRACT_VERSION, sync })),
    listPersonSourceSyncRuns: vi.fn(async (): Promise<unknown> => ({ contract_version: CONTRACT_VERSION, grant_id: syncId, runs: [], complete: true })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("person source sync server wrappers", () => {
  it("forwards exact owner-scoped filters and mutation receipts", async () => {
    const backend = client();
    mock.client.mockResolvedValue(backend);
    await loadPersonSourceSyncs({
      person_id: personId,
      relationship_context_id: contextId,
      seed_resource_id: seedId,
    });
    expect(backend.listPersonSourceSyncs).toHaveBeenCalledWith({
      person_id: personId,
      relationship_context_id: contextId,
      seed_resource_id: seedId,
    });
    await loadPersonSourceSync(syncId);
    expect(backend.getPersonSourceSync).toHaveBeenCalledWith(syncId);
    await savePersonSourceSync(syncId, mutation);
    expect(backend.putPersonSourceSync).toHaveBeenCalledWith(syncId, mutation);
    await removePersonSourceSync(syncId, {
      expected_revision: 1,
      idempotency_key: syncId,
    });
    expect(backend.deletePersonSourceSync).toHaveBeenCalledWith(syncId, {
      expected_revision: 1,
      idempotency_key: syncId,
    });
    await loadPersonSourceSyncRuns(syncId);
    expect(backend.listPersonSourceSyncRuns).toHaveBeenCalledWith(syncId);
  });

  it("fails closed when a response leaves the bounded contract", async () => {
    const backend = client();
    backend.getPersonSourceSync.mockResolvedValue({
      contract_version: CONTRACT_VERSION,
      sync: { ...sync, interval_seconds: 3600 },
    });
    mock.client.mockResolvedValue(backend);
    await expect(loadPersonSourceSync(syncId)).rejects.toMatchObject({
      status: 502,
      code: "time_contract_invalid",
    });

    const runsBackend = client();
    runsBackend.listPersonSourceSyncRuns.mockResolvedValue({
      contract_version: CONTRACT_VERSION,
      grant_id: syncId,
      runs: [{ fabricated_status: "completed" }],
      complete: true,
    });
    mock.client.mockResolvedValue(runsBackend);
    await expect(loadPersonSourceSyncRuns(syncId)).rejects.toBeInstanceOf(
      TalentSignalHttpError,
    );
  });

  it("requires a real backend session before any read", async () => {
    mock.client.mockResolvedValue(null);
    await expect(
      loadPersonSourceSyncs({ person_id: personId, relationship_context_id: contextId }),
    ).rejects.toMatchObject({ status: 401, code: "backend_session_expired" });
  });
});
