import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import type { BackendConfig } from "../config.js";
import { sha256 } from "../lib/hash.js";
import { LocalChatMediaUploads } from "./localChatMediaUploads.js";

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
  reserveUpload?(objectKey: string, attemptId: string, byteSize: number, contentType: string): Promise<void>;
  reconcileUpload?(objectKey: string, attemptId: string, byteSize: number, contentType: string): Promise<"completed" | "cancelled" | null>;
  verifyUpload?(objectKey: string, attemptId: string, byteSize: number, contentType: string): Promise<boolean>;
  delete(objectKey: string): Promise<void>;
  get(objectKey: string, contentType: string, attemptId?: string): Promise<StoredChatMedia>;
  put(objectKey: string, body: Uint8Array, contentType: string, attemptId?: string): Promise<void>;
}

interface TerminalWriteReceipt {
  type: "s3_terminal_rejection.v1"; sha256: string; code: string; status: number;
}
class TerminalS3WriteRejection extends Error {
  constructor(readonly scope: string, readonly attemptId: string, readonly receipt: TerminalWriteReceipt) {
    super("S3 rejected this upload before storing an object.");
  }
}
export function terminalChatMediaWriteRejection(error: unknown, storage: ChatMediaStorage,
  attemptId: string): TerminalWriteReceipt | null {
  return error instanceof TerminalS3WriteRejection && error.scope === storage.labScopeID && error.attemptId === attemptId
    ? error.receipt : null;
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
  private readonly uploads: LocalChatMediaUploads;

  constructor(private readonly directory: string) {
    this.labScopeID = sha256(JSON.stringify({provider:this.provider,directory:resolve(directory)}));
    this.uploads = new LocalChatMediaUploads(directory);
  }

  async purge(objectKey: string): Promise<void> { await this.delete(objectKey); }
  async purgeForLab(objectKey: string): Promise<void> { await this.purge(objectKey); }
  async reserveUpload(key: string, id: string, size: number, type: string) { await this.uploads.reserve(key, id, size, type); }
  async verifyUpload(key: string, id: string, size: number, type: string) { return this.uploads.verify(key, id, size, type); }
  async reconcileUpload(key: string, id: string, size: number, type: string) { return this.uploads.reconcile(key, id, size, type); }
  async existsForLab(objectKey: string): Promise<boolean> {
    if (await this.uploads.exists(objectKey)) return true;
    try { await stat(safeLocalPath(this.directory, objectKey)); return true; }
    catch(error) { if((error as NodeJS.ErrnoException).code === "ENOENT")return false;throw error; }
  }

  async put(
    objectKey: string,
    body: Uint8Array,
    _contentType: string,
    attemptId?: string,
  ): Promise<void> {
    if (attemptId) { await this.uploads.put(objectKey, attemptId, body); return; }
    const target = safeLocalPath(this.directory, objectKey);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, body, { mode: 0o600 });
  }

  async get(objectKey: string, contentType: string, attemptId?: string): Promise<StoredChatMedia> {
    return {
      body: attemptId ? await this.uploads.get(objectKey, attemptId) : await readFile(safeLocalPath(this.directory, objectKey)),
      contentType,
    };
  }

  async delete(objectKey: string): Promise<void> {
    await this.uploads.delete(objectKey);
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
    try { await this.writer.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: body,
        ContentLength: body.byteLength,
        ContentType: contentType,
        ServerSideEncryption: "AES256",
        ...(attemptId ? { Metadata: { "capir-upload-attempt": attemptId } } : {}),
      }),
    ); } catch (error) {
      // Only an actual single SDK response from this exact store is a
      // terminal rejection. Transport errors, 5xx, and untyped/opaque failures
      // remain unknown; neither status alone nor an error-shaped object proves it.
      const terminalAuthStatus: Readonly<Record<string, number>> = {
        AccessDenied: 403, InvalidAccessKeyId: 403, SignatureDoesNotMatch: 403,
        ExpiredToken: 400, InvalidToken: 400, AuthorizationHeaderMalformed: 400, RequestTimeTooSkewed: 403,
      };
      const denied = error instanceof S3ServiceException &&
        error.$metadata.httpStatusCode === terminalAuthStatus[error.name] &&
        error.$metadata.attempts === 1 && typeof error.$metadata.requestId === "string" &&
        error.$metadata.requestId.length > 0 && terminalAuthStatus[error.name] !== undefined;
      if (denied && attemptId) {
        throw new TerminalS3WriteRejection(this.labScopeID, attemptId, {
          type: "s3_terminal_rejection.v1", code: error.name, status: error.$metadata.httpStatusCode!,
          sha256: sha256(JSON.stringify(["s3_terminal_rejection.v1", this.labScopeID, attemptId,
            error.name, error.$metadata.httpStatusCode!, sha256(error.$metadata.requestId!)])),
        });
      }
      throw error;
    }
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
