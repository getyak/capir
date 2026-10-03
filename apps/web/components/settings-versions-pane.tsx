"use client";

import { ArrowClockwise } from "@phosphor-icons/react";
import Link from "next/link";
import {
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  readDesktopRelease,
  type DesktopReleaseIdentity,
} from "@/lib/desktop-release";
import { useOptionalSystemHealth } from "./system-health-provider";
import styles from "./settings-workspace.module.css";

export type WebReleaseView = {
  revision: string;
  source: "release_file" | "vercel_git_commit_sha";
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className={styles.group}><h2>{title}</h2>{children}</section>;
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "时间未知";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function subscribeDesktop(callback: () => void) {
  window.addEventListener("talent-signal-desktop", callback);
  return () => window.removeEventListener("talent-signal-desktop", callback);
}
const desktopServerSnapshot = JSON.stringify({ available: false, appVersion: null, update: null });
function desktopSnapshot() {
  return JSON.stringify(readDesktopRelease(window.talentSignalDesktop));
}

function useDesktopRelease(): DesktopReleaseIdentity {
  const value = useSyncExternalStore(
    subscribeDesktop,
    desktopSnapshot,
    () => desktopServerSnapshot,
  );
  return JSON.parse(value) as DesktopReleaseIdentity;
}

const noopSubscribe = () => () => {};
let deviceReadAt: string | null = null;
function deviceReadAtSnapshot(): string | null {
  deviceReadAt ??= new Date().toISOString();
  return deviceReadAt;
}

function useDeviceReadAt(): string | null {
  return useSyncExternalStore(noopSubscribe, deviceReadAtSnapshot, () => null);
}

function desktopUpdateText(update: DesktopReleaseIdentity["update"]): string {
  if (!update) return "更新状态未验证";
  if (update.phase === "available") {
    return update.availableVersion
      ? `有可用更新 ${update.availableVersion}`
      : "有可用更新";
  }
  if (update.phase === "downloading") {
    return `正在下载更新${update.progress === null ? "" : ` ${update.progress}%`}`;
  }
  if (update.phase === "installing") return "正在安装更新";
  if (update.phase === "failed") return "上次更新未完成，可在应用中重试";
  if (update.phase === "checking") return "正在检查更新";
  if (update.phase === "disabled") return "此构建未启用更新";
  if (update.phase === "information") return "有更新说明可查看";
  // An idle update phase does not prove a check ran or that no update exists.
  return "更新状态未验证";
}

/**
 * Compact revision with the full value available through the title and
 * accessible text, so the source and check time stay visible next to it.
 */
function RevisionText({ value, missing }: { value: string | null; missing: string }) {
  if (!value) return <span className={styles.versionIdentity}>{missing}</span>;
  const short = value.length > 12 ? `${value.slice(0, 9)}…` : value;
  return (
    <span
      className={styles.versionIdentity}
      title={value}
      data-full-revision={value}
    >
      {short}
      <span className={styles.visuallyHidden}>完整版本 {value}</span>
    </span>
  );
}

export function SettingsVersionsPane({
  webRelease,
  webReleaseObservedAt,
}: {
  webRelease: WebReleaseView | null;
  webReleaseObservedAt: string;
}) {
  const health = useOptionalSystemHealth();
  const desktop = useDesktopRelease();
  const deviceObservedAt = useDeviceReadAt();

  const observation = health?.observation ?? null;
  const backendRevision = observation?.backend_revision ?? null;
  const backendUnknown = !observation || !backendRevision;
  let backendStatus: string;
  if (!health) {
    backendStatus = "此页面没有可用的系统检测，无法读取后端版本。";
  } else if (health.phase === "session_expired") {
    backendStatus = "登录会话已过期，请重新登录后再读取。";
  } else if (!observation) {
    backendStatus =
      health.phase === "loading" ? "正在读取后端状态…" : "暂时无法读取后端状态。";
  } else if (health.stale) {
    backendStatus = "上次结果已过期，请刷新确认。";
  } else if (!backendRevision) {
    // A healthy request proves the path was reached, not that a version was
    // returned. Never turn request health into version readback.
    backendStatus = "本次请求路径已到达后端，但后端未提供版本标识。";
  } else {
    backendStatus = "后端在本次请求中报告了此版本；这不代表它与 Web 构建兼容。";
  }

  return (
    <div className={styles.pane}>
      <p className={styles.scopeNote}>
        各端独立发布。这里显示已核验的版本与检查时间；只有取得可靠更新结果时，才会提示“可更新”。
      </p>

      <Group title="此浏览器页面">
        <section
          className={styles.versionRow}
          data-version-component="web"
          data-unknown={webRelease ? "false" : "true"}
        >
          <div className={styles.versionHead}>
            <strong>capri Web</strong>
            <RevisionText
              value={webRelease ? webRelease.revision : null}
              missing="无法确认版本"
            />
          </div>
          <p className={styles.versionMeta}>
            <span>
              来源：
              {webRelease
                ? webRelease.source === "release_file"
                  ? "当前页面的发布回执"
                  : "部署平台的构建标识"
                : "当前页面未提供可验证的版本"}
            </span>
            <span>读取于 {formatTime(webReleaseObservedAt)}</span>
          </p>
          <p className={styles.versionStatus}>
            {webRelease
              ? "这是本次页面加载使用的 Web 构建；之后部署可能已更新，刷新可重新读取。"
              : "尚无法确认这个页面的版本；不会用产品名称或文件时间猜测。"}
          </p>
          <div className={styles.versionActions}>
            <button className={styles.versionRefresh} onClick={() => window.location.reload()} type="button">
              <ArrowClockwise aria-hidden="true" size={15} />
              重新载入本页版本
            </button>
          </div>
        </section>
      </Group>

      <Group title="服务">
        <section
          className={styles.versionRow}
          data-version-component="backend"
          data-unknown={backendUnknown ? "true" : "false"}
          data-phase={health?.phase ?? "unavailable"}
        >
          <div className={styles.versionHead}>
            <strong>后端服务</strong>
            <RevisionText value={backendRevision} missing="未提供版本" />
          </div>
          <p className={styles.versionMeta}>
            <span>来源：后端服务的本次运行回报</span>
            <span>
              观测于 {observation ? formatTime(observation.observed_at) : "时间未知"}
            </span>
          </p>
          <p className={styles.versionStatus} role="status" aria-live="polite">
            {backendStatus}
          </p>
          <div className={styles.versionActions}>
            {health ? (
              <button
                className={styles.versionRefresh}
                disabled={health.refreshing}
                onClick={() => void health.refresh()}
                type="button"
              >
                <ArrowClockwise aria-hidden="true" size={15} />
                {health.refreshing ? "读取中" : "重新读取"}
              </button>
            ) : (
              <Link className={styles.versionRefresh} href="/workspace/settings/diagnostics">
                查看系统检测
              </Link>
            )}
          </div>
        </section>
      </Group>

      <Group title="此设备">
        <section
          className={styles.versionRow}
          data-version-component="macos"
          data-unknown={desktop.appVersion ? "false" : "true"}
        >
          <div className={styles.versionHead}>
            <strong>macOS 应用</strong>
            <span className={styles.versionIdentity}>
              {desktop.appVersion ?? "无法确认版本"}
            </span>
          </div>
          <p className={styles.versionMeta}>
            <span>
              来源：
              {desktop.available ? "此设备的应用窗口" : "此处无法读取 macOS 应用窗口"}
            </span>
            <span>
              {desktop.available ? `读取于 ${formatTime(deviceObservedAt)}` : "未观测"}
            </span>
          </p>
          <p className={styles.versionStatus}>
            {desktop.available
              ? desktopUpdateText(desktop.update)
              : "此页面没有可用的 macOS 应用窗口，无法读取本地版本或更新状态。"}
          </p>
        </section>
      </Group>

      <Group title="其他设备">
        <section
          className={styles.versionRow}
          data-version-component="ios"
          data-unknown="true"
        >
          <div className={styles.versionHead}>
            <strong>iPhone / iPad 应用</strong>
            <span className={styles.versionIdentity}>此设备无法读取</span>
          </div>
          <p className={styles.versionStatus}>
            已安装版本只在对应的 iPhone 或 iPad 上可见：打开 capri → 设置 → 版本与状态。这里不会从发布清单推断。
          </p>
        </section>
        <section
          className={styles.versionRow}
          data-version-component="extension"
          data-unknown="true"
        >
          <div className={styles.versionHead}>
            <strong>浏览器扩展</strong>
            <span className={styles.versionIdentity}>此设备无法读取</span>
          </div>
          <p className={styles.versionStatus}>
            已安装版本在该浏览器的 capri Capture 扩展面板顶部显示；Chrome 报告可用更新时会提示。这里不能跨浏览器读取。
          </p>
        </section>
      </Group>
    </div>
  );
}
