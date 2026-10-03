import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { siteConfig } from "@/lib/site";
import "./globals.css";
import { getMarketingLocale } from "@/lib/server/marketing-locale";
import { MarketingLocaleProvider } from "@/components/marketing/locale-provider";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.title,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  authors: [{ name: siteConfig.name }],
  creator: siteConfig.name,
  publisher: siteConfig.name,
  keywords: [
    "个人 Agent",
    "聊天截图",
    "关系上下文",
    "客户与伙伴协作",
    "承诺与跟进",
    "关系记忆",
  ],
  alternates: {
    canonical: "/",
    types: {
      "application/rss+xml": `${siteConfig.url}/rss.xml`,
    },
  },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: "/",
    siteName: siteConfig.name,
    title: siteConfig.title,
    description: siteConfig.description,
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.title,
    description: siteConfig.description,
  },
  category: "technology",
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
    other: {
      "msvalidate.01": process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION ?? "",
    },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f1ed" },
    { media: "(prefers-color-scheme: dark)", color: "#141412" },
  ],
};

const themeScript = `
  (() => {
    try {
      const stored = localStorage.getItem("talent-signal-theme");
      const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      document.documentElement.dataset.theme = stored || (systemDark ? "dark" : "light");
    } catch {
      document.documentElement.dataset.theme = "light";
    }
  })();
`;

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const locale = await getMarketingLocale();
  return (
    <html lang={locale} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body lang="zh-CN">
        <a lang={locale} className="skip-link" href="#main-content">
          {locale === "en" ? "Skip to main content" : "跳到主要内容"}
        </a>
        <MarketingLocaleProvider locale={locale}>
          {children}
        </MarketingLocaleProvider>
      </body>
    </html>
  );
}
