import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { promises as dns } from "node:dns";

/**
 * MCP inbound connection safety.
 *
 * A user supplies an HTTPS Streamable HTTP server URL. Before capri
 * sends anything, the URL is constrained and its public DNS address is pinned
 * so a later resolution cannot rebind the request into a private network.
 *
 * Trusted local developer servers are reachable only when the exact origin is
 * listed in TALENT_SIGNAL_MCP_ALLOWED_ORIGINS. The allowlist is deployment
 * configuration, never browser input.
 */

export const MCP_ENCRYPTION_KEY_ENV = "TALENT_SIGNAL_MCP_ENCRYPTION_KEY";
export const MCP_ALLOWED_ORIGINS_ENV = "TALENT_SIGNAL_MCP_ALLOWED_ORIGINS";
export const MCP_PUBLIC_ORIGIN_ENV = "TALENT_SIGNAL_MCP_PUBLIC_ORIGIN";

const DOCKER_INTERNAL_NAME = /(?:^|\.)(?:localhost|local|internal|home\.arpa|metadata\.google\.internal)$/iu;

export class McpUrlRejectedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "McpUrlRejectedError";
    this.code = code;
  }
}

export interface McpEncryptionKey {
  readonly bytes: Buffer;
}

/**
 * A 32-byte base64 deployment key. Returns null when the deployment has not
 * configured it, so credential writes can fail closed with an explicit reason.
 */
export function loadMcpEncryptionKey(
  value = process.env[MCP_ENCRYPTION_KEY_ENV],
): McpEncryptionKey | null {
  if (!value?.trim()) return null;
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value.trim(), "base64");
  } catch {
    throw new Error(`${MCP_ENCRYPTION_KEY_ENV} must be base64.`);
  }
  if (decoded.length !== 32) {
    throw new Error(`${MCP_ENCRYPTION_KEY_ENV} must decode to exactly 32 bytes.`);
  }
  return { bytes: decoded };
}

export function encryptMcpCredential(
  secret: string,
  key: McpEncryptionKey,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.bytes, iv);
  const ciphertext = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptMcpCredential(
  encoded: string,
  key: McpEncryptionKey,
): string {
  const [version, ivPart, tagPart, bodyPart] = encoded.split(".");
  if (
    version !== "v1" ||
    !ivPart ||
    !tagPart ||
    !bodyPart
  ) {
    throw new Error("MCP credential ciphertext is malformed.");
  }
  const iv = Buffer.from(ivPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error("MCP credential ciphertext is malformed.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key.bytes, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(bodyPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function parseAllowedMcpOrigins(
  value = process.env[MCP_ALLOWED_ORIGINS_ENV],
): string[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => parseConfiguredOrigin(item, MCP_ALLOWED_ORIGINS_ENV));
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

/**
 * Only a bare HTTPS origin, or an HTTP loopback origin for a trusted local
 * developer server. Userinfo, path, query, and fragment are rejected so a
 * configured value can never redirect the published or allowlisted target.
 */
function parseConfiguredOrigin(raw: string, envName: string): string {
  const parsed = new URL(raw);
  if (
    parsed.origin === "null" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${envName} entries must be bare origins without credentials, query, or hash.`);
  }
  if (parsed.pathname.replace(/\/+$/u, "") !== "") {
    throw new Error(`${envName} entries must not include a path.`);
  }
  const loopback = isLoopbackHostname(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new Error(`${envName} entries must use HTTPS, except for an HTTP loopback origin.`);
  }
  return parsed.origin;
}

/**
 * The public origin used to render the published MCP endpoint. It comes from
 * deployment configuration, never from a request Host header.
 */
export function parsePublicMcpOrigin(
  value = process.env[MCP_PUBLIC_ORIGIN_ENV],
): string | null {
  if (!value?.trim()) return null;
  return parseConfiguredOrigin(value.trim(), MCP_PUBLIC_ORIGIN_ENV);
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/u.test(part)) return Number.NaN;
    return Number.parseInt(part, 10);
  });
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return octets;
}

function isPublicIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return false;
  const a = octets[0] ?? -1;
  const b = octets[1] ?? -1;
  const c = octets[2] ?? -1;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false;
  return true;
}

function ipv4FromMappedIpv6(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = /(?:^|:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/u.exec(lower);
  if (dotted?.[1]) return dotted[1];
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(lower);
  if (mapped?.[1] && mapped[2]) {
    const high = Number.parseInt(mapped[1], 16);
    const low = Number.parseInt(mapped[2], 16);
    return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
  }
  return null;
}

function embeddedIpv4FromIpv6(address: string): string | null {
  const lower = address.toLowerCase().split("%")[0] ?? address.toLowerCase();
  const groups = lower.split(":");
  // Expand "::" so positional extraction is reliable.
  const expanded: number[] = [];
  const doubleIndex = lower.indexOf("::");
  const head = doubleIndex === -1 ? groups : lower.slice(0, doubleIndex).split(":").filter(Boolean);
  const tail = doubleIndex === -1 ? [] : lower.slice(doubleIndex + 2).split(":").filter(Boolean);
  const toNumber = (group: string) => Number.parseInt(group || "0", 16);
  for (const group of head) expanded.push(toNumber(group));
  const missing = 8 - head.length - tail.length;
  for (let index = 0; index < Math.max(0, missing); index += 1) expanded.push(0);
  for (const group of tail) expanded.push(toNumber(group));
  if (expanded.length !== 8) return null;
  const first = expanded[0] ?? 0;
  const second = expanded[1] ?? 0;
  const g6 = expanded[6] ?? 0;
  const g7 = expanded[7] ?? 0;
  // 64:ff9b::/96 and 64:ff9b:1::/48 NAT64.
  if (first === 0x0064 && second === 0xff9b) {
    return `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
  }
  // 2002::/16 6to4.
  if (first === 0x2002) {
    const g2 = expanded[2] ?? 0;
    return `${second >> 8}.${second & 0xff}.${g2 >> 8}.${g2 & 0xff}`;
  }
  return null;
}

export function isPublicIpAddress(address: string): boolean {
  // This classifier intentionally stays self-contained rather than importing
  // the public-research host guard: inbound MCP additionally has to unwrap
  // IPv4-mapped, NAT64, and 6to4 IPv6 forms and to pin the resolved address,
  // while research.ts owns a different (hostname-based) fetch path.
  const value = address.trim().toLowerCase();
  if (value.includes(":")) {
    const mapped = ipv4FromMappedIpv6(value);
    if (mapped) return isPublicIpv4(mapped);
    const embedded = embeddedIpv4FromIpv6(value);
    if (embedded) return isPublicIpv4(embedded);
    if (value === "::" || value === "::1") return false;
    const firstGroup = value.split(":")[0] || "0";
    const first = Number.parseInt(firstGroup, 16);
    if (!Number.isFinite(first)) return false;
    if (first === 0) return false;
    // fc00::/7 unique local, fe80::/10 link local, ff00::/8 multicast.
    if ((first & 0xfe00) === 0xfc00) return false;
    if ((first & 0xffc0) === 0xfe80) return false;
    if ((first & 0xff00) === 0xff00) return false;
    // 2001:db8::/32 documentation.
    if (first === 0x2001 && (Number.parseInt(value.split(":")[1] ?? "0", 16) === 0x0db8)) {
      return false;
    }
    return true;
  }
  return isPublicIpv4(value);
}

export interface McpResolvedTarget {
  address: string;
  family: number;
  origin: string;
  trustedLocal: boolean;
  url: URL;
}

export interface McpUrlPolicy {
  allowedOrigins: string[];
  resolver?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
}

export const MCP_DNS_LOOKUP_TIMEOUT_MS = 5_000;

async function defaultResolver(
  hostname: string,
): Promise<Array<{ address: string; family: number }>> {
  // A bounded DNS lookup: a stalled resolver must fail as unavailable rather
  // than hold the connection attempt open indefinitely.
  const lookup = dns.lookup(hostname, { all: true, verbatim: true });
  const records = await Promise.race([
    lookup,
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new McpUrlRejectedError(
            "MCP_DNS_UNAVAILABLE",
            "The server hostname lookup timed out.",
          ),
        );
      }, MCP_DNS_LOOKUP_TIMEOUT_MS);
      timer.unref?.();
    }),
  ]);
  return records.map((record) => ({
    address: record.address,
    family: record.family,
  }));
}

function normalizedOrigin(url: URL): string {
  const port = url.port ? `:${url.port}` : "";
  return `${url.protocol}//${url.hostname}${port}`;
}

export async function resolveMcpServerUrl(
  raw: string,
  policy: McpUrlPolicy,
): Promise<McpResolvedTarget> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new McpUrlRejectedError(
      "MCP_ENDPOINT_REJECTED",
      "Enter a complete HTTPS server URL.",
    );
  }
  if (url.username || url.password) {
    throw new McpUrlRejectedError(
      "MCP_ENDPOINT_REJECTED",
      "Embedded credentials are not accepted in the server URL.",
    );
  }
  if (url.search || url.hash) {
    throw new McpUrlRejectedError(
      "MCP_ENDPOINT_REJECTED",
      "The server URL must not contain a query or fragment.",
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new McpUrlRejectedError(
      "MCP_ENDPOINT_REJECTED",
      "The MCP server must use HTTPS.",
    );
  }
  const origin = normalizedOrigin(url);
  const trustedLocal = policy.allowedOrigins.includes(origin);
  if (url.protocol === "http:" && !trustedLocal) {
    throw new McpUrlRejectedError(
      "MCP_ENDPOINT_REJECTED",
      "Only HTTPS MCP servers are accepted.",
    );
  }
  const hostname = url.hostname.toLowerCase();
  if (!trustedLocal) {
    if (
      DOCKER_INTERNAL_NAME.test(hostname) ||
      (!hostname.includes(".") && !hostname.includes(":"))
    ) {
      throw new McpUrlRejectedError(
        "MCP_DNS_UNAVAILABLE",
        "The server hostname does not resolve to a public address.",
      );
    }
  }
  const resolver = policy.resolver ?? defaultResolver;
  let records: Array<{ address: string; family: number }>;
  try {
    records = await resolver(url.hostname);
  } catch {
    throw new McpUrlRejectedError(
      "MCP_DNS_UNAVAILABLE",
      "The server hostname could not be resolved.",
    );
  }
  if (!records.length) {
    throw new McpUrlRejectedError(
      "MCP_DNS_UNAVAILABLE",
      "The server hostname could not be resolved.",
    );
  }
  if (!trustedLocal) {
    const unsafe = records.find((record) => !isPublicIpAddress(record.address));
    if (unsafe) {
      throw new McpUrlRejectedError(
        "MCP_ENDPOINT_REJECTED",
        "The server hostname resolves to a private or reserved address.",
      );
    }
  }
  const chosen = records[0];
  if (!chosen) {
    throw new McpUrlRejectedError(
      "MCP_DNS_UNAVAILABLE",
      "The server hostname could not be resolved.",
    );
  }
  return {
    address: chosen.address,
    family: chosen.family,
    origin,
    trustedLocal,
    url,
  };
}
