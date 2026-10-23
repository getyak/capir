import { DeleteObjectCommand, DeleteObjectsCommand, ListObjectVersionsCommand, S3Client } from "@aws-sdk/client-s3";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "./auth.js";
import { deleteChatMediaAsset } from "./chatMedia.js";
import { S3ChatMediaStorage, type ChatMediaStorage } from "./chatMediaStorage.js";

const auth = {
  accountId: "10000000-0000-4000-8000-000000000001",
  userId: "60000000-0000-4000-8000-000000000001",
  userKind: "password_human",
} as AuthContext;

function fixture() {
  const row = {
    id: "50000000-0000-4000-8000-000000000001",
    subject_id: "20000000-0000-4000-8000-000000000001",
    assignment_id: "30000000-0000-4000-8000-000000000001",
    created_by_user_id: auth.userId,
    storage_provider: "s3",
    object_key: "synthetic/account/image",
    status: "ready",
  };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("SELECT id, subject_id")) return { rows: [{ ...row }], rowCount: 1 };
    if (sql.includes("SET status = 'deleted'")) row.status = "deleted";
    return { rows: [], rowCount: 0 };
  });
  const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
  return { row, query, pool };
}

afterEach(() => vi.restoreAllMocks());

describe("unsubmitted Chat media permanent deletion", () => {
  it("removes all exact-key S3 versions before recording deleted", async () => {
    const { row, pool } = fixture();
    const versions = [
      { Key: row.object_key, VersionId: "private-v2" },
      { Key: row.object_key, VersionId: "private-v1" },
      { Key: `${row.object_key}-sibling`, VersionId: "keep" },
    ];
    const markers = [{ Key: row.object_key, VersionId: "old-marker" }];
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async command => {
      if (command instanceof ListObjectVersionsCommand) return { Versions: [...versions], DeleteMarkers: [...markers] } as never;
      if (command instanceof DeleteObjectCommand) {
        markers.push({ Key: row.object_key, VersionId: "new-marker" });
        return {} as never;
      }
      if (command instanceof DeleteObjectsCommand) {
        expect(row.status).toBe("ready");
        for (const target of command.input.Delete?.Objects ?? []) {
          for (const objects of [versions, markers]) {
            const index = objects.findIndex(item => item.Key === target.Key && item.VersionId === target.VersionId);
            if (index >= 0) objects.splice(index, 1);
          }
        }
        return {} as never;
      }
      throw new Error("Unexpected storage command");
    });
    const storage = new S3ChatMediaStorage("synthetic-private", {
      endpoint: "https://s3.example.test", forcePathStyle: true, region: "test-1",
    });
    await expect(deleteChatMediaAsset(pool, auth, storage, row.id)).resolves.toEqual({ id: row.id, status: "deleted" });
    expect(versions).toEqual([{ Key: `${row.object_key}-sibling`, VersionId: "keep" }]);
    expect(markers).toEqual([]);
    expect(row.status).toBe("deleted");
  });

  it("does not acknowledge deletion when a version cannot be permanently purged", async () => {
    const { row, pool, query } = fixture();
    const storage = {
      provider: "s3", delete: vi.fn(), purge: vi.fn(async () => { throw new Error("Synthetic purge failure"); }),
    } as unknown as ChatMediaStorage;
    await expect(deleteChatMediaAsset(pool, auth, storage, row.id)).rejects.toThrow("Synthetic purge failure");
    expect(row.status).toBe("ready");
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("SET status = 'deleted'"), expect.anything());
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("refuses a versioned storage adapter without permanent deletion support", async () => {
    const { row, pool } = fixture();
    const storage = { provider: "s3", delete: vi.fn() } as unknown as ChatMediaStorage;
    await expect(deleteChatMediaAsset(pool, auth, storage, row.id)).rejects.toMatchObject({
      statusCode: 503, code: "CHAT_MEDIA_PERMANENT_PURGE_UNAVAILABLE",
    });
    expect(row.status).toBe("ready");
    expect(storage.delete).not.toHaveBeenCalled();
  });
});
