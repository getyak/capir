import { randomUUID } from "node:crypto";
import { promises as dns } from "node:dns";
import { isIP } from "node:net";

import {
  CONTRACT_VERSION,
  type PublicResearchPage,
  type PublicResearchRequest,
  type PublicResearchResponse,
  type ResourceCaptureRequest,
} from "@talent-signal/contracts";
import { Parser } from "htmlparser2";
import type { Pool } from "pg";

import { inTransaction, type DatabaseClient } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { appendAudit } from "../lib/audit.js";
import { sha256Bytes } from "../lib/hash.js";
import {
  claimIdempotency,
  completeIdempotency,
} from "../lib/idempotency.js";
import type { AuthContext } from "./auth.js";
import { profileRobotsAllows } from "./onboardingRobots.js";
import { fetchProfileResource } from "./onboardingPublicHttp.js";
import { createResourceCapture } from "./resourceIntake.js";

const PAGE_BYTE_LIMIT = 1_000_000;
const ROBOTS_BYTE_LIMIT = 200_000;
const PAGE_TEXT_LIMIT = 35_000;
const PREVIEW_TEXT_LIMIT = 600;
const FETCH_TIMEOUT_MS = 8_000;
const FRESHNESS_DAYS = 7;
const ALLOW_SYNTHETIC_DNS_GATEWAY =
  process.env.NODE_ENV !== "production" &&
  process.env
    .TALENT_SIGNAL_RESEARCH_ALLOW_SYNTHETIC_DNS_GATEWAY === "true";

interface ResearchSeed {
  resourceId: string;
  sourceUrl: string;
  displayName: string;
}

/**
 * Fixed content-free research failure diagnostics. Untrusted exception text
 * never enters task warnings, retrieval-job `last_error`, audit recovery
 * metadata, or any other durable field; the approved source URL provenance is
 * preserved alongside the fixed diagnostic.
 */
export const PUBLIC_RESEARCH_FETCH_FAILED = "PUBLIC_RESEARCH_FETCH_FAILED";
export const PUBLIC_RESEARCH_CAPTURE_FAILED = "PUBLIC_RESEARCH_CAPTURE_FAILED";
export const PUBLIC_RESEARCH_UNAVAILABLE = "PUBLIC_RESEARCH_UNAVAILABLE";
export const PUBLIC_RESEARCH_RETRY_FAILED = "PUBLIC_RESEARCH_RETRY_FAILED";

/**
 * Public warnings are bounded to 500 characters by contract. Keep the fixed
 * diagnostic complete and truncate only the approved source URL provenance so
 * a long valid URL can never overflow the durable warning.
 */
const PUBLIC_RESEARCH_WARNING_LIMIT = 500;

export function publicResearchWarning(
  approvedUrl: string,
  diagnostic: string,
): string {
  const suffix = `: ${diagnostic}`;
  return `${approvedUrl.slice(0, Math.max(0, PUBLIC_RESEARCH_WARNING_LIMIT - suffix.length))}${suffix}`;
}

export interface CrawledPage {
  canonicalUrl: string;
  contentHash: string;
  retrievedAt: Date;
  text: string;
  links: string[];
}

export type ResearchPageLoader = (
  url: URL,
  allowedHostname: string,
  options?: { timeoutMs?: number },
) => Promise<CrawledPage>;

export interface ResearchMutationResult {
  body: PublicResearchResponse;
  replayed: boolean;
  status: number;
}

/**
 * Recurring-cycle authority is durable and re-derived from the database at
 * every commit point. These hooks let one exact already-authorized public
 * source re-read itself on an honest cadence through the SAME bounded
 * research pipeline while the cycle's grant gate shares the actual database
 * transaction with each page capture commit and the final completion.
 */
/** The authoritative terminal outcome of one recurring cycle (B3). */
export interface RecurringCycleOutcome {
  status: "completed" | "partial" | "failed" | "skipped";
  /** Fixed content-free diagnostics merged into the research response. */
  warnings: string[];
}

export interface RecurringResearchCycleHooks {
  runId: string;
  /** Immutable absolute cycle boundary carried through this entry (B2). */
  boundary: { deadlineAt: Date };
  /** Immutable approval provenance frozen from the ORIGINAL owner grant. */
  approval: {
    approvedByUserId: string;
    approvedAt: Date;
    authorizationScope: string;
    grantId: string;
  };
  /**
   * Live re-admission (lease, deadline, authority) from the database. Called
   * after awaited reads and immediately before DNS, the research lease claim
   * and bounded transport (B2). Throws when the cycle may no longer run.
   */
  admit(client?: DatabaseClient): Promise<void>;
  /** Record the durable research task on the cycle row once claimed. */
  recordTask(taskId: string): Promise<void>;
  /**
   * Commit one crawled page inside ONE database transaction shared with the
   * recurring authority gate and lease check
   * (createResourceCaptureInTransaction). `unchanged` marks a cross-cycle
   * dedup skip; `stop` marks live authority ending the cycle before commit.
   */
  commitPage(
    page: CrawledPage,
    request: ResourceCaptureRequest,
  ): Promise<{
    committed: PublicResearchPage | null;
    unchanged: boolean;
    stop: boolean;
  }>;
  /**
   * Finalize the cycle INSIDE the research completion transaction and BEFORE
   * any research row mutation: re-derive live authority, record the honest run
   * outcome and RETURN it so the research task, idempotent readback, audit and
   * API result can never claim more than the cycle observed (B3).
   */
  finalize(
    client: DatabaseClient,
    input: {
      taskId: string;
      status: PublicResearchResponse["status"];
      committedPages: PublicResearchPage[];
      unchangedPages: number;
      warnings: string[];
    },
  ): Promise<RecurringCycleOutcome>;
}

export interface PublicResearchRunOptions {
  /** Durable job<->cycle round trip replacing closure-only authority. */
  recurringRunId?: string;
  recurring?: RecurringResearchCycleHooks;
  /** Test seam at the actual DNS entry; production keeps the pinned lookup. */
  hostnameLookup?: ResearchHostnameLookup;
}

function canonicalUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(
      422,
      "PUBLIC_RESEARCH_URL_INVALID",
      "The public research seed URL is invalid.",
    );
  }
  if (url.protocol !== "https:") {
    throw new ApiError(
      422,
      "PUBLIC_RESEARCH_HTTPS_REQUIRED",
      "Public research currently requires an HTTPS seed URL.",
    );
  }
  url.username = "";
  url.password = "";
  url.hash = "";
  return url;
}

/** Canonical form of one approved public URL (userinfo/fragment stripped). */
export function canonicalPublicResearchUrl(value: string): URL {
  return canonicalUrl(value);
}

function isPrivateIpv4(
  address: string,
  allowSyntheticGateway: boolean,
): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a = 0, b = 0] = parts;
  if (
    allowSyntheticGateway &&
    a === 198 &&
    (b === 18 || b === 19)
  ) {
    return false;
  }
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && parts[2] === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && parts[2] === 100) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8:")
  );
}

export function isBlockedResearchAddress(
  address: string,
  allowSyntheticGateway = false,
): boolean {
  const family = isIP(address);
  if (family === 4) {
    return isPrivateIpv4(address, allowSyntheticGateway);
  }
  if (family === 6) {
    return isPrivateIpv6(address);
  }
  return true;
}

export type ResearchHostnameLookup = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

async function assertPublicHostname(
  hostname: string,
  lookup: ResearchHostnameLookup = (name) =>
    dns.lookup(name, { all: true, verbatim: true }),
): Promise<void> {
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new ApiError(
      422,
      "PUBLIC_RESEARCH_HOST_BLOCKED",
      "Local and private hosts cannot be researched.",
    );
  }
  const directIp = isIP(hostname);
  const addresses =
    directIp === 0
      ? await lookup(hostname)
      : [{ address: hostname, family: directIp }];
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) =>
      isBlockedResearchAddress(
        address,
        ALLOW_SYNTHETIC_DNS_GATEWAY,
      ),
    )
  ) {
    throw new ApiError(
      422,
      "PUBLIC_RESEARCH_HOST_BLOCKED",
      "The research host resolves to a private or reserved address.",
    );
  }
}

async function responseBytes(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maximumBytes) {
    throw new Error("The public page exceeds the bounded research size.");
  }
  if (!response.body) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) {
      break;
    }
    total += chunk.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("The public page exceeds the bounded research size.");
    }
    chunks.push(chunk.value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function fetchBounded(
  input: URL,
  allowedHostname: string,
  maximumBytes: number,
): Promise<{ response: Response; finalUrl: URL; bytes: Uint8Array }> {
  let current = new URL(input);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    if (
      current.protocol !== "https:" ||
      current.hostname.toLowerCase() !== allowedHostname
    ) {
      throw new Error(
        "A public research redirect left the approved HTTPS domain.",
      );
    }
    await assertPublicHostname(current.hostname);
    const response = await fetch(current, {
      headers: {
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
        "user-agent": "TalentSignalResearchBot/0.1",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("The public research redirect has no location.");
      }
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) {
      throw new Error(`The public page returned HTTP ${response.status}.`);
    }
    return {
      response,
      finalUrl: current,
      bytes: await responseBytes(response, maximumBytes),
    };
  }
  throw new Error("The public research redirect limit was exceeded.");
}

function robotsAllows(robotsText: string, pathname: string): boolean {
  const lines = robotsText
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);
  let applies = false;
  const rules: Array<{ allow: boolean; path: string }> = [];
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      applies = value === "*";
      continue;
    }
    if (
      applies &&
      (field === "allow" || field === "disallow") &&
      value
    ) {
      rules.push({ allow: field === "allow", path: value });
    }
  }
  const matching = rules
    .filter((rule) => pathname.startsWith(rule.path))
    .sort((left, right) => right.path.length - left.path.length);
  return matching[0]?.allow ?? true;
}

async function assertRobotsAllowed(
  url: URL,
  allowedHostname: string,
): Promise<void> {
  const robotsUrl = new URL("/robots.txt", url.origin);
  try {
    const result = await fetchBounded(
      robotsUrl,
      allowedHostname,
      ROBOTS_BYTE_LIMIT,
    );
    if (
      !robotsAllows(
        new TextDecoder().decode(result.bytes),
        url.pathname || "/",
      )
    ) {
      throw new ApiError(
        422,
        "PUBLIC_RESEARCH_ROBOTS_DISALLOWED",
        "The approved public page is disallowed by robots.txt.",
      );
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    // A missing or unavailable robots file does not create permission to
    // broaden scope; the exact user-approved page remains the only fallback.
  }
}

export function extractResearchPage(
  canonical: URL,
  contentType: string,
  bytes: Uint8Array,
  allowedHostname: string,
): { text: string; links: string[] } {
  const decoded = new TextDecoder().decode(bytes);
  if (!contentType.includes("html") && !contentType.startsWith("text/plain")) {
    throw new Error("The public research page is not readable text or HTML.");
  }
  if (contentType.startsWith("text/plain")) {
    return {
      text: decoded.normalize("NFKC").trim().slice(0, PAGE_TEXT_LIMIT),
      links: [],
    };
  }
  const links = new Set<string>();
  const textParts: string[] = [];
  const ignoredTags = new Set(["noscript", "script", "style"]);
  const lineBreakTags = new Set([
    "article",
    "aside",
    "blockquote",
    "br",
    "div",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "li",
    "main",
    "nav",
    "p",
    "section",
    "table",
    "td",
    "th",
    "tr",
  ]);
  let ignoredDepth = 0;
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (ignoredTags.has(name)) {
          ignoredDepth += 1;
          return;
        }
        if (ignoredDepth > 0) {
          return;
        }
        if (name === "a" && attributes.href) {
          try {
            const link = new URL(attributes.href, canonical);
            link.hash = "";
            if (
              link.protocol === "https:" &&
              link.hostname.toLowerCase() === allowedHostname
            ) {
              links.add(link.toString());
            }
          } catch {
            // Ignore malformed page links while preserving the fetched page.
          }
        }
        if (lineBreakTags.has(name)) {
          textParts.push("\n");
        }
      },
      ontext(value) {
        if (ignoredDepth === 0) {
          textParts.push(value);
        }
      },
      onclosetag(name) {
        if (ignoredTags.has(name)) {
          ignoredDepth = Math.max(0, ignoredDepth - 1);
          return;
        }
        if (ignoredDepth === 0 && lineBreakTags.has(name)) {
          textParts.push("\n");
        }
      },
    },
    { decodeEntities: true },
  );
  parser.end(decoded);
  const text = textParts
    .join("")
    .normalize("NFKC")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, PAGE_TEXT_LIMIT);
  if (!text) {
    throw new Error("The public research page contained no readable text.");
  }
  return { text, links: [...links].sort() };
}

async function loadPublicResearchPage(
  url: URL,
  allowedHostname: string,
): Promise<CrawledPage> {
  await assertRobotsAllowed(url, allowedHostname);
  const result = await fetchBounded(
    url,
    allowedHostname,
    PAGE_BYTE_LIMIT,
  );
  const extracted = extractResearchPage(
    result.finalUrl,
    result.response.headers.get("content-type")?.toLowerCase() ??
      "application/octet-stream",
    result.bytes,
    allowedHostname,
  );
  return {
    canonicalUrl: result.finalUrl.toString(),
    contentHash: sha256Bytes(result.bytes),
    retrievedAt: new Date(),
    text: extracted.text,
    links: extracted.links,
  };
}

async function loadPublicProfilePage(
  url: URL,
  allowedHostname: string,
  options?: { timeoutMs?: number },
): Promise<CrawledPage> {
  // A caller with a smaller remaining cycle budget may only shorten the
  // existing per-fetch ceiling, never extend it.
  const signal = AbortSignal.timeout(
    Math.max(1, Math.min(12_000, options?.timeoutMs ?? 12_000)),
  );
  const robots = await fetchProfileResource(new URL("/robots.txt", url.origin), url.origin, ROBOTS_BYTE_LIMIT, signal);
  const robotsText = robots.status === 404 || robots.status === 410 ? "" : new TextDecoder().decode(robots.bytes);
  if (robots.status !== 404 && robots.status !== 410) {
    if (robots.status < 200 || robots.status >= 300) {
      throw new Error("The public page cannot be read under its robots policy.");
    }
  }
  const page = await fetchProfileResource(url, url.origin, PAGE_BYTE_LIMIT, signal, target => profileRobotsAllows(robotsText, target));
  if (page.status < 200 || page.status >= 300) throw new Error("The public page is unavailable.");
  const extracted = extractResearchPage(page.url, String(page.headers["content-type"] ?? ""), page.bytes, allowedHostname);
  return { canonicalUrl: page.url.toString(), contentHash: sha256Bytes(page.bytes), retrievedAt: new Date(), text: extracted.text, links: [] };
}

/**
 * The recurring-cycle page loader: DNS resolution is actually pinned at the
 * TLS socket through the existing bounded onboarding public HTTP primitive
 * (same-origin redirects, robots on every hop, byte/time limits), because the
 * one-shot research fetch only resolves once before an unpinned fetch.
 */
export async function loadPinnedPublicResearchPage(
  url: URL,
  allowedHostname: string,
  options?: { timeoutMs?: number },
): Promise<CrawledPage> {
  return loadPublicProfilePage(url, allowedHostname, options);
}

export interface PublicProfilePreview {
  profileUrl: string;
  excerpt: string;
  retrievedAt: Date;
}

/**
 * Load one user-supplied public profile page through a dedicated HTTPS client:
 * same-origin redirects, DNS-pinned sockets, robots checks on every hop,
 * one page at depth 0, and byte/time limits. Userinfo and
 * private/local/IP targets are rejected rather than rewritten. No page content
 * is persisted here; the caller only receives a short untrusted excerpt.
 */
export async function previewPublicProfilePage(
  input: string,
  loadPage: ResearchPageLoader = loadPublicProfilePage,
): Promise<PublicProfilePreview> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ApiError(
      422,
      "ONBOARDING_PREVIEW_URL_INVALID",
      "Enter a public HTTPS profile URL.",
    );
  }
  if (url.protocol !== "https:") {
    throw new ApiError(
      422,
      "ONBOARDING_PREVIEW_URL_INVALID",
      "Profile preview requires a public HTTPS URL.",
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new ApiError(
      422,
      "ONBOARDING_PREVIEW_URL_INVALID",
      "A profile URL must not contain credentials.",
    );
  }
  url.hash = "";
  const hostname = url.hostname.toLowerCase();
  if (
    isIP(hostname) !== 0 ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    !hostname.includes(".")
  ) {
    throw new ApiError(
      422,
      "ONBOARDING_PREVIEW_URL_INVALID",
      "The profile host must be a public domain, not a local or IP address.",
    );
  }

  let page: CrawledPage;
  try {
    page = await loadPage(url, hostname);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      422,
      "ONBOARDING_PREVIEW_UNAVAILABLE",
      "That profile page could not be read.",
    );
  }
  const excerpt = page.text
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PREVIEW_TEXT_LIMIT);
  if (excerpt.length === 0) {
    throw new ApiError(
      422,
      "ONBOARDING_PREVIEW_UNAVAILABLE",
      "That profile page contained no readable text.",
    );
  }
  return {
    profileUrl: page.canonicalUrl,
    excerpt,
    retrievedAt: page.retrievedAt,
  };
}

export async function crawlPublicResearch(
  seedUrl: URL,
  request: PublicResearchRequest,
  loadPage: ResearchPageLoader = loadPublicResearchPage,
): Promise<{ pages: CrawledPage[]; warnings: string[] }> {
  const allowedHostname =
    request.authorization.allowed_domain.toLowerCase();
  const queue = [{ url: seedUrl.toString(), depth: 0 }];
  const visited = new Set<string>();
  const pages: CrawledPage[] = [];
  const warnings: string[] = [];
  // One loop iteration owns one distinct approved page attempt. The attempt is
  // reserved and consumed before loader dispatch — including when it fails —
  // so a failing page tree can never exceed the approved maximum_page_count
  // per-invocation bound and a consumed attempt is never refunded.
  let attempts = 0;

  while (
    queue.length > 0 &&
    attempts < request.authorization.maximum_page_count
  ) {
    const next = queue.shift();
    if (!next || visited.has(next.url)) {
      continue;
    }
    visited.add(next.url);
    attempts += 1;
    try {
      const url = canonicalUrl(next.url);
      if (url.hostname.toLowerCase() !== allowedHostname) {
        throw new Error(
          "A discovered public research page left the approved domain.",
        );
      }
      const page = await loadPage(url, allowedHostname);
      pages.push(page);
      if (next.depth < request.authorization.maximum_link_depth) {
        for (const link of page.links) {
          if (!visited.has(link)) {
            queue.push({ url: link, depth: next.depth + 1 });
          }
        }
      }
    } catch {
      // Fixed content-free diagnostic: the raw exception never becomes a
      // durable warning; the approved page URL keeps the provenance, bounded
      // so the warning always fits the public schema.
      warnings.push(publicResearchWarning(next.url, PUBLIC_RESEARCH_FETCH_FAILED));
    }
  }
  return { pages, warnings };
}

async function loadSeed(
  pool: Pool,
  auth: AuthContext,
  request: PublicResearchRequest,
): Promise<ResearchSeed> {
  const result = await pool.query<{
    id: string;
    source_locator: string | null;
    display_name: string;
  }>(
    `SELECT
       resources.id,
       resources.source_locator,
       resources.display_name
     FROM source_resources resources
     JOIN captures
       ON captures.account_id = resources.account_id
      AND captures.id = resources.capture_id
     JOIN source_retention_receipts receipts
       ON receipts.account_id = captures.account_id
      AND receipts.capture_id = captures.id
     WHERE resources.account_id = $1
       AND resources.id = $2
       AND resources.resource_kind = 'public_url'
       AND resources.processing_state <> 'deleted'
       AND captures.status = 'active'
       AND captures.identity_status = 'bound'
       AND receipts.authorization_state = 'authorized'
       AND (
         receipts.authorization_expires_at IS NULL
         OR receipts.authorization_expires_at > now()
       )
       AND captures.subject_id = $3
       AND captures.assignment_id = $4`,
    [
      auth.accountId,
      request.seed_resource_id,
      request.person_id,
      request.relationship_context_id,
    ],
  );
  const seed = result.rows[0];
  if (!seed?.source_locator) {
    throw new ApiError(
      404,
      "PUBLIC_RESEARCH_SEED_NOT_FOUND",
      "The active public URL seed was not found in this relationship.",
    );
  }
  return {
    resourceId: seed.id,
    sourceUrl: seed.source_locator,
    displayName: seed.display_name,
  };
}

async function loadCommittedResearchPage(
  pool: Pool,
  accountId: string,
  taskId: string,
  pageIndex: number,
): Promise<PublicResearchPage | null> {
  const result = await pool.query<{
    canonical_url: string;
    resource_id: string;
    capture_id: string;
    content_hash: string | null;
    retrieved_at: Date;
  }>(
    `SELECT
       resources.source_locator AS canonical_url,
       resources.id AS resource_id,
       resources.capture_id,
       resources.content_hash,
       resources.observed_at AS retrieved_at
     FROM source_resources resources
     JOIN captures
       ON captures.account_id = resources.account_id
      AND captures.id = resources.capture_id
     WHERE resources.account_id = $1
       AND resources.client_resource_id = $2
       AND resources.input_channel = 'api_connector'
       AND resources.processing_state <> 'deleted'
       AND captures.status = 'active'
     LIMIT 1`,
    [accountId, `research:${taskId}:${pageIndex}`],
  );
  const page = result.rows[0];
  if (!page?.canonical_url || !page.content_hash) {
    return null;
  }
  return {
    canonical_url: page.canonical_url,
    resource_id: page.resource_id,
    capture_id: page.capture_id,
    content_hash: page.content_hash,
    retrieved_at: page.retrieved_at.toISOString(),
  };
}

export async function getLatestPublicResearchTask(
  pool: Pool,
  auth: AuthContext,
  seedResourceId: string,
): Promise<PublicResearchResponse | null> {
  const result = await pool.query<{
    response_body: PublicResearchResponse;
  }>(
    `SELECT idempotency.response_body
     FROM research_retrieval_jobs jobs
     JOIN research_tasks tasks
       ON tasks.account_id = jobs.account_id
      AND tasks.id = jobs.task_id
     JOIN idempotency_records idempotency
       ON idempotency.account_id = jobs.account_id
      AND idempotency.id = jobs.idempotency_record_id
      AND idempotency.status = 'completed'
     JOIN source_resources seeds
       ON seeds.account_id = tasks.account_id
      AND seeds.id = tasks.seed_resource_id
     JOIN captures
       ON captures.account_id = seeds.account_id
      AND captures.id = seeds.capture_id
     JOIN source_retention_receipts receipts
       ON receipts.account_id = captures.account_id
      AND receipts.capture_id = captures.id
     WHERE jobs.account_id = $1
       AND tasks.seed_resource_id = $2
       AND jobs.recurring_run_id IS NULL
       AND seeds.processing_state <> 'deleted'
       AND captures.status = 'active'
       AND receipts.authorization_state = 'authorized'
       AND (
         receipts.authorization_expires_at IS NULL
         OR receipts.authorization_expires_at > now()
       )
     ORDER BY jobs.created_at DESC, jobs.id DESC
     LIMIT 1`,
    [auth.accountId, seedResourceId],
  );
  return result.rows[0]?.response_body ?? null;
}

async function admitRecurringCycle(
  recurring: RecurringResearchCycleHooks,
  client?: DatabaseClient,
): Promise<void> {
  // Both sides of awaited admission must remain inside the same immutable
  // boundary: an authority read can wait beyond the deadline itself.
  if (Date.now() >= recurring.boundary.deadlineAt.valueOf()) {
    throw new ApiError(
      409,
      "PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED",
      "The periodic cycle deadline elapsed before research continued.",
    );
  }
  await recurring.admit(client);
  if (Date.now() >= recurring.boundary.deadlineAt.valueOf()) {
    throw new ApiError(409, "PERSON_SOURCE_SYNC_DEADLINE_EXCEEDED",
      "The periodic cycle deadline elapsed while research authority was checked.");
  }
}

/** Maps the authoritative cycle outcome into the existing response schema. */
export function mapRecurringCycleOutcome(
  outcome: RecurringCycleOutcome["status"],
  hasCommittedPages: boolean,
): PublicResearchResponse["status"] {
  if (outcome === "skipped") return hasCommittedPages ? "partial" : "failed";
  return outcome;
}

export async function runPublicResearch(
  pool: Pool,
  auth: AuthContext,
  request: PublicResearchRequest,
  loadPage: ResearchPageLoader = loadPublicResearchPage,
  options: PublicResearchRunOptions = {},
): Promise<ResearchMutationResult> {
  const recurring = options.recurring;
  const seed = await loadSeed(pool, auth, request);
  if (recurring) {
    // B2: re-admit after the awaited seed read, immediately before DNS.
    await admitRecurringCycle(recurring);
  }
  const seedUrl = canonicalUrl(seed.sourceUrl);
  const expectedUrl = canonicalUrl(request.expected_seed_url);
  const allowedHostname =
    request.authorization.allowed_domain.toLowerCase();
  if (
    seedUrl.toString() !== expectedUrl.toString() ||
    seedUrl.hostname.toLowerCase() !== allowedHostname
  ) {
    throw new ApiError(
      409,
      "PUBLIC_RESEARCH_SCOPE_CHANGED",
      "The seed URL or approved domain changed before research began.",
    );
  }
  await assertPublicHostname(allowedHostname, options.hostnameLookup);
  if (recurring) {
    // B2: re-admit after the awaited DNS lookup, immediately before the
    // research lease claim below.
    await admitRecurringCycle(recurring);
  }

  const proposedTaskId = randomUUID();
  const executionId = `public-research-worker:${randomUUID()}`;
  const createdAt = new Date();
  const leaseExpiresAt = new Date(createdAt.getTime() + 5 * 60_000);
  // A recurring cycle stamps the ORIGINAL human grant (actor + authorization
  // revision + time) instead of a fabricated per-cycle approval.
  const authorizationScope =
    recurring?.approval.authorizationScope ??
    `Public HTTPS research approved by the user for ${allowedHostname}; ` +
    `maximum ${request.authorization.maximum_page_count} pages and link depth ` +
    `${request.authorization.maximum_link_depth}.`;
  const approvedByUserId =
    recurring?.approval.approvedByUserId ?? auth.userId;
  const approvedAt = recurring?.approval.approvedAt ?? createdAt;
  const initial = await inTransaction(pool, async (client) => {
    if (recurring) await admitRecurringCycle(recurring, client);
    const claim = await claimIdempotency(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "run_public_research",
      request.idempotency_key,
      request,
    );
    if (claim.replay) {
      const replay = claim.replay.body as PublicResearchResponse;
      if (recurring) await admitRecurringCycle(recurring, client);
      const leased = await client.query<{ id: string }>(
        `UPDATE research_retrieval_jobs
         SET status = 'running',
             attempt_count = attempt_count + 1,
             lease_owner = $3,
             lease_expires_at = $4,
             last_error = NULL,
             updated_at = $2
         WHERE account_id = $1
           AND task_id = $5
           AND (
             (
               status IN ('pending', 'retry')
               AND available_at <= $2
             )
             OR (
               status = 'running'
               AND lease_expires_at <= $2
             )
           )
         RETURNING id`,
        [
          auth.accountId,
          createdAt,
          executionId,
          leaseExpiresAt,
          replay.task_id,
        ],
      );
      if (recurring) await admitRecurringCycle(recurring, client);
      return {
        claimId: claim.id,
        replay: {
          body: replay,
          status: claim.replay.status,
        },
        taskId: replay.task_id,
        taskCreatedAt: new Date(replay.created_at),
        leaseAcquired: leased.rows.length === 1,
      };
    }
    if (recurring) await admitRecurringCycle(recurring, client);
    await client.query(
      `INSERT INTO research_tasks(
         id, account_id, subject_id, assignment_id, created_by_user_id,
         seed_resource_id, purpose, seed_urls, allowed_domains, maximum_link_depth,
         maximum_page_count, freshness_horizon, authorization_scope,
         status, approved_by_user_id, approved_at, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
         interval '7 days', $12, 'running', $14, $15, $13, $13
       )`,
      [
        proposedTaskId,
        auth.accountId,
        request.person_id,
        request.relationship_context_id,
        auth.userId,
        seed.resourceId,
        request.purpose,
        JSON.stringify([seedUrl.toString()]),
        JSON.stringify([allowedHostname]),
        request.authorization.maximum_link_depth,
        request.authorization.maximum_page_count,
        authorizationScope,
        createdAt,
        approvedByUserId,
        approvedAt,
      ],
    );
    const running: PublicResearchResponse = {
      contract_version: CONTRACT_VERSION,
      task_id: proposedTaskId,
      seed_resource_id: seed.resourceId,
      status: "running",
      authorization_scope: authorizationScope,
      pages: [],
      warnings: [],
      created_at: createdAt.toISOString(),
      completed_at: null,
    };
    await client.query(
      `INSERT INTO research_retrieval_jobs(
         id, account_id, task_id, idempotency_record_id,
         requested_by_user_id, request_body, status, attempt_count,
         lease_owner, lease_expires_at, recurring_run_id, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, 'running', 1, $7, $8, $10, $9, $9
       )`,
      [
        randomUUID(),
        auth.accountId,
        proposedTaskId,
        claim.id,
        auth.userId,
        request,
        executionId,
        leaseExpiresAt,
        createdAt,
        options.recurringRunId ?? null,
      ],
    );
    await appendAudit(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      recurring
        ? "person_source_sync.dispatched_from_grant"
        : "public_research.approved",
      "research_task",
      proposedTaskId,
      {
        seed_resource_id: seed.resourceId,
        allowed_domain: allowedHostname,
        maximum_page_count:
          request.authorization.maximum_page_count,
        maximum_link_depth:
          request.authorization.maximum_link_depth,
        ...(recurring
          ? {
              grant_id: recurring.approval.grantId,
              recurring_run_id: recurring.runId,
              external_effect: "none",
            }
          : {}),
      },
    );
    await completeIdempotency(client, claim, 202, running);
    // Lock waits or any receipt await may have crossed the boundary. Refuse
    // the transaction so no newly acquired research lease escapes COMMIT.
    if (recurring) await admitRecurringCycle(recurring, client);
    return {
      claimId: claim.id,
      replay: null,
      taskId: proposedTaskId,
      taskCreatedAt: createdAt,
      leaseAcquired: true,
    };
  });
  if (initial.replay && !initial.leaseAcquired) {
    return {
      body: initial.replay.body,
      replayed: true,
      status: initial.replay.status,
    };
  }
  const taskId = initial.taskId;
  const taskCreatedAt = initial.taskCreatedAt;
  if (recurring) {
    await recurring.recordTask(taskId);
  }

  const crawled = await crawlPublicResearch(seedUrl, request, loadPage);
  const committedPages: PublicResearchPage[] = [];
  let unchangedPages = 0;
  for (const [index, page] of crawled.pages.entries()) {
    try {
      const clientResourceId = `research:${taskId}:${index}`;
      const existing = await loadCommittedResearchPage(
        pool,
        auth.accountId,
        taskId,
        index,
      );
      if (existing) {
        if (existing.canonical_url !== page.canonicalUrl) {
          throw new Error(
            "A recovered page position now refers to a different canonical URL.",
          );
        }
        committedPages.push(existing);
        continue;
      }
      const resourceRequest: ResourceCaptureRequest = {
        contract_version: CONTRACT_VERSION,
        idempotency_key: `research:${taskId}:${index}`,
        channel: "api_connector",
        purpose: request.purpose,
        captured_at: page.retrievedAt.toISOString(),
        source_timezone: "UTC",
        person_scope: {
          status: "confirmed",
          person_id: request.person_id,
          relationship_context: {
            status: "existing",
            relationship_context_id:
              request.relationship_context_id,
          },
          binding_basis: recurring
            ? "The owner's expiring periodic observation grant approved re-reading this already-bound public URL."
            : "The authenticated user explicitly approved this bounded public research task.",
        },
        resource: {
          client_resource_id: clientResourceId,
          kind: "public_url",
          display_name: `Research snapshot · ${new URL(page.canonicalUrl).hostname}`,
          media_type: "text/html",
          observed_at: page.retrievedAt.toISOString(),
          source_timezone: "UTC",
          content_hash: page.contentHash,
          source_locator: page.canonicalUrl,
          discovered_from_resource_id: seed.resourceId,
          discovered_from_client_resource_id:
            "approved-research-seed",
          retention: {
            requested_mode: "ephemeral",
            source_scope: "reviewed_extracted_text",
          },
        },
        fragments: [
          {
            client_resource_id: clientResourceId,
            kind: "url_excerpt",
            sequence: 0,
            text: page.text,
            locator: {
              kind: "url_excerpt",
              canonical_url: page.canonicalUrl,
              retrieved_at: page.retrievedAt.toISOString(),
              start_character: 0,
              end_character: page.text.length,
            },
            attribution: {
              actor_kind: "public_source",
              status: "confirmed",
            },
            review_status: "proposed",
            parser: {
              name: "bounded-public-research",
              version: "1.0.0",
            },
          },
        ],
      };
      const committed = recurring
        ? await (async () => {
            // The gate, the cycle lease check and this capture commit share ONE
            // database transaction; a pause/revoke can never commit new
            // evidence, and an unchanged body creates no duplicate capture.
            const outcome = await recurring.commitPage(page, resourceRequest);
            if (outcome.stop) return "stop" as const;
            if (outcome.unchanged) return "unchanged" as const;
            return outcome.committed;
          })()
        : await createResourceCapture(pool, auth, resourceRequest).then(
            (result) => ({
              canonical_url: page.canonicalUrl,
              resource_id: result.body.resource.id,
              capture_id: result.body.capture_id,
              content_hash: page.contentHash,
              retrieved_at: page.retrievedAt.toISOString(),
            }),
          );
      if (committed === "stop") break;
      if (committed === "unchanged") {
        unchangedPages += 1;
        continue;
      }
      if (committed === null) {
        crawled.warnings.push(
          publicResearchWarning(page.canonicalUrl, PUBLIC_RESEARCH_CAPTURE_FAILED),
        );
        continue;
      }
      committedPages.push(committed);
    } catch {
      // Fixed content-free diagnostic: the raw capture exception never becomes
      // a durable warning; the approved page URL keeps the provenance, bounded
      // so the warning always fits the public schema.
      crawled.warnings.push(
        publicResearchWarning(page.canonicalUrl, PUBLIC_RESEARCH_CAPTURE_FAILED),
      );
    }
  }

  const completedAt = new Date();
  const observedAnything = recurring
    ? committedPages.length > 0 || unchangedPages > 0
    : committedPages.length > 0;
  const baseStatus: PublicResearchResponse["status"] =
    !observedAnything
      ? "failed"
      : crawled.warnings.length > 0
        ? "partial"
        : "completed";
  const baseBody: PublicResearchResponse = {
    contract_version: CONTRACT_VERSION,
    task_id: taskId,
    seed_resource_id: seed.resourceId,
    status: baseStatus,
    authorization_scope: authorizationScope,
    pages: committedPages,
    warnings: crawled.warnings,
    created_at: taskCreatedAt.toISOString(),
    completed_at: completedAt.toISOString(),
  };
  // B3: the recurring finalize hook's authoritative outcome governs every
  // receipt below; nothing may claim more than the cycle actually observed.
  let finalStatus: PublicResearchResponse["status"] = baseStatus;
  let body: PublicResearchResponse = baseBody;
  await inTransaction(pool, async (client) => {
    if (recurring) {
      // The cycle's live authority gate and honest outcome share this exact
      // completion transaction, and the recurring hook runs FIRST: its frozen
      // ROOT→seed→grant→run→research lock order can never invert against
      // DB-only reconciliation. No closure-only authority.
      const outcome = await recurring.finalize(client, {
        taskId,
        status: baseStatus,
        committedPages,
        unchangedPages,
        warnings: crawled.warnings,
      });
      finalStatus = mapRecurringCycleOutcome(
        outcome.status,
        committedPages.length > 0,
      );
      body = {
        ...baseBody,
        status: finalStatus,
        warnings: [...new Set([...crawled.warnings, ...outcome.warnings])],
      };
    }
    for (const page of committedPages) {
      const freshnessUntil = new Date(
        new Date(page.retrieved_at).getTime() +
          FRESHNESS_DAYS * 24 * 60 * 60 * 1_000,
      );
      await client.query(
        `INSERT INTO research_snapshots(
           id, account_id, task_id, resource_id, canonical_url,
           content_hash, retrieved_at, freshness_until, status
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
         ON CONFLICT (
           account_id, task_id, canonical_url, content_hash
         )
         DO NOTHING`,
        [
          randomUUID(),
          auth.accountId,
          taskId,
          page.resource_id,
          page.canonical_url,
          page.content_hash,
          page.retrieved_at,
          freshnessUntil,
        ],
      );
    }
    await client.query(
      `UPDATE research_tasks
       SET status = $3,
           updated_at = $4
       WHERE account_id = $1 AND id = $2`,
      [auth.accountId, taskId, finalStatus, completedAt],
    );
    await client.query(
      `UPDATE idempotency_records
       SET response_status = 201,
           response_body = $3,
           completed_at = $4
       WHERE account_id = $1 AND id = $2`,
      [auth.accountId, initial.claimId, body, completedAt],
    );
    const completedJob = await client.query<{ id: string }>(
      `UPDATE research_retrieval_jobs
       SET status = 'completed',
           lease_owner = NULL,
           lease_expires_at = NULL,
           last_error = NULL,
           updated_at = $4,
           completed_at = $4
       WHERE account_id = $1
         AND task_id = $2
         AND status = 'running'
         AND lease_owner = $3
       RETURNING id`,
      [
        auth.accountId,
        taskId,
        executionId,
        completedAt,
      ],
    );
    if (!completedJob.rows[0]) {
      throw new ApiError(
        409,
        "PUBLIC_RESEARCH_LEASE_LOST",
        "The bounded research worker lease changed before completion.",
      );
    }
    await appendAudit(
      client,
      { accountId: auth.accountId, actorUserId: null },
      recurring
        ? "person_source_sync.cycle_settled"
        : "public_research.completed",
      "research_task",
      taskId,
      {
        status: finalStatus,
        page_count: committedPages.length,
        warning_count: body.warnings.length,
        ...(recurring
          ? { recurring_run_id: recurring.runId, external_effect: "none" }
          : {}),
      },
    );
  });
  return {
    body,
    replayed: initial.replay !== null,
    status: 201,
  };
}

interface ResearchRetrievalJob {
  id: string;
  account_id: string;
  account_slug: string;
  task_id: string;
  idempotency_record_id: string;
  requested_by_user_id: string;
  user_email: string;
  request_body: PublicResearchRequest;
  seed_resource_id: string;
  authorization_scope: string;
  task_created_at: Date;
}

export interface ResearchRetrievalWorkerResult {
  claimed: number;
  completed: number;
  retried: number;
}

async function nextRecoverableResearchJob(
  pool: Pool,
  now: Date,
): Promise<ResearchRetrievalJob | null> {
  const result = await pool.query<ResearchRetrievalJob>(
    `SELECT
       jobs.id,
       jobs.account_id,
       accounts.slug AS account_slug,
       jobs.task_id,
       jobs.idempotency_record_id,
       jobs.requested_by_user_id,
       users.email AS user_email,
       jobs.request_body,
       tasks.seed_resource_id,
       tasks.authorization_scope,
       tasks.created_at AS task_created_at
     FROM research_retrieval_jobs jobs
     JOIN research_tasks tasks
       ON tasks.account_id = jobs.account_id
      AND tasks.id = jobs.task_id
     JOIN accounts
       ON accounts.id = jobs.account_id
     JOIN users
       ON users.account_id = jobs.account_id
      AND users.id = jobs.requested_by_user_id
     WHERE jobs.recurring_run_id IS NULL
       AND (
         (
           jobs.status IN ('pending', 'retry')
           AND jobs.available_at <= $1
         )
         OR (
           jobs.status = 'running'
           AND jobs.lease_expires_at <= $1
         )
       )
     ORDER BY
       CASE WHEN jobs.status = 'running' THEN 0 ELSE 1 END,
       COALESCE(jobs.lease_expires_at, jobs.available_at),
       jobs.created_at,
       jobs.id
     LIMIT 1`,
    [now],
  );
  return result.rows[0] ?? null;
}

async function completeUnavailableResearchJob(
  pool: Pool,
  job: ResearchRetrievalJob,
  message: string,
  completedAt: Date,
): Promise<boolean> {
  return inTransaction(pool, async (client) => {
    const current = await client.query<{ status: string }>(
      `SELECT status
       FROM research_retrieval_jobs
       WHERE account_id = $1 AND id = $2
       FOR UPDATE`,
      [job.account_id, job.id],
    );
    if (!current.rows[0] || current.rows[0].status === "completed") {
      return false;
    }
    const body: PublicResearchResponse = {
      contract_version: CONTRACT_VERSION,
      task_id: job.task_id,
      seed_resource_id: job.seed_resource_id,
      status: "failed",
      authorization_scope: job.authorization_scope,
      pages: [],
      warnings: [message.slice(0, 500)],
      created_at: job.task_created_at.toISOString(),
      completed_at: completedAt.toISOString(),
    };
    await client.query(
      `UPDATE research_tasks
       SET status = 'failed',
           updated_at = $3
       WHERE account_id = $1 AND id = $2`,
      [job.account_id, job.task_id, completedAt],
    );
    await client.query(
      `UPDATE idempotency_records
       SET status = 'completed',
           response_status = 201,
           response_body = $3,
           completed_at = $4
       WHERE account_id = $1 AND id = $2`,
      [
        job.account_id,
        job.idempotency_record_id,
        body,
        completedAt,
      ],
    );
    await client.query(
      `UPDATE research_retrieval_jobs
       SET status = 'completed',
           lease_owner = NULL,
           lease_expires_at = NULL,
           last_error = $3,
           updated_at = $4,
           completed_at = $4
       WHERE account_id = $1 AND id = $2`,
      [
        job.account_id,
        job.id,
        message.slice(0, 500),
        completedAt,
      ],
    );
    await appendAudit(
      client,
      { accountId: job.account_id, actorUserId: null },
      "public_research.completed",
      "research_task",
      job.task_id,
      {
        status: "failed",
        page_count: 0,
        warning_count: 1,
        recovery_reason: message.slice(0, 500),
      },
    );
    return true;
  });
}

async function recordResearchRetry(
  pool: Pool,
  job: ResearchRetrievalJob,
  message: string,
  now: Date,
): Promise<void> {
  await pool.query(
    `UPDATE research_retrieval_jobs
     SET status = 'retry',
         available_at = $3 + make_interval(
           secs => LEAST(
             3600,
             5 * power(2, LEAST(attempt_count, 9))::integer
           )
         ),
         lease_owner = NULL,
         lease_expires_at = NULL,
         last_error = $4,
         updated_at = $3
     WHERE account_id = $1
       AND id = $2
       AND (
         status IN ('pending', 'retry')
         OR (
           status = 'running'
           AND lease_expires_at <= $3
         )
       )`,
    [job.account_id, job.id, now, message.slice(0, 500)],
  );
}

export async function runPendingPublicResearchJobs(
  pool: Pool,
  options: {
    now?: Date;
    limit?: number;
  } = {},
): Promise<ResearchRetrievalWorkerResult> {
  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  const result: ResearchRetrievalWorkerResult = {
    claimed: 0,
    completed: 0,
    retried: 0,
  };
  for (let index = 0; index < limit; index += 1) {
    const now = options.now ?? new Date();
    const job = await nextRecoverableResearchJob(pool, now);
    if (!job) {
      break;
    }
    const auth: AuthContext = {
      accountId: job.account_id,
      accountSlug: job.account_slug,
      userId: job.requested_by_user_id,
      userEmail: job.user_email,
      userKind: "simulated_human",
      sessionId: "system:public-research-recovery-worker",
    };
    try {
      const recovered = await runPublicResearch(
        pool,
        auth,
        job.request_body,
      );
      if (recovered.status !== 201) {
        break;
      }
      result.claimed += 1;
      result.completed += 1;
    } catch (error) {
      if (error instanceof ApiError && error.statusCode < 500) {
        const completed = await completeUnavailableResearchJob(
          pool,
          job,
          PUBLIC_RESEARCH_UNAVAILABLE,
          new Date(),
        );
        if (completed) {
          result.claimed += 1;
          result.completed += 1;
        }
        continue;
      }
      await recordResearchRetry(
        pool,
        job,
        PUBLIC_RESEARCH_RETRY_FAILED,
        now,
      );
      result.retried += 1;
    }
  }
  return result;
}
