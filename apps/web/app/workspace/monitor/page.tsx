import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProductRunMonitor } from "@/components/product-run-monitor";
import { backendSessionIsExpired } from "@/lib/backend-session";
import { readBackendSessionClaims } from "@/lib/server/backendAuth";
import { contactHandoffSessionVersion } from "@/lib/server/contact-handoff-session";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "运行与反馈", robots: { index: false, follow: false } };
export default async function MonitorPage() {
  const claims = await readBackendSessionClaims();
  if (!claims || backendSessionIsExpired(claims.backendExpiresAt)) redirect("/login?callbackUrl=%2Fworkspace%2Fmonitor");
  const binding = contactHandoffSessionVersion(claims);
  return <ProductRunMonitor key={binding} sessionBinding={binding} />;
}
