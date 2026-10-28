import type { Pool, PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import type { AuthContext } from "./auth.js";
import type { ChatMediaStorage, StoredChatMedia } from "./chatMediaStorage.js";
import {
  bindChatMediaToManifest,
  CHAT_MEDIA_STORAGE_FAILURE_REASON,
  uploadChatMediaContent,
} from "./chatMedia.js";

const accountId = "10000000-0000-4000-8000-000000000001";
const personId = "20000000-0000-4000-8000-000000000001";
const contextId = "30000000-0000-4000-8000-000000000001";
const manifestId = "40000000-0000-4000-8000-000000000001";
const mediaId = "50000000-0000-4000-8000-000000000001";

function readyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: mediaId,
    subject_id: personId,
    assignment_id: contextId,
    created_by_user_id: "60000000-0000-4000-8000-000000000001",
    idempotency_key: "media-key",
    file_name: "context.jpg",
    media_type: "image/jpeg",
    byte_size: 4,
    width: null,
    height: null,
    storage_provider: "local",
    object_key: "account/person/media",
    status: "ready",
    created_at: new Date("2026-08-27T10:00:00.000Z"),
    ...overrides,
  };
}

describe("Chat media manifest binding", () => {
  it("binds ready media in recruiter-selected order", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [readyRow()] })
      .mockResolvedValueOnce({ rows: [] });
    const result = await bindChatMediaToManifest(
      { query } as unknown as PoolClient,
      accountId,
      personId,
      contextId,
      manifestId,
      [mediaId],
    );
    expect(result).toMatchObject([{ id: mediaId, status: "ready" }]);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("INSERT INTO context_manifest_media"),
      [accountId, manifestId, mediaId, 0],
    );
  });

  it.each([
    ["wrong person", { subject_id: "70000000-0000-4000-8000-000000000001" }],
    ["wrong relationship", { assignment_id: "80000000-0000-4000-8000-000000000001" }],
    ["failed upload", { status: "failed" }],
  ])("rejects %s before creating a manifest binding", async (_label, override) => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [readyRow(override)] });
    await expect(
      bindChatMediaToManifest(
        { query } as unknown as PoolClient,
        accountId,
        personId,
        contextId,
        manifestId,
        [mediaId],
      ),
    ).rejects.toMatchObject({ code: "CHAT_MEDIA_NOT_READY", statusCode: 409 });
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("Chat media upload failure diagnostics", () => {
  const auth = {
    accountId,
    accountSlug: "synthetic",
    userId: "60000000-0000-4000-8000-000000000001",
    userEmail: "recruiter@example.test",
    userKind: "simulated_human",
    sessionId: "70000000-0000-4000-8000-000000000001",
  } as AuthContext;

  function uploadRow(overrides: Record<string, unknown> = {}) {
    return {
      id: mediaId,
      subject_id: personId,
      assignment_id: contextId,
      created_by_user_id: auth.userId,
      idempotency_key: "upload-key",
      file_name: "context.jpg",
      media_type: "image/jpeg",
      byte_size: 4,
      width: null,
      height: null,
      storage_provider: "local",
      object_key: "account/person/media",
      status: "pending",
      created_at: new Date("2026-08-27T10:00:00.000Z"),
      ...overrides,
    };
  }

  it("retains only the fixed failure diagnostic when storage rejects with a canary error", async () => {
    const failure = Object.assign(new Error("SECRET_STORAGE_MESSAGE_CANARY"), {
      name: "SECRET_STORAGE_NAME_CANARY",
      stack: "Error: SECRET_STORAGE_MESSAGE_CANARY\n    at SECRET_STACK_CANARY",
      cause: new Error("SECRET_CAUSE_CANARY"),
    });
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const row = uploadRow() as ReturnType<typeof uploadRow> & { upload_state?: string; upload_attempt_id?: string; failure_reason?: unknown };
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("upload_state='writing'")) { row.upload_state = "writing"; row.upload_attempt_id = params[2] as string; }
      if (sql.includes("SET status = $3")) { row.status = params[2] as string; row.failure_reason = params[3]; row.upload_state = params[4] as string; }
      return { rows: sql.includes("SELECT") || sql.includes("RETURNING *") ? [{ ...row }] : [], rowCount: 1 };
    });
    const put = vi.fn(async () => { throw failure; });
    const storage = {
      provider: "local",
      put,
      get: vi.fn(),
      delete: vi.fn(),
    } as unknown as ChatMediaStorage;

    await expect(
      uploadChatMediaContent(
        { query, connect: async () => ({ query, release() {} }) } as unknown as Pool,
        auth,
        storage,
        mediaId,
        new Uint8Array([1, 2, 3, 4]),
        "image/jpeg",
      ),
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "CHAT_MEDIA_STORAGE_FAILED",
      message: "The image could not be stored. Retry keeps the same upload identity.",
    });
    expect(put).toHaveBeenCalledTimes(1);

    // No raw message, stack, cause, name, or code reaches any database
    // parameter: the failure row carries only the fixed diagnostic.
    const serialized = JSON.stringify(calls);
    for (const canary of [
      "SECRET_STORAGE_MESSAGE_CANARY",
      "SECRET_STORAGE_NAME_CANARY",
      "SECRET_STACK_CANARY",
      "SECRET_CAUSE_CANARY",
    ]) {
      expect(serialized).not.toContain(canary);
    }
    expect(row.status).toBe("failed");
    expect(row.upload_state).toBe("idle");
    expect(row.failure_reason).toBe(CHAT_MEDIA_STORAGE_FAILURE_REASON);
  });

  it("keeps the same upload identity and clears the fixed failure on retry", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    let attempt = 0;
    const row = uploadRow() as ReturnType<typeof uploadRow> & { upload_state?: string; upload_attempt_id?: string; failure_reason?: unknown };
    const respond = (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes("upload_state='writing'")) { row.upload_state = "writing"; row.upload_attempt_id = params[2] as string; }
      if (sql.includes("SET status = $3")) { row.status = params[2] as string; row.failure_reason = params[3]; row.upload_state = params[4] as string; }
      return { rows: sql.includes("SELECT") || sql.includes("RETURNING *") ? [{ ...row }] : [], rowCount: 1 };
    };
    const query = vi.fn(async (sql: string, params: unknown[] = []) => respond(sql, params));
    const client = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => respond(sql, params)),
      release: vi.fn(),
    };
    const put = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("SECRET_STORAGE_MESSAGE_CANARY");
    });
    const storage = {
      provider: "local",
      put,
      get: vi.fn(),
      delete: vi.fn(),
    } as unknown as ChatMediaStorage;
    const pool = {
      query,
      connect: vi.fn(async () => client),
    } as unknown as Pool;

    const failed = await uploadChatMediaContent(
      pool, auth, storage, mediaId, new Uint8Array([1, 2, 3, 4]), "image/jpeg",
    ).catch((error: unknown) => error);
    expect(failed).toMatchObject({ code: "CHAT_MEDIA_STORAGE_FAILED" });

    const retry = await uploadChatMediaContent(
      pool, auth, storage, mediaId, new Uint8Array([1, 2, 3, 4]), "image/jpeg",
    );
    expect(retry).toMatchObject({ id: mediaId, status: "ready" });

    // The retry reuses the exact staged upload: no new asset is inserted and
    // the ready transition clears the failure reason on the same row.
    expect(calls.some((call) => call.sql.includes("INSERT INTO chat_media_assets"))).toBe(false);
    expect(row.status).toBe("ready");
    expect(row.upload_state).toBe("idle");
    expect(row.failure_reason).toBeNull();
    expect(JSON.stringify(calls)).not.toContain("CANARY");
  });
});
