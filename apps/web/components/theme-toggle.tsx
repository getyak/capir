"use client";

import { Moon, Palette, Sun } from "@phosphor-icons/react";
import { useSyncExternalStore } from "react";

import { applyTheme, subscribeTheme, themeSnapshot } from "@/lib/theme-preference";
import { useT } from "./locale-provider";

/**
 * One theme control with two honest presentations: a circular icon action for
 * headers, and a menu row that names the current appearance in text.
 */
export function ThemeToggle({
  label = "切换明暗主题",
  showValue = false,
  variant = "icon",
}: {
  label?: string;
  showValue?: boolean;
  variant?: "icon" | "row";
}) {
  const t = useT();
  const localizedLabel = t(label);
  const theme = useSyncExternalStore(subscribeTheme, themeSnapshot, () => "light");

  function toggleTheme() {
    applyTheme(theme === "light" ? "dark" : "light");
  }

  if (variant === "row") {
    return (
      <button
        aria-label={localizedLabel}
        className="theme-toggle theme-toggle--row"
        onClick={toggleTheme}
        title={localizedLabel}
        type="button"
      >
        <Palette aria-hidden="true" size={16} />
        <span>{t("外观")}</span>
        <span className="theme-toggle__value">
          {showValue ? t(theme === "dark" ? "深色" : "浅色") : null}
        </span>
      </button>
    );
  }

  return (
    <button
      className="icon-button theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label={localizedLabel}
      title={localizedLabel}
    >
      <span className="theme-toggle__dark" aria-hidden="true">
        <Moon aria-hidden="true" size={18} weight="regular" />
      </span>
      <span className="theme-toggle__light" aria-hidden="true">
        <Sun aria-hidden="true" size={18} weight="regular" />
      </span>
    </button>
  );
}
