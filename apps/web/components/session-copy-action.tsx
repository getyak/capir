"use client";

import { Copy } from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState } from "react";
import { useT } from "./locale-provider";
import { workspaceSessionFetch } from "./workspace-session-request";
import { conversationCopyText } from "./conversation/session-conversation-copy";
import type { SessionMenuTarget } from "./session-rename-dialog";
import styles from "./workspace-shell.module.css";

export function SessionCopyAction({ target }: { target: SessionMenuTarget }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "busy" | "copied" | "failed">("idle");
  const current = useRef<AbortController | null>(null);
  useLayoutEffect(() => () => { current.current?.abort(); }, [target.id, target.binding, target.scope]);
  function copy() {
    if (current.current && !current.current.signal.aborted) return;
    const controller = new AbortController(); current.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    setState("busy");
    signal.addEventListener("abort", () => {
      if (!controller.signal.aborted) { setState("failed"); controller.abort(); }
    }, { once: true });
    const text = workspaceSessionFetch(`/api/workspace-sessions/${target.id}`, { cache: "no-store", signal })
      .then(async response => {
        const body = await response.json();
        signal.throwIfAborted();
        if (!response.ok || body.session_version !== target.binding || body.detail?.session_id !== target.id || body.detail?.state !== "active" || !Array.isArray(body.detail.turns)) throw new Error();
        const result = conversationCopyText(body.detail.turns, { user: t("sessionMenu.you"), assistant: "capri" });
        if (!result) throw new Error();
        return result;
      });
    // WebKit requires clipboard.write during the click; the item may resolve
    // after the authenticated read. https://webkit.org/blog/10855/async-clipboard-api/
    let write: Promise<void>;
    try {
      if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        const blob = text.then(value => new Blob([value], { type: "text/plain" }));
        void blob.catch(() => {});
        write = navigator.clipboard.write([new ClipboardItem({ "text/plain": blob })]);
      } else if (navigator.clipboard?.writeText) {
        write = text.then(value => { signal.throwIfAborted(); return navigator.clipboard.writeText(value); });
      } else write = Promise.reject(new Error());
    } catch { write = Promise.reject(new Error()); }
    void text.catch(() => {});
    void write.then(() => {
      if (!signal.aborted) setState("copied");
    }).catch(() => { if (!controller.signal.aborted) setState("failed"); })
      .finally(() => { if (current.current === controller) { controller.abort(); current.current = null; } });
  }
  return <>
    <button type="button" onClick={copy} disabled={state === "busy"}><Copy aria-hidden="true" size={15} /><span>{t("sessionMenu.copy")}</span></button>
    <span className={styles.sessionRowMenuNote}>{t("sessionMenu.copyHint")}</span>
    {state !== "idle" && <span className={styles.sessionRowMenuNote} role="status">{t(state === "copied" ? "sessionMenu.copied" : state === "failed" ? "sessionMenu.copyFailed" : "sessionMenu.copying")}</span>}
  </>;
}
