"use client";

import {
  ArrowLeft,
  ArrowRight,
  FileImage,
  Files,
  MagnifyingGlass,
  Plus,
  PuzzlePiece,
  User,
} from "@phosphor-icons/react";
import { animate } from "motion";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";

import {
  searchSidebarPeople,
  sidebarPersonHref,
} from "@/lib/workspace-sidebar";
import { WORKSPACE_SLASH_COMMANDS } from "@/lib/workspace-composer";
import { useWorkspaceDirectory } from "./workspace-search";
import styles from "./new-conversation-add-menu.module.css";

/**
 * The composer's compact add menu.
 *
 * It only offers actions this build really performs: a local file picker when
 * a real handler is wired, honest starter prompts that stage editable draft
 * text (never submit, never grant authority), the existing extension
 * management page for connected apps and tools, and opening an authorized
 * person's living page. The people directory loads only while the people view
 * is actually open.
 */

type MenuView = "root" | "tools" | "people";

/** Declarative row actions: selection resolves them in an event handler. */
export type MenuRun =
  | { kind: "attach-files" }
  | { kind: "attach-images" }
  | { kind: "capture" }
  | { kind: "view"; view: MenuView }
  | { kind: "starter"; insert: string }
  | { kind: "navigate"; href: string };

type MenuRow = {
  id: string;
  icon: typeof Plus;
  title: string;
  detail: string;
  tag?: string;
  run: MenuRun;
};

const EXTENSIONS_HREF = "/workspace/extensions";
const PEOPLE_HREF = "/workspace/people";

function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Mirror the nearest workspace theme onto the portaled panel so scoped tokens
 * like `ts-workspace-theme quiet-workspace` survive leaving the shell DOM.
 * Runs only while the panel is open: render never touches `document`.
 */
const MIRRORED_TOKENS = [
  "--background",
  "--surface",
  "--surface-muted",
  "--surface-selected",
  "--ink",
  "--ink-soft",
  "--muted",
  "--muted-strong",
  "--line",
  "--line-soft",
  "--line-strong",
  "--edge-highlight",
  "--focus",
  "--accent",
  "--accent-strong",
  "--shadow",
  "--shadow-object",
  "--card-radius",
  "--object-radius",
  "--input-radius",
  "--button-radius",
  "--ease-out",
] as const;

function applyPortalTheme(element: HTMLElement, anchor: HTMLElement | null) {
  if (typeof document === "undefined") return;
  const scope =
    anchor?.closest<HTMLElement>(".ts-workspace-theme, .quiet-workspace") ??
    document.querySelector<HTMLElement>(
      ".ts-workspace-theme, .quiet-workspace",
    );
  for (const name of ["ts-workspace-theme", "quiet-workspace"]) {
    if (scope?.classList.contains(name)) element.classList.add(name);
  }
  const themeScope =
    anchor?.closest<HTMLElement>("[data-theme]") ??
    document.documentElement.closest<HTMLElement>("[data-theme]") ??
    (document.documentElement.hasAttribute("data-theme")
      ? document.documentElement
      : null);
  const theme = themeScope?.getAttribute("data-theme");
  if (theme) element.setAttribute("data-theme", theme);
  // Scoped token overrides live on ancestors; copy the values the panel
  // needs so the portal cannot lose them.
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") {
    return;
  }
  const source = scope ?? themeScope ?? document.documentElement;
  const computed = window.getComputedStyle(source);
  for (const token of MIRRORED_TOKENS) {
    const value = computed.getPropertyValue(token).trim();
    if (value) element.style.setProperty(token, value);
  }
}

export function ComposerAddMenu({
  binding,
  onCapture,
  onAttachImages,
  onNavigate,
  onInsertText,
  onAttachFiles,
  disabled = false,
}: {
  binding: string | null;
  onCapture?: () => void;
  /** Direct inline image attach; preferred over the source-intake capture flow. */
  onAttachImages?: () => void;
  onNavigate: (href: string) => void;
  /** Stages editable draft text. Choosing a starter never submits anything. */
  onInsertText?: (text: string) => void;
  /** Real local file intake (picker). Without it no file row is offered. */
  onAttachFiles?: () => void;
  disabled?: boolean;
}) {
  const base = useId();
  const panelId = `${base}-add-panel`;
  const groupIds: Record<MenuView, string> = {
    root: `${base}-group-root`,
    tools: `${base}-group-tools`,
    people: `${base}-group-people`,
  };
  const groupLabelIds: Record<MenuView, string> = {
    root: `${base}-group-root-label`,
    tools: `${base}-group-tools-label`,
    people: `${base}-group-people-label`,
  };
  const searchId = `${base}-people-search`;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<MenuView>("root");
  const [query, setQuery] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const focusFrame = useRef<number | null>(null);
  const positionFrame = useRef<number | null>(null);

  // The people directory is fetched only while the people view is open.
  const directory = useWorkspaceDirectory(binding, open && view === "people");
  const matches = useMemo(
    () => searchSidebarPeople(directory.data?.people, query, 8),
    [directory.data, query],
  );

  const cancelFrames = useCallback(() => {
    if (focusFrame.current !== null) {
      window.cancelAnimationFrame(focusFrame.current);
      focusFrame.current = null;
    }
    if (positionFrame.current !== null) {
      window.cancelAnimationFrame(positionFrame.current);
      positionFrame.current = null;
    }
  }, []);

  const close = useCallback(
    (returnFocus = false) => {
      cancelFrames();
      setOpen(false);
      setView("root");
      setQuery("");
      if (returnFocus) trigger.current?.focus();
    },
    [cancelFrames],
  );

  const rows: MenuRow[] = useMemo(() => {
    if (view === "tools") {
      const starters: MenuRow[] = onInsertText
        ? WORKSPACE_SLASH_COMMANDS.filter((command) => command.kind === "starter").map(
            (command) => ({
              id: `starter-${command.id}`,
              icon: FileImage,
              title: command.title,
              detail: command.description,
              tag: "起稿提示",
              run: {
                kind: "starter",
                insert: command.insert ?? "",
              } satisfies MenuRun,
            }),
          )
        : [];
      return [
        ...starters,
        {
          id: "extensions",
          icon: PuzzlePiece,
          title: "管理连接的应用与工具",
          detail: "在扩展管理页查看已连接的内容",
          run: { kind: "navigate", href: EXTENSIONS_HREF },
        },
      ];
    }
    if (view === "people") {
      return matches.map((person) => ({
        id: `person-${person.id}`,
        icon: User,
        title: person.label,
        detail: person.detail,
        run: { kind: "navigate", href: sidebarPersonHref(person) },
      }));
    }
    const rows: MenuRow[] = [];
    if (onAttachFiles) {
      rows.push({
        id: "add-files",
        icon: Files,
        title: "添加文件",
        detail: "图片随消息发送，文档文本先预览",
        run: { kind: "attach-files" },
      });
    } else if (onAttachImages) {
      rows.push({
        id: "attach-images",
        icon: FileImage,
        title: "添加图片",
        detail: "选择图片，随消息一起发送",
        run: { kind: "attach-images" },
      });
    } else if (onCapture) {
      rows.push({
        id: "capture",
        icon: FileImage,
        title: "保存并整理图片",
        detail: "拖入或粘贴截图，另存为来源",
        run: { kind: "capture" },
      });
    }
    rows.push(
      {
        id: "tools",
        icon: PuzzlePiece,
        title: "工具与技能",
        detail: onInsertText ? "起稿提示与已连接的应用" : "已连接的应用与工具",
        run: { kind: "view", view: "tools" },
      },
      {
        id: "find-person",
        icon: User,
        title: "查找人物",
        detail: "打开人物页，不发送这条消息",
        run: { kind: "view", view: "people" },
      },
    );
    return rows;
  }, [matches, onAttachFiles, onAttachImages, onCapture, onInsertText, view]);

  /** Row selection happens in event handlers only: nothing submits here. */
  function runRow(row: MenuRow) {
    const run = row.run;
    if (run.kind === "view") {
      setView(run.view);
      setQuery("");
      return;
    }
    close();
    if (run.kind === "attach-files") onAttachFiles?.();
    else if (run.kind === "attach-images") onAttachImages?.();
    else if (run.kind === "capture") onCapture?.();
    else if (run.kind === "starter") {
      // Starter prompts only stage editable draft text.
      if (run.insert) onInsertText?.(run.insert);
    } else onNavigate(run.href);
  }

  // Position the panel from the trigger rect and the visual viewport. One
  // rAF per burst; every schedule is cancellable and re-entrant.
  const position = useCallback(() => {
    const element = panel.current;
    const anchor = trigger.current;
    if (!element || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const margin = 8;
    // Everything clamps to the real visual viewport: a keyboard or a 320px
    // window shrinks the panel instead of overflowing it.
    const width = Math.max(0, Math.min(288, viewportWidth - margin * 2));
    element.style.width = `${width}px`;
    element.style.maxHeight = "none";
    const natural = element.scrollHeight;
    const below = viewportTop + viewportHeight - rect.bottom - margin * 2;
    const above = rect.top - viewportTop - margin * 2;
    const openBelow = below >= Math.min(natural, 260) || below >= above;
    const height = Math.max(0, Math.min(natural, openBelow ? below : above));
    element.style.maxHeight = `${height}px`;
    const minTop = viewportTop + margin;
    const maxTop = viewportTop + viewportHeight - margin - height;
    const top = Math.min(
      Math.max(openBelow ? rect.bottom + margin : rect.top - margin - height, minTop),
      Math.max(minTop, maxTop),
    );
    const minLeft = viewportLeft + margin;
    const maxLeft = viewportLeft + viewportWidth - margin - width;
    const left = Math.min(
      Math.max(rect.left, minLeft),
      Math.max(minLeft, maxLeft),
    );
    element.style.top = `${top}px`;
    element.style.left = `${left}px`;
    element.dataset.side = openBelow ? "below" : "above";
    // The spring grows out of the trigger, not out of the panel centre.
    element.style.transformOrigin = `${Math.max(10, Math.min(rect.left + rect.width / 2 - left, width - 10))}px ${openBelow ? "0px" : `${height}px`}`;
  }, []);

  const schedulePosition = useCallback(() => {
    if (positionFrame.current !== null) {
      window.cancelAnimationFrame(positionFrame.current);
    }
    positionFrame.current = window.requestAnimationFrame(() => {
      positionFrame.current = null;
      position();
    });
  }, [position]);

  // Theme mirroring and the first position happen before paint; observers
  // then keep the panel glued to its trigger across scroll, resize, reflow.
  useLayoutEffect(() => {
    if (!open) return;
    const element = panel.current;
    if (!element) return;
    applyPortalTheme(element, trigger.current);
    position();
    const observer = new ResizeObserver(schedulePosition);
    if (trigger.current) observer.observe(trigger.current);
    observer.observe(element);
    window.addEventListener("resize", schedulePosition);
    window.addEventListener("scroll", schedulePosition, true);
    window.visualViewport?.addEventListener("resize", schedulePosition);
    window.visualViewport?.addEventListener("scroll", schedulePosition);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedulePosition);
      window.removeEventListener("scroll", schedulePosition, true);
      window.visualViewport?.removeEventListener("resize", schedulePosition);
      window.visualViewport?.removeEventListener("scroll", schedulePosition);
    };
  }, [open, view, schedulePosition, position]);

  // The menu is context-bound: losing the surface (disabled or a changed
  // workspace binding) discards it immediately.
  useEffect(() => {
    if (disabled && open) {
      // Intentional synchronous reset: a popover must never outlive its
      // disabled context.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      close(false);
    }
  }, [disabled, open, close]);
  const seenBinding = useRef(binding);
  useEffect(() => {
    if (seenBinding.current === binding) return;
    seenBinding.current = binding;
    if (open) {
      // Intentional synchronous reset: the new binding owns no open menu.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      close(false);
    }
  }, [binding, open, close]);

  // Interruptible, critically damped arrival from the trigger; nothing loops.
  useLayoutEffect(() => {
    if (!open) return;
    const element = panel.current;
    if (!element) return;
    if (reducedMotion()) {
      element.style.opacity = "1";
      element.style.transform = "none";
      return;
    }
    const controls = animate(
      element,
      { opacity: 1, scale: 1, y: 0 },
      { type: "spring", bounce: 0, duration: 0.32 },
    );
    // The spring is retargeted from its live value on interrupt and allowed to
    // settle on its own: stopping mid-flight would only add cleanup churn.
    void controls.finished.catch(() => {});
  }, [open]);

  // The plus rotates open and back with the same spring character.
  useLayoutEffect(() => {
    const icon = trigger.current?.querySelector<SVGSVGElement>("[data-add-icon]");
    if (!icon) return;
    if (reducedMotion()) {
      icon.style.transform = open ? "rotate(45deg)" : "rotate(0deg)";
      return;
    }
    const controls = animate(
      icon,
      { rotate: open ? 45 : 0 },
      { type: "spring", bounce: 0, duration: 0.32 },
    );
    void controls.finished.catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) {
      cancelFrames();
      return;
    }
    focusFrame.current = window.requestAnimationFrame(() => {
      focusFrame.current = null;
      if (view === "people") {
        search.current?.focus();
      } else {
        panel.current
          ?.querySelector<HTMLElement>("[data-add-focus]")
          ?.focus();
      }
    });
    return cancelFrames;
  }, [open, view, cancelFrames]);

  useEffect(() => {
    if (!open) return;
    function dismissFromOutside(event: Event) {
      const target = event.target;
      if (
        target instanceof Node &&
        !panel.current?.contains(target) &&
        !trigger.current?.contains(target)
      ) {
        close(false);
      }
    }
    document.addEventListener("pointerdown", dismissFromOutside);
    document.addEventListener("focusin", dismissFromOutside);
    return () => {
      document.removeEventListener("pointerdown", dismissFromOutside);
      document.removeEventListener("focusin", dismissFromOutside);
    };
  }, [open, close]);

  function focusables(): HTMLElement[] {
    return Array.from(
      panel.current?.querySelectorAll<HTMLElement>("[data-add-focus]") ?? [],
    );
  }

  function moveFocus(direction: 1 | -1 | "first" | "last") {
    const items = focusables();
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = 0;
    if (direction === "first") next = 0;
    else if (direction === "last") next = items.length - 1;
    else if (index === -1) next = direction === 1 ? 0 : items.length - 1;
    else next = (index + direction + items.length) % items.length;
    items[next]?.focus();
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    // The menu owns Escape while it is open: an Escape here must never reach
    // a window-level handler that would stop an active run.
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (view === "root") close(true);
      else {
        setView("root");
        setQuery("");
      }
      return;
    }
    const typing =
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(-1);
    } else if (!typing && event.key === "Home") {
      event.preventDefault();
      moveFocus("first");
    } else if (!typing && event.key === "End") {
      event.preventDefault();
      moveFocus("last");
    }
    // Tab keeps its native order: a popover must never trap focus.
  }

  const panelStyle: CSSProperties = {
    opacity: 0,
    transform: "translateY(4px) scale(0.96)",
    ...(reducedMotion() ? { opacity: 1, transform: "none" } : {}),
  };

  return (
    <div className={styles.anchor}>
      <button
        aria-controls={panelId}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="添加文件、工具与提示，或查找人物"
        className={styles.trigger}
        data-add-trigger
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        ref={trigger}
        type="button"
      >
        <Plus aria-hidden="true" data-add-icon size={18} weight="bold" />
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              aria-label="添加内容与查找人物"
              className={styles.panel}
              data-add-panel
              id={panelId}
              onKeyDown={handleKeyDown}
              ref={panel}
              role="dialog"
              style={panelStyle}
            >
              {view === "root" ? (
                <div
                  aria-labelledby={groupLabelIds.root}
                  className={styles.group}
                  id={groupIds.root}
                  role="group"
                >
                  <span className="sr-only" id={groupLabelIds.root}>
                    添加内容
                  </span>
                  {rows.map((row) => (
                    <MenuButton key={row.id} row={row} onSelect={runRow} />
                  ))}
                </div>
              ) : (
                <div
                  aria-labelledby={groupLabelIds[view]}
                  className={styles.group}
                  id={groupIds[view]}
                  role="group"
                >
                  <div className={styles.viewHeader}>
                    <button
                      aria-label="返回上一级"
                      className={styles.back}
                      data-add-focus
                      onClick={() => {
                        setView("root");
                        setQuery("");
                      }}
                      onPointerDown={(event) => event.preventDefault()}
                      type="button"
                    >
                      <ArrowLeft aria-hidden="true" size={15} weight="bold" />
                    </button>
                    <span className={styles.viewTitle} id={groupLabelIds[view]}>
                      {view === "tools" ? "工具与技能" : "查找人物"}
                    </span>
                  </div>
                  {view === "people" ? (
                    <div className={styles.search}>
                      <MagnifyingGlass aria-hidden="true" size={15} />
                      <input
                        aria-label="查找人物"
                        autoComplete="off"
                        id={searchId}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="查找人物"
                        ref={search}
                        type="search"
                        value={query}
                      />
                    </div>
                  ) : null}
                  {view === "people" && directory.loading ? (
                    <p className={styles.state} role="status">
                      正在读取账号目录…
                    </p>
                  ) : view === "people" && directory.failed ? (
                    <div className={styles.state} role="status">
                      <p>人物目录暂时无法读取；这里不会用缓存或示例补齐。</p>
                      <button
                        className={styles.retry}
                        data-add-focus
                        onPointerDown={(event) => event.preventDefault()}
                        onClick={directory.retry}
                        type="button"
                      >
                        重试
                      </button>
                    </div>
                  ) : view === "people" && rows.length === 0 ? (
                    <p className={styles.state} role="status">
                      {query ? "没有匹配的人物" : "还没有人物"}
                    </p>
                  ) : (
                    rows.map((row) => (
                      <MenuButton key={row.id} row={row} onSelect={runRow} />
                    ))
                  )}
                  {view === "people" ? (
                    <button
                      className={styles.row}
                      data-add-focus
                      onClick={() => {
                        close();
                        onNavigate(PEOPLE_HREF);
                      }}
                      onPointerDown={(event) => event.preventDefault()}
                      type="button"
                    >
                      <User aria-hidden="true" className={styles.rowIcon} size={17} weight="duotone" />
                      <span className={styles.rowText}>
                        <strong>查看全部人物</strong>
                        <small>打开人物目录页</small>
                      </span>
                      <ArrowRight aria-hidden="true" className={styles.rowArrow} size={14} />
                    </button>
                  ) : null}
                </div>
              )}
              {view === "root" ? null : (
                <p className={styles.note}>
                  {view === "tools"
                    ? onInsertText
                      ? "起稿提示只把文字插入草稿，发送由你决定。"
                      : "工具在扩展管理页查看与管理。"
                    : "打开人物页不会发送这条消息；未发送内容留在本机。"}
                </p>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function MenuButton({
  row,
  onSelect,
}: {
  row: MenuRow;
  onSelect: (row: MenuRow) => void;
}) {
  const Icon = row.icon;
  return (
    <button
      className={styles.row}
      data-add-focus
      onClick={() => onSelect(row)}
      onPointerDown={(event) => event.preventDefault()}
      type="button"
    >
      <Icon aria-hidden="true" className={styles.rowIcon} size={17} weight="duotone" />
      <span className={styles.rowText}>
        <strong>{row.title}</strong>
        <small>{row.detail}</small>
      </span>
      {row.tag ? (
        <span className={styles.rowTag}>{row.tag}</span>
      ) : (
        <ArrowRight aria-hidden="true" className={styles.rowArrow} size={14} />
      )}
    </button>
  );
}
