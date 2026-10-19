/** Allowlisted SDK metadata only; vendor text and stderr are never retained. */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
const SDK_ERROR_CATEGORIES = new Set([
  "authentication_failed", "oauth_org_not_allowed", "account_on_hold", "verification_required",
  "billing_error", "rate_limit", "overloaded", "invalid_request", "model_not_found",
  "server_error", "unknown", "max_output_tokens", "cloud_credential_error",
]);
const CONNECTION_HINTS = new Set([
  "ECONNRESET", "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EPIPE", "EPROTO",
  "CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_TLS_CERT_ALTNAME_INVALID",
]);
export function sdkErrorCategory(value: unknown): string | undefined {
  return typeof value === "string" && SDK_ERROR_CATEGORIES.has(value) ? value : undefined;
}
export function providerHttpStatus(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;
}
export function connectionHintsInText(value: string): string[] {
  return [...new Set(value.match(/\b[A-Z][A-Z0-9_]{2,63}\b/gu) ?? [])]
    .filter(code => CONNECTION_HINTS.has(code)).slice(0, 8);
}
export function connectionHintsInError(value: unknown): string[] {
  const result: string[] = [];
  try {
    for (let depth = 0; depth < 3 && value && typeof value === "object"; depth++) {
      // Never evaluate getters from a foreign error object.
      const code = Object.getOwnPropertyDescriptor(value, "code")?.value;
      if (typeof code === "string" && CONNECTION_HINTS.has(code) && !result.includes(code)) result.push(code);
      value = Object.getOwnPropertyDescriptor(value, "cause")?.value;
    }
  } catch { /* Diagnostics must not replace the original failure. */ }
  return result;
}

/** Inspect only the bounded tail of the existing disposable CLI debug file.
 * An SDK stderr callback enables an additional raw host debug sink; avoid it. */
export async function connectionHintsInDebugFile(path: string): Promise<string[]> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile()) return [];
    const bytes = Buffer.alloc(Math.min(stat.size, 16_384));
    const { bytesRead } = await file.read(bytes, 0, bytes.length, Math.max(0, stat.size - bytes.length));
    return connectionHintsInText(bytes.subarray(0, bytesRead).toString("utf8"));
  } catch { return []; }
  finally { await file?.close().catch(() => {}); }
}
