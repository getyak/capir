"use client";

import { Check, Copy, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { useT } from "./locale-provider";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import styles from "./workspace-extensions.module.css";

/** Restrained dialog frame shared by every extension dialog. */
export function ExtensionDialog({
  busy = false,
  children,
  dismissible = true,
  description,
  footer,
  onClose,
  title,
  width,
}: {
  busy?: boolean;
  children: ReactNode;
  dismissible?: boolean;
  description: string;
  footer: ReactNode;
  onClose: () => void;
  title: string;
  width?: "default" | "wide";
}) {
  const t = useT();
  // These dialogs are mounted by an existing page action, not a DialogTrigger.
  const [opener] = useState(() => typeof document !== "undefined" && document.activeElement instanceof HTMLElement
    && document.activeElement !== document.body ? document.activeElement : null);
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next && dismissible) onClose();
      }}
      open
    >
      <DialogContent
        layout="custom"
        showCloseButton={false}
        className={`${styles.dialog} ${width === "wide" ? styles.dialogWide : ""}`}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = opener?.isConnected ? opener : document.getElementById("main-content");
          target?.focus({ preventScroll: true });
        }}
      >
        <header className={styles.dialogHeader}>
          <div>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </div>
          {dismissible ? <DialogClose aria-label={t("关闭")} className={styles.closeButton}>
            <X aria-hidden="true" size={16} />
          </DialogClose> : null}
        </header>
        <div className={styles.dialogBody} aria-busy={busy}>{children}</div>
        <footer className={styles.dialogFooter} aria-busy={busy}>{footer}</footer>
        {/* Outside busy regions so waiting is announced before completion. */}
        <span className="sr-only" role="status">{busy ? t("正在处理…") : ""}</span>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmDialog({
  busy = false,
  confirmLabel,
  description,
  onCancel,
  onConfirm,
  open,
  title,
}: {
  busy?: boolean;
  confirmLabel: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
}) {
  if (!open) return null;
  return (
    <ExtensionDialog
      busy={busy}
      dismissible={!busy}
      description={description}
      footer={
        <>
          <button className={styles.quiet} disabled={busy} onClick={onCancel} type="button">
            取消
          </button>
          <button className={styles.danger} disabled={busy} onClick={onConfirm} type="button">
            {busy ? "正在处理…" : confirmLabel}
          </button>
        </>
      }
      onClose={onCancel}
      title={title}
    >
      {null}
    </ExtensionDialog>
  );
}

export function CopyButton({ label, value }: { label: string; value: string }) {
  const t = useT();
  const [feedback, setFeedback] = useState<{ value: string; state: "copied" | "error" | "idle" }>({ value, state: "idle" });
  const state = feedback.value === value ? feedback.state : "idle";
  const attempt = useRef(0);
  const reset = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    attempt.current++;
    if (reset.current !== null) clearTimeout(reset.current);
  }, []);
  async function copy() {
    const current = ++attempt.current;
    if (reset.current !== null) clearTimeout(reset.current);
    setFeedback({ value, state: "idle" });
    try {
      await navigator.clipboard.writeText(value);
      if (current !== attempt.current) return;
      setFeedback({ value, state: "copied" });
      reset.current = setTimeout(() => {
        if (current === attempt.current) setFeedback({ value, state: "idle" });
      }, 2_500);
    } catch {
      if (current === attempt.current) setFeedback({ value, state: "error" });
    }
  }
  return (
    <div className={styles.copyArea}>
      <button className={styles.quiet} onClick={() => void copy()} type="button">
        {state === "copied" ? (
          <Check aria-hidden="true" size={14} />
        ) : (
          <Copy aria-hidden="true" size={14} />
        )}
        {label}
      </button>
      <small className={styles.copyStatus} role="status">{state === "copied" ? t("已复制") : ""}</small>
      {state === "error" ? (
        <small role="alert">{t("浏览器拒绝了剪贴板访问，请手动选择并复制上面的内容。")}</small>
      ) : null}
    </div>
  );
}
