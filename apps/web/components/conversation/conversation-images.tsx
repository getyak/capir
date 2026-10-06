"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ArrowSquareOut, CaretLeft, CaretRight, DownloadSimple, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ConversationImageManifest } from "@talent-signal/contracts";

import { workspaceSessionFetch } from "../workspace-session-request";
import { loadConversationImages } from "@/lib/conversation-image-store";
import styles from "./queued-conversation.module.css";

type Props = {
  sessionId: string;
  messageId: string;
  /** Storage scope for local pending bytes; ignored for server history. */
  scope: string;
  images: readonly ConversationImageManifest[];
  /** Captured Session binding; the same mounted conversation identity. */
  binding: string;
  /** Pending outbox images live in IndexedDB until the server echoes them. */
  local: boolean;
  compact?: boolean;
};

function imageKey(images: readonly ConversationImageManifest[]): string {
  return images.map((image) => image.attachment_id).join("|");
}

/**
 * Inline conversation image strip with an exact-image viewer.
 *
 * Bytes always arrive through the scoped proxy or the local durable store,
 * never through a bare `<img src>` pointing at a sensitive URL. Object URLs are
 * created per mounted strip and revoked when the strip unmounts or the account
 * binding changes. One sent image renders directly; several render as folded
 * overlapping cards with a count and explicit expand/collapse. Clicking an
 * exact thumbnail opens only that image in the viewer, with previous/next
 * navigation in the original manifest order. The viewer opens or downloads
 * the original bytes only from the object URL and only on an explicit user
 * click, always naming the original file. Partial, unavailable and decode
 * failures keep their manifest position and stay honest and retryable; a
 * rejected local durable read ends in the same retryable state instead of an
 * indefinite loading placeholder.
 */
export function ConversationImageStrip(props: Props) {
  const [attempt, setAttempt] = useState(0);
  const identity = JSON.stringify([props.scope, props.sessionId, props.messageId, props.binding, props.local, imageKey(props.images), attempt]);
  return <LoadedConversationImageStrip {...props} key={identity} onRetry={() => setAttempt((value) => value + 1)} />;
}

function LoadedConversationImageStrip({
  sessionId,
  messageId,
  scope,
  images,
  binding,
  local,
  compact = false,
  onRetry,
}: Props & { onRetry: () => void }) {
  const [urls, setUrls] = useState<Array<string | null>>(() => images.map(() => null));
  const [failed, setFailed] = useState<boolean[]>(() => images.map(() => false));
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState<"fit" | "actual">("fit");
  const [fitPercent, setFitPercent] = useState<number | null>(null);
  const created = useRef<string[]>([]);
  const current = useRef<Array<string | null>>(images.map(() => null));
  const generation = useRef(0);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const keys = imageKey(images);

  const markFailed = (position: number) => {
    const url = current.current[position];
    if (url) {
      URL.revokeObjectURL(url);
      created.current = created.current.filter((entry) => entry !== url);
      current.current[position] = null;
      setUrls((previous) => previous.map((value, i) => (i === position ? null : value)));
    }
    setFailed((previous) => previous.map((value, i) => (i === position ? true : value)));
  };

  /** Replace one object URL, revoking the bytes it supersedes immediately. */
  const replaceUrl = (position: number, url: string) => {
    const previous = current.current[position];
    if (previous) {
      URL.revokeObjectURL(previous);
      created.current = created.current.filter((entry) => entry !== previous);
    }
    current.current[position] = url;
    created.current.push(url);
    setUrls((previous) => previous.map((value, i) => (i === position ? url : value)));
  };

  const loadServer = async (position: number, alive: () => boolean) => {
    try {
      const response = await workspaceSessionFetch(
        `/api/workspace-sessions/${encodeURIComponent(sessionId)}/conversation-images/${encodeURIComponent(messageId)}/${position}`,
        { cache: "no-store", headers: { "x-workspace-session": binding }, signal: AbortSignal.timeout(15_000) },
      );
      if (!alive()) return;
      if (!response.ok) { markFailed(position); return; }
      const blob = await response.blob();
      if (!alive()) return;
      replaceUrl(position, URL.createObjectURL(blob));
    } catch {
      if (alive()) markFailed(position);
    }
  };

  const loadLocal = async (alive: () => boolean, only?: number) => {
    const positions = only === undefined ? images.map((_, position) => position) : [only];
    try {
      const stored = await loadConversationImages(scope, sessionId, messageId);
      if (!alive()) return;
      const ordered = [...stored].sort((a, b) => a.position - b.position);
      for (const position of positions) {
        const manifest = images[position];
        const record = ordered[position];
        if (!record || !manifest || record.attachment_id !== manifest.attachment_id) { markFailed(position); continue; }
        replaceUrl(position, URL.createObjectURL(record.blob));
      }
    } catch {
      // A denied or broken durable store ends in an explicit retryable state,
      // never an eternal loading placeholder.
      if (!alive()) return;
      for (const position of positions) markFailed(position);
    }
  };

  useEffect(() => {
    generation.current += 1;
    const run = generation.current;
    const alive = () => generation.current === run;
    for (const url of created.current) URL.revokeObjectURL(url);
    created.current = [];
    current.current = images.map(() => null);
    void (async () => {
      if (local) { await loadLocal(alive); return; }
      // Sequential readback keeps one quiet transcript-side fetch at a time.
      for (let position = 0; position < images.length && alive(); position += 1) await loadServer(position, alive);
    })();
    return () => {
      generation.current += 1;
      for (const url of created.current) URL.revokeObjectURL(url);
      created.current = [];
      current.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, messageId, scope, binding, local, keys]);

  const measure = useCallback(() => {
    const image = imageRef.current;
    const stage = stageRef.current;
    if (!image || !stage) { setFitPercent(null); return; }
    const rect = stage.getBoundingClientRect();
    if (!image.naturalWidth || !image.naturalHeight || rect.width < 1 || rect.height < 1) { setFitPercent(null); return; }
    const scale = Math.min(Math.min(rect.width, 1100) / image.naturalWidth, rect.height / image.naturalHeight);
    setFitPercent(Math.max(1, Math.min(100, Math.round(scale * 100))));
  }, []);

  useEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, index, measure]);

  if (images.length === 0) return null;
  const anyFailed = failed.some(Boolean);
  const layout = images.length === 1 ? "single" : expanded ? "expanded" : "folded";

  const openAt = (position: number, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    setIndex(position);
    setZoom("fit");
    setFitPercent(null);
    setOpen(true);
  };
  const step = (delta: number) => setIndex((current) => (current + delta + images.length) % images.length);
  /** Only blank dialog space closes; the image and every control keep it open. */
  const onBlankClose = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) setOpen(false);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
  };
  const retryOne = (position: number) => {
    setFailed((previous) => previous.map((value, i) => (i === position ? false : value)));
    const run = generation.current;
    const alive = () => generation.current === run;
    void (async () => {
      if (local) await loadLocal(alive, position);
      else await loadServer(position, alive);
    })();
  };
  /** Open and download use only the mounted object URL on an explicit click. */
  const openOriginal = () => {
    const url = urls[index];
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };
  const downloadOriginal = () => {
    const url = urls[index];
    const name = images[index]?.file_name;
    if (!url || !name) return;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  };

  const zoomLabel = zoom === "actual" ? "100%" : fitPercent === null ? "适应" : `${fitPercent}%`;
  const zoomDescription = zoom === "actual"
    ? "缩放 100%（原始大小），点击切换为适应窗口"
    : "缩放 适应窗口，点击切换为原始 100%";
  const shown = images[index];

  return (
    <div className={styles.images} data-compact={compact ? "true" : undefined} data-layout={layout} ref={stripRef}>
      <ul className={styles.imageList} aria-label={`消息中的 ${images.length} 张图片`}>
        {images.map((image, position) => (
          <li className={styles.imageItem} key={image.attachment_id}>
            {urls[position] ? (
              <button
                className={styles.imageButton}
                onClick={(event) => openAt(position, event.currentTarget)}
                title={`查看原图 ${position + 1}`}
                type="button"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt={image.file_name} onError={() => markFailed(position)} src={urls[position]!} />
              </button>
            ) : (
              <span
                className={styles.imagePlaceholder}
                data-error={failed[position] ? "true" : undefined}
                role="status"
              >
                {failed[position] ? "图片暂时无法读取" : "正在读取图片…"}
              </span>
            )}
          </li>
        ))}
      </ul>
      {images.length > 1 ? (
        <div className={styles.imageStripActions}>
          <span className={styles.imageTotal}>{images.length} 张图片</span>
          <button
            aria-expanded={expanded}
            className={styles.imageExpand}
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            {expanded ? "收起图片" : "展开图片"}
          </button>
        </div>
      ) : null}
      {anyFailed ? (
        <button className={styles.imageRetry} onClick={onRetry} type="button">
          重新读取图片
        </button>
      ) : null}
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.imageBackdrop} />
          <Dialog.Content
            aria-describedby={undefined}
            className={styles.imageDialog}
            onClick={onBlankClose}
            onKeyDown={onKeyDown}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const trigger = triggerRef.current;
              // A decode failure can remove the original thumbnail button.
              (trigger?.isConnected ? trigger : stripRef.current?.querySelector<HTMLButtonElement>("button"))?.focus();
            }}
          >
            <div className={styles.imageToolbar}>
              <button aria-label={zoomDescription} className={styles.imageZoom} onClick={() => setZoom((value) => (value === "actual" ? "fit" : "actual"))} type="button">
                {zoomLabel}
              </button>
              <button aria-label="在新标签页打开原图" className={styles.imageControl} disabled={!urls[index]} onClick={openOriginal} type="button">
                <ArrowSquareOut aria-hidden size={16} />
              </button>
              <button aria-label="下载原图" className={styles.imageControl} disabled={!urls[index]} onClick={downloadOriginal} type="button">
                <DownloadSimple aria-hidden size={16} />
              </button>
              <Dialog.Close asChild>
                <button aria-label="关闭原图" className={styles.imageClose} type="button">
                  <X aria-hidden size={17} />
                </button>
              </Dialog.Close>
            </div>
            <div className={styles.imageStage} data-zoom={zoom} onClick={onBlankClose} ref={stageRef}>
              {images.length > 1 ? (
                <button aria-label="上一张图片" className={styles.imageNav} data-side="previous" onClick={() => step(-1)} type="button">
                  <CaretLeft aria-hidden size={18} />
                </button>
              ) : null}
              {urls[index] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={shown?.file_name ?? `原图 ${index + 1}`}
                  data-zoom={zoom}
                  onError={() => markFailed(index)}
                  onLoad={measure}
                  ref={imageRef}
                  src={urls[index]!}
                />
              ) : (
                <div className={styles.imageDialogMessage} role="status">
                  <p>{failed[index] ? "这张图片暂时无法读取。" : "正在读取图片…"}</p>
                  {failed[index] ? (
                    <button className={styles.imageRetryInline} onClick={() => retryOne(index)} type="button">
                      重新读取
                    </button>
                  ) : null}
                </div>
              )}
              {images.length > 1 ? (
                <button aria-label="下一张图片" className={styles.imageNav} data-side="next" onClick={() => step(1)} type="button">
                  <CaretRight aria-hidden size={18} />
                </button>
              ) : null}
            </div>
            <div className={styles.imageMeta}>
              <Dialog.Title className={styles.imageFileName}>{shown?.file_name ?? "原图"}</Dialog.Title>
              <span className={styles.imagePosition}>{index + 1} / {images.length}</span>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
