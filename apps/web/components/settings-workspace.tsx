"use client";
import { useT, useLocale } from "@/components/locale-provider";

import { LOCALE_ENDONYMS, type AccountSettings } from "@talent-signal/contracts";
import {
  ArrowUpRight,
  CaretDown,
  Check,
  Desktop,
  MagnifyingGlass,
  Moon,
  Sun,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import { AccountSettingsPanel } from "./account-settings";
import { DisplayLanguageSettings } from "./display-language-settings";
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
function SettingsSearch({ labEnabled, onChoose }: { labEnabled: boolean; onChoose: () => void }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const results = useMemo(
    () => searchSettings(query, labEnabled, t),
    [query, labEnabled, t],
  );
  const hasQuery = query.normalize("NFKC").trim().length > 0;
  const showing = open && hasQuery;

  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => {
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
    onChoose();
  }

  return (
    <div
      className={styles.search}
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "Escape") {
          if (query) {
            event.preventDefault();
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
        <span className={styles.visuallyHidden}>{t("搜索设置")}</span>
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder={t("搜索设置")}
          autoComplete="off"
          aria-label={t("搜索设置")}
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
          aria-label={t("设置搜索结果")}
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
              <p>{t("可以试试账号、外观、连接、工作空间或截图与文档。关系资料不会出现在设置搜索中。")}</p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One inventory at every width. On narrow screens the labelled disclosure
 * reveals search and full category names; desktop keeps the same links visible.
 * The parent keys this ephemeral chooser by section, so history also closes it.
 */
function SettingsNavigation({ section, labEnabled }: {
  section: SettingsSection;
  labEnabled: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let frame = 0;
    const media = window.matchMedia("(max-width: 900px)");
    let lastFocused: HTMLElement | null = null;
    function onFocusIn(event: FocusEvent) {
      lastFocused = event.target instanceof HTMLElement && rootRef.current?.contains(event.target)
        ? event.target : null;
    }
    function onResize() {
      // CSS can hide the focused rail before this media event, leaving body
      // active. Retain its last focus only until the user chooses another area.
      const focused = rootRef.current?.contains(document.activeElement)
        ? document.activeElement : document.activeElement === document.body ? lastFocused : null;
      if (!(focused instanceof HTMLElement) || !rootRef.current?.contains(focused)) return;
      if (media.matches) {
        // Opening the disclosure preserves focus on search/a category when the
        // desktop rail collapses around a keyboard user.
        setOpen(true);
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          if (document.activeElement === document.body && lastFocused === focused) focused.focus();
        });
      } else if (focused === triggerRef.current) {
        rootRef.current?.querySelector<HTMLAnchorElement>('[aria-current="page"]')?.focus();
      }
    }
    function onShortcut(event: KeyboardEvent) {
      if (event.isComposing || event.keyCode === 229 || event.altKey || event.defaultPrevented) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setOpen(true);
        frame = requestAnimationFrame(() => {
          const input = rootRef.current?.querySelector<HTMLInputElement>('input[type="search"]');
          input?.focus();
          input?.select();
        });
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        lastFocused = null;
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onShortcut);
    media.addEventListener("change", onResize);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onShortcut);
      media.removeEventListener("change", onResize);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, []);
  function close() {
    setOpen(false);
    if (window.matchMedia("(max-width: 900px)").matches) triggerRef.current?.focus();
  }
  return (
    <div
      className={styles.sidebar}
      ref={rootRef}
      data-settings-chooser
      data-open={open}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented &&
            !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
          event.preventDefault();
          close();
        }
      }}
    >
      <h1 className={styles.sidebarHeading}>{t("设置")}</h1>
      <button
        className={styles.categoryTrigger}
        type="button"
        ref={triggerRef}
        aria-expanded={open}
        aria-controls="settings-category-panel"
        onClick={() => setOpen(!open)}
      >
        <span className={styles.categoryContext}>{t("设置")}</span>
        <span className={styles.categoryLabel}>{t(sectionLabel(section))}</span>
        <CaretDown size={18} aria-hidden="true" />
      </button>
      <div className={styles.categoryPanel} id="settings-category-panel">
        <SettingsSearch labEnabled={labEnabled} onChoose={close} />
        <nav className={styles.navigation} aria-label={t("设置分区")} data-settings-navigation>
          {SETTINGS_SECTIONS.filter(item => item.id !== "testing" || labEnabled).map(item => (
            <Link
              key={item.id}
              href={item.href}
              aria-current={section === item.id ? "page" : undefined}
              onClick={(event) => {
                // Modified clicks keep ordinary open-in-new-tab behavior.
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                close();
              }}
            >
              <span>{t(item.label)}</span>
              {section === item.id ? <Check size={16} aria-hidden="true" /> : null}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

/** Visit lazily; retain drafts while inactive without running hidden effects. */
function RetainedSettingsPane({ active, children, section }: {
  active: boolean;
  children: ReactNode;
  section: SettingsSection;
}) {
  const [visited, setVisited] = useState(active);
  if (active && !visited) setVisited(true);
  return visited ? (
    <Activity mode={active ? "visible" : "hidden"}>
      <div data-settings-pane={section} hidden={!active} inert={!active}>{children}</div>
    </Activity>
  ) : null;
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
  const t = useT();
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
        <strong>{t(entry.title)}</strong>
        <small>{t(entry.description)}</small>
      </span>
      <span className={styles.searchResultMeta}>
        <span className={styles.searchScope}>{t(entry.scope)}</span>
        <span className={styles.searchDestination}>
          {t(entry.destination)}
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

function AppearancePane({ sessionVersion, account, accountAvailable = true }: {
  sessionVersion: string | null;
  account: AccountSettings | null;
  accountAvailable?: boolean;
}) {
  const t = useT();
  const locale = useLocale();
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

  // Activity suspends this effect while away, without discarding the draft.
  // Return to Appearance restores its preview; other panes use the saved theme.
  useEffect(() => {
    if (dirty) previewTheme(selected);
    return () => { revertTheme(); };
  }, [dirty, selected]);

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
      <Group title={t("语言")}>
        {account ? (
          <Activity mode={accountAvailable ? "visible" : "hidden"}>
            <div hidden={!accountAvailable} inert={!accountAvailable}>
              <DisplayLanguageSettings account={account} />
            </div>
          </Activity>
        ) : null}
        {!accountAvailable || !account ? (
          <p className={styles.notice}>{t("当前无法读取账号设置，重新登录后才能更改界面语言。")}</p>
        ) : null}
      </Group>

      <Group title={t("界面主题")}>
        <div className={styles.themes} role="radiogroup" aria-label={t("界面主题")}>
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
                <span className={styles.themeName}>{t(label)}<small>{t(hint)}</small></span>
                {selected === value ? (
                  <span className={styles.themeSelected}>
                    <Check size={12} aria-hidden="true" />{t("已选")}</span>
                ) : null}
              </span>
            </button>
          ))}
        </div>
        <p className={styles.scopeNote}>
          <span className={styles.webOnly}>{t("偏好只保存在这台设备的浏览器中，不会同步到其他设备，也不改变工作区里的资料。")}</span>
          <span className={styles.desktopOnly}>{t("偏好只保存在这台 Mac 的应用中，不会同步到其他设备，也不改变工作区里的资料。")}</span>
        </p>
      </Group>

      <Group title={t("阅读样张")}>
        <p className={styles.sampleNote}>{t("下面是示例，不会使用真实联系人内容。")}</p>
        <article className={styles.sample} data-appearance-sample>
          <div className={styles.sampleHead}>
            <strong>{t("林岚")}</strong><span>{t("合作伙伴")}</span><small>{t("最近更新 · 今天")}</small>
          </div>
          <p className={styles.sampleLine}>{t("下一步先确认试点目标，再定参与人。")}</p>
          <p className={styles.sampleMeta}>{t("已确认 · 沟通记录 9月24日")}<ArrowUpRight size={13} aria-hidden="true" />
          </p>
        </article>
      </Group>

      <AvatarDefaultSettings />

      <Group title={t("回复偏好")}>
        <Destination
          href="/workspace/preferences"
          title={t("管理回复偏好")}
          description={t("回复方式在单独页面编辑，避免这里出现第二个编辑器。")}
        />
        {!sessionVersion ? (
          <p className={styles.notice}>{t("当前会话不可读，重新登录后才能确认回复偏好。")}</p>
        ) : null}
      </Group>

      <div className={styles.actions} role="group" aria-label={t("外观偏好操作")}>
        <div className={styles.actionStatus}>
          {dirty ? (
            <p className={`${styles.actionNote} ${styles.unsaved}`} role="status">{t("预览未保存")}</p>
          ) : saved ? (
            <p className={`${styles.actionNote} ${styles.savedNote}`} role="status">{t("已保存到本机浏览器。")}</p>
          ) : null}
          {error ? (
            <p className={styles.errorNote} role="alert">{error}</p>
          ) : null}
        </div>
        <div className={styles.actionButtons}>
          <button type="button" onClick={cancel} disabled={!dirty}>{t("取消")}</button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={save}
            disabled={!dirty}
          >{t("保存偏好")}</button>
        </div>
      </div>

      <details className={styles.disclosure}>
        <summary>{t("语言与时区")}</summary>
        <div className={styles.row}><span>{t("显示语言")}</span><span className={styles.rowValue}>{LOCALE_ENDONYMS[locale]}</span></div>
        <div className={styles.row}>
          <span>{t("当前时区")}</span>
          <span className={styles.rowValue}>{timeZone}{t("（跟随设备）")}</span>
        </div>
      </details>
    </div>
  );
}

function ConnectionsPane({ workspaceName }: { workspaceName: string | null }) {
  const t = useT();
  return (
    <div className={styles.pane}>
      <Group title={t("边界如何生效（说明）")}>
        <ol className={styles.boundary}>
          <li>
            <span className={styles.boundaryIndex}>01</span>
            <strong>{t("可读取")}</strong>
            <p>{t("只读取已授权的资料")}</p>
          </li>
          <li>
            <span className={styles.boundaryIndex}>02</span>
            <strong>{t("可提议")}</strong>
            <p>{t("联系人变更先复核")}</p>
          </li>
          <li>
            <span className={styles.boundaryIndex}>03</span>
            <strong>{t("待你批准")}</strong>
            <p>{t("每次外部操作单独确认")}</p>
          </li>
        </ol>
        <p className={styles.destinationNote}>{t("这里是流程说明，不代表当前授权状态；真实来源与授权状态以对应页面为准。")}</p>
      </Group>

      <Group title={t("来源与目的地")}>
        <Destination
          href="/workspace/captures"
          title={t("手动导入的资料")}
          description={t("导入截图与文档，并核对来源与归属。")}
          badge={workspaceName ? `当前空间 · ${workspaceName}` : "当前空间"}
        />
        <Destination
          href="/workspace/extensions"
          title={t("浏览器收集与外部服务")}
          description={t("查看可用扩展与真实连接状态；未连接不会在这里被假定。")}
          badge={workspaceName ? `当前空间 · ${workspaceName}` : "当前空间"}
        />
        <p className={styles.destinationNote}>{t("来源详情、授权与删除后果以连接服务页面返回的状态为准，这里不显示未经 API 核验的来源计数。")}</p>
      </Group>

      <aside className={styles.callout}>
        <div>
          <strong>{t("外部行动，始终由你决定。")}</strong>
          <p>{t("消息、日历与其他外部写入需要单独审阅，设置不会替你批准。")}</p>
        </div>
        <OutboundAwareLink href="/workspace/boundaries">{t("查看数据与操作边界")}<ArrowUpRight size={14} aria-hidden="true" />
        </OutboundAwareLink>
      </aside>
    </div>
  );
}

function AdvancedPane({ labEnabled }: { labEnabled: boolean }) {
  const t = useT();
  return (
    <div className={styles.pane}>
      <Group title={t("设备权限")}>
        <section className={styles.devicePermissions} id="device-permissions">
          <h3>{t("屏幕录制权限")}</h3>
          <p>{t("屏幕录制权限归这台 Mac 上的 capri 应用所有：打开应用 →「此 Mac 设置…」→「权限」→ macOS 系统设置。")}</p>
          <p>{t("这个 Web 设置页无法授予或更改系统权限。")}</p>
          <p>{t("授权后回到应用，重新检查状态。")}</p>
        </section>
      </Group>
      <Group title={t("问题排查")}>
        <Destination href="/workspace/settings/diagnostics" title={t("连接诊断")} description={t("遇到加载或连接问题时，检查服务状态。")} />
        <Destination href="/workspace/monitor" title={t("运行记录")} description={t("查看任务进度与需要处理的问题。")} />
        <Destination href="/workspace/boundaries" title={t("数据与操作边界")} description={t("了解资料访问与操作授权范围。")} />
      </Group>
      {labEnabled ? (
        <Group title={t("内部测试")}>
          <Destination href="/workspace/settings/testing" title={t("测试空间")} description={t("使用隔离的合成资料验证功能。")} />
          <Destination href="/workspace/lab" title={t("功能实验室")} description={t("查看当前启用的实验功能。")} />
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

type SettingsWorkspaceProps = {
  avatarUrl?: string | null;
  initial: AccountSettings | null;
  sessionVersion: string | null;
  section: SettingsSection;
  labEnabled: boolean;
  connect?: "google" | "apple" | null;
  connectReturnTo?: string | null;
  webRelease?: WebReleaseView | null;
  webReleaseObservedAt?: string;
  recovery?: {
    operationRef: string | null;
    roles: {
      current: { provider: string; expiresAt: string } | null;
      duplicate: { provider: string; expiresAt: string } | null;
    };
  };
};

export function SettingsWorkspace(props: SettingsWorkspaceProps) {
  // Drafts never cross an account, workspace, or authenticated session boundary.
  // sessionVersion binds the credential and both identities independently of a
  // settings read. Only that known session may retain drafts through read errors.
  const identity = props.initial
    ? JSON.stringify([props.initial.workspace.id, props.initial.user.id])
    : null;
  const [lastIdentity, setLastIdentity] = useState(identity);
  if (identity && identity !== lastIdentity) setLastIdentity(identity);
  const scope = JSON.stringify([
    identity ?? (props.sessionVersion ? lastIdentity : null), props.sessionVersion,
  ]);
  return <SettingsWorkspaceSession key={scope} {...props} />;
}

function SettingsUnavailable({ section }: { section: SettingsSection }) {
  const t = useT();
  const router = useRouter();
  const href = SETTINGS_SECTIONS.find(item => item.id === section)!.href;
  return (
    <section className={styles.unavailable}>
      <h3>{t("账号设置暂时无法连接")}</h3>
      <p>{t("暂时无法读取最新资料。请重试，或重新登录。")}</p>
      <div>
        <button type="button" onClick={() => router.refresh()}>{t("重新载入")}</button>
        <Link href={`/login?callbackUrl=${encodeURIComponent(href)}`}>
          {t("重新登录")}<ArrowUpRight aria-hidden="true" size={14} />
        </Link>
      </div>
    </section>
  );
}

function SettingsWorkspaceSession({
  initial,
  sessionVersion,
  section,
  labEnabled,
  recovery,
  avatarUrl,
  connect,
  connectReturnTo,
  webRelease,
  webReleaseObservedAt,
}: SettingsWorkspaceProps) {
  const t = useT();
  const [lastAccount, setLastAccount] = useState(initial);
  if (initial && initial !== lastAccount) setLastAccount(initial);
  // Retained data only keeps hidden editors mounted. An unavailable read never
  // presents cached permissions, sessions or profile data as current.
  const retainedAccount = initial ?? (sessionVersion ? lastAccount : null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousSection = useRef(section);
  useEffect(() => {
    if (previousSection.current === section) return;
    previousSection.current = section;
    // A hash search result owns its destination scroll. Otherwise bring the
    // newly selected editor into view, including after keyboard/history moves.
    headingRef.current?.focus({ preventScroll: Boolean(window.location.hash) });
  }, [section]);
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
        <SettingsNavigation key={section} section={section} labEnabled={labEnabled} />

        <div className={styles.content}>
          <header className={styles.heading}>
            <div>
              <p className={styles.breadcrumb}>{t("设置")} / {t(sectionLabel(section))}</p>
              <h2 ref={headingRef} tabIndex={-1} data-settings-title>{t(sectionLabel(section))}</h2>
              <p className={styles.hint}>{t(PANE_HINTS[section])}</p>
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

          {(["overview", "account", "workspace"] as const).map(pane => (
            <RetainedSettingsPane key={pane} section={pane} active={section === pane && Boolean(initial)}>
            {retainedAccount ? (
              <AccountSettingsPanel
                initial={retainedAccount}
                avatarUrl={avatarUrl}
                section={pane === "overview" ? "profile" : pane}
                embedded
                recovery={recovery}
                connect={connect}
                connectReturnTo={connectReturnTo}
              />
            ) : null}
            </RetainedSettingsPane>
          ))}
          {!initial && ["overview", "account", "workspace", "appearance"].includes(section)
            ? <SettingsUnavailable section={section} />
            : null}
          {section === "account" ? <p><Link href="/workspace/settings/cli">{t("CLI 授权 · 查看与撤销")}</Link></p> : null}
          <RetainedSettingsPane section="appearance" active={section === "appearance"}>
            <AppearancePane sessionVersion={sessionVersion} account={retainedAccount} accountAvailable={Boolean(initial)} />
          </RetainedSettingsPane>
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
