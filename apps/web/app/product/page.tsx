import type { Metadata } from "next";
import {
  MarketingSubpage,
  subpageCopy,
} from "@/components/marketing/marketing-subpage";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { getMarketingLocale } from "@/lib/server/marketing-locale";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getMarketingLocale();
  const copy = subpageCopy[locale]["product"];
  return {
    title: copy.title,
    description: copy.description,
    alternates: { canonical: "/product" },
    openGraph: {
      title: copy.title,
      description: copy.description,
      url: "/product",
      locale: locale === "en" ? "en_US" : "zh_CN",
    },
  };
}
export default async function Page() {
  const locale = await getMarketingLocale();
  return (
    <>
      <SiteHeader />
      <MarketingSubpage kind="product" locale={locale} />
      <SiteFooter />
    </>
  );
}
