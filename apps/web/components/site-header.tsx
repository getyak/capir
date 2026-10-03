"use client";

import { List, X } from "@phosphor-icons/react";
import Link from "next/link";
import { siteConfig } from "@/lib/site";
import { usePathname } from "next/navigation";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  marketingAccessHref,
  marketingCopy,
  marketingNavigation,
} from "@/lib/marketing-copy";
import { BrandMark } from "./brand-mark";
import { ThemeToggle } from "./theme-toggle";
import { LanguageSwitcher } from "./marketing/language-switcher";
import { useMarketingLocale } from "./marketing/locale-provider";

export function SiteHeader() {
  const locale = useMarketingLocale();
  const c = marketingCopy(locale);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const pathname = usePathname();
  const links = marketingNavigation.map((href, i) => ({
    href,
    label: c.nav[i],
  }));
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1041px)");
    const close = (event: MediaQueryListEvent) => {
      if (event.matches) setMenuOpen(false);
    };
    query.addEventListener("change", close);
    return () => query.removeEventListener("change", close);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const surfaces = [
      document.querySelector("main"),
      document.querySelector(".site-footer"),
    ];
    const previous = surfaces.map((surface) => surface?.hasAttribute("inert"));
    const overflow = document.body.style.overflow;
    surfaces.forEach((surface) => surface?.setAttribute("inert", ""));
    document.body.style.overflow = "hidden";
    return () => {
      surfaces.forEach((surface, i) => {
        if (!previous[i]) surface?.removeAttribute("inert");
      });
      document.body.style.overflow = overflow;
    };
  }, [menuOpen]);
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!menuOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    }
    if (event.key === "Tab") {
      const controls = Array.from(
        headerRef.current?.querySelectorAll<HTMLElement>(
          "a[href], button:not([disabled]), select:not([disabled])",
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }
  return (
    <header
      ref={headerRef}
      className="site-header marketing-header"
      onKeyDown={handleKeyDown}
      lang={locale}
    >
      <div className="site-header__inner">
        <BrandMark
          label={locale === "en" ? `${siteConfig.name} home` : `${siteConfig.name} 首页`}
        />
        <nav className="desktop-nav" aria-label={c.navigation}>
          {links.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname.startsWith(href) ? "page" : undefined}
              data-current={pathname.startsWith(href) || undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="site-header__actions">
          <LanguageSwitcher />
          <ThemeToggle label={c.theme} />
          <Link
            className="desktop-account-link desktop-header-action"
            href="/login?callbackUrl=/workspace"
          >
            {c.login}
          </Link>
          <a
            className="button button--compact desktop-header-action"
            href={marketingAccessHref(locale)}
          >
            {c.access}
          </a>
          <button
            ref={menuButtonRef}
            className="icon-button menu-button"
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            aria-label={menuOpen ? c.closeMenu : c.openMenu}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? (
              <X aria-hidden="true" size={20} />
            ) : (
              <List aria-hidden="true" size={20} />
            )}
          </button>
        </div>
      </div>
      {menuOpen && (
        <nav
          id="mobile-navigation"
          className="mobile-nav"
          aria-label={c.navigation}
        >
          {links.map(({ href, label }) => (
            <Link
              key={href}
              className="mobile-nav__link"
              href={href}
              onClick={() => setMenuOpen(false)}
              aria-current={pathname.startsWith(href) ? "page" : undefined}
            >
              <span>{label}</span>
              {href === "/blog" && locale === "en" && (
                <small>{c.original}</small>
              )}
            </Link>
          ))}
          <Link
            className="mobile-nav__account"
            href="/login?callbackUrl=/workspace"
            onClick={() => setMenuOpen(false)}
          >
            {c.login}
          </Link>
          <a
            className="button mobile-nav__access"
            href={marketingAccessHref(locale)}
            onClick={() => setMenuOpen(false)}
          >
            {c.access} · {c.email}
          </a>
        </nav>
      )}
    </header>
  );
}
