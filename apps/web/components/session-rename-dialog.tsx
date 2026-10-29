"use client";

import { useEffect, useRef, useState } from "react";
import { normalizeSessionTitle } from "@/lib/session-title";
import { requestWorkspaceRefresh } from "@/lib/workspace-refresh";
import { useT } from "./locale-provider";
import { workspaceSessionFetch } from "./workspace-session-request";
import type { SessionDetail } from "./session-workbench/session-detail-state";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import styles from "./session-rename-dialog.module.css";

export type SessionMenuTarget = {
  id: string; binding: string; scope: string | null;
  onRenamed?: (detail: SessionDetail) => void;
};

export function SessionRenameDialog({ target, title, onClose, returnFocus }: {
  target: SessionMenuTarget; title: string; onClose: () => void; returnFocus?: () => void;
}) {
  const t = useT();
  const [value, setValue] = useState(title);
  const [revision, setRevision] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const lifetime = useRef<AbortController | null>(null);
  const operation = useRef(false);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController(); lifetime.current = controller;
    void workspaceSessionFetch(`/api/workspace-sessions/${target.id}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]) })
      .then(async response => {
        const body = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok || body.session_version !== target.binding || body.detail?.session_id !== target.id || body.detail?.state !== "active") throw new Error();
        setRevision(body.detail.revision);
        setValue(body.detail.title);
      }).catch(() => { if (!controller.signal.aborted) setError(t("sessionMenu.loadFailed")); });
    return () => { alive.current = false; controller.abort(); };
  }, [target.id, target.binding, t]);
  async function save() {
    const normalized = normalizeSessionTitle(value);
    if (!normalized || !revision || operation.current) return;
    operation.current = true; setBusy(true); setError("");
    try {
      const response = await workspaceSessionFetch(`/api/workspace-sessions/${target.id}`, {
        method: "PATCH", signal: AbortSignal.any([...(lifetime.current ? [lifetime.current.signal] : []), AbortSignal.timeout(15_000)]), headers: { "content-type": "application/json", "x-workspace-session": target.binding },
        body: JSON.stringify({ title: normalized, expected_revision: revision, idempotency_key: crypto.randomUUID() }),
      });
      if (!alive.current) return;
      const body = await response.json();
      if (!alive.current) return;
      if (!response.ok || body.detail?.session_id !== target.id || body.detail?.title !== normalized) {
        setError(t(response.status === 409 ? "sessionMenu.conflict" : "sessionMenu.renameFailed")); return;
      }
      target.onRenamed?.(body.detail);
      if (target.scope) requestWorkspaceRefresh(target.scope);
      onClose();
    } catch { if (alive.current) setError(t("sessionMenu.renameFailed")); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  const valid = normalizeSessionTitle(value) !== null;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className={styles.dialog} closeLabel={t("取消")} onCloseAutoFocus={event => { event.preventDefault(); returnFocus?.(); }}>
      <DialogTitle>{t("sessionMenu.rename")}</DialogTitle>
      <DialogDescription>{t("sessionMenu.titleHint")}</DialogDescription>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <label htmlFor="session-rename-title">{t("sessionMenu.title")}</label>
        <input autoComplete="off" id="session-rename-title" value={value} disabled={busy || revision === null} onChange={event => setValue(event.target.value)} aria-invalid={!valid} />
        {error && <p role="alert">{error}</p>}
        <div className={styles.actions}>
          <button type="button" onClick={onClose}>{t("取消")}</button>
          <button type="submit" disabled={busy || !revision || !valid}>{t(busy ? "sessionMenu.saving" : "保存")}</button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
