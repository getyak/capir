"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSyncExternalStore, useTransition } from "react";
import { isMarketingLocale, localeCookie, marketingLocales } from "@/lib/marketing-locale";
import { LOCALE_ENDONYMS } from "@talent-signal/contracts";
import { useAccountLocale, useMarketingLocale, useT } from "./locale-provider";

const subscribeToHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function LanguageSwitcher() {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    clientReady,
    serverReady,
  );
  const locale = useMarketingLocale();
  const accountLocale = useAccountLocale();
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  if (accountLocale) {
    return <Link className="site-language" href="/workspace/settings?section=appearance"
      aria-label={`${t("language.section.title")}: ${LOCALE_ENDONYMS[locale]}`}>
      {LOCALE_ENDONYMS[locale]}
    </Link>;
  }
  return (
    <select
      className="site-language"
      aria-label={t("language.section.title")}
      value={locale}
      disabled={pending || !hydrated}
      onChange={(event) => {
        const next = event.target.value;
        if (!isMarketingLocale(next)) return;
        document.cookie = `${localeCookie}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
        startTransition(() => router.refresh());
      }}
    >
      {marketingLocales.map((tag) => (
        <option key={tag} value={tag}>{LOCALE_ENDONYMS[tag]}</option>
      ))}
    </select>
  );
}
