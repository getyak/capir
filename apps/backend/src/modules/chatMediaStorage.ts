import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import type { BackendConfig } from "../config.js";
import { sha256 } from "../lib/hash.js";

export interface StoredChatMedia {
  body: Uint8Array;
  contentType: string;
}

export interface ChatMediaStorage {
  readonly provider: "local" | "s3";
  readonly labScopeID?: string;
  purgeForLab?(objectKey: string): Promise<void>;
  purge?(objectKey: string): Promise<void>;
  existsForLab?(objectKey: string): Promise<boolean>;
  inspectVersions?(objectKey: string): Promise<{ versions: number; deleteMarkers: number }>;
  verifyUpload?(objectKey: string, attemptId: string, byteSize: number, contentType: string): Promise<boolean>;
  delete(objectKey: string): Promise<void>;
  get(objectKey: string, contentType: string): Promise<StoredChatMedia>;
  put(objectKey: string, body: Uint8Array, contentType: string, attemptId?: string): Promise<void>;
}

function safeLocalPath(directory: string, objectKey: string): string {
  const root = resolve(directory);
  const target = resolve(root, objectKey);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error("Chat media object key escaped its configured directory.");
  }
  return target;
}

export class LocalChatMediaStorage implements ChatMediaStorage {
  readonly provider = "local" as const;
  readonly labScopeID: string;

  constructor(private readonly directory: string) {
    this.labScopeID = sha256(JSON.stringify({provider:this.provider,directory:resolve(directory)}));
  }

  async purge(objectKey: string): Promise<void> { await this.delete(objectKey); }
  async purgeForLab(objectKey: string): Promise<void> { await this.purge(objectKey); }
  async existsForLab(objectKey: string): Promise<boolean> {
    try { await stat(safeLocalPath(this.directory, objectKey)); return true; }
    catch(error) { if((error as NodeJS.ErrnoException).code === "ENOENT")return false;throw error; }
  }

  async put(
    objectKey: string,
    body: Uint8Array,
    _contentType: string,
  ): Promise<void> {
    const target = safeLocalPath(this.directory, objectKey);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, body, { mode: 0o600 });
  }

  async get(objectKey: string, contentType: string): Promise<StoredChatMedia> {
    return {
      body: await readFile(safeLocalPath(this.directory, objectKey)),
      contentType,
    };
  }

  async delete(objectKey: string): Promise<void> {
    try {
      await unlink(safeLocalPath(this.directory, objectKey));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

export class S3ChatMediaStorage implements ChatMediaStorage {
  readonly provider = "s3" as const;
  readonly labScopeID: string;
  private readonly client: S3Client;
  private readonly writer: S3Client;

  constructor(
    private readonly bucket: string,
    options: {
      endpoint?: string;
      forcePathStyle: boolean;
      region: string;
    },
  ) {
    this.client = new S3Client(options);
    // One domain attempt must mean exactly one external PUT. Automatic SDK
    // retries could leave a second late request after the first HEAD receipt.
    this.writer = new S3Client({ ...options, maxAttempts: 1 });
    this.labScopeID = sha256(JSON.stringify({provider:this.provider,bucket,
      endpoint:options.endpoint??null,region:options.region,forcePathStyle:options.forcePathStyle}));
  }

  private async exactVersions(objectKey: string) {
    const objects: Array<{ Key: string; VersionId: string }> = [];
    let versions = 0, deleteMarkers = 0;
    let marker: { KeyMarker?: string; VersionIdMarker?: string } = {};
    const seen = new Set<string>();
    for (let page = 0; page < 1000; page++) {
      const result = await this.client.send(new ListObjectVersionsCommand({
        Bucket: this.bucket, Prefix: objectKey, MaxKeys: 1000, ...marker,
      }));
      for (const [entries, kind] of [[result.Versions ?? [], "version"], [result.DeleteMarkers ?? [], "marker"]] as const) {
        for (const entry of entries) {
          if (entry.Key !== objectKey) continue;
          if (!entry.VersionId) throw new Error("Media version identity is unavailable.");
          objects.push({ Key: objectKey, VersionId: entry.VersionId });
          if (kind === "version") versions++; else deleteMarkers++;
        }
      }
      if (!result.IsTruncated) return { objects, versions, deleteMarkers };
      const cursor = JSON.stringify([result.NextKeyMarker, result.NextVersionIdMarker]);
      if (!result.NextKeyMarker || seen.has(cursor) ||
          (result.NextKeyMarker === objectKey && !result.NextVersionIdMarker)) {
        throw new Error("Media version pagination did not advance.");
      }
      seen.add(cursor);
      marker = { KeyMarker: result.NextKeyMarker,
        ...(result.NextVersionIdMarker ? { VersionIdMarker: result.NextVersionIdMarker } : {}) };
    }
    throw new Error("Media version pagination exceeds the safe inventory bound.");
  }

  async inspectVersions(objectKey: string): Promise<{ versions: number; deleteMarkers: number }> {
    const inventory = await this.exactVersions(objectKey);
    return { versions: inventory.versions, deleteMarkers: inventory.deleteMarkers };
  }

  async purgeForLab(objectKey: string): Promise<void> { await this.purge(objectKey); }

  private async assertObjectAbsent(objectKey: string): Promise<void> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return;
      throw error;
    }
    throw new Error("Media object remains after version cleanup.");
  }

  async purge(objectKey: string): Promise<void> {
    // Freeze a complete listing before deleting, so continuation never relies
    // on a version marker that this operation has already removed.
    for (let pass = 0; pass < 3; pass++) {
      const { objects } = await this.exactVersions(objectKey);
      if (objects.length === 0) { await this.assertObjectAbsent(objectKey); return; }
      for (let offset = 0; offset < objects.length; offset += 1000) {
        const result = await this.client.send(new DeleteObjectsCommand({
          Bucket: this.bucket, Delete: { Objects: objects.slice(offset, offset + 1000), Quiet: true },
        }));
        if (result.Errors?.length) throw new Error("Some media versions could not be deleted.");
      }
    }
    if ((await this.exactVersions(objectKey)).objects.length === 0) { await this.assertObjectAbsent(objectKey); return; }
    throw new Error("Media version cleanup remains incomplete.");
  }

  async verifyUpload(objectKey: string, attemptId: string, byteSize: number, contentType: string): Promise<boolean> {
    try {
      const receipt = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      return receipt.Metadata?.["capir-upload-attempt"] === attemptId &&
        receipt.ContentLength === byteSize && receipt.ContentType === contentType;
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
      throw error;
    }
  }

  async existsForLab(objectKey: string): Promise<boolean> {
    try { await this.client.send(new HeadObjectCommand({Bucket:this.bucket,Key:objectKey})); return true; }
    catch(error) { if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode!==404)throw error; }
    return (await this.exactVersions(objectKey)).objects.length>0;
  }

  async put(
    objectKey: string,
    body: Uint8Array,
    contentType: string,
    attemptId?: string,
  ): Promise<void> {
    await this.writer.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: body,
        ContentLength: body.byteLength,
        ContentType: contentType,
        ServerSideEncryption: "AES256",
        ...(attemptId ? { Metadata: { "capir-upload-attempt": attemptId } } : {}),
      }),
    );
  }

  async get(objectKey: string, contentType: string): Promise<StoredChatMedia> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
    if (!result.Body) throw new Error("Chat media object body is unavailable.");
    return {
      body: await result.Body.transformToByteArray(),
      contentType: result.ContentType ?? contentType,
    };
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }),
    );
  }
}

export function createChatMediaStorage(
  config: BackendConfig,
): ChatMediaStorage {
  const storage = config.chatMediaStorage ?? {
    provider: "local" as const,
    directory: `${process.cwd()}/.data/chat-media`,
  };
  return storage.provider === "s3"
    ? new S3ChatMediaStorage(storage.bucket, storage)
    : new LocalChatMediaStorage(storage.directory);
}
