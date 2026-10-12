import type { FastifyLoggerOptions, FastifyRequest } from "fastify";

/** URL query parameters may contain one-use auth proofs. Keep paths only. */
export function requestLogUrl(value: string): string {
  const query = value.indexOf("?");
  const fragment = value.indexOf("#");
  const end = Math.min(query < 0 ? value.length : query, fragment < 0 ? value.length : fragment);
  return value.slice(0, end);
}

/**
 * Fixed substitute message for error-bearing log calls. Pino infers `msg` from
 * `Error.message` or `object.err.message` before serializers run, so the
 * serializer alone cannot stop raw error text from reaching the log stream.
 * This constant is the only message emitted for error values without a
 * distinct call-site message; call-site fixed messages are preserved as-is.
 */
export const SAFE_ERROR_LOG_MESSAGE =
  "Error detail redacted by request logger policy";

/**
 * Closed error category set. The category is derived only through this closed
 * mapping (or the code allowlists below); a raw `Error.name` is never emitted,
 * so user-controlled names cannot smuggle private strings into logs.
 */
export type SafeErrorCategory =
  | "api_error"
  | "aborted"
  | "database_error"
  | "error"
  | "network_error"
  | "range_error"
  | "reference_error"
  | "syntax_error"
  | "timeout"
  | "type_error"
  | "unknown";

export type SafeErrorSummary = {
  type: SafeErrorCategory;
  /** Emitted only for explicitly allowlisted stable infrastructure codes. */
  code?: string;
};

const ERROR_CATEGORY_BY_NAME: ReadonlyMap<string, SafeErrorCategory> =
  new Map<string, SafeErrorCategory>([
    ["AbortError", "aborted"],
    ["TimeoutError", "timeout"],
    ["ApiError", "api_error"],
    ["SyntaxError", "syntax_error"],
    ["TypeError", "type_error"],
    ["RangeError", "range_error"],
    ["ReferenceError", "reference_error"],
  ]);

/**
 * Closed PostgreSQL SQLSTATE allowlist. An uppercase-looking string is not a
 * stable code: only these exact codes survive serialization. App-level
 * contract codes stay at the call site (top-level `code` field), not on the
 * error value, so arbitrary error properties can never widen this set.
 */
const ALLOWED_DATABASE_ERROR_CODES: ReadonlySet<string> = new Set([
  "08000",
  "08003",
  "08006",
  "22001",
  "23502",
  "23503",
  "23505",
  "23514",
  "40001",
  "40P01",
  "42P01",
  "53300",
  "55P03",
  "57014",
  "P0001",
]);

/** Closed Node/undici syscall and protocol code allowlist. */
const ALLOWED_NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
  "ABORT_ERR",
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ENOTFOUND",
  "EPROTO",
  "ERR_STREAM_PREMATURE_CLOSE",
  "ETIMEDOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function readStringProperty(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  try {
    const candidate = value[key];
    return typeof candidate === "string" ? candidate : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The single safe error shape for the `err` and `error` log fields. It exports
 * only a closed category plus an explicitly allowlisted stable code: never a
 * raw message, stack, cause, name, constructor name, database detail/query,
 * provider body, rejected input, URLs, or any arbitrary property.
 */
export function safeErrorSummary(value: unknown): SafeErrorSummary {
  if (typeof value !== "object" || value === null) {
    return { type: "unknown" };
  }
  const record = value as Record<string, unknown>;
  const code = readStringProperty(record, "code");
  if (code !== undefined && ALLOWED_DATABASE_ERROR_CODES.has(code)) {
    return { type: "database_error", code };
  }
  if (code !== undefined && ALLOWED_NETWORK_ERROR_CODES.has(code)) {
    return { type: "network_error", code };
  }
  const name = readStringProperty(record, "name");
  const named = name === undefined ? undefined : ERROR_CATEGORY_BY_NAME.get(name);
  if (named !== undefined) {
    return { type: named };
  }
  return { type: value instanceof Error ? "error" : "unknown" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function inferredRawMessage(value: unknown): string | undefined {
  // A primitive string under an error field is itself raw error text that a
  // call-site message must never echo.
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  try {
    return typeof value.message === "string" ? value.message : undefined;
  } catch {
    return undefined;
  }
}

function resolveErrorLogMessage(
  candidate: unknown,
  inferred: ReadonlyArray<string | undefined>,
): string {
  // Pino and Fastify's automatic error logging can pass raw error text as the
  // log message; anything equal to any supported err/error value's own message
  // is private error content, not a call-site message.
  if (
    typeof candidate === "string" &&
    candidate.length > 0 &&
    !inferred.includes(candidate)
  ) {
    return candidate;
  }
  return SAFE_ERROR_LOG_MESSAGE;
}

/**
 * Normalizes error-bearing log arguments before Pino runs. This closes the
 * message-inference path (`Error.message`, `object.err.message`) that bypasses
 * serializers, while keeping caller-provided fixed messages useful.
 */
export function normalizeErrorLogArguments(
  args: readonly unknown[],
): unknown[] {
  const [first, second, ...rest] = args;
  if (first instanceof Error) {
    return [
      { err: first },
      resolveErrorLogMessage(second, [first.message]),
      ...rest,
    ];
  }
  if (isRecord(first) && (first.err !== undefined || first.error !== undefined)) {
    // Both supported error fields are compared: a message copied from the
    // value the caller placed under `error` must not bypass normalization just
    // because `err` holds a different value (or null).
    return [
      first,
      resolveErrorLogMessage(second, [
        inferredRawMessage(first.err),
        inferredRawMessage(first.error),
      ]),
      ...rest,
    ];
  }
  return [...args];
}

/** Central request/content redaction policy, including ephemeral conversations. */
export function requestLoggerOptions(level = process.env.LOG_LEVEL ?? "info") {
  // Fastify's typed err serializer advertises `message`/`stack` fields that the
  // safe policy deliberately never exports; the cast keeps that type lie
  // confined to this adapter instead of widening the safe summary shape.
  const errorSerializer = safeErrorSummary as unknown as NonNullable<
    NonNullable<FastifyLoggerOptions["serializers"]>["err"]
  >;
  return {
    level,
    hooks: {
      logMethod(
        this: unknown,
        args: unknown[],
        method: (...methodArgs: unknown[]) => void,
      ) {
        method.apply(this, normalizeErrorLogArguments(args));
      },
    },
    serializers: {
      req(request: FastifyRequest) {
        return { id: request.id, method: request.method, url: requestLogUrl(request.url ?? ""),
          hostname: request.hostname, remoteAddress: request.ip,
          ...(request.socket.remotePort === undefined ? {} : { remotePort: request.socket.remotePort }) };
      },
      err: errorSerializer,
      error: errorSerializer,
    },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.body.payload",
        "body.payload",
        "req.body.messages",
        "body.messages",
        "req.body.messages[*].content",
        "body.messages[*].content",
        "req.body.password",
        "req.body.step_up.password",
        "req.body.step_up.identity_token",
        "req.body.attempt_secret",
        "req.body.code",
        "req.body.verifier",
        "req.body.state",
        "req.body.cancel_secret",
        "req.body.verification_secret",
        "req.body.identity_token",
        "req.body.proof.password",
        "req.body.proof.identity_token",
        "req.body.access_token",
        "req.body.audio_base64",
        "req.body.content_parts[*].content_text",
        "req.body.content_parts[*].content_base64",
        "req.body.image.data_base64",
        "req.body.expected_behavior",
        "req.body.review_note",
        "headers.authorization",
        "body.password",
        "body.step_up.password",
        "body.step_up.identity_token",
        "body.attempt_secret",
        "body.code",
        "body.verifier",
        "body.state",
        "body.cancel_secret",
        "body.verification_secret",
        "body.identity_token",
        "body.proof.password",
        "body.proof.identity_token",
        "body.access_token",
        "body.audio_base64",
        "body.content_parts[*].content_text",
        "body.content_parts[*].content_base64",
        "body.image.data_base64",
        "body.expected_behavior",
        "body.review_note",
        "access_token",
        "password_scrypt",
        "attempt_secret",
        "verification_secret",
        "identity_token",
      ],
      censor: "[redacted]",
    },
  };
}
