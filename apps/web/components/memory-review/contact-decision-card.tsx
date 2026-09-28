"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { MemoryItemOutcome } from "./use-memory-review";
import styles from "./memory-review.module.css";

type Props = {
  displayLabel: string;
  relationshipContext: string;
  sourceExcerpt: string;
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

export function ContactDecisionCard({ displayLabel, relationshipContext, sourceExcerpt, status, busy,
  outcome, onAdd, onCorrectName, onPass, onCompare, onCheck, onUndo, comparison }: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(displayLabel);
  const [context, setContext] = useState(relationshipContext);
  const createdId = outcome?.receipt?.created_person_id;
  return <section className={styles.actionCard} aria-label="联系人操作" data-contact-decision-card>
    <div className={styles.actionHead}><span>联系人</span><span>{outcome?.kind === "committed" ? "已添加" : outcome?.kind === "skipped" ? "已跳过" : outcome?.kind === "unknown" || outcome?.kind === "undo_unknown" ? "待核对" : status === "ambiguous" ? "需核对身份" : "待添加"}</span></div>
    <div className={styles.contactDecisionIdentity}><span className={styles.avatar} aria-hidden="true">{displayLabel.slice(0, 1)}</span><div><strong>{displayLabel}</strong>{relationshipContext ? <small>{relationshipContext}</small> : null}</div></div>
    <div className={styles.actionSource}><blockquote data-expanded="true">{sourceExcerpt}</blockquote></div>
    {outcome?.kind === "committed" ? <div className={styles.actionReceipt} role="status">已添加联系人
      {createdId ? <Link href={`/workspace/people/${createdId}`}>查看人物</Link> : null}
      {onUndo && outcome.receipt?.undo?.allowed ? <button type="button" onClick={onUndo}>撤销</button> : null}
    </div> : outcome?.kind === "skipped" ? <p className={styles.actionReceipt} role="status">本次未添加</p>
      : outcome?.kind === "undone" ? <p className={styles.actionReceipt} role="status">{outcome.receipt?.undo_contact_outcome === "retained" ? "已撤销这次添加；联系人因后续记录保留" : "已撤销这次添加"}</p>
      : outcome?.kind === "unknown" || outcome?.kind === "undo_unknown" ? <div className={styles.actionReceipt} role="status">{outcome.kind === "undo_unknown" ? "撤销结果待核对" : "结果待核对"}<button type="button" onClick={onCheck}>核对结果</button></div>
      : outcome?.kind === "unavailable" ? <p className={styles.actionReceipt} role="alert">来源已失效，不能继续添加。</p>
      : null}
    {!outcome && editing ? <form className={styles.contactDecisionEdit} onSubmit={(event) => {
      event.preventDefault();
      if (!name.trim()) return;
      if (name.trim() !== displayLabel.trim()) {
        if (onCorrectName) void onCorrectName(name.trim(), context.trim()).then((ok) => { if (ok) setEditing(false); });
        return;
      }
      onAdd(name.trim(), context.trim());
      setEditing(false);
    }}>
      <label>姓名<input value={name} maxLength={200} onChange={(event) => setName(event.target.value)}/></label>
      <label>关系<input value={context} maxLength={200} onChange={(event) => setContext(event.target.value)}/></label>
      <div className={styles.actionButtons}><button className={styles.actionPrimary} type="submit" disabled={busy || !name.trim()}>{name.trim() !== displayLabel.trim() ? "核对新姓名" : "添加联系人"}</button><button type="button" onClick={() => { setName(displayLabel); setContext(relationshipContext); setEditing(false); }}>取消</button></div>
    </form> : null}
    {!outcome && !editing ? <div className={styles.actionButtons}>
      {status === "pending" ? <button className={styles.actionPrimary} type="button" disabled={busy} onClick={() => onAdd(name.trim(), context.trim())}>添加联系人</button> : <p className={styles.actionHint}>发现同名人物，先核对是谁。</p>}
      {status === "pending" ? <button type="button" disabled={busy} onClick={() => setEditing(true)}>改资料</button> : null}
      <button type="button" disabled={busy} onClick={onCompare}>{status === "ambiguous" ? "核对人物" : "查找已有"}</button>
      <button type="button" disabled={busy} onClick={onPass}>暂不添加</button>
    </div> : null}
    {comparison}
  </section>;
}
