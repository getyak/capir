"use client";

import { useT } from "@/components/locale-provider";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { DotsThree } from "@phosphor-icons/react";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import type { MemoryItemOutcome } from "./use-memory-review";
import { SourceImageButton, type SourceImage } from "./source-image-button";
import styles from "./memory-review.module.css";

type Props = {
  displayLabel: string;
  relationshipContext: string;
  sourceExcerpt: string;
  sourceImage?: SourceImage | null;
  sourceUnavailable?: boolean;
  status: "pending" | "ambiguous";
  busy: boolean;
  outcome?: MemoryItemOutcome | null;
  onAdd: (displayLabel: string, relationshipContext: string) => void;
  onCorrectName?: (displayLabel: string, relationshipContext: string) => Promise<boolean>;
  onPass: () => void;
  onCompare: () => void;
  onCheck: () => void;
  onUndo?: () => void;
  comparison?: ReactNode;
};

export function ContactDecisionCard({ displayLabel, relationshipContext, sourceExcerpt, sourceImage, sourceUnavailable = false, status, busy,
  outcome, onAdd, onCorrectName, onPass, onCompare, onCheck, onUndo, comparison }: Props) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(displayLabel);
  const [context, setContext] = useState(relationshipContext);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsTrigger = useRef<HTMLButtonElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const editRequested = useRef(false);
  const createdId = outcome?.receipt?.created_person_id;
  const unavailable = sourceUnavailable || outcome?.kind === "unavailable";
  const hasExcerpt = sourceExcerpt.trim() && sourceExcerpt.trim() !== displayLabel.trim();
  return <section className={`${styles.actionCard} ${styles.contactDecisionCard}`} aria-label={t("联系人操作")} data-contact-decision-card>
    <div className={styles.contactDecisionIdentity}>
      <strong>{unavailable ? t("联系人") : displayLabel}</strong>
      <span>{unavailable ? t("不可用") : outcome?.kind === "committed" ? t("已添加") : outcome?.kind === "skipped" ? t("已跳过") : outcome?.kind === "unknown" || outcome?.kind === "undo_unknown" ? t("待核对") : status === "ambiguous" ? t("需核对身份") : t("待添加")}</span>
    </div>
    {!unavailable && relationshipContext ? <p className={styles.contactDecisionContext}>{relationshipContext}</p> : null}
    {!unavailable && (hasExcerpt || sourceImage) ? <div className={styles.contactDecisionSource}>
      {hasExcerpt ? <blockquote>{sourceExcerpt}</blockquote> : null}
      {sourceImage ? <SourceImageButton source={sourceImage}/> : null}
    </div> : null}
    {sourceUnavailable ? <p className={styles.actionReceipt} role="alert">{t("来源已失效，不能继续添加。")}</p>
      : outcome?.kind === "committed" ? <div className={styles.actionReceipt} role="status">{t("已添加联系人")}
      {createdId ? <Link href={`/workspace/people/${createdId}`}>{t("查看人物")}</Link> : null}
      {onUndo && outcome.receipt?.undo?.allowed ? <button type="button" onClick={onUndo}>{t("撤销")}</button> : null}
    </div> : outcome?.kind === "skipped" ? <p className={styles.actionReceipt} role="status">{t("本次未添加")}</p>
      : outcome?.kind === "undone" ? <p className={styles.actionReceipt} role="status">{outcome.receipt?.undo_contact_outcome === "retained" ? t("已撤销这次添加；联系人因后续记录保留") : t("已撤销这次添加")}</p>
      : outcome?.kind === "unknown" || outcome?.kind === "undo_unknown" ? <div className={styles.actionReceipt} role="status">{outcome.kind === "undo_unknown" ? t("撤销结果待核对") : t("结果待核对")}<button type="button" onClick={onCheck}>{t("核对结果")}</button></div>
      : outcome?.kind === "unavailable" ? <p className={styles.actionReceipt} role="alert">{t("来源已失效，不能继续添加。")}</p>
      : null}
    {!sourceUnavailable && !outcome && editing ? <form className={styles.contactDecisionEdit} onSubmit={(event) => {
      event.preventDefault();
      if (busy || !name.trim()) return;
      if (name.trim() !== displayLabel.trim()) {
        if (onCorrectName) void onCorrectName(name.trim(), context.trim()).then((ok) => { if (ok) setEditing(false); });
        return;
      }
      onAdd(name.trim(), context.trim());
      setEditing(false);
    }}>
      <label>{t("姓名")}<input ref={nameInput} disabled={busy} value={name} maxLength={200} onChange={(event) => setName(event.target.value)}/></label>
      <label>{t("关系")}<input disabled={busy} value={context} maxLength={200} onChange={(event) => setContext(event.target.value)}/></label>
      <div className={styles.actionButtons}><button className={styles.actionPrimary} type="submit" disabled={busy || !name.trim()}>{name.trim() !== displayLabel.trim() ? t("核对新姓名") : t("添加联系人")}</button><button type="button" disabled={busy} onClick={() => { setEditing(false); requestAnimationFrame(() => actionsTrigger.current?.focus()); }}>{t("取消")}</button></div>
    </form> : null}
    {!sourceUnavailable && !outcome && !editing ? <>
      {status === "ambiguous" ? <p className={styles.actionHint}>{t("已有同名人物，可以查看已有记录，或添加为另一位联系人。")}</p> : null}
      <div className={`${styles.actionButtons} ${styles.contactDecisionActions}`}>
        <button className={styles.actionPrimary} type="button" disabled={busy || !displayLabel.trim()} onClick={() => onAdd(displayLabel.trim(), relationshipContext.trim())}>{status === "ambiguous" ? t("添加为新联系人") : t("添加联系人")}</button>
        <Popover open={actionsOpen && !busy} onOpenChange={setActionsOpen}>
          <PopoverTrigger asChild><button ref={actionsTrigger} className={styles.contactDecisionMore} type="button" disabled={busy}><DotsThree size={20} aria-hidden="true"/>{t("更多操作")}</button></PopoverTrigger>
          <PopoverContent className={styles.contactDecisionMenu} align="end" aria-label={t("联系人操作")} onCloseAutoFocus={(event) => {
            if (editRequested.current) {
              event.preventDefault();
              editRequested.current = false;
              nameInput.current?.focus();
            }
          }}>
            <button type="button" disabled={busy} onClick={() => {
              setName(displayLabel); setContext(relationshipContext);
              editRequested.current = true; setEditing(true); setActionsOpen(false);
            }}>{t("改资料")}</button>
            <button type="button" disabled={busy} onClick={() => { setActionsOpen(false); onCompare(); }}>{status === "ambiguous" ? t("核对人物") : t("查找已有")}</button>
            <button type="button" disabled={busy} onClick={() => { setActionsOpen(false); onPass(); }}>{t("暂不添加")}</button>
          </PopoverContent>
        </Popover>
      </div>
    </> : null}
    {!sourceUnavailable ? comparison : null}
  </section>;
}
