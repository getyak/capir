import type { Pool } from "pg";
import { afterEach, expect, it, vi } from "vitest";

import { buildApp as buildAppWithWorkers, type AppDependencies } from "../app.js";
import type { BackendConfig } from "../config.js";
import {
  SAFE_ERROR_LOG_MESSAGE,
  safeErrorSummary,
} from "./requestLogger.js";

const config: BackendConfig = {
  allowedOrigins: ["http://localhost:3000"],
  appleSignInAudiences: ["com.talentsignal.app"],
  appleSignInEnabled: true,
  databaseUrl: "postgresql://synthetic-only",
  host: "127.0.0.1",
  passwordAuthEnabled: true,
  passwordRegistrationEnabled: true,
  port: 4317,
  retentionSweepIntervalMs: 60_000,
  sessionTtlSeconds: 28_800,
  simulatedAuthEnabled: true,
};

// Same boundary as app.test.ts: queue worker execution is covered elsewhere
// with a disposable database.
const buildApp = (dependencies: AppDependencies) =>
  buildAppWithWorkers({
    ...dependencies,
    conversationQueueWorkerEnabled: false,
  });

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
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
  const error = new Error(
    "message-private-canary",
  ) as Error & Record<string, unknown>;
  error.name = "name-private-canary";
  error.stack =
    "name-private-canary: message-private-canary\n    at stack-private-canary";
  error.cause = cause;
  error.code = "PRIVATE_CODE_CANARY";
  error.detail = "db-detail-private-canary";
  error.query = "db-query-private-canary";
  error.providerBody = "provider-body-private-canary";
  error.customProperty = "custom-property-private-canary";
  error.url = "https://example.invalid/url-private-canary";
  return error;
}

/**
 * Captures the real shipped logger stream. Pino detects a replaced
 * `process.stdout.write` and uses `process.stdout` itself, so the complete
 * emitted JSON of `buildApp`'s logger is observed without widening production
 * logger injection.
 */
function captureProcessStdout() {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as never);
  return {
    output: () => chunks.join(""),
    restore: () => spy.mockRestore(),
  };
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

function fakePool() {
  return {
    query: vi.fn().mockResolvedValue({ rows: [] }),
  } as unknown as Pool;
}

it("keeps the shipped buildApp global error handler log policy safe and correlated", async () => {
  const capture = captureProcessStdout();
  let responseBody!: {
    error: { code: string; message: string; request_id: string };
  };
  try {
    const app = await buildApp({ config, pool: fakePool() });
    apps.push(app);
    app.get("/synthetic/throwing-route", async () => {
      throw syntheticPrivateError();
    });
    const response = await app.inject({
      method: "GET",
      url: "/synthetic/throwing-route?state=url-private-canary",
    });
    expect(response.statusCode).toBe(500);
    responseBody = response.json();
  } finally {
    capture.restore();
  }

  // Client error contract: fixed message and request correlation only.
  expect(responseBody.error.code).toBe("INTERNAL_ERROR");
  expect(responseBody.error.message).toBe(
    "The request could not be completed.",
  );
  expect(responseBody.error.request_id).toEqual(expect.any(String));
  expect(responseBody.error.request_id.length).toBeGreaterThan(0);

  const output = capture.output();
  expectNoPrivateCanaries(output);
  const errorLine = logLines(output).find(
    (line) => line.msg === "Unhandled control-plane request failure",
  );
  expect(errorLine).toBeDefined();
  expect(errorLine?.err).toEqual({ type: "error" });
  // Request correlation survives on the request child logger binding and the
  // automatic request log, while URLs keep paths only.
  expect(errorLine?.reqId).toBe(responseBody.error.request_id);
  const requestLine = logLines(output).find((line) => line.req !== undefined);
  const loggedRequest = requestLine?.req as {
    id?: string;
    url?: string;
    method?: string;
  } | undefined;
  expect(loggedRequest?.id).toBe(responseBody.error.request_id);
  expect(loggedRequest?.method).toBe("GET");
  expect(loggedRequest?.url).toBe("/synthetic/throwing-route");
});

it("normalizes every error-bearing shape on the shipped logger stream", async () => {
  const capture = captureProcessStdout();
  try {
    const app = await buildApp({ config, pool: fakePool() });
    apps.push(app);
    const circular: Record<string, unknown> = {
      message: "message-private-canary",
      detail: "db-detail-private-canary",
    };
    circular.self = circular;
    const databaseError = syntheticPrivateError() as Error & {
      code: string;
    };
    databaseError.code = "P0001";
    app.log.error(syntheticPrivateError());
    app.log.error({ err: syntheticPrivateError() });
    app.log.error({ err: syntheticPrivateError() }, "fixed operation message");
    app.log.error({ error: syntheticPrivateError() });
    app.log.error({ err: circular }, "fixed operation message");
    app.log.error({ err: "provider-body-private-canary" });
    app.log.error({ err: databaseError }, "fixed operation message");
  } finally {
    capture.restore();
  }

  const output = capture.output();
  expectNoPrivateCanaries(output);
  const lines = logLines(output).filter(
    (line) => line.err !== undefined || line.error !== undefined,
  );
  expect(lines.map((line) => line.msg)).toEqual([
    SAFE_ERROR_LOG_MESSAGE,
    SAFE_ERROR_LOG_MESSAGE,
    "fixed operation message",
    SAFE_ERROR_LOG_MESSAGE,
    "fixed operation message",
    SAFE_ERROR_LOG_MESSAGE,
    "fixed operation message",
  ]);
  expect(lines[0]?.err).toEqual({ type: "error" });
  expect(lines[3]?.error).toEqual({ type: "error" });
  expect(lines[4]?.err).toEqual({ type: "unknown" });
  expect(lines[5]?.err).toEqual({ type: "unknown" });
  expect(lines[6]?.err).toEqual({ type: "database_error", code: "P0001" });
});

it("safeErrorSummary remains the closed error contract for hostile values", () => {
  expect(safeErrorSummary(syntheticPrivateError())).toEqual({ type: "error" });
  expect(safeErrorSummary("name-private-canary")).toEqual({ type: "unknown" });
  const networkError = new Error("message-private-canary") as Error & {
    code: string;
  };
  networkError.code = "ETIMEDOUT";
  expect(safeErrorSummary(networkError)).toEqual({
    type: "network_error",
    code: "ETIMEDOUT",
  });
});
