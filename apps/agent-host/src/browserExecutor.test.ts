import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { startBrowserExecutorServer } from "./browserExecutorServer.js";
import { browseViaExecutor } from "./browserExecutorClient.js";
import { parseBrowserRequest, parseBrowserResponse, type BrowserExecutorRequest } from "./browserExecutorProtocol.js";
import { runContactResearchTool } from "./contactResearchService.js";
import { CONTACT_RESEARCH_CONTRACT } from "@talent-signal/agent";

const token = "a".repeat(64);
const source = (url = "https://example.com/"): BrowserExecutorRequest => ({ version: 1, task_id: randomUUID(),
  call_id: randomUUID(), source_id: createHash("sha256").update(`exa:${url}`).digest("hex"), provider_id: "exa", url, deadline: Date.now() + 10_000 });
const observation = { url: "https://example.com/", title: "Example", text: "Public example", engine: "chromium" as const,
  engineVersion: "153", requests: 1, blockedRequests: 0, httpRequests: 1, responseBytes: 100 };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(close => close())); });
async function start(browse = vi.fn(async (_url: string, _signal: AbortSignal) => observation)) {
  const executor = await startBrowserExecutorServer({ token, port: 0, initialize: async () => {}, browse });
  cleanups.push(() => executor.close());
  const url = `http://127.0.0.1:${(executor.server.address() as AddressInfo).port}`;
  return { browse, url, environment: { TALENT_SIGNAL_BROWSER_EXECUTOR_URL: url, TALENT_SIGNAL_BROWSER_EXECUTOR_TOKEN: token } };
}
function post(url: string, value: unknown, authorization = `Bearer ${token}`) {
  return fetch(`${url}/v1/browse`, { method: "POST", headers: { "content-type": "application/json", authorization }, body: JSON.stringify(value) });
}

describe("private browser executor protocol", () => {
  it("binds source and response identity and rejects excess data", () => {
    const request = source();
    expect(parseBrowserResponse({ request, observation }, request)).toEqual(observation);
    for (const raw of [{ ...request, anchors: ["private"] }, { ...request, source_id: "b".repeat(64) },
      { ...request, url: "http://example.com/" }, { ...request, provider_id: "shell" }]) {
      expect(() => parseBrowserRequest(raw)).toThrow();
    }
    expect(() => parseBrowserResponse({ request: { ...request, call_id: randomUUID() }, observation }, request)).toThrow("IDENTITY_MISMATCH");
    expect(() => parseBrowserResponse({ request, observation: { ...observation, url: "https://elsewhere.example/" } }, request)).toThrow();
    expect(() => parseBrowserResponse({ request, observation: { ...observation, text: "x".repeat(16_001) } }, request)).toThrow();
  });
  it("fails closed for absent configuration and non-private endpoints", async () => {
    for (const environment of [{}, ...["http://example.com", "http://8.8.8.8", "http://127.0.0.1/path", "http://user@127.0.0.1"].map(url => ({
      TALENT_SIGNAL_BROWSER_EXECUTOR_URL: url, TALENT_SIGNAL_BROWSER_EXECUTOR_TOKEN: token }))]) {
      await expect(browseViaExecutor(source(), new AbortController().signal, environment)).rejects.toThrow();
    }
  });
  it("protects readiness and reads current runtime health", async () => {
    const health = vi.fn(async () => {});
    const executor = await startBrowserExecutorServer({ token, port: 0, initialize: async () => {}, health, browse: async () => observation });
    cleanups.push(() => executor.close());
    const url = `http://127.0.0.1:${(executor.server.address() as AddressInfo).port}/health/ready`;
    expect((await fetch(url)).status).toBe(401);
    expect(health).not.toHaveBeenCalled();
    expect((await fetch(url, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    health.mockRejectedValueOnce(new Error("BROWSER_CLEANUP_UNVERIFIED"));
    expect((await fetch(url, { headers: { authorization: `Bearer ${token}` } })).status).toBe(502);
  });
  it("authenticates and limits the body before invoking the browser", async () => {
    const fixture = await start();
    expect((await post(fixture.url, source(), "Bearer wrong")).status).toBe(401);
    expect((await post(fixture.url, { ...source(), excess: "x".repeat(5_000) })).status).toBe(413);
    expect((await post(fixture.url, { ...source(), deadline: Date.now() - 1 })).status).toBe(502);
    expect(fixture.browse).not.toHaveBeenCalled();
    await expect(browseViaExecutor(source(), new AbortController().signal, fixture.environment)).resolves.toEqual(observation);
  });
  it("routes the production research service through RPC without sending anchors or credentials", async () => {
    const fixture = await start();
    const input = source();
    const request = { contract_version: CONTACT_RESEARCH_CONTRACT, task_id: input.task_id, call_id: input.call_id,
      anchors: ["Synthetic private context"], input: { operation: "browse", source: {
        source_id: input.source_id, url: input.url, title: "Example", text: "", channel: "web", provider_id: "exa",
        provider_request_id: null, content_hash: "a".repeat(64), retrieved_at: new Date().toISOString(), stage: "discovered",
      } } };
    await expect(runContactResearchTool(request, { NODE_ENV: "production", TALENT_SIGNAL_BROWSER_IMAGE: `sha256:${"a".repeat(64)}` })).rejects.toThrow("NOT_CONFIGURED");
    const result = await runContactResearchTool(request, { NODE_ENV: "production", ...fixture.environment });
    expect(result.sources[0]?.provider_id).toBe("browser");
    expect(result.external_effects).toEqual([]);
    expect(fixture.browse).toHaveBeenCalledWith(input.url, expect.any(AbortSignal));
  });
  it("shares concurrent identical calls, rejects conflicts, and keeps content-free terminal tombstones", async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const fixture = await start(vi.fn(async () => { await pending; return observation; }));
    const request = source();
    const first = post(fixture.url, request), second = post(fixture.url, Object.fromEntries(Object.entries(request).reverse()));
    await vi.waitFor(() => expect(fixture.browse).toHaveBeenCalledTimes(1));
    expect((await post(fixture.url, { ...request, deadline: request.deadline + 1 })).status).toBe(409);
    release();
    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect((await post(fixture.url, request)).status).toBe(409);
    expect(fixture.browse).toHaveBeenCalledTimes(1);
  });
  it("keeps capacity until cancellation cleanup settles and then permits another call", async () => {
    let release!: () => void;
    const cleanup = new Promise<void>(resolve => { release = resolve; });
    let aborted = 0;
    const fixture = await start(vi.fn(async (_url: string, signal: AbortSignal) => {
      await new Promise<void>(resolve => signal.addEventListener("abort", () => { aborted++; resolve(); }, { once: true }));
      await cleanup;
      signal.throwIfAborted();
      return observation;
    }));
    const controllers = [new AbortController(), new AbortController()];
    const calls = controllers.map(controller => browseViaExecutor(source(), controller.signal, fixture.environment).catch(() => undefined));
    await vi.waitFor(() => expect(fixture.browse).toHaveBeenCalledTimes(2));
    controllers.forEach(controller => controller.abort());
    await Promise.all(calls);
    await vi.waitFor(() => expect(aborted).toBe(2));
    expect((await post(fixture.url, source())).status).toBe(503);
    release();
    fixture.browse.mockImplementation(async () => observation);
    await vi.waitFor(async () => expect((await post(fixture.url, source())).status).toBe(200));
  });
  it("cancels at the absolute deadline after normal body completion", async () => {
    let reason: unknown;
    const fixture = await start(vi.fn(async (_url: string, signal: AbortSignal) => {
      await new Promise<void>(resolve => signal.addEventListener("abort", () => { reason = signal.reason; resolve(); }, { once: true }));
      signal.throwIfAborted(); return observation;
    }));
    const response = await post(fixture.url, { ...source(), deadline: Date.now() + 150 });
    expect(response.status).toBe(502);
    expect((reason as Error).message).toBe("BROWSER_DEADLINE_EXCEEDED");
  });
  it("rejects arbitrary Error.code and code-shaped Error.message from the browse boundary", async () => {
    for (const failure of [
      Object.assign(new Error("boom"), { code: "SECRET_CODE_CANARY" }),
      Object.assign(new Error("SECRET_MESSAGE_CANARY"), { code: "BROWSER_ARBITRARY_SECRET" }),
      new Error("BROWSER_ARBITRARY_SECRET_CANARY"),
      Object.assign(new Error("SECRET_MESSAGE_CANARY"), {
        name: "BROWSER_SECRET_NAME_CANARY",
        stack: "Error: SECRET_MESSAGE_CANARY\n    at SECRET_STACK_CANARY",
        cause: new Error("SECRET_CAUSE_CANARY"),
      }),
    ]) {
      const fixture = await start(vi.fn(async () => { throw failure; }));
      const response = await post(fixture.url, source());
      expect(response.status).toBe(502);
      const body = await response.text();
      // Arbitrary codes and code-shaped messages map to the fixed fallback.
      expect(JSON.parse(body)).toEqual({ error: "BROWSER_EXECUTOR_FAILED" });
      for (const canary of ["CANARY", "SECRET"]) expect(body).not.toContain(canary);
    }
  });
  it("preserves recognized browser limits and real socket transient codes", async () => {
    for (const [failure, expected] of [
      [new Error("BROWSER_HTTP_LIMIT"), "BROWSER_HTTP_LIMIT"],
      [new Error("BROWSER_RESPONSE_BYTE_LIMIT"), "BROWSER_RESPONSE_BYTE_LIMIT"],
      [new Error("BROWSER_DEADLINE_EXCEEDED"), "BROWSER_DEADLINE_EXCEEDED"],
      [Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }), "ECONNRESET"],
    ] as const) {
      const fixture = await start(vi.fn(async () => { throw failure; }));
      const response = await post(fixture.url, source());
      expect(response.status).toBe(502);
      expect(JSON.parse(await response.text())).toEqual({ error: expected });
    }
  });
  it("never follows redirects or accepts excessive response bytes", async () => {
    let requests = 0;
    const server = createServer((_req, res) => {
      requests++;
      if (requests === 1) { res.writeHead(302, { location: "/secret" }); res.end(); }
      else { res.writeHead(200, { "content-type": "application/json" }); res.end("x".repeat(80_001)); }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
    const environment = { TALENT_SIGNAL_BROWSER_EXECUTOR_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, TALENT_SIGNAL_BROWSER_EXECUTOR_TOKEN: token };
    await expect(browseViaExecutor(source(), new AbortController().signal, environment)).rejects.toThrow("UNAVAILABLE");
    expect(requests).toBe(1);
    await expect(browseViaExecutor(source(), new AbortController().signal, environment)).rejects.toThrow("TOO_LARGE");
  });
});
