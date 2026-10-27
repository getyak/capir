"use client";

import { useEffect, useState } from "react";
import type { McpToolCallReceipt } from "@talent-signal/contracts";
import { useT } from "../locale-provider";
import { workspaceSessionFetch } from "../workspace-session-request";
import styles from "./mcp.module.css";

function ReceiptImage({ callId, index, sessionVersion }: { callId: string; index: number; sessionVersion: string }) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    void (async () => {
      try {
        const response = await workspaceSessionFetch(`/api/extensions/tool-calls/${callId}/images/${index}`, {
          cache: "no-store", headers: { "x-workspace-session": sessionVersion },
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
        });
        if (!response.ok || !["image/png", "image/jpeg", "image/webp"].includes(response.headers.get("content-type") ?? "")) throw new Error("unavailable");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch { if (!controller.signal.aborted) setError(true); }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [attempt, callId, index, sessionVersion]);
  if (error) return <div role="status"><p>{t("图片暂时无法读取。工具不会重新执行。")}</p><button type="button" onClick={() => { setError(false); setUrl(""); setAttempt(value => value + 1); }}>{t("重新读取图片")}</button></div>;
  if (!url) return <p role="status">{t("正在读取图片……")}</p>;
  // Only a scoped, authenticated raster response becomes a local object URL.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.receiptImage} src={url} alt={t("工具返回的图片 {index}", { index: index + 1 })} onError={() => setError(true)} />;
}

export function McpReceiptImages({ receipt, sessionVersion }: { receipt: McpToolCallReceipt; sessionVersion: string }) {
  const t = useT();
  if (receipt.outcome !== "succeeded" || !receipt.result_json) return null;
  let blocks: Array<{ type?: string; status?: string; image_index?: number; error_code?: string }> = [];
  try { const parsed = JSON.parse(receipt.result_json); if (Array.isArray(parsed.content)) blocks = parsed.content.slice(0, 100); } catch { return null; }
  const images = blocks.filter(block => block && block.type === "image");
  const seen = new Set<number>();
  return images.map((image, index) => {
    const position = image.image_index;
    if (image.status !== "ready" || !Number.isInteger(position) || position! < 0 || position! > 3) return <p key={`unavailable-${index}`} role="status">{image.error_code === "MCP_IMAGE_CONVERSATION_REQUIRED"
      ? t("图片需要归属对话才能保留；本次工具不会重新执行。")
      : t("工具返回的图片无法保存或显示；请查看结果与来源。工具不会重新执行。")}</p>;
    if (seen.has(position!)) return null;
    seen.add(position!);
    return <ReceiptImage key={`${receipt.call_id}:${position}:${sessionVersion}`} callId={receipt.call_id} index={position!} sessionVersion={sessionVersion} />;
  });
}
