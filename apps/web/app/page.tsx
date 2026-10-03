import type { Metadata } from "next";
import { MarketingHome } from "@/components/marketing/marketing-home";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { StructuredData } from "@/components/structured-data";
import { personalAgentHomeFaqs } from "@/lib/personal-agent-copy";
import { getMarketingLocale } from "@/lib/server/marketing-locale";
import { siteConfig } from "@/lib/site";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getMarketingLocale();
  const c = { title: locale === "en" ? `${siteConfig.name} | Keep important people and unfinished things close` : siteConfig.title, promise: locale === "en" ? "Keep the context, promises, and changes in a chat. Your personal Agent helps you continue the next conversation." : siteConfig.description, faqs: personalAgentHomeFaqs(locale) };
  const title = c.title;
  return {
    title: { absolute: title },
    description: c.promise,
    alternates: { canonical: "/" },
    openGraph: {
      title,
      description: c.promise,
      locale: locale === "en" ? "en_US" : "zh_CN",
    },
  };
}

export default async function HomePage() {
  const locale = await getMarketingLocale();
  const c = { title: locale === "en" ? `${siteConfig.name} | Keep important people and unfinished things close` : siteConfig.title, promise: locale === "en" ? "Keep the context, promises, and changes in a chat. Your personal Agent helps you continue the next conversation." : siteConfig.description, faqs: personalAgentHomeFaqs(locale) };
  return (
    <>
      <StructuredData
        value={{
          "@context": "https://schema.org",
          "@type": "Organization",
          name: siteConfig.name,
          url: siteConfig.url,
          description: c.promise,
        }}
      />
      <StructuredData
        value={{
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: c.faqs.map(([question, answer]) => ({
            "@type": "Question",
            name: question,
            acceptedAnswer: { "@type": "Answer", text: answer },
          })),
        }}
      />
      <SiteHeader />
      <MarketingHome locale={locale} />
      <SiteFooter />
    </>
  );
}
