/**
 * Release transport and verification for the standalone updater.
 *
 * Every body is capped before use; the manifest signature is verified before
 * parsing; the platform archive is verified against the signed sha256 AND the
 * signed byte size before it is ever extracted. This verification runs in
 * both the Node install/update code and the shell bootstrap (install.sh), so a
 * compromised transport alone can never substitute an archive.
 */
import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { CapirCliError, EXIT } from "../errors.js";
import type { FetchLike } from "../http.js";
import {
  parseManifest,
  selectAsset,
  verifyManifestSignature,
  type ReleaseAsset,
  type ReleaseManifest,
} from "./manifest.js";

/** Absolute caps regardless of what a signed manifest claims. */
export const MANIFEST_MAX_BYTES = 256 * 1024;
export const ARCHIVE_MAX_BYTES = 512 * 1024 * 1024;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export interface ReleaseTransport {
  fetchImpl: FetchLike;
  /** Per-request deadline; bounded so a hung server cannot stall the CLI. */
  timeoutMs?: number;
  /** Caller-owned cancellation (automatic check deadline); always honored. */
  signal?: AbortSignal;
}

function downloadError(message: string): CapirCliError {
  return new CapirCliError("CAPIR_UPDATE_DOWNLOAD_FAILED", EXIT.INFRASTRUCTURE, message);
}

/** Fetch a body with a hard byte cap and deadline; returns exact bytes. */
export async function fetchCapped(
  transport: ReleaseTransport,
  url: string,
  maxBytes: number,
): Promise<Buffer> {
  const controller = new AbortController();
  const abortFromParent = (): void => controller.abort();
  if (transport.signal) {
    if (transport.signal.aborted) controller.abort();
    else transport.signal.addEventListener("abort", abortFromParent, { once: true });
  }
  const timer = setTimeout(
    () => controller.abort(),
    transport.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  );
  timer.unref();
  try {
    const response = await transport.fetchImpl(url, { signal: controller.signal });
    if (!response.ok) throw downloadError(`Release download failed (${response.status}) for ${url}.`);
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > maxBytes) throw downloadError(`Release body for ${url} exceeds its byte cap.`);
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = response.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw downloadError(`Release body for ${url} exceeds its byte cap.`);
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw downloadError(`Release body for ${url} exceeds its byte cap.`);
    return buffer;
  } catch (error) {
    if (error instanceof CapirCliError) throw error;
    throw downloadError(
      `Release download failed for ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
    transport.signal?.removeEventListener("abort", abortFromParent);
  }
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolveDone, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveDone(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export function fileByteSize(path: string): number {
  return statSync(path).size;
}

export interface VerifiedRelease {
  manifest: ReleaseManifest;
  asset: ReleaseAsset;
}

/**
 * Verify manifest bytes + detached signature with an explicit trust key, then
 * strictly parse and select the platform asset. Never called without a trust
 * key: production passes the committed constant, tests pass a test key as an
 * explicit dependency.
 */
export function verifyManifestBytes(
  manifestBytes: Buffer | string,
  signatureBytes: Buffer,
  trustPublicKey: string,
  platform: string,
  options: { releaseBaseUrl?: string } = {},
): VerifiedRelease {
  const text = typeof manifestBytes === "string" ? manifestBytes : manifestBytes.toString("utf8");
  verifyManifestSignature(text, signatureBytes, trustPublicKey);
  const manifest = parseManifest(text, options);
  const asset = selectAsset(manifest, platform);
  return { manifest, asset };
}

/**
 * Verify the downloaded platform archive against the signed entry before any
 * extraction. Both byte size and sha256 must match exactly.
 */
export async function verifyArchiveFile(
  archivePath: string,
  asset: ReleaseAsset,
): Promise<void> {
  const size = fileByteSize(archivePath);
  if (size !== asset.size)
    throw new CapirCliError(
      "CAPIR_UPDATE_CHECKSUM_MISMATCH",
      EXIT.INFRASTRUCTURE,
      `Downloaded archive has ${size} bytes but the signed manifest declares ${asset.size}; refusing to extract.`,
    );
  const digest = await sha256File(archivePath);
  if (digest !== asset.sha256)
    throw new CapirCliError(
      "CAPIR_UPDATE_CHECKSUM_MISMATCH",
      EXIT.INFRASTRUCTURE,
      "Downloaded archive sha256 does not match the signed manifest; refusing to extract.",
    );
}

/** Download the channel manifest and its detached signature (capped, bounded). */
export async function fetchChannelManifest(
  transport: ReleaseTransport,
  urls: { manifest: string; signature: string },
  trustPublicKey: string,
  platform: string,
): Promise<VerifiedRelease> {
  const manifestBytes = await fetchCapped(transport, urls.manifest, MANIFEST_MAX_BYTES);
  const signatureBytes = await fetchCapped(transport, urls.signature, MANIFEST_MAX_BYTES);
  return verifyManifestBytes(manifestBytes, signatureBytes, trustPublicKey, platform);
}
