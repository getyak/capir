/**
 * Local appearance preference for the authenticated workspace.
 *
 * The resolved `data-theme` attribute is the single thing CSS reads. A saved
 * choice of `system` is stored as the absence of an override, which keeps the
 * pre-hydration boot script in `app/layout.tsx` authoritative and lets the
 * device preference win without a second load. Appearance edits stage through
 * `previewTheme` and only reach storage through `commitTheme`, so cancel and
 * persistence failure (which keeps the preview but leaves the draft visibly
 * unsaved) are both honest.
 */

export const THEME_EVENT = "talent-signal:theme-change";
const THEME_KEY = "talent-signal-theme";

/** The concrete theme applied to the document. */
export type WorkspaceTheme = "light" | "dark";
/** The user's saved choice; `system` follows the device. */
export type ThemePreference = WorkspaceTheme | "system";

/** Non-persisted appearance shown while the user is editing. */
let previewOverride: ThemePreference | null = null;

function mediaQuery(): MediaQueryList | null {
  try {
    return typeof window !== "undefined" &&
      typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  } catch {
    return null;
  }
}

function systemTheme(): WorkspaceTheme {
  return mediaQuery()?.matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): WorkspaceTheme {
  return preference === "system" ? systemTheme() : preference;
}

/** The saved preference only; never the unsaved preview. */
export function themePreferenceSnapshot(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    /* Storage is unavailable; follow the device instead. */
  }
  return "system";
}

/** The concrete theme currently painted on the document. */
export function themeSnapshot(): WorkspaceTheme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function writePreference(preference: ThemePreference): boolean {
  try {
    if (preference === "system") window.localStorage.removeItem(THEME_KEY);
    else window.localStorage.setItem(THEME_KEY, preference);
    return true;
  } catch {
    return false;
  }
}

function paint(theme: WorkspaceTheme) {
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new Event(THEME_EVENT));
}

export function subscribeTheme(onChange: () => void) {
  const sync = (event: StorageEvent) => {
    if (event.key !== THEME_KEY && event.key !== null) return;
    // Another window must not steal an active, unsaved preview.
    if (previewOverride !== null) return;
    const value = event.key === null ? themePreferenceSnapshot() : event.newValue;
    document.documentElement.dataset.theme =
      value === "light" || value === "dark" ? value : systemTheme();
    onChange();
  };
  const media = mediaQuery();
  const followSystem = () => {
    if ((previewOverride ?? themePreferenceSnapshot()) !== "system") return;
    document.documentElement.dataset.theme = systemTheme();
    onChange();
  };
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", sync);
  media?.addEventListener("change", followSystem);
  // A second window can change the preference between first paint and hydration.
  try {
    if (previewOverride === null) {
      const stored = themePreferenceSnapshot();
      if (stored !== "system" || document.documentElement.dataset.theme === undefined) {
        document.documentElement.dataset.theme = resolveTheme(stored);
      }
    }
  } catch {
    /* Keep the current appearance when storage is unavailable. */
  }
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", sync);
    media?.removeEventListener("change", followSystem);
  };
}

/**
 * Stage a choice for preview without persisting it. Cancel calls `revertTheme`;
 * save calls `commitTheme`. The document repaints on every preview so the
 * synthetic sample and the rest of the workspace stay truthful.
 */
export function previewTheme(preference: ThemePreference) {
  previewOverride = preference;
  paint(resolveTheme(preference));
}

/** Discard the preview and repaint the saved preference. */
export function revertTheme(): WorkspaceTheme {
  previewOverride = null;
  const theme = resolveTheme(themePreferenceSnapshot());
  paint(theme);
  return theme;
}

/**
 * Persist the staged choice. On failure the preview is kept so the user does
 * not lose their draft, and `false` lets the caller keep it visibly unsaved.
 */
export function commitTheme(preference: ThemePreference): boolean {
  const persisted = writePreference(preference);
  previewOverride = persisted ? null : preference;
  paint(resolveTheme(preference));
  return persisted;
}

/**
 * Apply a concrete theme immediately. Retained for the existing theme toggle,
 * which writes on selection rather than staging a draft.
 */
export function applyTheme(nextTheme: WorkspaceTheme) {
  const persisted = writePreference(nextTheme);
  previewOverride = persisted ? null : nextTheme;
  paint(nextTheme);
}
