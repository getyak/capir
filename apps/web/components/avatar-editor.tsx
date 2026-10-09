"use client";

import { Camera } from "@phosphor-icons/react/dist/csr/Camera";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { useState } from "react";
import type { AvatarStyle } from "@/lib/avatar";
import { AvatarPreferenceConflictError, withAvatarStorageLock, type AvatarSnapshot } from "@/lib/avatar-preferences";
import { useAvatarEditor, useAvatarPreferences } from "./avatar-preferences-provider";
import { IdentityAvatar } from "./identity-avatar";
import { PersonDirectoryAvatar } from "./person-directory-avatar";
import { useClientReady } from "./ui/use-client-ready";
import styles from "./avatar-editor.module.css";

const choices: { value: AvatarStyle; label: string }[] = [
  { value: "initials", label: "姓名" }, { value: "shapes", label: "几何" }, { value: "glass", label: "柔光" },
];

export function AvatarEditor({ id, label, url, self = false, size = 72, shape, className, triggerLabel }: {
  id: string; label: string; url?: string | null; self?: boolean; size?: number;
  shape?: "circle" | "squircle"; className?: string; triggerLabel?: string;
}) {
  const openEditor = useAvatarEditor();
  const ready = useClientReady();
  return <button type="button" className={`${styles.trigger} ${className ?? ""}`} disabled={!openEditor || !ready}
    data-compact={size <= 40} data-labelled={Boolean(triggerLabel)} aria-haspopup="dialog" aria-label={self ? "编辑我的头像" : `编辑 ${label} 的头像`}
    onClick={event => openEditor?.({ id, label, url, self }, event.currentTarget)}>
    <PersonDirectoryAvatar id={id} label={label} url={url} self={self} size={size} shape={shape} />
    <span className={styles.camera}><Camera size={13} aria-hidden="true" /></span>
    {triggerLabel && <span className={styles.triggerLabel}>{triggerLabel}</span>}
  </button>;
}

export function AvatarDefaultSettings() {
  const { store, defaultStyle } = useAvatarPreferences();
  const [error, setError] = useState("");
  const [clearing, setClearing] = useState<AvatarSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  async function select(value: AvatarStyle) {
    if (!store || busy) return;
    setBusy(true); setStatus("");
    try { await withAvatarStorageLock(store, () => store.setDefault(value)); setError(""); setStatus("默认头像风格已保存"); }
    catch { setError("默认风格未保存，请检查浏览器存储后重试。"); }
    finally { setBusy(false); }
  }
  async function clear() {
    if (!store || !clearing || busy) return;
    setBusy(true); setStatus("");
    try { await withAvatarStorageLock(store, () => store.clear(clearing)); setClearing(null); setError(""); setStatus("本机头像设置已清除"); }
    catch (reason) {
      setError(reason instanceof AvatarPreferenceConflictError ? "头像设置已在其他位置更新，请重新确认要清除的设置。" : "未能清除本机头像数据，请检查浏览器存储后重试。");
      setClearing(null);
    } finally { setBusy(false); }
  }
  return <section className={styles.settings} aria-label="默认头像风格">
    <div><h2>联系人默认头像</h2><p>没有照片时使用。单独设置过的联系人保持自己的风格。</p></div>
    <div className={styles.defaults}>
      {choices.map(choice => <button className={styles.defaultOption} disabled={!store || busy} aria-pressed={defaultStyle === choice.value} key={choice.value} type="button" onClick={() => void select(choice.value)}>
        <span className={styles.examples}>
          <IdentityAvatar id="example-1" label="张伟" size={40} preference={{ style: choice.value }} />
          <IdentityAvatar id="example-2" label="John Smith" size={40} preference={{ style: choice.value }} />
          <IdentityAvatar id="example-3" label="陈曦" size={40} preference={{ style: choice.value }} />
        </span>
        <span>{choice.label}{defaultStyle === choice.value ? <Check size={14} aria-hidden="true" /> : null}</span>
      </button>)}
    </div>
    <p className={styles.hint}>没有姓名时，使用稳定的抽象图案。</p>
    <details className={styles.localData}>
      <summary>管理本机头像数据</summary>
      <p>清除当前账号在此浏览器中上传的头像和风格设置，恢复已有来源照片与姓名头像。</p>
      {clearing ? <div><button className={styles.textButton} type="button" disabled={busy} onClick={() => setClearing(null)}>保留设置</button><button className={styles.textButton} type="button" disabled={busy} onClick={() => void clear()}>确认清除</button></div>
        : <button className={styles.textButton} type="button" disabled={!store || busy} onClick={() => { store?.refresh(); setClearing(store?.getSnapshot() ?? null); }}>清除本机头像设置</button>}
    </details>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <span className={styles.srOnly} role="status">{status}</span>
  </section>;
}
