import { cache } from "react";
import { cookies, headers } from "next/headers";
import type { LanguagePreference } from "@talent-signal/contracts";
import { localeCookie, resolveMarketingLocale } from "@/lib/marketing-locale";
import { loadAccountSettings } from "@/lib/server/accountBackend";

/**
 * The authenticated display-language preference, or null when there is no
 * readable account session. A readable account defaults to `system`, which
 * follows the browser independently of the public-site locale cookie.
 */
export const accountDisplayLanguage = cache(async (): Promise<LanguagePreference | null> => {
  try {
    const settings = await loadAccountSettings();
    return settings.preferences?.display_language ?? "system";
  } catch {
    return null;
  }
});

/**
 * Effective display locale for this request:
 * account preference (system follows Accept-Language), otherwise public
 * locale cookie -> weighted Accept-Language.
 */
export const getMarketingLocale = cache(async () => {
  const [cookieStore, requestHeaders, preference] = await Promise.all([
    cookies(),
    headers(),
    accountDisplayLanguage(),
  ]);
  return resolveMarketingLocale(
    preference === null ? cookieStore.get(localeCookie)?.value
      : preference === "system" ? undefined : preference,
    requestHeaders.get("accept-language") ?? "",
  );
});
