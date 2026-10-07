"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { Shuffle } from "@phosphor-icons/react/dist/csr/Shuffle";
import { UploadSimple } from "@phosphor-icons/react/dist/csr/UploadSimple";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { useEffect, useRef, useState } from "react";
import type { AvatarPreference } from "@/lib/avatar";
import { AvatarPreferenceConflictError, withAvatarStorageLock } from "@/lib/avatar-preferences";
import { decodeAvatarUpload } from "@/lib/avatar-upload";
import { useAvatarPreferences, type AvatarEditorRequest } from "./avatar-preferences-provider";
import { AvatarCropEditor } from "./avatar-crop-editor";
import { IdentityAvatar } from "./identity-avatar";
import styles from "./avatar-editor.module.css";

const choices = [
  { value: "auto", label: "自动" }, { value: "initials", label: "姓名" },
  { value: "shapes", label: "几何" }, { value: "glass", label: "柔光" },
] as const;

/** One on-demand editor owns the draft, decoded image and save attempt for the workspace. */
export default function AvatarEditorDialog({ request, onClose }: { request: AvatarEditorRequest; onClose: () => void }) {
  const { id, label, url, self = false } = request;
  const { store, defaultStyle } = useAvatarPreferences();
  const entity = self ? "self" : `person:${id}`;
  const seed = self ? store?.key ?? id : id;
  const [expected, setExpected] = useState(request.expected);
  const [draft, setDraft] = useState<AvatarPreference>(request.expected ?? { style: "auto" });
  const [variationSeed, setVariationSeed] = useState(() => request.expected?.seed ?? (self ? crypto.randomUUID() : undefined));
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [cropVersion, setCropVersion] = useState(0);
  const uploadVersion = useRef(0);
  const saveAbort = useRef<AbortController | null>(null);
  const dismissed = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const wasCropping = useRef(false);
  const cropping = bitmap !== null;
  const busy = reading || saving;
  useEffect(() => () => { uploadVersion.current++; saveAbort.current?.abort(); }, []);
  useEffect(() => () => bitmap?.close(), [bitmap]);
  useEffect(() => {
    const scroller = body.current;
    if (!scroller) return;
    scroller.scrollTop = 0;
    // Crop controls disappear on apply/cancel. Keep keyboard focus on a
    // stable surface and reveal the resulting preview, without stealing
    // Radix's initial close-button focus when the editor first opens.
    if (wasCropping.current !== cropping) scroller.focus({ preventScroll: true });
    wasCropping.current = cropping;
  }, [cropping]);
  useEffect(() => {
    // Save stays visible outside the scroller, so reveal its feedback too.
    if (error) feedback.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [error]);

  function close() {
    if (saving || dismissed.current) return;
    dismissed.current = true;
    uploadVersion.current++;
    onClose();
  }
  async function selectFile(file: File | undefined) {
    if (!file) return;
    const version = ++uploadVersion.current;
    setReading(true); setError("");
    try {
      const next = await decodeAvatarUpload(file);
      if (version === uploadVersion.current) { setBitmap(next); setCropVersion(version); }
      else next.close();
    } catch (reason) {
      if (version === uploadVersion.current) setError(reason instanceof Error ? reason.message : "图片无法读取，请换一张重试。");
    } finally { if (version === uploadVersion.current) setReading(false); }
  }
  async function save() {
    if (!store || busy || bitmap) return;
    const controller = new AbortController();
    saveAbort.current = controller;
    setSaving(true); setError("");
    try {
      await withAvatarStorageLock(store, () => store.save(entity,
        draft.style === "auto" && !draft.photo ? undefined : draft, { expected }), controller.signal);
      onClose();
    } catch (reason) {
      if (controller.signal.aborted) return;
      const changed = reason instanceof AvatarPreferenceConflictError;
      setConflict(changed);
      setError(changed ? "头像已在其他位置修改。请载入最新设置后继续，当前草稿尚未保存。"
        : "没有保存成功。浏览器存储可能已满或被禁用；请释放空间后重试。");
    } finally { if (!controller.signal.aborted) setSaving(false); }
  }
  function loadLatest() {
    store?.refresh();
    const latest = store?.getSnapshot().people[entity];
    setExpected(latest); setDraft(latest ?? { style: "auto" });
    if (self) setVariationSeed(latest?.seed ?? crypto.randomUUID());
    setBitmap(null); setError(""); setConflict(false);
  }
  function selectStyle(style: AvatarPreference["style"]) {
    setDraft(current => ({ ...current, style,
      seed: self && (style === "shapes" || style === "glass") ? variationSeed : undefined,
    }));
  }
  function shuffle() {
    const nextSeed = crypto.randomUUID();
    setVariationSeed(nextSeed);
    setDraft(current => ({ ...current, seed: nextSeed, style: current.style === "glass" ? "glass" : "shapes" }));
  }

  return <Dialog.Root open onOpenChange={value => { if (!value) close(); }}>
    <Dialog.Portal>
      <Dialog.Overlay data-avatar-editor="" className={styles.overlay} />
      <Dialog.Content data-avatar-editor="" className={`${styles.dialog} ts-workspace-theme quiet-workspace`}
        onKeyDown={event => {
          event.stopPropagation();
          // Focus can arrive before Radix registers this as the highest layer.
          // The parent may consume that Escape to protect its own surface;
          // the focused editor still owns dismissal. close() is idempotent.
          if (event.key === "Escape" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
            event.preventDefault();
            close();
          }
        }}
        onEscapeKeyDown={event => { if (saving) event.preventDefault(); }}
        onInteractOutside={event => { if (saving) event.preventDefault(); }}
        onCloseAutoFocus={event => {
          event.preventDefault();
          const target = request.trigger.closest("details:not([open])")?.querySelector<HTMLElement>("summary") ?? request.trigger;
          if (target.isConnected) target.focus({ preventScroll: true });
          else document.getElementById("main-content")?.focus({ preventScroll: true });
        }}>
        <header className={styles.header}>
          <div className={styles.heading}>
            <Dialog.Title className={styles.title}>{self ? "我的头像" : "联系人头像"}</Dialog.Title>
            <Dialog.Close className={styles.close} disabled={saving} aria-label="关闭头像设置"><X size={18} /></Dialog.Close>
          </div>
          <Dialog.Description className={styles.description}>选一张照片，或挑一个喜欢的图案。</Dialog.Description>
        </header>
        <div ref={body} className={styles.body} role="region" aria-label="头像预览与显示设置" tabIndex={0}>
          {bitmap ? <AvatarCropEditor key={cropVersion} bitmap={bitmap}
            onApply={photo => { setDraft({ style: "auto", photo }); setBitmap(null); }} onCancel={() => setBitmap(null)} /> : <>
            <div className={styles.preview}>
              <IdentityAvatar id={seed} label={label} url={url} size={88} defaultStyle={defaultStyle} preference={draft} />
              <strong>{label}</strong>
              <span>{draft.photo && draft.style === "auto" ? "自选图片" : draft.seed ? "选好后保存，头像就会保持不变" : draft.style === "auto" ? "优先照片，没有照片时使用默认风格" : "为这个头像单独设置"}</span>
              {self ? <button type="button" className={styles.shuffle} disabled={busy} onClick={shuffle}><Shuffle size={16} aria-hidden="true" />换一个</button> : null}
            </div>
            <fieldset className={styles.fieldset} disabled={busy}>
              <legend>显示方式</legend>
              <div className={styles.options}>
                {choices.map(choice => <button type="button" key={choice.value} aria-pressed={draft.style === choice.value} className={styles.option} onClick={() => selectStyle(choice.value)}>
                  <IdentityAvatar id={seed} label={label} url={url} size={40} defaultStyle={defaultStyle} preference={{ ...draft, style: choice.value,
                    seed: self && (choice.value === "shapes" || choice.value === "glass") ? variationSeed : undefined }} />
                  <span>{choice.label}</span>{draft.style === choice.value ? <Check className={styles.selected} aria-hidden="true" size={12} /> : null}
                </button>)}
              </div>
            </fieldset>
          </>}
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" aria-label="选择头像图片" className={styles.file}
            onChange={event => { void selectFile(event.target.files?.[0]); event.target.value = ""; }} />
          <button className={styles.upload} type="button" disabled={busy} onClick={() => input.current?.click()}>
            <UploadSimple aria-hidden="true" size={16} />{reading ? "正在处理图片…" : "上传图片"}
          </button>
          <p className={styles.hint}>JPG、PNG 或 WebP · 最大 8 MB · 可调整裁切</p>
          <details className={styles.localData}><summary>保存范围与来源</summary><p>仅保存在此浏览器或应用的当前账号中，暂不跨设备同步。不会修改来源平台的照片。图案由 DiceBear 在本机生成。</p></details>
          {draft.photo && !bitmap ? <button className={styles.textButton} type="button" disabled={busy} onClick={() => setDraft(current => ({ style: current.style, seed: current.seed }))}>移除自选图片</button> : null}
          {error || conflict ? <div ref={feedback}>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
            {conflict ? <button className={styles.secondary} type="button" disabled={busy} onClick={loadLatest}>载入最新设置</button> : null}
          </div> : null}
        </div>
        <footer className={styles.footer}>
          <button className={styles.textButton} type="button" disabled={busy || !!bitmap} onClick={() => setDraft({ style: "auto" })}>恢复默认</button>
          <div><Dialog.Close className={styles.secondary} disabled={saving}>取消</Dialog.Close>
            <button className={styles.primary} type="button" disabled={busy || !!bitmap || conflict} onClick={() => void save()}>{saving ? "正在保存…" : "保存头像"}</button></div>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
