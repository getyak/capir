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
  ) {}

  withToken(token: string | undefined): CapirBackendClient {
    return new CapirBackendClient(this.origin, this.fetchImpl, token);
  }

  async request<T>(
    schema: unknown,
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    options: { headers?: Record<string, string>; signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<T> {
    let response: Response;
    const signal = AbortSignal.any([
      ...(options.signal ? [options.signal] : []),
      AbortSignal.timeout(options.timeoutMs ?? 30_000),
    ]);
    try {
      response = await this.fetchImpl(`${this.origin}${path}`, {
        method,
        redirect: "error",
        headers: {
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          ...options.headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal,
      });
    } catch {
      throw new CapirCliError(
        "CAPIR_TRANSPORT",
        EXIT.INFRASTRUCTURE,
        `The capir backend at ${this.origin} could not be reached.`,
      );
    }
    let text: string;
    try {
      text = await response.text();
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
