import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import { isIP } from "node:net";

import {
  publicResearchDomainAllowed,
  type AgentFetchedWebPage,
  type AgentPublicResearchScope,
  type AgentWebSearchResult,
} from "@talent-signal/agent";

import { withAbort } from "./abortable.js";
import { AgentSafeWebFetchError, isBlockedWebAddress } from "./safeWebFetch.js";

// Official v2 request/response contract:
// https://docs.firecrawl.dev/api-reference/endpoint/scrape
const FIRECRAWL_SCRAPE_URL = "https://api.firecrawl.dev/v2/scrape";
const FIRECRAWL_TIMEOUT_MS = 60_000;
const RESPONSE_BYTE_LIMIT = 1_000_000;
const MARKDOWN_CHARACTER_LIMIT = 35_000;

type HostLookup = typeof dns.lookup;

export interface FirecrawlWebFetchOptions {
  apiKey: string;
  zeroDataRetention?: boolean;
  fetcher?: typeof fetch;
  lookup?: HostLookup;
  now?: () => Date;
}

interface FirecrawlScrapeResponse {
  success?: unknown;
  error?: unknown;
  data?: {
    markdown?: unknown;
    metadata?: {
      title?: unknown;
      sourceURL?: unknown;
      url?: unknown;
      statusCode?: unknown;
      error?: unknown;
    };
  };
}

async function readBoundedResponse(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > RESPONSE_BYTE_LIMIT) {
    throw new AgentSafeWebFetchError(
      "WEB_FETCH_PROVIDER_RESPONSE_TOO_LARGE",
      "The Firecrawl response exceeded the bounded response size.",
    );
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > RESPONSE_BYTE_LIMIT) {
      await reader.cancel();
      throw new AgentSafeWebFetchError(
        "WEB_FETCH_PROVIDER_RESPONSE_TOO_LARGE",
        "The Firecrawl response exceeded the bounded response size.",
      );
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}

function providerError(status: number, detail: string): AgentSafeWebFetchError {
  if (status === 401 || status === 403) {
    return new AgentSafeWebFetchError(
      "WEB_FETCH_PROVIDER_AUTH_FAILED",
      "Firecrawl rejected the Agent Host credential.",
    );
  }
  if (status === 402) {
    return new AgentSafeWebFetchError(
      "WEB_FETCH_PROVIDER_PAYMENT_REQUIRED",
      "Firecrawl cannot serve this request under the current provider plan.",
    );
  }
  if (status === 429) {
    return new AgentSafeWebFetchError(
      "WEB_FETCH_PROVIDER_RATE_LIMITED",
      "Firecrawl rate-limited the bounded fetch request.",
    );
  }
  return new AgentSafeWebFetchError(
    "WEB_FETCH_PROVIDER_FAILED",
    `Firecrawl could not complete the bounded fetch${detail ? `: ${detail}` : "."}`,
  );
}

async function assertAuthorizedPublicUrl(
  rawUrl: string,
  scope: AgentPublicResearchScope,
  signal: AbortSignal,
  lookup: HostLookup,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AgentSafeWebFetchError(
      "WEB_FETCH_DOMAIN_OUT_OF_SCOPE",
      "The discovered page is not an authorized public HTTPS URL.",
    );
  }
  if (
    rawUrl.length > 2_000 ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.endsWith(".local") ||
    !publicResearchDomainAllowed(url.hostname, scope.authorization)
  ) {
    throw new AgentSafeWebFetchError(
      "WEB_FETCH_DOMAIN_OUT_OF_SCOPE",
      "The discovered page is outside the explicit research authorization.",
    );
  }
  signal.throwIfAborted();
  try {
    const directIp = isIP(url.hostname);
    const addresses = directIp
      ? [{ address: url.hostname }]
      : await withAbort(signal, () =>
          lookup(url.hostname, { all: true, verbatim: true }),
        );
    if (
      addresses.length === 0 ||
      addresses.some(({ address }) => isBlockedWebAddress(address))
    ) {
      throw new AgentSafeWebFetchError(
        "WEB_FETCH_HOST_BLOCKED",
        "The discovered page resolves to a private or reserved address.",
      );
    }
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof AgentSafeWebFetchError) throw error;
    throw new AgentSafeWebFetchError(
      "WEB_FETCH_DNS_FAILED",
      "The discovered public host could not be resolved safely.",
    );
  }
  signal.throwIfAborted();
  url.hash = "";
  return url;
}

/**
 * The official Firecrawl source scraper reports the requested original URL in
 * `metadata.sourceURL` and the engine's actual final URL in `metadata.url`.
 * Both are validated independently against the exact authorized discovered
 * URL; the fetched evidence is only trustworthy when the origin Firecrawl was
 * asked for and the final address it returned agree with that authorization.
 * A missing or substituted final URL is never backfilled from sourceURL.
 */
function parseProviderUrl(
  raw: unknown,
  requested: URL,
  kind: "source" | "final",
): URL {
  if (typeof raw !== "string") {
    throw new AgentSafeWebFetchError(
      "WEB_FETCH_PROVIDER_RESPONSE_INVALID",
      kind === "final"
        ? "Firecrawl did not return the fetched final URL."
        : "Firecrawl did not return the fetched source URL.",
    );
  }
  let providerUrl: URL;
  try {
    providerUrl = new URL(raw);
  } catch {
    throw new AgentSafeWebFetchError(
      "WEB_FETCH_PROVIDER_RESPONSE_INVALID",
      kind === "final"
        ? "Firecrawl returned an invalid final URL."
        : "Firecrawl returned an invalid source URL.",
    );
  }
  if (
    providerUrl.protocol !== "https:" ||
    providerUrl.username ||
    providerUrl.password ||
    providerUrl.port ||
    providerUrl.toString() !== requested.toString()
  ) {
    throw new AgentSafeWebFetchError(
      "WEB_FETCH_SOURCE_MISMATCH",
      "Firecrawl returned content for a URL other than the exact discovered source.",
    );
  }
  providerUrl.hash = "";
  return providerUrl;
}

export function createFirecrawlWebFetch(
  options: FirecrawlWebFetchOptions,
): (
  scope: AgentPublicResearchScope,
  result: AgentWebSearchResult,
  signal: AbortSignal,
) => Promise<Omit<AgentFetchedWebPage, "resultID">> {
  const apiKey = options.apiKey.trim();
  const zeroDataRetention = options.zeroDataRetention === true;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is required by the local Agent host.");
  const fetcher = options.fetcher ?? fetch;
  const lookup = options.lookup ?? dns.lookup;
  const now = options.now ?? (() => new Date());

  return async (scope, result, signal) => {
    if (result.providerID !== scope.providerID) {
      throw new AgentSafeWebFetchError(
        "WEB_FETCH_PROVIDER_MISMATCH",
        "The discovered page belongs to a different search provider.",
      );
    }
    const timeout = AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS);
    const boundedSignal = AbortSignal.any([signal, timeout]);
    let requested: URL;
    try {
      requested = await assertAuthorizedPublicUrl(
        result.url,
        scope,
        boundedSignal,
        lookup,
      );
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (timeout.aborted) {
        throw new AgentSafeWebFetchError(
          "WEB_FETCH_PROVIDER_TIMEOUT",
          "The bounded Firecrawl fetch timed out before provider dispatch.",
        );
      }
      throw error;
    }
    let response: Response;
    try {
      const headers: Record<string, string> = {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      };
      response = await fetcher(FIRECRAWL_SCRAPE_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          // Firecrawl documents main-content Markdown, PDF parsing, caching,
          // and zero-data-retention on the v2 scrape endpoint above.
          url: requested.toString(),
          formats: ["markdown"],
          onlyMainContent: true,
          timeout: FIRECRAWL_TIMEOUT_MS,
          parsers: ["pdf"],
          storeInCache: false,
          ...(zeroDataRetention ? { zeroDataRetention: true } : {}),
        }),
        signal: boundedSignal,
      });
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (timeout.aborted) {
        throw new AgentSafeWebFetchError(
          "WEB_FETCH_PROVIDER_TIMEOUT",
          "Firecrawl exceeded the bounded fetch timeout.",
        );
      }
      throw new AgentSafeWebFetchError(
        "WEB_FETCH_UNAVAILABLE",
        // Fixed operation message: an untyped transport exception message is
        // untrusted and never enters a typed fetch error or model context.
        "Firecrawl could not be reached.",
      );
    }

    const raw = await readBoundedResponse(response);
    let payload: FirecrawlScrapeResponse;
    try {
      payload = JSON.parse(raw) as FirecrawlScrapeResponse;
    } catch {
      throw new AgentSafeWebFetchError(
        "WEB_FETCH_PROVIDER_RESPONSE_INVALID",
        "Firecrawl returned a malformed response.",
      );
    }
    const detail =
      typeof payload.error === "string" ? payload.error.slice(0, 300) : "";
    if (!response.ok || payload.success !== true) {
      throw providerError(response.status, detail);
    }
    const metadata = payload.data?.metadata;
    const statusCode = metadata?.statusCode;
    if (
      typeof statusCode !== "number" ||
      !((statusCode >= 200 && statusCode < 300) || statusCode === 304)
    ) {
      throw new AgentSafeWebFetchError(
        "WEB_FETCH_TARGET_FAILED",
        `The discovered page did not load cleanly through Firecrawl${typeof statusCode === "number" ? ` (HTTP ${statusCode})` : "."}`,
      );
    }
    parseProviderUrl(metadata?.sourceURL, requested, "source");
    const canonicalUrl = parseProviderUrl(
      metadata?.url,
      requested,
      "final",
    ).toString();
    if (typeof payload.data?.markdown !== "string") {
      throw new AgentSafeWebFetchError(
        "WEB_FETCH_PROVIDER_RESPONSE_INVALID",
        "Firecrawl did not return Markdown content.",
      );
    }
    const markdown = payload.data.markdown.normalize("NFKC").trim();
    if (!markdown) {
      throw new AgentSafeWebFetchError(
        "WEB_FETCH_CONTENT_EMPTY",
        "Firecrawl returned no readable page content.",
      );
    }
    if (markdown.length > MARKDOWN_CHARACTER_LIMIT) {
      throw new AgentSafeWebFetchError(
        "WEB_FETCH_CONTENT_TOO_LARGE",
        "Firecrawl Markdown exceeded the bounded evidence size.",
      );
    }
    const text = markdown;
    return {
      canonicalUrl,
      title:
        typeof metadata?.title === "string" && metadata.title.trim()
          ? metadata.title.trim().slice(0, 500)
          : result.title,
      text,
      contentHash: createHash("sha256").update(text).digest("hex"),
      retrievedAt: now().toISOString(),
      providerID: result.providerID,
    };
  };
}
