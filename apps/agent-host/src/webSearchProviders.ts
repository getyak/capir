import { isIP } from "node:net";

import {
  normalizePublicResearchDomains,
  publicResearchDomainAllowed,
  type AgentPublicResearchScope,
  type AgentWebSearchResult,
} from "@talent-signal/agent";

const SEARCH_TIMEOUT_MS = 8_000;
const SEARCH_RESPONSE_BYTE_LIMIT = 1_000_000;

export interface AgentWebSearchRequest {
  query: string;
  maximumResults: number;
  recencyDays: number | null;
}

export interface AgentWebSearchProvider {
  readonly id: string;
  search(
    scope: AgentPublicResearchScope,
    request: AgentWebSearchRequest,
    signal: AbortSignal,
  ): Promise<readonly Omit<AgentWebSearchResult, "resultID">[]>;
}

export class AgentWebSearchProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentWebSearchProviderError";
  }
}

interface SearchProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
}

function providerBaseUrl(value: string, officialHost: string): string {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== officialHost ||
    parsed.username ||
    parsed.password
  ) {
    throw new AgentWebSearchProviderError(
      "WEB_SEARCH_PROVIDER_ENDPOINT_INVALID",
      `Search provider endpoint must use ${officialHost} over HTTPS.`,
    );
  }
  return parsed.toString().replace(/\/$/u, "");
}

async function searchProviderFetch(
  fetcher: typeof fetch,
  input: URL | RequestInfo,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetcher(input, init);
  } catch (error) {
    if (error instanceof AgentWebSearchProviderError) throw error;
    // Fixed operation message: an untyped transport exception message is
    // untrusted and never enters a typed provider error or model context.
    throw new AgentWebSearchProviderError(
      "WEB_SEARCH_PROVIDER_UNAVAILABLE",
      "The search provider could not be reached.",
    );
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > SEARCH_RESPONSE_BYTE_LIMIT) {
    throw new AgentWebSearchProviderError(
      "WEB_SEARCH_RESPONSE_TOO_LARGE",
      "The search provider response exceeded its byte budget.",
    );
  }
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > SEARCH_RESPONSE_BYTE_LIMIT) {
    throw new AgentWebSearchProviderError(
      "WEB_SEARCH_RESPONSE_TOO_LARGE",
      "The search provider response exceeded its byte budget.",
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AgentWebSearchProviderError(
      "WEB_SEARCH_RESPONSE_INVALID",
      "The search provider returned invalid JSON.",
    );
  }
}

function normalizedResult(
  providerID: string,
  input: {
    url?: unknown;
    title?: unknown;
    snippet?: unknown;
    publishedAt?: unknown;
  },
  scope: AgentPublicResearchScope,
): Omit<AgentWebSearchResult, "resultID"> | null {
  if (typeof input.url !== "string" || typeof input.title !== "string") {
    return null;
  }
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    isIP(url.hostname) !== 0 ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname.endsWith(".local") ||
    !publicResearchDomainAllowed(url.hostname, scope.authorization)
  ) {
    return null;
  }
  url.hash = "";
  const publishedAt =
    typeof input.publishedAt === "string" &&
    Number.isFinite(Date.parse(input.publishedAt))
      ? new Date(input.publishedAt).toISOString()
      : null;
  return {
    url: url.toString(),
    title: input.title.trim().slice(0, 500),
    snippet:
      typeof input.snippet === "string"
        ? input.snippet.trim().slice(0, 2_000)
        : "",
    publishedAt,
    providerID,
  };
}

function uniqueResults(
  providerID: string,
  inputs: readonly {
    url?: unknown;
    title?: unknown;
    snippet?: unknown;
    publishedAt?: unknown;
  }[],
  scope: AgentPublicResearchScope,
  maximumResults: number,
) {
  const seen = new Set<string>();
  const results: Array<Omit<AgentWebSearchResult, "resultID">> = [];
  for (const input of inputs) {
    const result = normalizedResult(providerID, input, scope);
    if (!result || seen.has(result.url)) continue;
    seen.add(result.url);
    results.push(result);
    if (results.length >= maximumResults) break;
  }
  return results;
}

function braveFreshness(days: number | null): string | undefined {
  if (days === null || days > 365) return undefined;
  if (days <= 1) return "pd";
  if (days <= 7) return "pw";
  if (days <= 31) return "pm";
  return "py";
}

export class BraveWebSearchProvider implements AgentWebSearchProvider {
  readonly id = "brave-web-search";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(options: SearchProviderOptions) {
    this.apiKey = options.apiKey.trim();
    if (!this.apiKey) {
      throw new AgentWebSearchProviderError(
        "WEB_SEARCH_CREDENTIAL_MISSING",
        "A Brave Search API key is required.",
      );
    }
    this.baseUrl = providerBaseUrl(
      options.baseUrl ?? "https://api.search.brave.com/res/v1",
      "api.search.brave.com",
    );
    this.fetcher = options.fetcher ?? fetch;
  }

  async search(
    scope: AgentPublicResearchScope,
    request: AgentWebSearchRequest,
    signal: AbortSignal,
  ) {
    const parameters = new URLSearchParams({
      q: request.query,
      count: String(request.maximumResults),
      safesearch: "strict",
      extra_snippets: "true",
    });
    const freshness = braveFreshness(request.recencyDays);
    if (freshness) parameters.set("freshness", freshness);
    if (scope.authorization.accessMode === "domain_allowlist") {
      parameters.set(
        "q",
        `${request.query} ${scope.authorization.allowedDomains
          .map((domain) => `site:${domain}`)
          .join(" OR ")}`,
      );
    }
    const response = await searchProviderFetch(
      this.fetcher,
      `${this.baseUrl}/web/search?${parameters}`,
      {
        headers: {
          accept: "application/json",
          "x-subscription-token": this.apiKey,
        },
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        ]),
      },
    );
    if (!response.ok) {
      throw new AgentWebSearchProviderError(
        "WEB_SEARCH_PROVIDER_FAILED",
        `Brave Search failed with HTTP ${response.status}.`,
      );
    }
    const payload = (await boundedJson(response)) as {
      web?: {
        results?: Array<{
          url?: unknown;
          title?: unknown;
          description?: unknown;
          age?: unknown;
          extra_snippets?: unknown;
        }>;
      };
    };
    return uniqueResults(
      this.id,
      (payload.web?.results ?? []).map((item) => ({
        url: item.url,
        title: item.title,
        snippet: [item.description]
          .concat(Array.isArray(item.extra_snippets) ? item.extra_snippets : [])
          .filter((value): value is string => typeof value === "string")
          .join(" "),
        publishedAt: item.age,
      })),
      scope,
      request.maximumResults,
    );
  }
}

function tavilyTimeRange(days: number | null): string | undefined {
  if (days === null || days > 365) return undefined;
  if (days <= 1) return "day";
  if (days <= 7) return "week";
  if (days <= 31) return "month";
  return "year";
}

export class TavilyWebSearchProvider implements AgentWebSearchProvider {
  readonly id = "tavily-search";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(options: SearchProviderOptions) {
    this.apiKey = options.apiKey.trim();
    if (!this.apiKey) {
      throw new AgentWebSearchProviderError(
        "WEB_SEARCH_CREDENTIAL_MISSING",
        "A Tavily API key is required.",
      );
    }
    this.baseUrl = providerBaseUrl(
      options.baseUrl ?? "https://api.tavily.com",
      "api.tavily.com",
    );
    this.fetcher = options.fetcher ?? fetch;
  }

  async search(
    scope: AgentPublicResearchScope,
    request: AgentWebSearchRequest,
    signal: AbortSignal,
  ) {
    const response = await searchProviderFetch(
      this.fetcher,
      `${this.baseUrl}/search`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: request.query,
          max_results: request.maximumResults,
          search_depth: "basic",
          include_answer: false,
          include_raw_content: false,
          include_images: false,
          ...(scope.authorization.accessMode === "domain_allowlist"
            ? { include_domains: scope.authorization.allowedDomains }
            : {}),
          ...(tavilyTimeRange(request.recencyDays)
            ? { time_range: tavilyTimeRange(request.recencyDays) }
            : {}),
        }),
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        ]),
      },
    );
    if (!response.ok) {
      throw new AgentWebSearchProviderError(
        "WEB_SEARCH_PROVIDER_FAILED",
        `Tavily Search failed with HTTP ${response.status}.`,
      );
    }
    const payload = (await boundedJson(response)) as {
      results?: Array<{
        url?: unknown;
        title?: unknown;
        content?: unknown;
        published_date?: unknown;
      }>;
    };
    return uniqueResults(
      this.id,
      (payload.results ?? []).map((item) => ({
        url: item.url,
        title: item.title,
        snippet: item.content,
        publishedAt: item.published_date,
      })),
      scope,
      request.maximumResults,
    );
  }
}

export { normalizePublicResearchDomains };
