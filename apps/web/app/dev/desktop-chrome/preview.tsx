"use client";
import { useEffect, useMemo, useState } from "react";
import { WorkspaceAccountMenu } from "@/components/workspace-account-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import type { DesktopChromeState } from "@/lib/desktop-release";
import { createWeeklyUsageStore, type WeeklyUsageStore } from "@/lib/weekly-usage";
import styles from "@/components/workspace-shell.module.css";

/**
 * Synthetic rehearsal for the workspace footer and account menu.
 *
 * Every value here is invented for preview only: the fixture is never a
 * production source of update or usage truth, and this route is unreachable
 * outside development.
 */

const HOST_STATES = {
  browser: null,
  idle: { protocolVersion: 1, availableVersion: null },
  available: {
    protocolVersion: 1,
    availableVersion: "0.2.0 (12)",
    phase: "available",
    offerID: "b75e9546-2b27-4ee6-bdb2-bcb11f882652",
  },
  legacy: {
    protocolVersion: 1,
    availableVersion: "0.2.0 (12)",
    phase: "available",
  },
  downloading: {
    protocolVersion: 1,
    availableVersion: "0.2.0 (12)",
    phase: "downloading",
    progress: 41,
    offerID: "b75e9546-2b27-4ee6-bdb2-bcb11f882652",
  },
  installing: {
    protocolVersion: 1,
    availableVersion: "0.2.0 (12)",
    phase: "installing",
    offerID: "b75e9546-2b27-4ee6-bdb2-bcb11f882652",
  },
  failed: {
    protocolVersion: 1,
    availableVersion: "0.2.0 (12)",
    phase: "failed",
  },
} satisfies Record<string, DesktopChromeState | null>;

type HostState = keyof typeof HOST_STATES;
type UsageMode = "real" | "ready" | "loading" | "error";

function syntheticUsageStore(mode: Exclude<UsageMode, "real">): WeeklyUsageStore {
  if (mode === "ready") {
    const now = new Date();
    const monday = new Date(now.getTime() + 8 * 3_600_000);
    monday.setUTCHours(0, 0, 0, 0);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    const start = monday.getTime() - 8 * 3_600_000;
    return createWeeklyUsageStore(() =>
      Promise.resolve({
        contract_version: "2026-08-24.10",
        schema_version: "workspace-weekly-usage.v1",
        window: {
          start: new Date(start).toISOString(),
          end: new Date(start + 7 * 86_400_000).toISOString(),
          timezone: "Asia/Shanghai",
        },
        count: 260,
        allowance: 1000,
        computed_at: now.toISOString(),
      }),
    );
  }
  if (mode === "loading") {
    return createWeeklyUsageStore(() => new Promise(() => {}));
  }
  return createWeeklyUsageStore(() => Promise.reject(new Error("synthetic")));
}

export function DesktopChromeFixture() {
  const [collapsed, setCollapsed] = useState(false);
  const [hostState, setHostState] = useState<HostState>("available");
  const [usageMode, setUsageMode] = useState<UsageMode>("ready");

  useEffect(() => {
    const state = HOST_STATES[hostState];
    if (state) window.talentSignalDesktop = { ...state, supportMailHandoff: hostState !== "legacy" } as DesktopChromeState;
    else delete window.talentSignalDesktop;
    window.dispatchEvent(new Event("talent-signal-desktop"));
    return () => {
      delete window.talentSignalDesktop;
    };
  }, [hostState]);

  const usage = useMemo<WeeklyUsageStore | null>(
    () => (usageMode === "real" ? null : syntheticUsageStore(usageMode)),
    [usageMode],
  );

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarState} data-collapsed={collapsed}>
          <div className={styles.brandRow}>
            <button aria-label="Talent Signal" className={styles.brand} onClick={() => setCollapsed(!collapsed)}>
              <span className={styles.brandMark} /><span className={styles.brandName}>Talent Signal</span>
            </button>
          </div>
        </div>
        <nav style={{ display: "grid", gap: 18, padding: 12, fontSize: 13 }}>
          <span>新对话</span><span>今天</span><span>人物</span><span>日程</span>
        </nav>
        <div className={styles.account}>
          <WorkspaceAccountMenu
            accountName="Lin"
            usage={usage}
            signOutAction={() => {}}
            workspaceName="合成测试工作区"
          />
        </div>
      </aside>
      <main style={{ padding: "15vh 8vw" }}>
        <p style={{ color: "var(--muted)", fontSize: 12 }}>桌面页脚与账号菜单 · 合成演练（不是真实数据）</p>
        <h1 style={{ fontSize: 26, fontWeight: 500, margin: "12px 0" }}>继续你的工作。</h1>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>
          更新与用量状态均为合成值，仅用于浏览器与主机内的视觉检查；悬停不会执行任何操作。
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "18px 0" }}>
          <label style={{ fontSize: 13 }}>
            主机状态{" "}
            <select
              aria-label="合成主机状态"
              onChange={(event) => setHostState(event.target.value as HostState)}
              value={hostState}
            >
              <option value="browser">浏览器（无主机）</option>
              <option value="idle">空闲 · 下载入口</option>
              <option value="available">有更新 · 可信 offer</option>
              <option value="legacy">有更新 · 旧主机</option>
              <option value="downloading">下载中</option>
              <option value="installing">安装中</option>
              <option value="failed">更新失败</option>
            </select>
          </label>
          <label style={{ fontSize: 13 }}>
            用量状态{" "}
            <select
              aria-label="合成用量状态"
              onChange={(event) => setUsageMode(event.target.value as UsageMode)}
              value={usageMode}
            >
              <option value="real">真实接口</option>
              <option value="ready">合成数据</option>
              <option value="loading">读取中</option>
              <option value="error">读取失败</option>
            </select>
          </label>
          <ThemeToggle label="切换演练明暗主题" />
        </div>
        <textarea aria-label="演练草稿" placeholder="留下一段草稿，检查更新时不会重载页面。" style={{ width: "100%", marginTop: 36, padding: 18, border: "1px solid var(--line-soft)", borderRadius: 12 }} />
      </main>
    </div>
  );
}
