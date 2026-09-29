"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useState } from "react";
import { workspaceSessionFetch } from "../workspace-session-request";
import styles from "./memory-review.module.css";

export type SourceImage = {
  binding: string;
  sessionId: string;
  messageId: string;
  imageIndex: number;
  fileName: string;
  region?: { x: number; y: number; width: number; height: number } | null;
};

export function SourceImageButton({ source }: { source: SourceImage }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const response = await workspaceSessionFetch(
          `/api/workspace-sessions/${encodeURIComponent(source.sessionId)}/conversation-images/${encodeURIComponent(source.messageId)}/${source.imageIndex}`,
          { cache: "no-store", headers: { "x-workspace-session": source.binding }, signal: abort.signal },
        );
        if (!response.ok) throw new Error("Source image unavailable");
        const blob = await response.blob();
        if (abort.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (!abort.signal.aborted) setFailed(true);
      }
    })();
    return () => {
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, source.binding, source.sessionId, source.messageId, source.imageIndex]);

  return <Dialog.Root open={open} onOpenChange={(next) => {
    setOpen(next);
    if (!next) { setUrl(null); setFailed(false); }
  }}>
    <Dialog.Trigger asChild><button className={styles.actionSourceImage} type="button">查看原图</button></Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className={styles.sourceImageBackdrop}/>
      <Dialog.Content className={styles.sourceImageDialog} aria-describedby={undefined}>
        <Dialog.Title>来源原图</Dialog.Title>
        <Dialog.Close asChild><button type="button" aria-label="关闭原图">关闭</button></Dialog.Close>
        {url ? <div className={styles.sourceImageFrame}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={source.fileName} src={url}/>
          {source.region ? <span aria-label="引用区域" className={styles.sourceImageRegion} style={{
            left: `${source.region.x * 100}%`, top: `${source.region.y * 100}%`,
            width: `${source.region.width * 100}%`, height: `${source.region.height * 100}%`,
          }}/> : null}
        </div> : <p role={failed ? "alert" : "status"}>{failed ? "原图暂时无法读取，请关闭后重试。" : "正在读取原图…"}</p>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
