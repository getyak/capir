import { describe, expect, it, vi } from "vitest";

import {
  normalizePublicResearchDomains,
  publicResearchDomainAllowed,
  type AgentPublicResearchScope,
} from "@talent-signal/agent";
import {
  BraveWebSearchProvider,
  TavilyWebSearchProvider,
} from "./webSearchProviders.js";

const scope: AgentPublicResearchScope = {
  runID: "33333333-3333-4333-8333-333333333333",
  objective: "Research Example Company.",
  providerID: "synthetic",
  authorization: {
    purpose: "company_market_research",
    subjectKind: "company",
    accessMode: "domain_allowlist",
    allowedDomains: ["example.com"],
    queryAnchors: ["Example Company"],
    maximumSearchCount: 2,
    maximumFetchCount: 2,
  },
};

describe("local public-web provider registry", () => {
  it("normalizes public domain policy and matches subdomains", () => {
    expect(normalizePublicResearchDomains(["Example.com", "example.com"]))
      .toEqual(["example.com"]);
    expect(publicResearchDomainAllowed("news.example.com", scope.authorization))
      .toBe(true);
    expect(publicResearchDomainAllowed("example.net", scope.authorization))
      .toBe(false);
    expect(() => normalizePublicResearchDomains(["example.com/path"]))
      .toThrow("public ASCII hostnames");
    expect(() => normalizePublicResearchDomains(["127.0.0.1"]))
      .toThrow("public ASCII hostnames");
  });

  it("normalizes Brave results without exposing its credential", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "Allowed",
                url: "https://news.example.com/update#section",
                description: "Public update",
                extra_snippets: ["Second excerpt"],
              },
              { title: "Blocked", url: "https://other.test/update" },
              { title: "Insecure", url: "http://example.com/update" },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new BraveWebSearchProvider({
      apiKey: "secret-brave-key",
      fetcher,
    });
    const results = await provider.search(
      { ...scope, providerID: provider.id },
      { query: "Example market update", maximumResults: 5, recencyDays: 7 },
      new AbortController().signal,
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      url: "https://news.example.com/update",
      providerID: "brave-web-search",
      snippet: "Public update Second excerpt",
    });
    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("x-subscription-token"))
      .toBe("secret-brave-key");
    expect(JSON.stringify(results)).not.toContain("secret-brave-key");
  });

  it("passes domain/time policy to Tavily and disables generated answers", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Company filing",
              url: "https://example.com/filing",
              content: "Public filing excerpt",
              published_date: "2026-08-28T00:00:00Z",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const provider = new TavilyWebSearchProvider({
      apiKey: "secret-tavily-key",
      fetcher,
    });
    const results = await provider.search(
      { ...scope, providerID: provider.id },
      { query: "Example filing", maximumResults: 3, recencyDays: 30 },
      new AbortController().signal,
    );

    expect(results[0]?.providerID).toBe("tavily-search");
    const [, init] = fetcher.mock.calls[0] ?? [];
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      include_domains: ["example.com"],
      include_answer: false,
      include_raw_content: false,
      max_results: 3,
      time_range: "month",
    });
    expect(JSON.stringify(results)).not.toContain("secret-tavily-key");
  });

  it("rejects non-official endpoints and classifies transport failures", async () => {
    expect(
      () =>
        new BraveWebSearchProvider({
          apiKey: "secret-brave-key",
          baseUrl: "http://127.0.0.1:8787/res/v1",
        }),
    ).toThrow("api.search.brave.com over HTTPS");

    const provider = new TavilyWebSearchProvider({
      apiKey: "secret-tavily-key",
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
    });
    await expect(
      provider.search(
        { ...scope, providerID: provider.id },
        { query: "Example filing", maximumResults: 3, recencyDays: null },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "WEB_SEARCH_PROVIDER_UNAVAILABLE" });
  });

  it("keeps raw transport exception message, name, stack, and cause out of typed provider failures", async () => {
    const provider = new TavilyWebSearchProvider({
      apiKey: "secret-tavily-key",
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
      await provider.search(
        { ...scope, providerID: provider.id },
        { query: "Example filing", maximumResults: 3, recencyDays: null },
        new AbortController().signal,
      );
    } catch (error) {
      failure = error;
    }

    // The typed code and fixed operation message survive; nothing from the
    // raw transport exception does.
    expect(failure).toMatchObject({
      code: "WEB_SEARCH_PROVIDER_UNAVAILABLE",
      message: "The search provider could not be reached.",
    });
    const error = failure as Error & { cause?: unknown };
    const serialized = JSON.stringify({
      message: error.message,
      name: error.name,
      stack: error.stack,
      cause: error.cause,
    });
    expect(serialized).not.toContain("CANARY");
    expect(serialized).not.toContain("secret-tavily-key");
  });
});
