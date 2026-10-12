import { createHash } from "node:crypto";
import type { promises as dns } from "node:dns";

import type {
  AgentPublicResearchScope,
  AgentWebSearchResult,
} from "@talent-signal/agent";
import { describe, expect, it, vi } from "vitest";

import { createFirecrawlWebFetch } from "./firecrawlWebFetch.js";

const scope: AgentPublicResearchScope = {
  runID: "33333333-3333-4333-8333-333333333333",
  objective: "Research Example Company.",
  providerID: "synthetic-search",
  authorization: {
    purpose: "company_market_research",
    subjectKind: "company",
    accessMode: "domain_allowlist",
    allowedDomains: ["example.com"],
    queryAnchors: ["Example Company"],
    maximumSearchCount: 1,
    maximumFetchCount: 1,
  },
};

const result: AgentWebSearchResult = {
  resultID: "a".repeat(64),
  url: "https://example.com/report.pdf",
  title: "Public report",
  snippet: "A public report.",
  publishedAt: null,
  providerID: scope.providerID,
};

const publicLookup = (async () => [
  { address: "93.184.216.34", family: 4 as const },
]) as unknown as typeof dns.lookup;

function response(
  overrides: Record<string, unknown> = {},
  init: ResponseInit = {},
) {
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        markdown: "# Rendered report\n\nDynamic and PDF content.",
        metadata: {
          title: "Rendered report",
          sourceURL: result.url,
          url: result.url,
          statusCode: 200,
        },
      },
      ...overrides,
    }),
    { status: 200, ...init },
  );
}

describe("Firecrawl web fetch", () => {
  it("requests bounded retained-free main-content Markdown and preserves discovered provenance", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response());
    const fetchPage = createFirecrawlWebFetch({
      apiKey: "synthetic-firecrawl-key",
      fetcher,
      lookup: publicLookup,
      zeroDataRetention: true,
      now: () => new Date("2026-09-19T00:00:00.000Z"),
    });

    const page = await fetchPage(scope, result, new AbortController().signal);

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe("https://api.firecrawl.dev/v2/scrape");
    expect(init).toMatchObject({ method: "POST" });
    expect(init?.headers).toEqual({
      authorization: "Bearer synthetic-firecrawl-key",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      url: result.url,
      formats: ["markdown"],
      onlyMainContent: true,
      timeout: 60_000,
      parsers: ["pdf"],
      storeInCache: false,
      zeroDataRetention: true,
    });
    expect(page).toEqual({
      canonicalUrl: result.url,
      title: "Rendered report",
      text: "# Rendered report\n\nDynamic and PDF content.",
      contentHash: createHash("sha256")
        .update("# Rendered report\n\nDynamic and PDF content.")
        .digest("hex"),
      retrievedAt: "2026-09-19T00:00:00.000Z",
      providerID: result.providerID,
    });
  });

  it("fails closed without the reliable Agent Host credential", () => {
    expect(() => createFirecrawlWebFetch({ apiKey: "" })).toThrow(
      "FIRECRAWL_API_KEY is required",
    );
  });

  it("rejects private, foreign-provider, and unauthorized URLs before provider dispatch", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const fetchPage = createFirecrawlWebFetch({
      apiKey: "synthetic",
      fetcher,
      lookup: publicLookup,
    });
    await expect(
      fetchPage(scope, { ...result, providerID: "foreign" }, new AbortController().signal),
    ).rejects.toMatchObject({ code: "WEB_FETCH_PROVIDER_MISMATCH" });
    await expect(
      fetchPage(scope, { ...result, url: "https://other.test/report" }, new AbortController().signal),
    ).rejects.toMatchObject({ code: "WEB_FETCH_DOMAIN_OUT_OF_SCOPE" });
    const privateLookup = (async () => [
      { address: "127.0.0.1", family: 4 as const },
    ]) as unknown as typeof dns.lookup;
    await expect(
      createFirecrawlWebFetch({ apiKey: "synthetic", fetcher, lookup: privateLookup })(
        scope,
        result,
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "WEB_FETCH_HOST_BLOCKED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [401, "WEB_FETCH_PROVIDER_AUTH_FAILED"],
    [402, "WEB_FETCH_PROVIDER_PAYMENT_REQUIRED"],
    [429, "WEB_FETCH_PROVIDER_RATE_LIMITED"],
    [503, "WEB_FETCH_PROVIDER_FAILED"],
  ])("classifies provider HTTP %s", async (status, code) => {
    const fetchPage = createFirecrawlWebFetch({
      apiKey: "synthetic",
      lookup: publicLookup,
      fetcher: vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, error: "bounded" }), {
          status,
        }),
      ),
    });
    await expect(fetchPage(scope, result, new AbortController().signal)).rejects.toMatchObject({ code });
  });

  it("rejects target failures, source or final substitution, malformed data, and oversized Markdown", async () => {
    const cases: Array<[Response, string]> = [
      // A non-2xx target status is rejected before URL provenance is read.
      [response({ data: { markdown: "text", metadata: { sourceURL: result.url, url: result.url, statusCode: 403 } } }), "WEB_FETCH_TARGET_FAILED"],
      // The original URL Firecrawl reports must be the exact discovered URL.
      [response({ data: { markdown: "text", metadata: { sourceURL: "https://other.test/report", url: result.url, statusCode: 200 } } }), "WEB_FETCH_SOURCE_MISMATCH"],
      [response({ data: { markdown: "text", metadata: { sourceURL: "https://example.com/other.pdf", url: result.url, statusCode: 200 } } }), "WEB_FETCH_SOURCE_MISMATCH"],
      [response({ data: { markdown: "text", metadata: { url: result.url, statusCode: 200 } } }), "WEB_FETCH_PROVIDER_RESPONSE_INVALID"],
      [response({ data: { markdown: "text", metadata: { sourceURL: "not-a-url", url: result.url, statusCode: 200 } } }), "WEB_FETCH_PROVIDER_RESPONSE_INVALID"],
      // The actual final URL is required and validated independently. It is
      // never backfilled from sourceURL, and any redirect off the authorized
      // host, path, scheme, or port fails closed.
      [response({ data: { markdown: "text", metadata: { sourceURL: result.url, statusCode: 200 } } }), "WEB_FETCH_PROVIDER_RESPONSE_INVALID"],
      [response({ data: { markdown: "text", metadata: { sourceURL: result.url, url: "not-a-url", statusCode: 200 } } }), "WEB_FETCH_PROVIDER_RESPONSE_INVALID"],
      [response({ data: { markdown: "text", metadata: { sourceURL: result.url, url: "https://other.test/report.pdf", statusCode: 200 } } }), "WEB_FETCH_SOURCE_MISMATCH"],
      [response({ data: { markdown: "text", metadata: { sourceURL: result.url, url: "https://example.com/other.pdf", statusCode: 200 } } }), "WEB_FETCH_SOURCE_MISMATCH"],
      [response({ data: { markdown: "text", metadata: { sourceURL: result.url, url: "https://10.0.0.1/report.pdf", statusCode: 200 } } }), "WEB_FETCH_SOURCE_MISMATCH"],
      [response({ data: { markdown: "text", metadata: { sourceURL: result.url, url: "http://example.com/report.pdf", statusCode: 200 } } }), "WEB_FETCH_SOURCE_MISMATCH"],
      [new Response("not-json"), "WEB_FETCH_PROVIDER_RESPONSE_INVALID"],
      [response({ data: { markdown: "x".repeat(35_001), metadata: { sourceURL: result.url, url: result.url, statusCode: 200 } } }), "WEB_FETCH_CONTENT_TOO_LARGE"],
    ];
    for (const [providerResponse, code] of cases) {
      const fetchPage = createFirecrawlWebFetch({
        apiKey: "synthetic",
        lookup: publicLookup,
        fetcher: vi.fn<typeof fetch>().mockResolvedValueOnce(providerResponse),
      });
      await expect(fetchPage(scope, result, new AbortController().signal)).rejects.toMatchObject({ code });
    }
  });

  it("keeps raw transport exception message, name, stack, and cause out of the typed Firecrawl failure", async () => {
    const fetchPage = createFirecrawlWebFetch({
      apiKey: "synthetic-firecrawl-key",
      lookup: publicLookup,
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(
        Object.assign(new Error("SECRET_MESSAGE_CANARY"), {
          name: "SECRET_NAME_CANARY",
          stack: "Error: SECRET_STACK_CANARY\n    at SECRET_FRAME_CANARY",
          cause: new Error("SECRET_CAUSE_CANARY"),
        }),
      ),
    });
    let failure: unknown;
    try {
      await fetchPage(scope, result, new AbortController().signal);
    } catch (error) {
      failure = error;
    }

    // The typed code and fixed operation message survive; nothing from the
    // raw transport exception does.
    expect(failure).toMatchObject({
      code: "WEB_FETCH_UNAVAILABLE",
      message: "Firecrawl could not be reached.",
    });
    const error = failure as Error & { cause?: unknown };
    const serialized = JSON.stringify({
      message: error.message,
      name: error.name,
      stack: error.stack,
      cause: error.cause,
    });
    expect(serialized).not.toContain("CANARY");
  });

  it("propagates caller cancellation instead of rewriting it as a provider error", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      await new Promise<void>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
          once: true,
        });
      });
      return response();
    });
    const fetchPage = createFirecrawlWebFetch({
      apiKey: "synthetic",
      fetcher,
      lookup: publicLookup,
    });
    const pending = fetchPage(scope, result, controller.signal);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    const reason = new Error("SYNTHETIC_CANCEL");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it("cancels a stalled DNS admission before provider dispatch", async () => {
    let release!: (value: unknown) => void;
    const lookup = (() =>
      new Promise((resolve) => {
        release = resolve;
      })) as unknown as typeof dns.lookup;
    const fetcher = vi.fn<typeof fetch>();
    const controller = new AbortController();
    const fetchPage = createFirecrawlWebFetch({
      apiKey: "synthetic",
      fetcher,
      lookup,
    });
    const pending = fetchPage(scope, result, controller.signal);
    await Promise.resolve();
    const reason = new Error("SYNTHETIC_DNS_CANCEL");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(fetcher).not.toHaveBeenCalled();
    release([{ address: "93.184.216.34", family: 4 }]);
  });
});
