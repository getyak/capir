"use client";

import type { AccountSettings } from "@talent-signal/contracts";
import {
  ArrowUpRight,
  Check,
  Desktop,
  MagnifyingGlass,
  Moon,
  Sun,
} from "@phosphor-icons/react";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import { AccountSettingsPanel } from "./account-settings";
import { AvatarDefaultSettings } from "./avatar-editor";
import { SettingsVersionsPane, type WebReleaseView } from "./settings-versions-pane";
import {
  searchSettings,
  SETTINGS_SECTIONS,
  type SettingsSearchEntry,
  type SettingsSection,
} from "@/lib/settings-sections";
import {
  commitTheme,
  previewTheme,
  revertTheme,
  subscribeTheme,
  themePreferenceSnapshot,
  type ThemePreference,
} from "@/lib/theme-preference";
import styles from "./settings-workspace.module.css";

const SECTION_LABELS = new Map(
  SETTINGS_SECTIONS.map((section) => [section.id, section.label]),
);
const sectionLabel = (id: SettingsSection) => SECTION_LABELS.get(id)!;

/**
 * Settings-owned routes stay inside the Settings surface and may use client
 * navigation. Everything else is an outbound workspace destination that must
 * be an ordinary document anchor: the macOS WKWebView routes real navigation
 * actions to the main workbench in `WKNavigationDelegate`, and a Next `<Link>`
 * would intercept the click through client-side history and bypass it.
 */
function isSettingsOwnedHref(href: string): boolean {
  return (
    href === "/workspace/settings" ||
    href.startsWith("/workspace/settings/") ||
    href.startsWith("/workspace/settings?")
  );
}

function OutboundAwareLink({
  href,
  ...anchorProps
}: { href: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return isSettingsOwnedHref(href) ? (
    <Link href={href} {...anchorProps} />
  ) : (
    <a href={href} {...anchorProps} />
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className={styles.group}><h2>{title}</h2>{children}</section>;
}

function Destination({
  href,
  title,
  description,
  badge,
}: {
  href: string;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <OutboundAwareLink className={styles.destination} href={href}>
      <span><strong>{title}</strong><small>{description}</small></span>
      <span className={styles.destinationMeta}>
        {badge ? <span className={styles.destinationBadge}>{badge}</span> : null}
        <ArrowUpRight size={15} aria-hidden="true" />
      </span>
    </OutboundAwareLink>
  );
}

/**
 * Settings search over the static section/destination index. It never reads
 * people or conversations, so a query cannot surface private relationship data.
 * Arrow keys move focus through the results; Escape clears and returns focus to
 * the field; a failed query explains the available owners.
 */
function SettingsSearch({ labEnabled }: { labEnabled: boolean }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const results = useMemo(
    () => searchSettings(query, labEnabled),
    [query, labEnabled],
  );
  const hasQuery = query.normalize("NFKC").trim().length > 0;
  const showing = open && hasQuery;

  useEffect(() => {
    function onShortcut(event: KeyboardEvent) {
      if (event.isComposing || event.altKey) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    }
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onShortcut);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onShortcut);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, []);

  function focusResult(index: number) {
    const links = panelRef.current?.querySelectorAll<HTMLAnchorElement>(
      "[data-settings-result]",
    );
    links?.[index]?.focus();
  }

  function reset() {
    setOpen(false);
    setQuery("");
    setActive(-1);
  }

  return (
    <div
      className={styles.search}
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "Escape") {
          event.preventDefault();
          if (query) {
            setQuery("");
            setActive(-1);
            inputRef.current?.focus();
          } else {
            setOpen(false);
            inputRef.current?.blur();
          }
          return;
        }
        if (!showing || !results.length) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const next = event.key === "ArrowDown"
            ? (active + 1) % results.length
            : (active - 1 + results.length) % results.length;
          setActive(next);
          focusResult(next);
          return;
        }
        if (event.key === "Enter" && active >= 0) {
          event.preventDefault();
          panelRef.current
            ?.querySelectorAll<HTMLAnchorElement>("[data-settings-result]")
            [active]?.click();
        }
      }}
    >
      <label className={styles.searchField}>
        <MagnifyingGlass size={15} aria-hidden="true" />
        <span className={styles.visuallyHidden}>搜索设置</span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="搜索设置"
          autoComplete="off"
          aria-label="搜索设置"
          aria-controls="settings-search-results"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
        <kbd aria-hidden="true">⌘F</kbd>
      </label>
      {showing ? (
        <div
          className={styles.searchPanel}
          id="settings-search-results"
          data-settings-search-results
          ref={panelRef}
          aria-label="设置搜索结果"
        >
          {results.length ? (
            results.map((entry, index) => (
              <SearchResult
                active={index === active}
                entry={entry}
                key={entry.id}
                onActivate={() => setActive(index)}
                onChoose={reset}
              />
            ))
          ) : (
            <div className={styles.searchEmpty} role="status" data-settings-search-empty>
              <p>没有找到“{query.trim()}”对应的设置。</p>
              <p>
                可以试试账号、外观、连接、工作空间或截图与文档。关系资料不会出现在设置搜索中。
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SearchResult({
  active,
  entry,
  onActivate,
  onChoose,
}: {
  active: boolean;
  entry: SettingsSearchEntry;
  onActivate: () => void;
  onChoose: () => void;
}) {
  return (
    <OutboundAwareLink
      className={styles.searchResult}
      data-settings-result=""
      data-settings-hit={entry.id}
      href={entry.href}
      aria-selected={active}
      onMouseEnter={onActivate}
      onFocus={onActivate}
      onClick={onChoose}
    >
      <span className={styles.searchResultText}>
        <strong>{entry.title}</strong>
        <small>{entry.description}</small>
      </span>
      <span className={styles.searchResultMeta}>
        <span className={styles.searchScope}>{entry.scope}</span>
        <span className={styles.searchDestination}>
          {entry.destination}
          <ArrowUpRight size={12} aria-hidden="true" />
        </span>
      </span>
    </OutboundAwareLink>
  );
}

const THEME_OPTIONS = [
  { value: "system", label: "跟随系统", hint: "随设备切换", Icon: Desktop },
  { value: "light", label: "浅色", hint: "温暖清晰", Icon: Sun },
  { value: "dark", label: "深色", hint: "安静专注", Icon: Moon },
] as const satisfies readonly {
  value: ThemePreference;
  label: string;
  hint: string;
  Icon: typeof Sun;
}[];

function AppearancePane({ sessionVersion }: { sessionVersion: string | null }) {
  const timeZone = useSyncExternalStore(
    () => () => {},
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    () => "—",
  );
  const persisted = useSyncExternalStore(
    subscribeTheme,
    themePreferenceSnapshot,
    () => "system" as ThemePreference,
  );
  const [draft, setDraft] = useState<ThemePreference | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const selected = draft ?? persisted;
  const dirty = selected !== persisted;

  // An unsaved preview must never leak past Appearance. Leaving the pane
  // (section change, navigation, or reload) reapplies the saved preference,
  // including system-following resolution.
  useEffect(() => () => { revertTheme(); }, []);

  function choose(value: ThemePreference) {
    if (value === selected) return;
    setDraft(value);
    setSaved(false);
    setError("");
    previewTheme(value);
  }
  function cancel() {
    if (!dirty) return;
    revertTheme();
    setDraft(null);
    setSaved(false);
    setError("");
  }
  function save() {
    if (!draft || !dirty) return;
    if (commitTheme(draft)) {
      setDraft(null);
      setSaved(true);
      setError("");
      return;
    }
    setSaved(false);
    setError("偏好未能保存到本机浏览器，请检查存储设置后重试。预览会保留，关闭页面后不会生效。");
  }

  return (
    <div className={styles.pane}>
      <Group title="界面主题">
        <div className={styles.themes} role="radiogroup" aria-label="界面主题">
          {THEME_OPTIONS.map(({ value, label, hint, Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected === value}
              data-theme-option={value}
              onClick={() => choose(value)}
            >
              <span
                className={styles.themePreview}
                data-theme-preview={value}
                aria-hidden="true"
              >
                <i /><span><b /><b /><b /></span>
              </span>
              <span className={styles.themeLabel}>
                <Icon size={15} aria-hidden="true" />
                <span className={styles.themeName}>{label}<small>{hint}</small></span>
                {selected === value ? (
                  <span className={styles.themeSelected}>
                    <Check size={12} aria-hidden="true" />已选
                  </span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
        <p className={styles.scopeNote}>
          <span className={styles.webOnly}>偏好只保存在这台设备的浏览器中，不会同步到其他设备，也不改变工作区里的资料。</span>
          <span className={styles.desktopOnly}>偏好只保存在这台 Mac 的应用中，不会同步到其他设备，也不改变工作区里的资料。</span>
        </p>
      </Group>

      <Group title="阅读样张">
        <p className={styles.sampleNote}>下面是示例，不会使用真实联系人内容。</p>
        <article className={styles.sample} data-appearance-sample>
          <div className={styles.sampleHead}>
            <strong>林岚</strong><span>合作伙伴</span><small>最近更新 · 今天</small>
          </div>
          <p className={styles.sampleLine}>下一步先确认试点目标，再定参与人。</p>
          <p className={styles.sampleMeta}>
            已确认 · 沟通记录 9月24日 <ArrowUpRight size={13} aria-hidden="true" />
          </p>
        </article>
      </Group>

      <AvatarDefaultSettings />

      <Group title="回复偏好">
        <Destination
          href="/workspace/preferences"
          title="管理回复偏好"
          description="回复方式在单独页面编辑，避免这里出现第二个编辑器。"
        />
        {!sessionVersion ? (
          <p className={styles.notice}>当前会话不可读，重新登录后才能确认回复偏好。</p>
        ) : null}
      </Group>

      <div className={styles.actions} role="group" aria-label="外观偏好操作">
        <div className={styles.actionStatus}>
          {dirty ? (
            <p className={`${styles.actionNote} ${styles.unsaved}`} role="status">预览未保存</p>
          ) : saved ? (
            <p className={`${styles.actionNote} ${styles.savedNote}`} role="status">已保存到本机浏览器。</p>
          ) : null}
          {error ? (
            <p className={styles.errorNote} role="alert">{error}</p>
          ) : null}
        </div>
        <div className={styles.actionButtons}>
          <button type="button" onClick={cancel} disabled={!dirty}>取消</button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={save}
            disabled={!dirty}
          >
            保存偏好
          </button>
        </div>
      </div>

      <details className={styles.disclosure}>
        <summary>语言与时区</summary>
        <div className={styles.row}><span>显示语言</span><span className={styles.rowValue}>简体中文</span></div>
        <div className={styles.row}>
          <span>当前时区</span>
          <span className={styles.rowValue}>{timeZone}（跟随设备）</span>
        </div>
      </details>
    </div>
  );
}

function ConnectionsPane({ workspaceName }: { workspaceName: string | null }) {
  return (
    <div className={styles.pane}>
      <Group title="边界如何生效（说明）">
        <ol className={styles.boundary}>
          <li>
            <span className={styles.boundaryIndex}>01</span>
            <strong>可读取</strong>
            <p>只读取已授权的资料</p>
          </li>
          <li>
            <span className={styles.boundaryIndex}>02</span>
            <strong>可提议</strong>
            <p>联系人变更先复核</p>
          </li>
          <li>
            <span className={styles.boundaryIndex}>03</span>
            <strong>待你批准</strong>
            <p>每次外部操作单独确认</p>
          </li>
        </ol>
        <p className={styles.destinationNote}>
          这里是流程说明，不代表当前授权状态；真实来源与授权状态以对应页面为准。
        </p>
      </Group>

      <Group title="来源与目的地">
        <Destination
          href="/workspace/captures"
          title="手动导入的资料"
          description="导入截图与文档，并核对来源与归属。"
          badge={workspaceName ? `当前空间 · ${workspaceName}` : "当前空间"}
        />
        <Destination
          href="/workspace/extensions"
          title="浏览器收集与外部服务"
          description="查看可用扩展与真实连接状态；未连接不会在这里被假定。"
          badge={workspaceName ? `当前空间 · ${workspaceName}` : "当前空间"}
        />
        <p className={styles.destinationNote}>
          来源详情、授权与删除后果以连接服务页面返回的状态为准，这里不显示未经 API 核验的来源计数。
        </p>
      </Group>

      <aside className={styles.callout}>
        <div>
          <strong>外部行动，始终由你决定。</strong>
          <p>消息、日历与其他外部写入需要单独审阅，设置不会替你批准。</p>
        </div>
        <OutboundAwareLink href="/workspace/boundaries">
          查看数据与操作边界 <ArrowUpRight size={14} aria-hidden="true" />
        </OutboundAwareLink>
      </aside>
    </div>
  );
}

function AdvancedPane({ labEnabled }: { labEnabled: boolean }) {
  return (
    <div className={styles.pane}>
      <Group title="设备权限">
        <section className={styles.devicePermissions} id="device-permissions">
          <h3>屏幕录制权限</h3>
          <p>
            屏幕录制权限归这台 Mac 上的 capri 应用所有：打开应用 →「此 Mac 设置…」→「权限」→
            macOS 系统设置。
          </p>
          <p>这个 Web 设置页无法授予或更改系统权限。</p>
          <p>授权后回到应用，重新检查状态。</p>
        </section>
      </Group>
      <Group title="问题排查">
        <Destination href="/workspace/settings/diagnostics" title="连接诊断" description="遇到加载或连接问题时，检查服务状态。" />
        <Destination href="/workspace/monitor" title="运行记录" description="查看任务进度与需要处理的问题。" />
        <Destination href="/workspace/boundaries" title="数据与操作边界" description="了解资料访问与操作授权范围。" />
      </Group>
      {labEnabled ? (
        <Group title="内部测试">
          <Destination href="/workspace/settings/testing" title="测试空间" description="使用隔离的合成资料验证功能。" />
          <Destination href="/workspace/lab" title="功能实验室" description="查看当前启用的实验功能。" />
        </Group>
      ) : null}
    </div>
  );
}

const PANE_HINTS: Record<SettingsSection, string> = {
  overview: "头像、显示名称与个人介绍。",
  account: "管理登录方式与访问设备。",
  workspace: "空间资料、成员与访问权限。",
  appearance: "先看真实内容如何变化，再保存偏好。",
  connections: "理解资料的使用范围，每一步都能回到原处。",
  versions: "查看 Web、后端与各设备的实际版本和检查时间。",
  advanced: "遇到问题时，检查服务状态与运行记录。",
  testing: "使用隔离的合成资料验证功能。",
};

export function SettingsWorkspace({
  initial,
  sessionVersion,
  section,
  labEnabled,
  recovery,
  avatarUrl,
  webRelease,
  webReleaseObservedAt,
}: {
  avatarUrl?: string | null;
  initial: AccountSettings | null;
  sessionVersion: string | null;
  section: SettingsSection;
  labEnabled: boolean;
  webRelease?: WebReleaseView | null;
  webReleaseObservedAt?: string;
  recovery?: {
    operationRef: string | null;
    roles: {
      current: { provider: string; expiresAt: string } | null;
      duplicate: { provider: string; expiresAt: string } | null;
    };
  };
}) {
  const workspaceName = initial?.workspace.name ?? null;
  // Display-only scope labels. Browser/app wording is paired with CSS so the
  // macOS Settings scene can say "this Mac" without granting any capability.
  const scopes =
    section === "appearance"
      ? { web: "仅此浏览器 · 本机保存", desktop: "仅此 Mac · 本机保存" }
      : section === "overview"
        ? { web: "账号 · 本机头像", desktop: "账号 · 本机头像" }
        : section === "connections" && workspaceName
          ? { web: `当前空间 · ${workspaceName}`, desktop: `当前空间 · ${workspaceName}` }
          : section === "versions"
            ? { web: "各组件分别显示", desktop: "各组件分别显示" }
            : section === "testing"
              ? { web: "测试空间", desktop: "测试空间" }
              : section === "account"
                ? { web: "账号", desktop: "账号" }
                : { web: "当前空间", desktop: "当前空间" };

  return (
    <main className={styles.page} id="main-content" tabIndex={-1} data-settings-workspace data-desktop-settings-surface="1">
      <div className={styles.layout}>
        <div className={styles.sidebar}>
          <h1 className={styles.sidebarHeading}>设置</h1>
          <SettingsSearch labEnabled={labEnabled} />
          <nav className={styles.navigation} aria-label="设置分区" data-settings-navigation>
            {SETTINGS_SECTIONS.filter(
              (item) => item.id !== "testing" || labEnabled,
            ).map((item) => (
              <Link
                key={item.id}
                href={item.href}
                aria-current={section === item.id ? "page" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className={styles.content}>
          <header className={styles.heading}>
            <div>
              <p className={styles.breadcrumb}>设置 / {sectionLabel(section)}</p>
              <h2>{sectionLabel(section)}</h2>
              <p className={styles.hint}>{PANE_HINTS[section]}</p>
            </div>
            <span className={styles.scopePill} data-settings-scope>
              {scopes.desktop === scopes.web ? scopes.web : (
                <>
                  <span className={styles.webOnly}>{scopes.web}</span>
                  <span className={styles.desktopOnly}>{scopes.desktop}</span>
                </>
              )}
            </span>
          </header>

          {["overview", "account", "workspace"].includes(section) ? (
            initial ? (
              <AccountSettingsPanel
                key={`${initial.workspace.id}-${initial.user.id}-${section}`}
                initial={initial}
                avatarUrl={avatarUrl}
                section={section === "overview" ? "profile" : (section as "account" | "workspace")}
                embedded
                recovery={recovery}
              />
            ) : (
              <section className={styles.unavailable}>
                <h3>账号设置暂时无法连接</h3>
                <p>暂时无法读取最新资料。请重试，或重新登录。</p>
                <div>
                  <a href="/workspace/settings">重新载入</a>
                  <Link href="/login?callbackUrl=%2Fworkspace%2Fsettings">
                    重新登录 <ArrowUpRight aria-hidden="true" size={14} />
                  </Link>
                </div>
              </section>
            )
          ) : null}
          {section === "appearance" ? <AppearancePane sessionVersion={sessionVersion} /> : null}
          {section === "connections" ? <ConnectionsPane workspaceName={workspaceName} /> : null}
          {section === "versions" ? (
            <SettingsVersionsPane
              webRelease={webRelease ?? null}
              webReleaseObservedAt={webReleaseObservedAt ?? ""}
            />
          ) : null}
          {section === "advanced" || section === "testing" ? (
            <AdvancedPane labEnabled={labEnabled} />
          ) : null}
        </div>
      </div>
    </main>
  );
}
