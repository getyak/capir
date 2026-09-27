import { memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

/** Presentation only: model text cannot load images or acquire citation authority.
 * React Markdown escapes raw HTML by default; do not add a raw-HTML plugin.
 * https://github.com/remarkjs/react-markdown#security
 * Governed source links continue to belong to their explicit evidence controls.
 */
export const ConversationResponse = memo(function ConversationResponse({
  children,
  lead = false,
}: {
  children?: string;
  /** First line plays the response lead (larger emphasis) when no block title stands in for it. */
  lead?: boolean;
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
});
