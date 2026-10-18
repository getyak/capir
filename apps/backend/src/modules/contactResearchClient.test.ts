import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CONTACT_RESEARCH_CONTRACT,
  ContactResearchToolRequestSchema,
  ContactResearchToolResponseSchema,
  type ContactPublicSource,
} from "@talent-signal/agent";
import {
  assertContactResearchResponseMatchesRequest,
  LocalContactResearchClient,
} from "./contactResearchClient.js";
import { isWorkspacePublicResearchTransientError } from "./workspacePublicResearch.js";

function source(provider: "exa" | "tikhub", channel: "web" | "reddit", url: string): ContactPublicSource {
  return {
    source_id: createHash("sha256").update(`${provider}:${url}`).digest("hex"),
    url, title: "Example", text: "Discovery text", channel, provider_id: provider,
    provider_request_id: "fixture", content_hash: "a".repeat(64),
    retrieved_at: "2026-09-19T00:00:00.000Z", stage: provider === "exa" ? "discovered" : "profile_observation",
  };
}

describe("contact research response readback", () => {
  const social = source("tikhub", "reddit", "https://www.reddit.com/user/example");
  const web = source("exa", "web", "https://example.com/profile");
  const request = ContactResearchToolRequestSchema.parse({
    contract_version: CONTACT_RESEARCH_CONTRACT, task_id: randomUUID(), call_id: randomUUID(),
    anchors: ["Example"], input: { operation: "fetch", sources: [social, web] },
  });
  const response = ContactResearchToolResponseSchema.parse({
    contract_version: CONTACT_RESEARCH_CONTRACT, task_id: request.task_id, call_id: request.call_id,
    sources: [{ ...web, text: "Fetched body", content_hash: "b".repeat(64), stage: "fetched" }], channels: [],
    fetch_outcomes: [
      { source_id: social.source_id, channel: social.channel, provider: social.provider_id,
        status: "unsupported", error_code: "UNSUPPORTED" },
      { source_id: web.source_id, channel: web.channel, provider: web.provider_id, status: "ok", error_code: null },
    ], external_effects: [],
  });

  it("accepts exact ordered outcomes and the matching successful fetched source", () => {
    expect(() => assertContactResearchResponseMatchesRequest(request, response)).not.toThrow();
  });

  it("rejects missing, reordered, duplicated or substituted fetch readback", () => {
    const malformed = [
      { ...response, fetch_outcomes: response.fetch_outcomes.slice(1) },
      { ...response, fetch_outcomes: [...response.fetch_outcomes].reverse() },
      { ...response, fetch_outcomes: [response.fetch_outcomes[0]!, response.fetch_outcomes[0]!] },
      { ...response, sources: [] },
      { ...response, sources: [{ ...response.sources[0]!, url: "https://example.com/substituted" }] },
      { ...response, sources: [...response.sources, response.sources[0]!] },
    ];
    for (const item of malformed) {
      expect(() => assertContactResearchResponseMatchesRequest(request, item)).toThrow("CONTACT_RESEARCH_READBACK_MISMATCH");
    }
  });

  it("rejects fetch outcomes on a non-fetch response", () => {
    const search = ContactResearchToolRequestSchema.parse({
      contract_version: CONTACT_RESEARCH_CONTRACT, task_id: request.task_id, call_id: request.call_id,
      anchors: ["Example"], input: { operation: "search", channels: ["web"], query: "Example", maximum_results_per_channel: 1 },
    });
    expect(() => assertContactResearchResponseMatchesRequest(search, response)).toThrow("CONTACT_RESEARCH_READBACK_MISMATCH");
  });
});

// Real local Unix-socket server tests: the client must refuse a malicious
// server error body instead of forwarding regex-shaped untrusted content.
describe("LocalContactResearchClient error boundary", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function socketServer(
    status: number,
    body: unknown,
  ): Promise<{ socketPath: string; client: LocalContactResearchClient }> {
    const directory = await fs.mkdtemp(join(tmpdir(), "contact-research-client-test-"));
    const socketPath = join(directory, "agent.sock");
    const server: Server = createServer((request, response) => {
      request.resume();
      const payload = Buffer.from(JSON.stringify(body));
      response.writeHead(status, {
        "content-type": "application/json",
        "content-length": payload.byteLength,
      });
      response.end(payload);
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    cleanups.push(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fs.rm(directory, { recursive: true, force: true });
    });
    return { socketPath, client: new LocalContactResearchClient(socketPath) };
  }

  function searchRequest() {
    return ContactResearchToolRequestSchema.parse({
      contract_version: CONTACT_RESEARCH_CONTRACT,
      task_id: randomUUID(),
      call_id: randomUUID(),
      anchors: ["Example"],
      input: {
        operation: "search",
        channels: ["web"],
        query: "Example",
        maximum_results_per_channel: 1,
      },
    });
  }

  it("refuses an arbitrary regex-shaped malicious server error body", async () => {
    for (const error of [
      "CONTACT_RESEARCH_ARBITRARY_SECRET_CANARY",
      "BROWSER_ARBITRARY_SECRET_CANARY",
      "CONTACT_RESEARCH_CAPACITY_EXHAUSTED_SECRET",
    ]) {
      const { client } = await socketServer(502, { error });
      const rejection = await client.execute(searchRequest(), new AbortController().signal)
        .then(() => null, (thrown: unknown) => thrown as Error);
      expect(rejection).toBeInstanceOf(Error);
      // The malicious code-shaped body is dropped in favor of the bounded
      // HTTP-status diagnostic; nothing untrusted is forwarded.
      expect(rejection?.message).toBe("CONTACT_RESEARCH_HTTP_502");
      expect(JSON.stringify(rejection?.message)).not.toContain("CANARY");
    }
  });

  it("preserves recognized fixed diagnostics from the local Agent Host", async () => {
    const { client } = await socketServer(503, { error: "CONTACT_RESEARCH_CAPACITY_EXHAUSTED" });
    const rejection = await client.execute(searchRequest(), new AbortController().signal)
      .then(() => null, (thrown: unknown) => thrown as Error);
    expect(rejection?.message).toBe("CONTACT_RESEARCH_CAPACITY_EXHAUSTED");
  });

  it("never lets a server body rewrite the real HTTP status diagnostic", async () => {
    // HTTP_<status> codes are generated by this client from the real status
    // line and are not server-emitted: a 400 response claiming a transient
    // CONTACT_RESEARCH_HTTP_500 must stay the real 400 and permanent.
    const { client } = await socketServer(400, { error: "CONTACT_RESEARCH_HTTP_500" });
    const rejection = await client.execute(searchRequest(), new AbortController().signal)
      .then(() => null, (thrown: unknown) => thrown as Error);
    expect(rejection?.message).toBe("CONTACT_RESEARCH_HTTP_400");
    expect(isWorkspacePublicResearchTransientError(rejection)).toBe(false);
  });

  it("refuses every client-owned diagnostic claimed by a server body", async () => {
    for (const claimed of [
      "CONTACT_RESEARCH_HTTP_429",
      "CONTACT_RESEARCH_HTTP_504",
      "CONTACT_RESEARCH_TIMEOUT",
      "CONTACT_RESEARCH_READBACK_MISMATCH",
      "CONTACT_RESEARCH_RESPONSE_TOO_LARGE",
      "CONTACT_RESEARCH_SOCKET_INVALID",
      "CONTACT_RESEARCH_INJECTED_TRANSIENT",
    ]) {
      const { client } = await socketServer(400, { error: claimed });
      const rejection = await client.execute(searchRequest(), new AbortController().signal)
        .then(() => null, (thrown: unknown) => thrown as Error);
      expect(rejection?.message).toBe("CONTACT_RESEARCH_HTTP_400");
      expect(rejection?.message).not.toBe(claimed);
    }
  });

  it("accepts real server policy, browse, and socket codes from the body", async () => {
    for (const supported of [
      "CONTACT_RESEARCH_QUERY_OUT_OF_SCOPE",
      "CONTACT_RESEARCH_PRIVATE_LOOKUP_PROHIBITED",
      "CONTACT_RESEARCH_CALL_ID_CONFLICT",
      "CONTACT_RESEARCH_JSON_REQUIRED",
      "BROWSER_HTTP_LIMIT",
      "BROWSER_RESPONSE_BYTE_LIMIT",
      "ECONNRESET",
    ]) {
      const { client } = await socketServer(502, { error: supported });
      const rejection = await client.execute(searchRequest(), new AbortController().signal)
        .then(() => null, (thrown: unknown) => thrown as Error);
      expect(rejection?.message).toBe(supported);
    }
  });
});
