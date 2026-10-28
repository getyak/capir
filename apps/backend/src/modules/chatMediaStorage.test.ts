import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DeleteObjectsCommand, HeadObjectCommand, ListObjectVersionsCommand, S3Client } from "@aws-sdk/client-s3";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LocalChatMediaStorage,
  S3ChatMediaStorage,
} from "./chatMediaStorage.js";

const directories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("S3 Chat media storage", () => {
  it("writes private bytes to the configured bucket and object key", async () => {
    const send = vi
      .spyOn(S3Client.prototype, "send")
      .mockResolvedValue({} as never);
    const storage = new S3ChatMediaStorage("private-chat-media", {
      endpoint: "https://s3.example.test",
      forcePathStyle: true,
      region: "test-1",
    });
    await storage.put(
      "account/person/media",
      new Uint8Array([1, 2, 3]),
      "image/webp",
    );
    const command = send.mock.calls[0]?.[0] as unknown as {
      input: Record<string, unknown>;
    };
    expect(command.input).toMatchObject({
      Bucket: "private-chat-media",
      Key: "account/person/media",
      ContentLength: 3,
      ContentType: "image/webp",
      ServerSideEncryption: "AES256",
    });
  });

  it("purges every exact-key version without deleting a prefix sibling", async () => {
    const responses = [
      { Versions: [{ Key: "account/person/media", VersionId: "v2" }, { Key: "account/person/media-copy", VersionId: "other" }],
        DeleteMarkers: [{ Key: "account/person/media", VersionId: "v1" }] },
      {},
      { Versions: [], DeleteMarkers: [] },
    ];
    const send = vi.spyOn(S3Client.prototype, "send").mockImplementation(async () => responses.shift() as never);
    const storage = new S3ChatMediaStorage("private-chat-media", {
      endpoint: "https://s3.example.test", forcePathStyle: true, region: "test-1",
    });
    await storage.purgeForLab("account/person/media");
    const deletion = send.mock.calls[1]?.[0] as unknown as {input:{Delete:{Objects:Array<{Key:string;VersionId:string}>}}};
    expect(deletion.input.Delete.Objects).toEqual([
      { Key: "account/person/media", VersionId: "v2" },
      { Key: "account/person/media", VersionId: "v1" },
    ]);
  });

  it("purges more than twenty pages of versions and markers before acknowledging completion", async () => {
    const key = "account/person/media";
    let versions = Array.from({ length: 21_001 }, (_, index) => ({ Key: key, VersionId: `v${index}` }));
    const sibling = { Key: `${key}-sibling`, VersionId: "keep" };
    vi.spyOn(S3Client.prototype, "send").mockImplementation(async command => {
      if (command instanceof ListObjectVersionsCommand) {
        const offset = command.input.VersionIdMarker
          ? versions.findIndex(version => version.VersionId === command.input.VersionIdMarker) + 1 : 0;
        const page = versions.slice(offset, offset + 1000);
        return { Versions: [...page, sibling], IsTruncated: offset + 1000 < versions.length,
          NextKeyMarker: key, NextVersionIdMarker: page.at(-1)?.VersionId } as never;
      }
      if (command instanceof DeleteObjectsCommand) {
        const deleted = new Set(command.input.Delete?.Objects?.map(value => value.VersionId));
        expect(command.input.Delete?.Objects?.every(value => value.Key === key)).toBe(true);
        versions = versions.filter(value => !deleted.has(value.VersionId));
        return {} as never;
      }
      throw new Error("Unexpected storage command");
    });
    const storage = new S3ChatMediaStorage("synthetic-private", { forcePathStyle: true, region: "test-1" });
    await storage.purge(key);
    expect(versions).toEqual([]);
  });

  it("fails closed on truncated listing without continuation instead of recording deletion", async () => {
    const send = vi.spyOn(S3Client.prototype, "send").mockResolvedValue({
      IsTruncated: true, Versions: [], DeleteMarkers: [],
    } as never);
    const storage = new S3ChatMediaStorage("synthetic-private", { forcePathStyle: true, region: "test-1" });
    await expect(storage.purge("account/person/media")).rejects.toThrow("pagination");
    expect(send.mock.calls.every(([command]) => command instanceof ListObjectVersionsCommand)).toBe(true);
  });


  it("attaches a unique upload attempt to PUT and requires its complete matching HEAD receipt", async () => {
    let head = { Metadata: { "capir-upload-attempt": "attempt-1" }, ContentLength: 3, ContentType: "image/png" };
    const send = vi.spyOn(S3Client.prototype, "send").mockImplementation(async command =>
      command instanceof HeadObjectCommand ? head as never : {} as never);
    const storage = new S3ChatMediaStorage("synthetic-private", { forcePathStyle: true, region: "test-1" });
    await storage.put("account/person/media", new Uint8Array([1, 2, 3]), "image/png", "attempt-1");
    expect((send.mock.calls[0]?.[0] as { input: unknown }).input).toMatchObject({
      Metadata: { "capir-upload-attempt": "attempt-1" },
    });
    await expect(storage.verifyUpload("account/person/media", "attempt-1", 3, "image/png")).resolves.toBe(true);
    head = { ...head, Metadata: { "capir-upload-attempt": "another-attempt" } };
    await expect(storage.verifyUpload("account/person/media", "attempt-1", 3, "image/png")).resolves.toBe(false);
    head = { ...head, Metadata: { "capir-upload-attempt": "attempt-1" }, ContentLength: 2 };
    await expect(storage.verifyUpload("account/person/media", "attempt-1", 3, "image/png")).resolves.toBe(false);
  });


  it("sends only one external PUT even when S3 returns a retryable response", async () => {
    vi.stubEnv("AWS_ACCESS_KEY_ID", "synthetic-only");
    vi.stubEnv("AWS_SECRET_ACCESS_KEY", "synthetic-only");
    vi.stubEnv("AWS_MAX_ATTEMPTS", "3");
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++; response.writeHead(503, { "Content-Type": "application/xml" });
      response.end("<Error><Code>SlowDown</Code></Error>");
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const storage = new S3ChatMediaStorage("synthetic", { region: "test-1", forcePathStyle: true,
        endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
      await expect(storage.put("synthetic/key", new Uint8Array([1]), "image/png", "synthetic-attempt")).rejects.toBeDefined();
      expect(requests).toBe(1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }, 15_000);

});

describe("local Chat media storage", () => {
  it("round-trips private bytes and deletes the object", async () => {
    const directory = await mkdtemp(join(tmpdir(), "talent-signal-chat-media-"));
    directories.push(directory);
    const storage = new LocalChatMediaStorage(directory);
    const body = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

    await storage.put("account/person/media", body, "image/jpeg");
    const stored = await storage.get("account/person/media", "image/jpeg");
    expect(Array.from(stored.body)).toEqual(Array.from(body));
    expect(stored.contentType).toBe("image/jpeg");
    await storage.delete("account/person/media");
    expect(await storage.existsForLab("account/person/media")).toBe(false);
    await expect(storage.get("account/person/media", "image/jpeg")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects object keys that escape the configured root", async () => {
    const directory = await mkdtemp(join(tmpdir(), "talent-signal-chat-media-"));
    directories.push(directory);
    const storage = new LocalChatMediaStorage(directory);
    await expect(storage.put("../../escape", new Uint8Array([1]), "image/png")).rejects.toThrow(
      "escaped its configured directory",
    );
  });
});
