import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { BROWSER_EXECUTOR_PATH, BROWSER_REQUEST_BYTES, BROWSER_RESPONSE_BYTES,
  parseBrowserRequest, parseBrowserResponse, type BrowserExecutorRequest } from "./browserExecutorProtocol.js";
import {
  boundedDiagnosticCode,
  BROWSER_EXECUTOR_ERROR_CODE_SET,
} from "./diagnosticCodes.js";
import type { PublicBrowserObservation } from "./isolatedPublicBrowser.js";

interface Entry {
  identity: string;
  controller: AbortController;
  subscribers: number;
  promise: Promise<PublicBrowserObservation>;
}
export interface BrowserExecutorOptions {
  token: string;
  port: number;
  browse: (url: string, signal: AbortSignal) => Promise<PublicBrowserObservation>;
  initialize: () => Promise<void>;
  health?: () => Promise<void>;
}
function json(response: ServerResponse, status: number, value: unknown) {
  if (response.destroyed || response.writableEnded) return;
  const data = Buffer.from(JSON.stringify(value));
  if (data.length > BROWSER_RESPONSE_BYTES) throw new Error("BROWSER_RESPONSE_TOO_LARGE");
  response.writeHead(status, { "content-type": "application/json", "content-length": data.length,
    "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(data);
}
async function body(request: IncomingMessage): Promise<unknown> {
  if (Number(request.headers["content-length"] ?? 0) > BROWSER_REQUEST_BYTES) throw new Error("BROWSER_REQUEST_TOO_LARGE");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += data.length;
    if (size > BROWSER_REQUEST_BYTES) throw new Error("BROWSER_REQUEST_TOO_LARGE");
    chunks.push(data);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** No queue: admitted calls own capacity until browser cleanup has settled.
 * Completed call tombstones retain only hashes, never URLs or page contents. */
export async function startBrowserExecutorServer(options: BrowserExecutorOptions) {
  if (!/^[a-f0-9]{64}$/u.test(options.token)) throw new Error("BROWSER_EXECUTOR_TOKEN_INVALID");
  const authorization = Buffer.from(`Bearer ${options.token}`);
  const active = new Map<string, Entry>();
  const completed = new Map<string, { identity: string; expires: number }>();
  let ready = false, shuttingDown = false, healthActive = false;
  const server = createServer({ maxHeaderSize: 4_096, requestTimeout: 5_000, headersTimeout: 5_000 }, (request, response) => {
    const arrived = Date.now();
    const timer = setTimeout(() => response.destroy(), 40_000);
    timer.unref();
    response.once("close", () => clearTimeout(timer));
    void (async () => {
      const supplied = Buffer.from(request.headers.authorization ?? "");
      if (supplied.length !== authorization.length || !timingSafeEqual(supplied, authorization)) {
        json(response, 401, { error: "BROWSER_EXECUTOR_UNAUTHORIZED" }); return;
      }
      if (!ready || shuttingDown) { json(response, 503, { error: "BROWSER_EXECUTOR_NOT_READY" }); return; }
      if (request.method === "GET" && request.url === "/health/ready") {
        if (!options.health || healthActive) { json(response, 503, { error: "BROWSER_EXECUTOR_NOT_READY" }); return; }
        healthActive = true;
        try { await options.health(); json(response, 200, { status: "ready", engine: "chromium" }); }
        finally { healthActive = false; }
        return;
      }
      if (request.method !== "POST" || request.url !== BROWSER_EXECUTOR_PATH) {
        json(response, 404, { error: "BROWSER_EXECUTOR_ROUTE_DENIED" }); return;
      }
      if (request.headers["content-type"] !== "application/json") {
        json(response, 415, { error: "BROWSER_EXECUTOR_JSON_REQUIRED" }); return;
      }
      const parsed = parseBrowserRequest(await body(request));
      if (parsed.deadline <= Date.now() || parsed.deadline > arrived + 30_000) throw new Error("BROWSER_DEADLINE_INVALID");
      for (const [key, entry] of completed) if (entry.expires <= Date.now()) completed.delete(key);
      const key = createHash("sha256").update(`${parsed.task_id}:${parsed.call_id}`).digest("hex");
      const identity = createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
      const previous = completed.get(key), existing = active.get(key);
      if (previous || (existing && existing.identity !== identity)) {
        json(response, 409, { error: previous?.identity === identity ? "BROWSER_CALL_FINISHED" : "BROWSER_CALL_ID_CONFLICT" }); return;
      }
      if (!existing && (active.size >= 2 || completed.size + active.size >= 512)) {
        json(response, 503, { error: "BROWSER_CAPACITY_UNAVAILABLE" }); return;
      }
      const controller = existing?.controller ?? new AbortController();
      const entry: Entry = existing ?? { controller, identity, subscribers: 0,
        promise: Promise.resolve().then(async () => {
          const deadline = setTimeout(() => controller.abort(new Error("BROWSER_DEADLINE_EXCEEDED")), Math.max(0, parsed.deadline - Date.now()));
          deadline.unref();
          try {
            controller.signal.throwIfAborted();
            const result = await options.browse(parsed.url, controller.signal);
            controller.signal.throwIfAborted();
            return parseBrowserResponse({ request: parsed, observation: result }, parsed);
          } finally { clearTimeout(deadline); }
        }) };
      if (!existing) {
        active.set(key, entry);
        const settle = () => {
          active.delete(key);
          completed.set(key, { identity, expires: Date.now() + 5 * 60_000 });
        };
        void entry.promise.then(settle, settle);
      }
      entry.subscribers++;
      let detached = false;
      const detach = () => {
        if (detached) return;
        detached = true;
        if (--entry.subscribers === 0) controller.abort(new Error("BROWSER_CLIENT_CLOSED"));
      };
      // IncomingMessage.close also fires for a normally completed request body.
      // Only premature response close cancels execution (Node HTTP docs).
      const closed = () => { if (!response.writableFinished) detach(); };
      response.once("close", closed);
      if (response.destroyed) detach();
      try { json(response, 200, { request: parsed, observation: await entry.promise }); }
      finally { response.removeListener("close", closed); detach(); }
    })().catch(error => {
      // Only finite recognized diagnostics cross this boundary: an arbitrary
      // error.code or code-shaped error.message is never forwarded.
      const code = boundedDiagnosticCode(
        error,
        BROWSER_EXECUTOR_ERROR_CODE_SET,
        "BROWSER_EXECUTOR_FAILED",
      );
      json(response, code === "BROWSER_REQUEST_TOO_LARGE" ? 413 : 502, { error: code });
    });
  });
  server.maxConnections = 16;
  server.keepAliveTimeout = 1_000;
  // Production uses one fixed loopback port. Acquire it before initialization
  // or orphan cleanup so a second production executor cannot race the owner.
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  });
  try { await options.initialize(); ready = true; }
  catch (error) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); throw error; }
  return {
    server,
    async close() {
      shuttingDown = true;
      for (const entry of active.values()) entry.controller.abort(new Error("BROWSER_EXECUTOR_STOPPING"));
      server.closeAllConnections();
      await Promise.allSettled([...active.values()].map(entry => entry.promise));
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
