import type { promises as dns } from "node:dns";

import { describe, expect, it, vi } from "vitest";

import {
  AgentSafeWebFetchError,
  fetchDiscoveredPublicPage,
  isBlockedWebAddress,
  fetchBrowserResource,
} from "./safeWebFetch.js";
import type {
  AgentPublicResearchScope,
  AgentWebSearchResult,
} from "@talent-signal/agent";

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
  url: "https://example.com/report",
  title: "Public report",
  snippet: "A public report.",
  publishedAt: null,
  providerID: scope.providerID,
};

const publicLookup = (async () => [
  { address: "93.184.216.34", family: 4 as const },
]) as unknown as typeof dns.lookup;

describe("local safe web fetch", () => {
  it("blocks private and reserved network addresses", () => {
    expect(isBlockedWebAddress("127.0.0.1")).toBe(true);
    expect(isBlockedWebAddress("10.0.0.1")).toBe(true);
    expect(isBlockedWebAddress("::1")).toBe(true);
    expect(isBlockedWebAddress("93.184.216.34")).toBe(false);
    for (const address of ["::ffff:127.0.0.1", "64:ff9b::7f00:1", "2001:0db8::1", "2002:7f00:1::1", "3fff::1", "192.88.99.1", "2::1"]) {
      expect(isBlockedWebAddress(address)).toBe(true);
    }
    expect(isBlockedWebAddress("2001:4860:4860::8888")).toBe(false);
    expect(isBlockedWebAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("brokers only same-origin public resources without cookies or credential headers", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(new Response("window.loaded=true", { headers: { "content-type": "text/javascript", "set-cookie": "secret=1" } }));
    const result = await fetchBrowserResource("https://example.com/app.js", "https://example.com", new AbortController().signal,
      { fetcher, lookup: publicLookup });
    expect(result.body.toString()).toBe("window.loaded=true");
    expect(result.headers).not.toHaveProperty("set-cookie");
    expect(fetcher.mock.calls.at(-1)?.[1]).toMatchObject({ method: "GET", redirect: "manual" });
    const headers = fetcher.mock.calls.at(-1)?.[1]?.headers;
    expect(headers).not.toHaveProperty("cookie"); expect(headers).not.toHaveProperty("authorization");
    const count = fetcher.mock.calls.length;
    for (const url of ["http://example.com/", "https://example.com:444/", "https://private.example/", "https://me:secret@example.com/"]) {
      await expect(fetchBrowserResource(url, "https://example.com", new AbortController().signal,
        { fetcher, lookup: publicLookup })).rejects.toThrow("Only this discovered HTTPS origin");
    }
    expect(fetcher.mock.calls.length).toBe(count);
  });

  it("does not follow robots redirects onto a different port", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://example.com:8443/private" } }))
      .mockResolvedValueOnce(new Response("<h1>Public</h1>", { headers: { "content-type": "text/html" } }));
    await fetchBrowserResource("https://example.com/page", "https://example.com", new AbortController().signal,
      { fetcher, lookup: publicLookup });
    expect(fetcher.mock.calls.map(call => String(call[0]))).toEqual(["https://example.com/robots.txt", "https://example.com/page"]);
  });

  it("counts robots in the shared HTTP budget and stops before another dispatch", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("missing", { status: 404 }));
    const budget = { requests: 79, bytes: 0 };
    await expect(fetchBrowserResource("https://example.com/page", "https://example.com", new AbortController().signal,
      { fetcher, lookup: publicLookup, budget })).rejects.toThrow("BROWSER_HTTP_LIMIT");
    expect(fetcher).toHaveBeenCalledOnce(); expect(budget.requests).toBe(80);
  });

  it("cancels a stalled DNS lookup without dispatching a later request", async () => {
    let release!: (value: unknown) => void;
    const lookup = (() => new Promise(resolve => { release = resolve; })) as unknown as typeof dns.lookup;
    const fetcher = vi.fn<typeof fetch>();
    const controller = new AbortController();
    const pending = fetchBrowserResource("https://example.com/page", "https://example.com", controller.signal, { lookup, fetcher });
    await Promise.resolve(); await Promise.resolve();
    controller.abort(new Error("SYNTHETIC_DNS_CANCEL"));
    await expect(pending).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    release([{ address: "93.184.216.34", family: 4 }]);
    await Promise.resolve(); await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("fetches one discovered page with a content identity", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          "<html><body><h1>Public report</h1><p>Market expanded.</p></body></html>",
          { status: 200, headers: { "content-type": "text/html" } },
        ),
      );

    const page = await fetchDiscoveredPublicPage(
      scope,
      result,
      new AbortController().signal,
      { fetcher, lookup: publicLookup },
    );

    expect(page.text).toContain("Market expanded.");
    expect(page.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(page.canonicalUrl).toBe(result.url);
  });

  it("rejects a cross-host redirect", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://other.test/private" },
        }),
      );

    await expect(
      fetchDiscoveredPublicPage(
        scope,
        result,
        new AbortController().signal,
        { fetcher, lookup: publicLookup },
      ),
    ).rejects.toMatchObject({
      code: "WEB_FETCH_REDIRECT_OUT_OF_SCOPE",
    } satisfies Partial<AgentSafeWebFetchError>);
  });

  it("classifies DNS and transport failures without treating them as tool input", async () => {
    const failedLookup = (async () => {
      throw new Error("dns offline");
    }) as unknown as typeof dns.lookup;
    await expect(
      fetchDiscoveredPublicPage(
        scope,
        result,
        new AbortController().signal,
        { fetcher: vi.fn<typeof fetch>(), lookup: failedLookup },
      ),
    ).rejects.toMatchObject({ code: "WEB_FETCH_DNS_FAILED" });

    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockRejectedValueOnce(new Error("connection reset"));
    await expect(
      fetchDiscoveredPublicPage(
        scope,
        result,
        new AbortController().signal,
        { fetcher, lookup: publicLookup },
      ),
    ).rejects.toMatchObject({ code: "WEB_FETCH_UNAVAILABLE" });
  });

  it("keeps raw transport exception message, name, stack, and cause out of the typed direct-fetch failure", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockRejectedValueOnce(
        Object.assign(new Error("SECRET_MESSAGE_CANARY"), {
          name: "SECRET_NAME_CANARY",
          stack: "Error: SECRET_STACK_CANARY\n    at SECRET_FRAME_CANARY",
          cause: new Error("SECRET_CAUSE_CANARY"),
        }),
      );
    let failure: unknown;
    try {
      await fetchDiscoveredPublicPage(
        scope,
        result,
        new AbortController().signal,
        { fetcher, lookup: publicLookup },
      );
    } catch (error) {
      failure = error;
    }

    // The typed code and fixed operation message survive; nothing from the
    // raw transport exception does.
    expect(failure).toMatchObject({
      code: "WEB_FETCH_UNAVAILABLE",
      message: "The public page could not be reached.",
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
});
