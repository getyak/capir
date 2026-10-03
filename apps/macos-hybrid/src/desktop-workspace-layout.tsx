import { useState, type ReactNode } from "react";

/** Host presentation only. Session authority stays in App and the native bridge. */
export function DesktopWorkspaceLayout({ accountName, title, status, children }: {
  accountName: string | null;
  title: string;
  status: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="ts-workspace-theme app-shell" data-collapsed={collapsed}>
      <a className="skip-link" href="#workspace">跳到工作区</a>
      <aside className="sidebar" aria-label="capri 工作区">
        <div className="brand">
          <span aria-hidden="true" className="brand-mark">TS</span>
          <strong>capri</strong>
          <button className="collapse-control" type="button" onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"} aria-expanded={!collapsed}
            title={collapsed ? "展开侧栏" : "收起侧栏"}>
            <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor">
              <rect x="2" y="3" width="16" height="14" rx="2" /><path d="M7 3v14" />
            </svg>
          </button>
        </div>
        <nav aria-label="工作区章节">
          <a href="#workspace" title="当前对话"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor"><path d="M17 9.5a7 7 0 0 1-7 7H4l-2 1 1-4a7 7 0 1 1 14-4Z" /></svg><span>当前对话</span></a>
          <a href="#connection" title="本机连接"><svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor"><path d="M7 2v5m6-5v5M5 7h10v3a5 5 0 0 1-10 0Zm5 8v3" /></svg><span>本机连接</span></a>
        </nav>
        <div className="sidebar-foot" title={accountName ?? "尚未连接"}>
          <span className="account-monogram" aria-hidden="true">{accountName?.slice(0, 1) ?? "—"}</span>
          <span>{accountName ?? "尚未连接"}</span>
        </div>
      </aside>
      <main id="workspace" tabIndex={-1}>
        <header className="topbar">
          <div><p className="eyebrow">本机工作区</p><h1>{title}</h1></div>
          {status}
        </header>
        {children}
      </main>
    </div>
  );
}
