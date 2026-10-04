/**
 * One-JSON-document stdout envelope with secret redaction.
 *
 * The redactor scrubs bearer material and 43+ character unbroken token-shaped
 * strings from every rendered value before it can reach stdout, stderr, or
 * error messages. Secrets must also never arrive here in the first place:
 * request bodies keep tokens out of logs and errors by construction.
 */
import { CAPIR_SCHEMA_VERSION } from "@talent-signal/contracts";

// 64-character pure hex strings are public scenario digests, not secrets.
// Token-alphabet boundary convention (shared with the proof harness and the
// receipt scanner): a token is bounded by characters OUTSIDE the token
// alphabet, never by word boundaries. Legal 43-character base64url values can
// begin or end with "-"/"_", and "\\b" fails around those non-word characters,
// letting a full credential escape redaction.
export const TOKEN_LIKE_PATTERN =
  /(?<![A-Za-z0-9._~-])(?![a-f0-9]{64}(?![A-Za-z0-9._~-]))[A-Za-z0-9._~-]{43,128}(?![A-Za-z0-9._~-])/g;
const TOKEN_LIKE = TOKEN_LIKE_PATTERN;
const BEARER_LIKE = /\bBearer\s+[^\s"']+/gi;
const AUTH_HEADER_LIKE = /("?authorization"?\s*[:=]\s*"?)[^",\s]+/gi;

export function redactText(value: string): string {
  return value
    .replace(BEARER_LIKE, "Bearer [REDACTED]")
    .replace(AUTH_HEADER_LIKE, "$1[REDACTED]")
    .replace(TOKEN_LIKE, "[REDACTED]");
}

/**
 * Suppress exact known secret values (supplied or generated passwords, the
 * operator credential, handoff secrets) even when they lack any token shape.
 * Untrusted server text may echo a chosen password; it is scrubbed here.
 */
export function redactSecrets(value: string, secrets: readonly string[]): string {
  let out = value;
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 4) {
      out = out.split(secret).join("[REDACTED]");
    }
  }
  return out;
}

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (/(token|secret|password|code_verifier)s?$/i.test(key)) {
        out[key] = typeof entry === "string" ? "[REDACTED]" : entry === null ? null : "[REDACTED]";
        continue;
      }
      out[key] = redactValue(entry);
    }
    return out;
  }
  return value;
}

export interface SuccessEnvelope {
  schema_version: typeof CAPIR_SCHEMA_VERSION;
  ok: true;
  command: string;
  [key: string]: unknown;
}

export interface FailureEnvelope {
  schema_version: typeof CAPIR_SCHEMA_VERSION;
  ok: false;
  command: string;
  error: {
    code: string;
    message: string;
    recoverable_request_id?: string;
  };
  run?: unknown;
  browser?: unknown;
  client_state?: unknown;
  generated_credential?: unknown;
}

export function successEnvelope(
  command: string,
  payload: Record<string, unknown> = {},
  rawFields?: Record<string, unknown>,
): SuccessEnvelope {
  return {
    schema_version: CAPIR_SCHEMA_VERSION,
    ok: true,
    command,
    ...((redactValue(payload) as Record<string, unknown>) ?? {}),
    // The ONLY redaction exception: the generated-credential success
    // projection of `capir test create`. It carries the CLI-generated
    // password (never a supplied one) and is added after global redaction.
    ...(rawFields ?? {}),
  };
}

export function failureEnvelope(
  command: string,
  error: {
    code: string;
    message: string;
    recoverableRequestId?: string;
    run?: unknown;
    browser?: unknown;
    clientState?: unknown;
    generatedCredential?: Record<string, unknown>;
  },
): FailureEnvelope {
  const envelope: FailureEnvelope = {
    schema_version: CAPIR_SCHEMA_VERSION,
    ok: false,
    command,
    error: {
      code: redactText(error.code),
      message: redactText(error.message),
    },
  };
  if (error.recoverableRequestId)
    envelope.error.recoverable_request_id = error.recoverableRequestId;
  if (error.run !== undefined) envelope.run = redactValue(error.run);
  if (error.browser !== undefined) envelope.browser = redactValue(error.browser);
  if (error.clientState !== undefined)
    envelope.client_state = redactValue(error.clientState);
  // Same narrow exception as successEnvelope: an otherwise successful
  // generated credential is never lost or suppressed by a later failure.
  if (error.generatedCredential !== undefined)
    envelope.generated_credential = error.generatedCredential;
  return envelope;
}

export function renderHuman(envelope: SuccessEnvelope | FailureEnvelope): string {
  if (!envelope.ok) {
    const lines = [`error ${envelope.error.code}: ${envelope.error.message}`];
    if (envelope.error.recoverable_request_id)
      lines.push(`recoverable request id: ${envelope.error.recoverable_request_id}`);
    const credential = envelope.generated_credential as
      | { username?: unknown; password?: unknown }
      | undefined;
    if (credential && typeof credential.password === "string") {
      lines.push(`username: ${String(credential.username ?? "")}`);
      lines.push(`password: ${credential.password}`);
    }
    return lines.join("\n");
  }
  const lines: string[] = [`ok ${envelope.command}`];
  for (const [key, value] of Object.entries(envelope)) {
    if (key === "schema_version" || key === "ok" || key === "command") continue;
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  return lines.join("\n");
}
