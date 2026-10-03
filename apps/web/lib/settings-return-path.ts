/**
 * Login-continuity path for Web settings.
 *
 * Account settings deliberately live in the browser, so a signed-out person who
 * follows an account link must land back on the same pane after login. That
 * return target is derived here, once, from a schema-validated section id.
 *
 * Security property: this module can only ever produce a fixed same-origin
 * `/workspace/settings` path. The query value is never reflected, concatenated
 * or otherwise reused, so an injected absolute URL, protocol-relative host,
 * traversal segment, array or arbitrary object collapses to the settings
 * overview instead of becoming a redirect destination.
 */

import { isSettingsSection, type SettingsSection } from "./settings-sections";

/**
 * Resolve a raw `?section=` query value to a real section.
 *
 * Next.js may hand a repeated parameter through as `string[]`, and a missing or
 * unknown value is not an error: settings always has an overview to show.
 */
export function settingsSectionFrom(value: unknown): SettingsSection {
  return typeof value === "string" && isSettingsSection(value)
    ? value
    : "overview";
}

/** The single canonical return path for a settings section. */
export function settingsReturnPath(value: unknown): string {
  const section = settingsSectionFrom(value);
  // `overview` is the bare route; every other section is an allowlisted id.
  return section === "overview"
    ? "/workspace/settings"
    : `/workspace/settings?section=${section}`;
}
