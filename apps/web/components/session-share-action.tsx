"use client";

import { ShareNetwork } from "@phosphor-icons/react";
import { useLayoutEffect, useRef, useState } from "react";
import { isSessionId } from "./session-workbench/session-view";
import { useT } from "./locale-provider";
import styles from "./workspace-shell.module.css";

export function SessionShareAction({ id }: { id: string }) {
  const t = useT();
  const owner = useRef<symbol | null>(null);
  const busy = useRef(false);
  const [state, setState] = useState<"idle" | "busy" | "copied" | "shared" | "failed">("idle");
  useLayoutEffect(() => {
    owner.current = Symbol(id); busy.current = false;
    return () => { owner.current = null; };
  }, [id]);
  async function share(copyOnly = false) {
    if (!isSessionId(id) || busy.current) return;
    const operation = owner.current;
    busy.current = true; setState("busy");
    // Never forward draft locators, query capabilities, hashes or private titles.
    const url = new URL(`/workspace/sessions/${id}`, window.location.origin).href;
    try {
      if (!copyOnly && navigator.share) {
        await navigator.share({ url });
        if (owner.current === operation) setState("shared");
      } else {
        if (!navigator.clipboard?.writeText) throw new Error();
        await navigator.clipboard.writeText(url);
        if (owner.current === operation) setState("copied");
      }
    } catch (error) {
      if (owner.current === operation) setState(error instanceof DOMException && error.name === "AbortError" ? "idle" : "failed");
    } finally { if (owner.current === operation) busy.current = false; }
  }
  return <>
    <button type="button" onClick={() => void share()} disabled={state === "busy"}>
      <ShareNetwork aria-hidden="true" size={15} /><span>{t("sessionMenu.share")}</span>
    </button>
    <span className={styles.sessionRowMenuNote}>{t("sessionMenu.shareHint")}</span>
    {state === "failed" && <button type="button" onClick={() => void share(true)}>{t("sessionMenu.copyLink")}</button>}
    {["copied", "shared", "failed"].includes(state) && <span className={styles.sessionRowMenuNote} role="status">
      {t(state === "copied" ? "sessionMenu.linkCopied" : state === "shared" ? "sessionMenu.shared" : "sessionMenu.shareFailed")}
    </span>}
  </>;
}
