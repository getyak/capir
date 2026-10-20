import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { readBackendSessionClaims } from "@/lib/server/backendAuth";
import { contactHandoffSessionVersion } from "@/lib/server/contact-handoff-session";
import { backendSessionIsExpired } from "@/lib/backend-session";
import { AgentResponsePreference } from "@/components/agent-response-preference";
import { translate } from "@/lib/i18n";
import { getMarketingLocale } from "@/lib/server/marketing-locale";

import styles from "@/components/agent-review-form.module.css";

export default async function PreferencesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const claims = await readBackendSessionClaims();
  if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) redirect("/login");
  const sessionVersion = contactHandoffSessionVersion(claims);
  const locale = await getMarketingLocale();
  return <main className={styles.page}><Link className={styles.back} href="/workspace">{translate(locale, "返回工作台")}</Link><AgentResponsePreference key={sessionVersion} sessionVersion={sessionVersion} /></main>;
}
