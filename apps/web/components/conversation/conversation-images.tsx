"use client";

import { ArrowSquareOut, CaretLeft, CaretRight, DownloadSimple, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import type { ConversationImageManifest } from "@talent-signal/contracts";

import { workspaceSessionFetch } from "../workspace-session-request";
import { useT } from "../locale-provider";
import { loadConversationImages } from "@/lib/conversation-image-store";
import styles from "./queued-conversation.module.css";
import imageStyles from "./conversation-images.module.css";

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
 * binding changes. Sent images share aligned cells with a count and explicit
 * expand/collapse. Clicking an
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
  const t = useT();
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
  const triggerPosition = useRef(0);
  const expandRef = useRef<HTMLButtonElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);
  const previewId = useId();
  const restoreFocus = useRef(false);
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

  useLayoutEffect(() => {
    if (open) {
      previewRef.current?.focus({ preventScroll: true });
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      const trigger = triggerRef.current;
      // Restore after React has revealed the source strip again. The exact
      // thumbnail may have failed decoding or moved into the folded range.
      const visible = trigger?.isConnected && (expanded || images.length === 1 || triggerPosition.current < 3);
      (visible ? trigger : expandRef.current ?? stripRef.current?.querySelector<HTMLButtonElement>("button"))?.focus({ preventScroll: true });
    }
  }, [open, expanded, images.length]);

  if (images.length === 0) return null;
  const anyFailed = failed.some(Boolean);
  const layout = images.length === 1 ? "single" : expanded ? "expanded" : "folded";

  const openAt = (position: number, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    triggerPosition.current = position;
    setIndex(position);
    setZoom("fit");
    setFitPercent(null);
    setOpen(true);
  };
  const step = (delta: number) => setIndex((current) => (current + delta + images.length) % images.length);
  const close = () => {
    restoreFocus.current = true;
    setOpen(false);
  };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    // Close only this inspection; Escape must not reach the run's Stop shortcut.
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    // The actual-size scroll region keeps native keyboard panning.
    if (zoom === "actual" && event.target === stageRef.current) return;
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

  const zoomLabel = zoom === "actual" ? "100%" : fitPercent === null ? t("conversation.image.fit") : `${fitPercent}%`;
  const zoomDescription = zoom === "actual"
    ? t("conversation.image.zoomActual")
    : t("conversation.image.zoomFit");
  const shown = images[index];

  return (
    <div className={styles.images} data-message-evidence={messageId} data-compact={compact ? "true" : undefined} data-layout={layout} data-preview-open={open || undefined} ref={stripRef}>
      {/* Inspection replaces the thumbnail presentation in this message;
          displaying both repeats the same source and pushes the answer away. */}
      <div className={imageStyles.thumbnails} hidden={open}>
        <ul className={styles.imageList} aria-label={t("conversation.image.messageLabel", { count: images.length })}>
          {images.map((image, position) => (
            <li className={styles.imageItem} key={image.attachment_id}>
              {urls[position] ? (
                <button
                  className={styles.imageButton}
                  aria-controls={open ? previewId : undefined}
                  aria-expanded={open && index === position}
                  onClick={(event) => openAt(position, event.currentTarget)}
                  title={t("conversation.image.view", { index: position + 1 })}
                  aria-label={t("conversation.image.viewNamed", { index: position + 1, name: image.file_name })}
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
                  {t(failed[position] ? "conversation.image.unavailable" : "conversation.image.loading")}
                </span>
              )}
            </li>
          ))}
        </ul>
        {images.length > 1 ? (
          <div className={styles.imageStripActions}>
            <span className={styles.imageTotal}>{t("conversation.image.count", { count: images.length })}</span>
            <button
              ref={expandRef}
              aria-expanded={expanded}
              className={styles.imageExpand}
              onClick={() => setExpanded((value) => !value)}
              type="button"
            >
              {t(expanded ? "conversation.image.collapse" : "conversation.image.expand")}
            </button>
          </div>
        ) : null}
        {anyFailed ? (
          <button className={styles.imageRetry} onClick={onRetry} type="button">
            {t("conversation.image.reloadAll")}
          </button>
        ) : null}
      </div>
      {open && <section
            aria-labelledby={`${previewId}-name`}
            id={previewId}
            data-evidence-preview
            ref={previewRef}
            tabIndex={-1}
            className={`${styles.imageDialog} ${imageStyles.preview}`}
            onKeyDown={onKeyDown}
          >
            <div className={styles.imageMeta}>
              <h3 id={`${previewId}-name`} className={styles.imageFileName}>{shown?.file_name ?? t("conversation.image.original")}</h3>
              {images.length > 1 ? <span className={styles.imagePosition}>{index + 1} / {images.length}</span> : null}
            </div>
            <div className={`${styles.imageToolbar} ${imageStyles.toolbar}`}>
              {images.length > 1 && <>
                <button aria-label={t("conversation.image.previous")} className={styles.imageNav} onClick={() => step(-1)} type="button"><CaretLeft aria-hidden size={18}/></button>
                <button aria-label={t("conversation.image.next")} className={styles.imageNav} onClick={() => step(1)} type="button"><CaretRight aria-hidden size={18}/></button>
              </>}
              <button aria-label={zoomDescription} className={styles.imageZoom} onClick={() => setZoom((value) => (value === "actual" ? "fit" : "actual"))} type="button">
                {zoomLabel}
              </button>
              <button aria-label={t("conversation.image.openTab")} className={styles.imageControl} disabled={!urls[index]} onClick={openOriginal} type="button">
                <ArrowSquareOut aria-hidden size={16} />
              </button>
              <button aria-label={t("conversation.image.download")} className={styles.imageControl} disabled={!urls[index]} onClick={downloadOriginal} type="button">
                <DownloadSimple aria-hidden size={16} />
              </button>
                <button aria-label={t("conversation.image.close")} className={styles.imageClose} onClick={close} type="button">
                  <X aria-hidden size={17} />
                </button>
            </div>
            <div aria-label={t(zoom === "actual" ? "conversation.image.previewActual" : "conversation.image.preview")} className={styles.imageStage} data-zoom={zoom} ref={stageRef} role="region" tabIndex={zoom === "actual" ? 0 : -1}>
              {urls[index] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={shown?.file_name ?? t("conversation.image.originalAt", { index: index + 1 })}
                  data-zoom={zoom}
                  onError={() => markFailed(index)}
                  onLoad={measure}
                  ref={imageRef}
                  src={urls[index]!}
                />
              ) : (
                <div className={styles.imageDialogMessage} role="status">
                  <p>{t(failed[index] ? "conversation.image.unavailableSentence" : "conversation.image.loading")}</p>
                  {failed[index] ? (
                    <button className={styles.imageRetryInline} onClick={() => retryOne(index)} type="button">
                      {t("conversation.image.reload")}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          </section>}
    </div>
  );
}
