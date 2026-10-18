import { Writable } from "node:stream";
import Fastify from "fastify";
import { expect, it } from "vitest";
import {
  SAFE_ERROR_LOG_MESSAGE,
  requestLoggerOptions,
  safeErrorSummary,
} from "./requestLogger.js";

it("redacts ephemeral conversation content and credentials while keeping diagnostic codes", async () => {
  let output = "";
  const stream = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done(); } });
  const app = Fastify({ logger: { ...requestLoggerOptions("info"), stream } });
  app.log.info({ code: "PRIVATE_CONVERSATION_TIMEOUT", body: {
    messages: [{ role: "user", content: "private-content-canary" }],
    password: "password-canary", access_token: "token-canary",
    code: "desktop-code-canary", verifier: "desktop-verifier-canary",
    state: "desktop-state-canary", cancel_secret: "desktop-cancel-canary",
  }, headers: { authorization: "authorization-canary" } });
  await app.close();
  expect(output).toContain("PRIVATE_CONVERSATION_TIMEOUT");
  for (const canary of ["private-content-canary", "password-canary", "token-canary", "authorization-canary",
    "desktop-code-canary", "desktop-verifier-canary", "desktop-state-canary", "desktop-cancel-canary"]) expect(output).not.toContain(canary);
});

it("automatic request logs keep paths but never query proofs", async () => {
  let output = "";
  const stream = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done(); } });
  const app = Fastify({ logger: { ...requestLoggerOptions("info"), stream } });
  app.get("/v1/desktop-browser-login/:id/grant", () => ({ status: "prepared" }));
  await app.inject("/v1/desktop-browser-login/example/grant?state=url-state-canary&web_origin=origin-canary");
  await app.close();
  expect(output).toContain("/v1/desktop-browser-login/example/grant");
  expect(output).not.toContain("url-state-canary");
  expect(output).not.toContain("origin-canary");
});

/** Every private string travels in its own field so any leak is attributable. */
const PRIVATE_ERROR_CANARIES = [
  "message-private-canary",
  "stack-private-canary",
  "cause-private-canary",
  "name-private-canary",
  "PRIVATE_CODE_CANARY",
  "custom-property-private-canary",
  "provider-body-private-canary",
  "db-detail-private-canary",
  "db-query-private-canary",
  "url-private-canary",
] as const;

function syntheticPrivateError(): Error {
  const cause = new Error("cause-private-canary");
  cause.stack = "Error: cause-private-canary\n    at stack-private-canary";
  const error = new Error("message-private-canary") as Error & Record<string, unknown>;
  error.name = "name-private-canary";
  error.stack = "name-private-canary: message-private-canary\n    at stack-private-canary";
  error.cause = cause;
  error.code = "PRIVATE_CODE_CANARY";
  error.detail = "db-detail-private-canary";
  error.query = "db-query-private-canary";
  error.providerBody = "provider-body-private-canary";
  error.customProperty = "custom-property-private-canary";
  error.url = "https://example.invalid/url-private-canary";
  return error;
}

function captureLoggerApp() {
  let output = "";
  const stream = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done(); } });
  const app = Fastify({ logger: { ...requestLoggerOptions("info"), stream } });
  return { app, output: () => output };
}

function logLines(output: string): Array<Record<string, unknown>> {
  return output
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function expectNoPrivateCanaries(output: string) {
  for (const canary of PRIVATE_ERROR_CANARIES) {
    expect(output).not.toContain(canary);
  }
}

it("keeps fixed call-site messages for first-arg Errors and never emits raw error text", async () => {
  const { app, output } = captureLoggerApp();
  app.log.error(syntheticPrivateError(), "Unhandled control-plane request failure");
  await app.close();
  const emitted = logLines(output());
  expect(emitted).toHaveLength(1);
  expect(emitted[0]?.msg).toBe("Unhandled control-plane request failure");
  expect(emitted[0]?.err).toEqual({ type: "error" });
  expectNoPrivateCanaries(output());
});

it("substitutes the fixed safe message when a first-arg Error has no call-site message", async () => {
  const { app, output } = captureLoggerApp();
  app.log.error(syntheticPrivateError());
  await app.close();
  const emitted = logLines(output());
  expect(emitted).toHaveLength(1);
  expect(emitted[0]?.msg).toBe(SAFE_ERROR_LOG_MESSAGE);
  expect(emitted[0]?.err).toEqual({ type: "error" });
  expectNoPrivateCanaries(output());
});

it("normalizes err objects with and without call-site messages", async () => {
  const { app, output } = captureLoggerApp();
  app.log.error({ err: syntheticPrivateError() }, "fixed operation message");
  app.log.error({ err: syntheticPrivateError() });
  await app.close();
  const emitted = logLines(output());
  expect(emitted.map((line) => line.msg)).toEqual([
    "fixed operation message",
    SAFE_ERROR_LOG_MESSAGE,
  ]);
  expectNoPrivateCanaries(output());
});

it("never echoes a log message equal to the raw error message", async () => {
  const error = syntheticPrivateError();
  const { app, output } = captureLoggerApp();
  app.log.error({ err: error }, error.message);
  app.log.error(error, error.message);
  await app.close();
  const emitted = logLines(output());
  expect(emitted.map((line) => line.msg)).toEqual([
    SAFE_ERROR_LOG_MESSAGE,
    SAFE_ERROR_LOG_MESSAGE,
  ]);
  expectNoPrivateCanaries(output());
});

it("keeps user-controlled Error.name under the error field inside safe serialization", async () => {
  const { app, output } = captureLoggerApp();
  app.log.error({ error: syntheticPrivateError() }, "fixed operation message");
  app.log.error({ error: syntheticPrivateError() });
  await app.close();
  const emitted = logLines(output());
  expect(emitted.map((line) => line.msg)).toEqual([
    "fixed operation message",
    SAFE_ERROR_LOG_MESSAGE,
  ]);
  expect(emitted.every((line) => line.err === undefined)).toBe(true);
  for (const line of emitted) expect(line.error).toEqual({ type: "error" });
  expectNoPrivateCanaries(output());
});

it("serializes non-Error, circular, and message-less err values safely", async () => {
  const circular: Record<string, unknown> = {
    message: "message-private-canary",
    detail: "db-detail-private-canary",
  };
  circular.self = circular;
  const { app, output } = captureLoggerApp();
  app.log.error({ err: "string-private-canary-message" });
  app.log.error({ err: { stack: "stack-private-canary", code: "PRIVATE_CODE_CANARY" } });
  app.log.error({ err: circular }, "fixed operation message");
  await app.close();
  const emitted = logLines(output());
  expect(emitted).toHaveLength(3);
  expect(emitted[0]?.err).toEqual({ type: "unknown" });
  expect(emitted[1]?.err).toEqual({ type: "unknown" });
  expect(emitted[2]?.err).toEqual({ type: "unknown" });
  expect(emitted.map((line) => line.msg)).toEqual([
    SAFE_ERROR_LOG_MESSAGE,
    SAFE_ERROR_LOG_MESSAGE,
    "fixed operation message",
  ]);
  expectNoPrivateCanaries(output());
  expect(output()).not.toContain("string-private-canary-message");
});

it("keeps explicitly allowlisted stable codes and drops arbitrary uppercase codes", async () => {
  const networkError = new Error("message-private-canary") as Error & { code: string };
  networkError.code = "ETIMEDOUT";
  const databaseError = new Error("message-private-canary") as Error & { code: string; detail: string };
  databaseError.code = "P0001";
  databaseError.detail = "db-detail-private-canary";
  const arbitraryError = new Error("message-private-canary") as Error & { code: string };
  arbitraryError.code = "PRIVATE_CODE_CANARY";
  const { app, output } = captureLoggerApp();
  app.log.error({ err: networkError }, "fixed operation message");
  app.log.error({ err: databaseError }, "fixed operation message");
  app.log.error({ err: arbitraryError }, "fixed operation message");
  await app.close();
  const emitted = logLines(output());
  expect(emitted[0]?.err).toEqual({ type: "network_error", code: "ETIMEDOUT" });
  expect(emitted[1]?.err).toEqual({ type: "database_error", code: "P0001" });
  expect(emitted[2]?.err).toEqual({ type: "error" });
  expectNoPrivateCanaries(output());
});

it("preserves top-level call-site code and run correlation next to safe error summaries", async () => {
  const { app, output } = captureLoggerApp();
  app.log.error(
    { code: "PRODUCT_SPAN_PERSISTENCE_FAILED", run_id: "run-42", err: syntheticPrivateError() },
    "Product span persistence failed",
  );
  await app.close();
  const emitted = logLines(output());
  expect(emitted[0]?.code).toBe("PRODUCT_SPAN_PERSISTENCE_FAILED");
  expect(emitted[0]?.run_id).toBe("run-42");
  expect(emitted[0]?.msg).toBe("Product span persistence failed");
  expectNoPrivateCanaries(output());
});

it("never echoes a message copied from the error field when err holds another value", async () => {
  const errorA = new Error("message-a-private-canary");
  const errorB = new Error("message-b-private-canary");
  const { app, output } = captureLoggerApp();
  app.log.error({ err: errorA, error: errorB }, errorB.message);
  app.log.error({ err: errorA, error: errorB }, errorA.message);
  app.log.error({ err: null, error: errorB }, errorB.message);
  app.log.error({ err: errorA, error: errorB }, "fixed operation message");
  await app.close();
  const emitted = logLines(output());
  expect(emitted.map((line) => line.msg)).toEqual([
    SAFE_ERROR_LOG_MESSAGE,
    SAFE_ERROR_LOG_MESSAGE,
    SAFE_ERROR_LOG_MESSAGE,
    "fixed operation message",
  ]);
  expect(emitted[0]?.err).toEqual({ type: "error" });
  expect(emitted[0]?.error).toEqual({ type: "error" });
  expect(emitted[2]?.err).toEqual({ type: "unknown" });
  expect(emitted[2]?.error).toEqual({ type: "error" });
  expectNoPrivateCanaries(output());
  expect(output()).not.toContain("message-a-private-canary");
  expect(output()).not.toContain("message-b-private-canary");
});

it("never echoes a primitive string carried in an error field as the message", async () => {
  const { app, output } = captureLoggerApp();
  app.log.error(
    { err: "primitive-err-private-canary" },
    "primitive-err-private-canary",
  );
  app.log.error(
    { error: "primitive-error-private-canary" },
    "primitive-error-private-canary",
  );
  app.log.error(
    { err: "primitive-err-private-canary" },
    "fixed operation message",
  );
  await app.close();
  const emitted = logLines(output());
  expect(emitted.map((line) => line.msg)).toEqual([
    SAFE_ERROR_LOG_MESSAGE,
    SAFE_ERROR_LOG_MESSAGE,
    "fixed operation message",
  ]);
  expect(emitted[0]?.err).toEqual({ type: "unknown" });
  expect(emitted[1]?.error).toEqual({ type: "unknown" });
  expect(output()).not.toContain("primitive-err-private-canary");
  expect(output()).not.toContain("primitive-error-private-canary");
});

it("keeps the automatic throwing-route error log safe without a custom error handler", async () => {
  const { app, output } = captureLoggerApp();
  app.get("/synthetic/throws", () => {
    throw syntheticPrivateError();
  });
  await app.inject("/synthetic/throws?state=url-private-canary");
  await app.close();
  const emitted = logLines(output());
  expectNoPrivateCanaries(output());
  const errorLines = emitted.filter((line) => line.err !== undefined);
  expect(errorLines.length).toBeGreaterThan(0);
  for (const line of errorLines) {
    expect(line.err).toEqual({ type: "error" });
    expect(typeof line.msg).toBe("string");
  }
  expect(
    errorLines.some((line) => line.msg === SAFE_ERROR_LOG_MESSAGE),
  ).toBe(true);
  const requestLine = emitted.find((line) => line.req !== undefined);
  expect(requestLine).toBeDefined();
  expect((requestLine?.req as { url?: string }).url).toBe("/synthetic/throws");
});

it("safeErrorSummary stays closed for null, primitives, and hostile shapes", () => {
  expect(safeErrorSummary(undefined)).toEqual({ type: "unknown" });
  expect(safeErrorSummary(null)).toEqual({ type: "unknown" });
  expect(safeErrorSummary("name-private-canary")).toEqual({ type: "unknown" });
  expect(safeErrorSummary(7)).toEqual({ type: "unknown" });
  const throwingGetter = Object.create(Error.prototype) as Record<string, unknown>;
  Object.defineProperty(throwingGetter, "code", {
    get() {
      throw new Error("name-private-canary");
    },
  });
  expect(safeErrorSummary(throwingGetter)).toEqual({ type: "error" });
});
