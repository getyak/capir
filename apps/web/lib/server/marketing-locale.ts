import { cache } from "react";
import { cookies, headers } from "next/headers";
import type { LocaleTag } from "@talent-signal/contracts";
import { localeCookie, resolveMarketingLocale } from "@/lib/marketing-locale";
import { loadAccountSettings } from "@/lib/server/accountBackend";

/**
 * The authenticated display-language preference, or null when there is no
 * readable account session. `system` falls through to the public negotiation.
 */
async function accountDisplayLanguage(): Promise<LocaleTag | null> {
  try {
    const settings = await loadAccountSettings();
    const preference = settings.preferences?.display_language;
    return preference && preference !== "system" ? preference : null;
  } catch {
    return null;
  }
}

/**
 * Effective display locale for this request:
 * account preference -> locale cookie -> weighted Accept-Language.
 */
export const getMarketingLocale = cache(async () => {
  const [cookieStore, requestHeaders, preference] = await Promise.all([
    cookies(),
    headers(),
    accountDisplayLanguage(),
  ]);
  return (
    preference ??
    resolveMarketingLocale(
      cookieStore.get(localeCookie)?.value,
      requestHeaders.get("accept-language") ?? "",
    )
  );
});
