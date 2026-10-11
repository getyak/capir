/**
 * Same-origin redirect target validation.
 *
 * Browser-safe by contract: no Node built-ins and no server-only imports, so
 * client components may import it directly. `auth-config` re-exports it for
 * compatibility. The function can only ever return the fallback or a
 * same-origin path; an injected absolute URL, protocol-relative host,
 * traversal or control character collapses to the fallback.
 */
export function safeRedirectTarget(
  value: FormDataEntryValue | null | undefined,
  fallback = "/workspace",
) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    /[\u0000-\u0020\u007f]/.test(value)
  ) {
    return fallback;
  }

  try {
    const target = new URL(value, "https://redirect.invalid");
    if (target.origin !== "https://redirect.invalid") return fallback;
    return target.pathname + target.search + target.hash;
  } catch { return fallback; }
}
