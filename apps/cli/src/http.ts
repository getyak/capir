/**
 * Minimal capir backend client over fetch.
 *
 * Uses the Task 1 contract envelopes verbatim: every response is validated
 * against `@talent-signal/contracts` schemas and every error is mapped to a
 * stable CLI error code and exit code without leaking bearer material.
 */
import {
  CapirAuthStatusResponseSchema,
  CapirAuthorizationRequestSchema,
  CapirAuthorizationResponseSchema,
  CapirCapabilitiesResponseSchema,
  CapirExchangeRequestSchema,
  CapirExchangeResponseSchema,
  CapirHandoffResponseSchema,
  CapirOperationRequestSchema,
  CapirSandboxRequestSchema,
  CapirSandboxResponseSchema,
} from "@talent-signal/contracts";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { CapirCliError, EXIT, type ExitCode } from "./errors.js";
import { registerContractFormats } from "./formats.js";
import { redactText } from "./output.js";

registerContractFormats();

export type FetchLike = typeof fetch;

/** Default transport deadline when no duration was selected explicitly. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * One request-scoped deadline covering the real fetch AND its body read.
 *
 * The timer and any forwarded abort listener are released as soon as the
 * request settles; a settled request's signal is never aborted afterwards,
 * and the timer alone never keeps the process alive.
 */
function requestDeadline(
  timeoutMs: number,
  external?: AbortSignal,
): {
  signal: AbortSignal;
  race<T>(work: Promise<T>): Promise<T>;
  dispose(): void;
} {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener("abort", onExternalAbort, { once: true });
  }
  const expired = new Error("The request deadline elapsed.");
  const rejection = new Promise<never>((_resolve, reject) => {
    const signal = controller.signal;
    const settle = () => reject(signal.reason ?? expired);
    if (signal.aborted) settle();
    else signal.addEventListener("abort", settle, { once: true });
  });
  const timer = setTimeout(() => controller.abort(expired), timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    race: (work) => Promise.race([work, rejection]),
    dispose: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    },
  };
}

const LogoutResponseSchema = Type.Object(
  {
    schema_version: Type.String(),
    revoked_grant_id: Type.String(),
  },
  { additionalProperties: true },
);

interface ErrorEnvelope {
  error?: unknown;
}

const EXIT_BY_CODE = new Map<string, ExitCode>([
  ["CAPIR_AUTH_REQUIRED", EXIT.AUTH_DENIED],
  ["CAPIR_AUTH_DENIED", EXIT.AUTH_DENIED],
  ["CAPIR_HANDOFF_CONSUMER_DENIED", EXIT.AUTH_DENIED],
  ["CAPIR_INTENT_CONFLICT", EXIT.INVALID_ARGUMENTS],
  ["CAPIR_ORIGIN_DENIED", EXIT.INVALID_ARGUMENTS],
  ["CAPIR_REDIRECT_DENIED", EXIT.INVALID_ARGUMENTS],
  ["CAPIR_HANDOFF_REPLAY", EXIT.INFRASTRUCTURE],
  ["CAPIR_SCENARIO_UNSUPPORTED", EXIT.INFRASTRUCTURE],
  ["CAPIR_SANDBOX_NOT_READY", EXIT.INFRASTRUCTURE],
  ["CAPIR_SANDBOX_NOT_FOUND", EXIT.INFRASTRUCTURE],
  ["CAPIR_WEB_HANDOFF_UNAVAILABLE", EXIT.INFRASTRUCTURE],
  ["CAPIR_DISABLED", EXIT.INFRASTRUCTURE],
  ["CAPIR_PREPARATION_FAILED", EXIT.INFRASTRUCTURE],
  ["CAPIR_PREPARATION_CANCELLED", EXIT.INFRASTRUCTURE],
  ["LAB_TEST_WORKSPACE_CLOSED", EXIT.INFRASTRUCTURE],
  ["LAB_WORKSPACE_LIMIT", EXIT.CAPACITY],
  ["LAB_WORKSPACE_ENTRY_LIMIT", EXIT.CAPACITY],
]);

export class CapirBackendClient {
  constructor(
    readonly origin: string,
    readonly fetchImpl: FetchLike,
    private readonly token?: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  withToken(token: string | undefined): CapirBackendClient {
    return new CapirBackendClient(this.origin, this.fetchImpl, token, this.timeoutMs);
  }

  async request<T>(
    schema: unknown,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    options: { headers?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<T> {
    // The selected request duration governs this request; a per-call
    // deadline still narrows it. One deadline covers fetch and body read.
    const deadline = requestDeadline(options.timeoutMs ?? this.timeoutMs, options.signal);
    try {
      let response: Response;
      try {
        response = await deadline.race(this.fetchImpl(`${this.origin}${path}`, {
          method,
          redirect: "error",
          headers: {
            accept: "application/json",
            ...(body !== undefined ? { "content-type": "application/json" } : {}),
            ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
            ...options.headers,
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: deadline.signal,
        }));
      } catch {
        throw new CapirCliError(
          "CAPIR_TRANSPORT",
          EXIT.INFRASTRUCTURE,
          `The capir backend at ${this.origin} could not be reached.`,
        );
      }
      let text: string;
      try {
        text = await deadline.race(response.text());
      } catch {
        throw new CapirCliError(
          "CAPIR_TRANSPORT",
          EXIT.INFRASTRUCTURE,
          `The capir backend at ${this.origin} interrupted its response.`,
        );
      }
      let parsed: unknown;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined;
        }
      }
      if (!response.ok) {
        // Error responses are untrusted too: malformed fields must never reach
        // the renderer, and an opaque credential is not a protocol error code.
        const rawError = (parsed as ErrorEnvelope | null)?.error;
        const envelope =
          rawError && typeof rawError === "object" && !Array.isArray(rawError)
            ? (rawError as { code?: unknown; message?: unknown })
            : {};
        const rawCode = envelope.code;
        const code =
          typeof rawCode === "string" &&
          /^[A-Z][A-Z0-9_]{0,79}$/.test(rawCode) &&
          redactText(rawCode) === rawCode
            ? rawCode
            : `HTTP_${response.status}`;
        throw new CapirCliError(
          code,
          EXIT_BY_CODE.get(code) ??
            (response.status === 401 || response.status === 403
              ? EXIT.AUTH_DENIED
              : response.status === 429
                ? EXIT.CAPACITY
                : response.status >= 500
                  ? EXIT.INFRASTRUCTURE
                  : EXIT.INVALID_ARGUMENTS),
          typeof envelope.message === "string"
            ? envelope.message
            : `The capir backend returned HTTP ${response.status}.`,
        );
      }
      if (!Value.Check(schema as never, parsed)) {
        throw new CapirCliError(
          "CAPIR_CONTRACT_DRIFT",
          EXIT.INFRASTRUCTURE,
          "The capir backend response does not match the capir.v1 contract.",
        );
      }
      return parsed as T;
    } finally {
      deadline.dispose();
    }
  }

  capabilities() {
    return this.request<import("@talent-signal/contracts").CapirCapabilitiesResponse>(
      CapirCapabilitiesResponseSchema as never,
      "GET",
      "/v1/capir/capabilities",
    );
  }

  authorize(body: unknown) {
    if (!Value.Check(CapirAuthorizationRequestSchema as never, body)) {
      throw new CapirCliError(
        "CAPIR_CONTRACT_DRIFT",
        EXIT.INFRASTRUCTURE,
        "The authorization request does not match the capir.v1 contract.",
      );
    }
    return this.request<import("@talent-signal/contracts").CapirAuthorizationResponse>(
      CapirAuthorizationResponseSchema as never,
      "POST",
      "/v1/capir/auth/authorize",
      body,
    );
  }

  exchange(body: unknown, options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
    if (!Value.Check(CapirExchangeRequestSchema as never, body)) {
      throw new CapirCliError(
        "CAPIR_CONTRACT_DRIFT",
        EXIT.INFRASTRUCTURE,
        "The exchange request does not match the capir.v1 contract.",
      );
    }
    return this.request<import("@talent-signal/contracts").CapirExchangeResponse>(
      CapirExchangeResponseSchema as never,
      "POST",
      "/v1/capir/auth/exchange",
      body,
      options,
    );
  }

  authStatus() {
    return this.request<import("@talent-signal/contracts").CapirAuthStatusResponse>(
      CapirAuthStatusResponseSchema as never,
      "GET",
      "/v1/capir/auth/status",
    );
  }

  logout(options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
    return this.request<{ schema_version: string; revoked_grant_id: string }>(
      LogoutResponseSchema as never,
      "POST",
      "/v1/capir/auth/logout",
      {},
      options,
    );
  }

  prepare(body: unknown) {
    if (!Value.Check(CapirSandboxRequestSchema as never, body)) {
      throw new CapirCliError(
        "CAPIR_CONTRACT_DRIFT",
        EXIT.INFRASTRUCTURE,
        "The sandbox request does not match the capir.v1 contract.",
      );
    }
    return this.request<import("@talent-signal/contracts").CapirSandboxResponse>(
      CapirSandboxResponseSchema as never,
      "POST",
      "/v1/capir/sandboxes",
      body,
    );
  }

  readSandbox(id: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
    return this.request<import("@talent-signal/contracts").CapirSandboxResponse>(
      CapirSandboxResponseSchema as never,
      "GET",
      `/v1/capir/sandboxes/${encodeURIComponent(id)}`,
      undefined,
      options,
    );
  }

  stop(id: string, operationId: string) {
    return this.request<import("@talent-signal/contracts").CapirSandboxResponse>(
      CapirSandboxResponseSchema as never,
      "POST",
      `/v1/capir/sandboxes/${encodeURIComponent(id)}/stop`,
      { id: operationId },
    );
  }

  handoff(id: string, operationId: string) {
    return this.request<import("@talent-signal/contracts").CapirHandoffResponse>(
      CapirHandoffResponseSchema as never,
      "POST",
      `/v1/capir/sandboxes/${encodeURIComponent(id)}/handoffs`,
      { id: operationId },
    );
  }
}
