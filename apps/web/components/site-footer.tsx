"use client";

import Link from "next/link";
import { siteConfig } from "@/lib/site";
import {
  marketingCopy,
  marketingNavigation,
  relationshipDemoHref,
} from "@/lib/marketing-copy";
import { BrandMark } from "./brand-mark";
import { useMarketingLocale } from "./marketing/locale-provider";

export function SiteFooter({ distribution = false }: { distribution?: boolean }) {
  const locale = useMarketingLocale();
  const c = marketingCopy(locale);
  return (
    <footer className="site-footer" lang={locale}>
      <div className="shell site-footer__inner">
        <div className="site-footer__brand">
          <BrandMark
            label={
              locale === "en" ? `${siteConfig.name} home` : `${siteConfig.name} 首页`
            }
          />
          <p>{c.footer}</p>
        </div>
        <nav
          className="site-footer__links"
          aria-label={locale === "en" ? "Footer navigation" : "页脚导航"}
        >
          <div>
            <p className="footer-heading">{c.explore}</p>
            {marketingNavigation.slice(0, 4).map((href, i) => (
              <Link key={href} href={href}>
                {c.nav[i]}
              </Link>
            ))}
            <Link href={relationshipDemoHref}>{c.demo}</Link>
            <Link href="/download">
              {locale === "en" ? "Download and connect" : "下载与连接"}
            </Link>
          </div>
          <div>
            <p className="footer-heading">{c.nav[2]}</p>
            <Link href="/privacy">
              {c.privacy}
              {locale === "en" ? ` · ${c.original}` : ""}
            </Link>
            <Link href="/blog">
              {c.nav[4]}
              {locale === "en" ? ` · ${c.original}` : ""}
            </Link>
            <Link href="/rss.xml">RSS</Link>
            <Link href="/login?callbackUrl=/workspace">{c.login}</Link>
          </div>
        </nav>
      </div>
      <div className="shell site-footer__base" data-distribution={distribution || undefined}>
        <p>© {new Date().getFullYear()} {siteConfig.name}</p>
        <p>{distribution ? (locale === "en" ? "Independent releases · verifiable installation sources" : "各端独立发布 · 安装来源可核查") : c.prototype}</p>
      </div>
    </footer>
  );
}
