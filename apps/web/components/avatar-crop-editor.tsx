"use client";

import { useCallback, useRef, useState } from "react";
import { avatarCropBounds, centeredAvatarCrop, drawAvatarCrop, encodeAvatarCrop, type AvatarCrop } from "@/lib/avatar-upload";
import styles from "./avatar-editor.module.css";

export function AvatarCropEditor({ bitmap, shape = "circle", onApply, onCancel }: {
  bitmap: ImageBitmap; shape?: "circle" | "squircle"; onApply: (photo: string) => void; onCancel: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; crop: AvatarCrop } | null>(null);
  const [crop, setCrop] = useState(centeredAvatarCrop);
  const [error, setError] = useState("");
  const renderPreview = useCallback((node: HTMLCanvasElement | null) => {
    canvas.current = node;
    try { if (node) drawAvatarCrop(node, bitmap, crop); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "无法预览图片。"); }
  }, [bitmap, crop]);
  const bounds = avatarCropBounds(bitmap.width, bitmap.height, crop);
  return <section className={styles.crop} aria-label="调整头像图片">
    <canvas ref={renderPreview} width={384} height={384} className={styles.cropPreview} data-shape={shape} role="img" aria-label="头像裁切预览"
      onPointerDown={event => {
        drag.current = { x: event.clientX, y: event.clientY, crop };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (!start) return;
        const scale = event.currentTarget.getBoundingClientRect().width / bounds.edge;
        const move = (position: number, delta: number, overflow: number) => overflow > 0 ? Math.max(0, Math.min(1, position - delta / scale / overflow)) : .5;
        setCrop({ ...start.crop, x: move(start.crop.x, event.clientX - start.x, bitmap.width - bounds.edge),
          y: move(start.crop.y, event.clientY - start.y, bitmap.height - bounds.edge) });
      }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} />
    <p className={styles.hint}>拖动图片调整位置，也可以使用下方滑块。</p>
    {([
      ["zoom", "缩放", 1, 3, false],
      ["x", "左右位置", 0, 1, bitmap.width === bounds.edge],
      ["y", "上下位置", 0, 1, bitmap.height === bounds.edge],
    ] as const).map(([key, label, min, max, disabled]) => <label className={styles.cropControl} key={key}>
      <span>{label}</span><input type="range" min={min} max={max} step={.01} value={crop[key]} disabled={disabled}
        aria-valuetext={key === "zoom" ? `${Math.round(crop.zoom * 100)}%` : `${Math.round(crop[key] * 100)}%`}
        onChange={event => setCrop(current => ({ ...current, [key]: Number(event.target.value) }))} />
    </label>)}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <div className={styles.cropActions}>
      <button className={styles.textButton} type="button" onClick={() => setCrop(centeredAvatarCrop)}>重新居中</button>
      <button className={styles.secondary} type="button" onClick={onCancel}>取消裁切</button>
      <button className={styles.primary} type="button" onClick={() => {
        try { onApply(encodeAvatarCrop(bitmap, crop)); }
        catch (reason) { setError(reason instanceof Error ? reason.message : "图片处理失败，请重试。"); }
      }}>使用这张图片</button>
    </div>
  </section>;
}
