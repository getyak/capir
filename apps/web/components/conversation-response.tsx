"use client";

import { memo, useCallback, useId, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CaretUp } from "@phosphor-icons/react";

import {
  extractiveReadingPreview,
  isLongAnswer,
} from "@/lib/conversation-extractive-preview";
import styles from "./conversation-response.module.css";
import { useT } from "./locale-provider";

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
  const t = useT();
  const names = [...new Set((sources ?? [])
    .map((source) => source.display_name.trim())
    .filter((name) => name.length > 0))];
  // Absence of governed references does not earn a repeated footer under
  // ordinary prose. Never synthesize a source or promote model links here.
  if (!names.length) return null;
  return (
    <p className={styles.provenance}>
      {t("response.sources")} · {names.join(" · ")}
    </p>
  );
}

/**
 * The foldable reading surface for one completed, long answer. Folding shows
 * an extractive preview of the answer's own leading text; the exact full text
 * stays in the DOM and unfolds verbatim. Platform zoom/scroll gestures remain
 * native; the explicit control alone changes answer visibility.
 */
function FoldableResponse({
  children,
  lead,
}: {
  children: string;
  lead: boolean;
}) {
  const t = useT();
  const fullTextId = useId();
  const [reading, setReading] = useState({ body: children, folded: false });
  if (reading.body !== children) setReading({ body: children, folded: false });
  const folded = reading.body === children && reading.folded;
  const setFolded = useCallback((value: boolean | ((previous: boolean) => boolean)) => {
    setReading(current => ({ body: children, folded: typeof value === "function" ? value(current.body === children && current.folded) : value }));
  }, [children]);
  const preview = extractiveReadingPreview(children);
  const truncated = preview.length > 0 && preview.length < children.trim().length;
  return (
    <div
      aria-label={t("response.body")}
      className={styles.foldSurface}
      data-folded={folded ? "true" : "false"}
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
          <span className={styles.foldBadge}>{t("response.preview")}</span>
        ) : null}
        <button
          aria-controls={fullTextId}
          aria-expanded={!folded}
          aria-label={t(folded ? "response.expand" : "response.collapse")}
          className={styles.foldToggle}
          onClick={() => setFolded((value) => !value)}
          type="button"
        >
          {folded ? t("response.expand") : <><CaretUp aria-hidden size={16}/><span>{t("response.collapse")}</span></>}
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
  const t = useT();
  return (
    <div className={styles.response} data-lead={lead ? "true" : "false"}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h3>{children}</h3>,
          h2: ({ children }) => <h4>{children}</h4>,
          h3: ({ children }) => <h5>{children}</h5>,
          h4: ({ children }) => <h6>{children}</h6>,
          h5: ({ children }) => <h6>{children}</h6>,
          h6: ({ children }) => <h6>{children}</h6>,
          a: ({ children, href }) => (
            <span>{children}{href && children !== href ? <span className={styles.destination}> ({href})</span> : null}</span>
          ),
          img: ({ alt }) => <span className={styles.destination}>{t(alt ? "response.imageWithAlt" : "response.image", { alt: alt ?? "" })}</span>,
          table: ({ children }) => (
            <div aria-label={t("response.table")} className={styles.tableScroll} role="region" tabIndex={0}>
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
  /** Completed long answers may be folded through an explicit reading control. */
  foldable?: boolean;
}) {
  const body = children ?? "";
  if (foldable && isLongAnswer(body) && extractiveReadingPreview(body).length > 0) {
    return <FoldableResponse lead={lead}>{body}</FoldableResponse>;
  }
  return <ResponseBody lead={lead}>{body}</ResponseBody>;
});
