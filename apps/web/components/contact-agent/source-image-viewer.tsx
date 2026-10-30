"use client";

import { ArrowsOut, WarningCircle, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { workspaceSessionFetch } from "@/components/workspace-session-request";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "../ui/dialog";

import styles from "./contact-agent.module.css";

type ViewerState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error"; message: string };

/**
 * Original-image readback for one saved contact-agent source.
 *
 * The bytes always come through the scoped `workspaceSessionFetch` proxy, never
 * an unscoped `<img src>` or a new tab. The decoded blob is an in-memory object
 * URL that is revoked when the viewer closes, when the image changes or when
 * the component unmounts. A late or stale response is dropped by token so a
 * closed dialog or a switched account can never paint over the next one.
 */
export function SourceImageViewer({
  taskId,
  imageIndex,
  label,
  compact = false,
}: {
  taskId: string;
  imageIndex: number;
  label?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ViewerState>({ status: "idle" });
  const objectURL = useRef<string | null>(null);
  const token = useRef(0);
  const dialogFocus = useRef<HTMLButtonElement>(null);
  const title = label ?? `原图 ${imageIndex + 1}`;

  const release = useCallback(() => {
    if (objectURL.current) {
      URL.revokeObjectURL(objectURL.current);
      objectURL.current = null;
    }
  }, []);

  useEffect(() => release, [release]);

  // The fetch effect never sets state synchronously: loading is entered from
  // the open/retry event, and the resolved blob or error arrives in a callback.
  useEffect(() => {
    if (!open || attempt === 0) return;
    const current = (token.current += 1);
    release();
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        const response = await workspaceSessionFetch(
          `/api/contact-agent/tasks/${encodeURIComponent(taskId)}/images/${imageIndex}`,
          { cache: "no-store", signal: controller.signal },
        );
        if (cancelled || current !== token.current) return;
        if (!response.ok) {
          throw new Error("原图暂时无法读取，请稍后重试。");
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.startsWith("image/")) {
          throw new Error("服务返回的内容不是图片，已停止显示。");
        }
        const blob = await response.blob();
        if (cancelled || current !== token.current) return;
        const url = URL.createObjectURL(blob);
        objectURL.current = url;
        setState({ status: "ready", url });
      } catch (error) {
        if (cancelled || current !== token.current) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "原图暂时无法读取，请稍后重试。",
        });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, attempt, imageIndex, taskId, release]);

  function beginLoad() {
    setState({ status: "loading" });
    setAttempt((current) => current + 1);
  }

  function handleOpenChange(next: boolean) {
    if (next) {
      setOpen(true);
      beginLoad();
      return;
    }
    setOpen(false);
    token.current += 1;
    release();
    setState({ status: "idle" });
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger asChild>
        <button
          className={compact ? styles.imageViewLink : styles.imageViewButton}
          type="button"
        >
          {!compact ? <ArrowsOut aria-hidden size={14} /> : null}
          {compact ? title : `查看${title}`}
        </button>
      </DialogTrigger>
      <DialogContent
        layout="custom"
        showCloseButton={false}
        aria-label={title}
        className={styles.viewer}
        onOpenAutoFocus={(event) => {
          // The close button is the safest first stop; the decoded image has
          // no intrinsic focus target.
          event.preventDefault();
          dialogFocus.current?.focus({ preventScroll: true });
        }}
      >
        <header className={styles.viewerHeader}>
          <DialogTitle asChild>
            <h2>{title}</h2>
          </DialogTitle>
          <DialogClose asChild>
            <button aria-label="关闭原图" ref={dialogFocus} type="button">
              <X aria-hidden size={18} />
            </button>
          </DialogClose>
        </header>
        {state.status === "loading" ? (
          <p className={styles.viewerStatus} role="status">
            正在打开原图…
          </p>
        ) : null}
        {state.status === "error" ? (
          <div className={styles.viewerError} role="alert">
            <WarningCircle aria-hidden size={18} />
            <p>{state.message}</p>
            <button onClick={beginLoad} type="button">
              重试
            </button>
          </div>
        ) : null}
        {state.status === "ready" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={title}
            onError={() =>
              setState({
                status: "error",
                message: "图片无法显示，可能不是有效的图片。",
              })
            }
            src={state.url}
          />
        ) : null}
        <DialogDescription className={styles.viewerNote}>
          原图来自这次来源，最多保留 30 天；可随时删除这次采集。
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}
