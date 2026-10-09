"use client";

import { GearSix, Globe } from "@phosphor-icons/react";
import { useSyncExternalStore } from "react";
import styles from "./workspace-shell.module.css";

// Presentation only: the native host owns trust, the offered version and installation.
export function desktopVersion(state: unknown): string | null {
  if (!state || typeof state !== "object" || !("protocolVersion" in state) || state.protocolVersion !== 1 || !("availableVersion" in state)) return null;
  return typeof state.availableVersion === "string" && /^[\w.+() -]{1,40}$/.test(state.availableVersion)
    ? state.availableVersion : null;
}

export type DesktopUpdatePhase =
  | "idle"
  | "available"
  | "downloading"
  | "installing"
  | "failed";

export type DesktopChromeSnapshot = {
  version: string | null;
  phase: DesktopUpdatePhase;
  progress: number | null;
  offerID: string | null;
  /** A host without a trusted offer ID keeps its legacy review flow. */
  legacy: boolean;
  supportMailHandoff: boolean;
};

function subscribe(callback: () => void) {
  window.addEventListener("talent-signal-desktop", callback);
  return () => window.removeEventListener("talent-signal-desktop", callback);
}
function snapshot() {
  const state = window.talentSignalDesktop;
  if (state?.protocolVersion !== 1) return null;
  const version = desktopVersion(state);
  // Additive fields keep older signed hosts usable. Legacy hosts still own their UI.
  const rawPhase = state.phase ?? (version ? "available" : "idle");
  const phase: DesktopUpdatePhase =
    rawPhase === "downloading" || rawPhase === "installing" || rawPhase === "failed"
      ? rawPhase
      : rawPhase === "available" && version
        ? "available"
        : "idle";
  const progress = typeof state.progress === "number" && Number.isFinite(state.progress)
    ? Math.max(0, Math.min(100, Math.round(state.progress))) : null;
  const offerID = typeof state.offerID === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(state.offerID) ? state.offerID : null;
  return JSON.stringify({ version, phase, progress, offerID, legacy: offerID === null, supportMailHandoff: state.supportMailHandoff === true } satisfies DesktopChromeSnapshot);
}
const serverSnapshot = () => null;

/** Hosted desktop state, or null in an ordinary browser. */
export function useDesktopChrome(): DesktopChromeSnapshot | null {
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return value ? (JSON.parse(value) as DesktopChromeSnapshot) : null;
}

/** The existing trusted host protocol; only the host may install. */
export function installUpdateHref(state: DesktopChromeSnapshot): string {
  return state.offerID
    ? `talentsignal-desktop://install-update?offer=${state.offerID}`
    : "talentsignal-desktop://updates";
}

/**
 * Updates-available banner at the top of the avatar popover. The explicit
 * action uses the host's existing trusted install protocol; hovering it never
 * executes anything.
 */
export function DesktopUpdateBanner({ onNavigate }: { onNavigate?: () => void }) {
  const state = useDesktopChrome();
  if (!state || state.phase !== "available" || !state.version) return null;
  const label = state.legacy
    ? `查看 macOS ${state.version} 更新`
    : `更新至 macOS ${state.version} 并重启`;
  return (
    <div className={styles.updateBanner} role="status">
      <span className={styles.updateBannerText}>
        <strong>macOS {state.version}</strong>
        <small>
          {state.legacy
            ? "此主机在应用内查看更新。"
            : "下载校验后重启应用。"}
        </small>
      </span>
      <a
        aria-label={label}
        href={installUpdateHref(state)}
        onClick={onNavigate}
      >
        {state.legacy ? "查看" : "安装"}
      </a>
    </div>
  );
}

function settingsHrefFor(hosted: boolean, scheme: string, fallback: string) {
  return hosted ? scheme : fallback;
}

/** Native account management opens the browser; Web stays in its workspace. */
export function DesktopAccountLink({ onClick }: { onClick: () => void }) {
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return (
    <a
      aria-label={state ? "账号与偏好（在默认浏览器中打开）" : "账号与偏好"}
      href={settingsHrefFor(Boolean(state), "talentsignal-desktop://account-settings", "/workspace/settings")}
      onClick={onClick}
    >
      <Globe aria-hidden="true" size={16} />
      <span>{state ? "账号与偏好 ↗" : "账号与偏好"}</span>
    </a>
  );
}

export function DesktopAccountNotice() {
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  if (!state) return null;
  return <span className={styles.accountMetaRow}>
    <span aria-label="账号与偏好会在此账号的默认浏览器中打开；浏览器的登录状态可能与本应用不同。">
      在此账号的默认浏览器中打开 · 浏览器登录状态可能与本应用不同
    </span>
  </span>;
}

/** The native window owns device settings only, so it is offered only where a
 * native host exists. Browsers keep the ordinary Web settings route. */
export function DesktopDeviceSettingsLink({ onClick }: { onClick: () => void }) {
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  if (!state) return null;
  return (
    <a href="talentsignal-desktop://settings" onClick={onClick}>
      <GearSix aria-hidden="true" size={16} />
      <span>此 Mac 设置…</span>
      <kbd>⌘ ,</kbd>
    </a>
  );
}
