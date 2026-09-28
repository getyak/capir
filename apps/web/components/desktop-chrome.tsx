"use client";

import { ArrowDown, ArrowClockwise, GearSix } from "@phosphor-icons/react";
import { useSyncExternalStore } from "react";
import styles from "./workspace-shell.module.css";

// Presentation only: the native host owns trust, the offered version and installation.
export function desktopVersion(state: unknown): string | null {
  if (!state || typeof state !== "object" || !("protocolVersion" in state) || state.protocolVersion !== 1 || !("availableVersion" in state)) return null;
  return typeof state.availableVersion === "string" && /^[\w.+() -]{1,40}$/.test(state.availableVersion)
    ? state.availableVersion : null;
}
function subscribe(callback: () => void) {
  window.addEventListener("talent-signal-desktop", callback);
  return () => window.removeEventListener("talent-signal-desktop", callback);
}
function snapshot() {
  const state = window.talentSignalDesktop;
  if (state?.protocolVersion !== 1) return null;
  const version = desktopVersion(state);
  // Additive fields keep older signed hosts usable. Legacy hosts still own their UI.
  const phase = state.phase ?? (version ? "available" : "idle");
  const progress = typeof state.progress === "number" && Number.isFinite(state.progress)
    ? Math.max(0, Math.min(100, Math.round(state.progress))) : null;
  const offerID = typeof state.offerID === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(state.offerID) ? state.offerID : null;
  return JSON.stringify({ version, phase, progress, offerID, legacy: offerID === null });
}
const serverSnapshot = () => null;

export function DesktopUpdateButton() {
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  if (!value) return null;
  const state = JSON.parse(value) as { version: string | null; phase: string; progress: number | null; legacy: boolean; offerID: string | null };
  if (state.phase === "downloading" || state.phase === "installing") {
    const label = state.phase === "installing" ? "正在更新并重启" : `正在下载更新${state.progress === null ? "" : ` ${state.progress}%`}`;
    return <span className={styles.desktopUpdate} role="status" aria-label={label} title={label}>
      <ArrowDown aria-hidden="true" size={13} weight="bold" />
      <span>{state.phase === "installing" ? "更新中" : state.progress === null ? "下载中" : `${state.progress}%`}</span>
    </span>;
  }
  if (state.phase === "failed") {
    return <a className={styles.desktopUpdate} href="talentsignal-desktop://updates" aria-label="更新未完成，重新检查更新" title="当前版本仍可使用；点击重试检查更新">
      <ArrowClockwise aria-hidden="true" size={13} /><span>重试更新</span>
    </a>;
  }
  if (state.phase !== "available" || !state.version) return null;
  const label = state.legacy ? `查看 macOS ${state.version} 更新` : `更新至 macOS ${state.version} 并重启`;
  return <a aria-label={label} className={styles.desktopUpdate} href={state.offerID ? `talentsignal-desktop://install-update?offer=${state.offerID}` : "talentsignal-desktop://updates"} title={state.legacy ? label : `${label}；点击后自动下载、校验并重启`}>
    <ArrowDown aria-hidden="true" size={13} weight="bold" /><span>{state.legacy ? "更新" : "更新并重启"}</span>
  </a>;
}

export function DesktopSettingsLink({ onClick }: { onClick: () => void }) {
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return <a href={state ? "talentsignal-desktop://settings" : "/workspace/settings"} onClick={onClick}>
    <GearSix aria-hidden="true" size={16} /><span>设置</span>{state ? <kbd>⌘ ,</kbd> : null}
  </a>;
}
