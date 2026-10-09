"use client";

import { memo, useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

import {
  extractiveReadingPreview,
  isLongAnswer,
} from "@/lib/conversation-extractive-preview";
import styles from "./conversation-response.module.css";

/**
 * Provenance line for one response block: real, governed source names only.
 * Source URLs stay behind their explicit evidence controls and are never
 * promoted to citations by this presentation.
 */
export function ConversationProvenance({
  sources,
}: {
  sources?: ReadonlyArray<{ display_name: string }> | null;
}) {
  const names = (sources ?? [])
    .map((source) => source.display_name.trim())
    .filter((name) => name.length > 0);
  return (
    <p className={styles.provenance}>
      依据 · {names.length ? names.join(" · ") : "未附引用来源"}
    </p>
  );
}

type WebKitGestureEvent = Event & { scale?: number };

/** Code, tables and scrollable regions keep their own gestures. */
function insideProtectedRegion(target: EventTarget | null): boolean {
  return target instanceof Element &&
    Boolean(target.closest("pre, table, [data-no-fold]"));
}

/** Never fold while the reader has text selected. */
function hasTextSelection(): boolean {
  try {
    const selection = window.getSelection();
    return Boolean(selection && !selection.isCollapsed && selection.toString().length > 0);
  } catch {
    return false;
  }
}

/**
 * Two-finger pinch plus a scoped ctrl-wheel path (Chromium trackpad pinch).
 * All listeners are element-scoped: nothing global competes with native
 * back/forward navigation gestures or browser zoom elsewhere on the page.
 */
function usePinchFold(
  surface: RefObject<HTMLElement | null>,
  enabled: boolean,
  setFolded: (folded: boolean) => void,
) {
  useEffect(() => {
    const element = surface.current;
    if (!element || !enabled) return;
    let armed = false;
    let decided = false;
    const onGestureStart = (event: Event) => {
      armed = !insideProtectedRegion(event.target) && !hasTextSelection();
      if (armed) event.preventDefault();
      decided = false;
    };
    const onGestureChange = (event: Event) => {
      if (!armed || hasTextSelection() || insideProtectedRegion(event.target)) return;
      event.preventDefault();
      if (decided) return;
      const scale = (event as WebKitGestureEvent).scale;
      if (typeof scale !== "number") return;
      if (scale <= 0.85) {
        decided = true;
        setFolded(true);
      } else if (scale >= 1.15) {
        decided = true;
        setFolded(false);
      }
    };
    const onGestureEnd = (event: Event) => {
      if (armed) event.preventDefault();
      armed = false;
    };
    let wheelTotal = 0;
    let lastWheel = 0;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      if (insideProtectedRegion(event.target)) return;
      if (hasTextSelection()) return;
      if (!event.deltaY || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      event.preventDefault();
      const now = performance.now();
      if (now - lastWheel > 220 || Math.sign(wheelTotal) !== Math.sign(event.deltaY)) wheelTotal = 0;
      lastWheel = now;
      wheelTotal += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      if (Math.abs(wheelTotal) >= 24) {
        setFolded(wheelTotal > 0);
        wheelTotal = 0;
      }
    };
    element.addEventListener("gesturestart", onGestureStart);
    element.addEventListener("gesturechange", onGestureChange);
    element.addEventListener("gestureend", onGestureEnd);
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("gesturestart", onGestureStart);
      element.removeEventListener("gesturechange", onGestureChange);
      element.removeEventListener("gestureend", onGestureEnd);
      element.removeEventListener("wheel", onWheel);
    };
  }, [surface, enabled, setFolded]);
}

/**
 * The foldable reading surface for one completed, long answer. Folding shows
 * an extractive preview of the answer's own leading text; the exact full text
 * stays in the DOM and unfolds verbatim. Only this surface handles pinch — the
 * streaming preview and short answers keep plain rendering.
 */
function FoldableResponse({
  children,
  lead,
}: {
  children: string;
  lead: boolean;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const fullTextId = useId();
  const [reading, setReading] = useState({ body: children, folded: false });
  if (reading.body !== children) setReading({ body: children, folded: false });
  const folded = reading.body === children && reading.folded;
  const setFolded = useCallback((value: boolean | ((previous: boolean) => boolean)) => {
    setReading(current => ({ body: children, folded: typeof value === "function" ? value(current.body === children && current.folded) : value }));
  }, [children]);
  usePinchFold(surface, true, setFolded);
  const preview = extractiveReadingPreview(children);
  const truncated = preview.length > 0 && preview.length < children.trim().length;
  return (
    <div
      aria-label="回答正文"
      className={styles.foldSurface}
      data-folded={folded ? "true" : "false"}
      ref={surface}
    >
      <div hidden={folded} id={fullTextId}>
        <ResponseBody lead={lead}>{children}</ResponseBody>
      </div>
      {folded && preview ? (
        <p className={styles.foldPreview} data-fold-preview="true">
          {preview}{truncated ? "……" : ""}
        </p>
      ) : null}
      <div className={styles.foldFooter}>
        {folded && preview ? (
          <span className={styles.foldBadge}>阅读预览</span>
        ) : null}
        <button
          aria-controls={fullTextId}
          aria-expanded={!folded}
          className={styles.foldToggle}
          onClick={() => setFolded((value) => !value)}
          type="button"
        >
          {folded ? "展开全文" : "收起"}
        </button>
      </div>
    </div>
  );
}

function ResponseBody({
  children,
  lead,
}: {
  children: string;
  lead: boolean;
}) {
  return (
    <div className={styles.response} data-lead={lead ? "true" : "false"}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h3>{children}</h3>,
          h2: ({ children }) => <h3>{children}</h3>,
          h3: ({ children }) => <h3>{children}</h3>,
          a: ({ children, href }) => (
            <span>{children}{href && children !== href ? <span className={styles.destination}> ({href})</span> : null}</span>
          ),
          img: ({ alt }) => <span className={styles.destination}>[图片{alt ? `：${alt}` : ""}]</span>,
          table: ({ children }) => (
            <div aria-label="表格（可横向滚动）" className={styles.tableScroll} role="region" tabIndex={0}>
              <table>{children}</table>
            </div>
          ),
          pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}

/** Presentation only: model text cannot load images or acquire citation authority.
 * React Markdown escapes raw HTML by default; do not add a raw-HTML plugin.
 * https://github.com/remarkjs/react-markdown#security
 * Governed source links continue to belong to their explicit evidence controls.
 *
 * `foldable` is passed only for completed answer blocks: a forming streamed
 * reply must never look complete or fold its pending decisions away.
 */
export const ConversationResponse = memo(function ConversationResponse({
  children,
  lead = false,
  foldable = false,
}: {
  children?: string;
  /** First line plays the response lead (larger emphasis) when no block title stands in for it. */
  lead?: boolean;
  /** Completed long answers earn the extractive pinch fold. */
  foldable?: boolean;
}) {
  const body = children ?? "";
  if (foldable && isLongAnswer(body) && extractiveReadingPreview(body).length > 0) {
    return <FoldableResponse lead={lead}>{body}</FoldableResponse>;
  }
  return <ResponseBody lead={lead}>{body}</ResponseBody>;
});
