"use client";

import type { AccountSettings } from "@talent-signal/contracts";
import { ArrowUpRight, CaretRight, Moon, Sun } from "@phosphor-icons/react";
import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { AccountSettingsPanel } from "./account-settings";
import { AgentResponsePreference } from "./agent-response-preference";
import { AvatarDefaultSettings } from "./avatar-editor";
import { SETTINGS_SECTIONS, type SettingsSection } from "@/lib/settings-sections";
import { applyTheme, subscribeTheme, themeSnapshot } from "@/lib/theme-preference";
import styles from "./settings-workspace.module.css";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className={styles.group}><h2>{title}</h2>{children}</section>;
}
function Row({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <div className={styles.row}><div><strong>{title}</strong>{description && <p>{description}</p>}</div>{children}</div>;
}
function Destination({ href, title, description }: { href: string; title: string; description: string }) {
  return <Link className={styles.destination} href={href}><span><strong>{title}</strong><small>{description}</small></span><CaretRight size={16} aria-hidden="true" /></Link>;
}
function ThemeChoice() {
  const theme = useSyncExternalStore(subscribeTheme, themeSnapshot, () => "light");
  return <div className={styles.themes} role="group" aria-label="界面主题">
    {([{ value: "light", label: "浅色", Icon: Sun }, { value: "dark", label: "深色", Icon: Moon }] as const).map(({ value, label, Icon }) =>
      <button key={value} type="button" aria-pressed={theme === value} onClick={() => applyTheme(value)}>        <span className={styles.themePreview} data-theme-preview={value} aria-hidden="true"><i /><span><b /><b /><b /></span></span>
        <span className={styles.themeLabel}><Icon size={16} aria-hidden="true" />{label}<span aria-hidden="true" className={styles.radio} /></span>
      </button>)}
  </div>;
}
function AppearancePane({ sessionVersion }: { sessionVersion: string | null }) {
  const timeZone = useSyncExternalStore(() => () => {}, () => Intl.DateTimeFormat().resolvedOptions().timeZone, () => "—");
  return <div className={styles.pane}>
    <Group title="界面主题"><ThemeChoice /></Group>
    <AvatarDefaultSettings />
    <Group title="回复偏好">{sessionVersion ? <AgentResponsePreference sessionVersion={sessionVersion} embedded /> : <p className={styles.notice}>重新登录后可设置回复偏好。</p>}</Group>
    <details className={styles.disclosure}><summary>语言与时区</summary>
      <Row title="显示语言"><span className={styles.rowValue}>简体中文</span></Row>
      <Row title="当前时区" description="跟随设备设置。"><span className={styles.rowValue}>{timeZone}</span></Row>
    </details>
  </div>;
}
function ConnectionsPane() {
  return <div className={styles.pane}><Group title="资料与连接">
    <Destination href="/workspace/extensions" title="连接服务" description="查看可用扩展与连接状态" />
    <Destination href="/workspace/captures" title="已导入资料" description="查看和管理已交给工作区的资料" />
  </Group><details className={styles.disclosure}><summary>设备权限</summary><p>截屏、录音和通知权限在对应设备的原生应用中管理。</p></details></div>;
}
function AdvancedPane({ labEnabled }: { labEnabled: boolean }) {
  return <div className={styles.pane}><Group title="问题排查">
    <Destination href="/workspace/settings/diagnostics" title="连接诊断" description="遇到加载或连接问题时，检查服务状态" />
    <Destination href="/workspace/monitor" title="运行记录" description="查看任务进度与需要处理的问题" />
    <Destination href="/workspace/boundaries" title="数据与操作边界" description="了解资料访问与操作授权范围" />
  </Group>{labEnabled && <Group title="内部测试"><Destination href="/workspace/settings/testing" title="测试空间" description="使用隔离的合成资料验证功能" /><Destination href="/workspace/lab" title="功能实验室" description="查看当前启用的实验功能" /></Group>}</div>;
}
const titles: Record<SettingsSection, string> = { overview: "个人资料", account: "账号与安全", workspace: "工作空间", appearance: "外观与偏好", connections: "连接与权限", advanced: "帮助与诊断", testing: "测试与诊断" };
const hints: Partial<Record<SettingsSection, string>> = { account: "管理登录方式与访问设备。", workspace: "空间资料、成员与访问权限。", appearance: "让工作区更合你的习惯。", connections: "管理工作区使用的资料与服务。" };
export function SettingsWorkspace({ initial, sessionVersion, section, labEnabled, recovery, avatarUrl }: {
  avatarUrl?: string | null; initial: AccountSettings | null; sessionVersion: string | null; section: SettingsSection; labEnabled: boolean;
  recovery?: { operationRef: string | null; roles: { current: { provider: string; expiresAt: string } | null; duplicate: { provider: string; expiresAt: string } | null } };
}) {
  const primary = ["overview", "account", "appearance", "workspace", "connections"];
  const link = (id: SettingsSection) => { const item = SETTINGS_SECTIONS.find(item => item.id === id)!; return <Link key={id} href={item.href} aria-current={section === id ? "page" : undefined}>{titles[id]}</Link>; };
  return <main className={styles.page} id="main-content" tabIndex={-1} data-settings-workspace>
    <header className={styles.header}>
      <h1>设置</h1>
      <p>管理账号、外观与工作偏好。</p>
    </header>
    <nav className={styles.navigation} aria-label="设置分区" data-settings-navigation>
      <div className={styles.primaryNav}>{primary.map(id => link(id as SettingsSection))}</div>
      <details className={styles.more} open={section === "advanced" || section === "testing" ? true : undefined}>
        <summary>更多设置</summary>{link("advanced")}{labEnabled && link("testing")}
      </details>
    </nav>
    <div className={styles.content}>
      <header className={styles.heading}><h2>{titles[section]}</h2>{hints[section] && <p>{hints[section]}</p>}</header>
      {["overview", "account", "workspace"].includes(section) ? initial ?
        <AccountSettingsPanel key={`${initial.workspace.id}-${initial.user.id}-${section}`} initial={initial} avatarUrl={avatarUrl} section={section === "overview" ? "profile" : section as "account" | "workspace"} embedded recovery={recovery} /> :
        <section className={styles.unavailable}><h3>账号设置暂时无法连接</h3><p>暂时无法读取最新资料。请重试，或重新登录。</p><div><a href="/workspace/settings">重新载入</a><Link href="/login?callbackUrl=%2Fworkspace%2Fsettings">重新登录 <ArrowUpRight aria-hidden="true" size={14} /></Link></div></section> : null}
      {section === "appearance" && <AppearancePane sessionVersion={sessionVersion} />}
      {section === "connections" && <ConnectionsPane />}
      {(section === "advanced" || section === "testing") && <AdvancedPane labEnabled={labEnabled} />}
    </div>
  </main>;
}
