"use client";

import { useState, type ReactNode } from "react";
import type { MemoryDecision, MemoryProposalItem } from "@talent-signal/contracts";
import type { MemoryItemOutcome } from "./use-memory-review";
import styles from "./memory-review.module.css";

type Props = {
  item: MemoryProposalItem;
  personLabel: string | null;
  busy: boolean;
  locked?: boolean;
  outcome?: MemoryItemOutcome;
  onDecide: (itemId: string, decision: MemoryDecision, editedText?: string) => void;
  onCheck?: (itemId: string) => void;
  onUndo?: (itemId: string) => void;
  onComment?: (itemId: string) => void;
};

function scopeLabel(item: MemoryProposalItem, personLabel: string | null): string {
  if (item.scope === "self") return "关于我";
  if (item.scope === "person") return personLabel ? `关于${personLabel}` : "关于对方";
  return personLabel ? `与${personLabel}的关系` : "关系";
}

export function MemoryItemCard({ item, personLabel, busy, locked = false, outcome, onDecide, onCheck, onUndo, onComment }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.display_text);
  const [sourceOpen, setSourceOpen] = useState(false);
  const conflict = item.judgment_kind === "conflict" && item.admission_status === "needs_judgment";
  const sensitive = item.judgment_kind === "sensitive" && item.admission_status === "needs_judgment";
  const canDecide = (item.admission_status === "eligible" || conflict || sensitive) && item.status === "pending";
  const isUpdate = item.operation === "update";
  const primary = isUpdate ? "更新记忆" : "记住";
  const savedDecision = outcome?.receipt?.decisions.find((entry) => entry.proposal_item_id === item.id)?.decision;
  const shownText = outcome?.kind === "committed"
    ? savedDecision === "keep_old" ? item.previous_text ?? item.display_text : outcome.finalText ?? item.display_text
    : item.display_text;
  const receiptLabel = savedDecision === "keep_old" ? "已保留旧值"
    : savedDecision === "retain_conflict" ? "已保留两种说法"
    : isUpdate ? "已更新记忆" : "已记住";
  const pass = isUpdate ? "暂不更新" : "暂不保存";
  const resolved = outcome?.kind === "committed" || outcome?.kind === "skipped" || outcome?.kind === "undone";
  return <section className={styles.actionCard} aria-label={`记忆 · ${scopeLabel(item, personLabel)}`} data-memory-item-card={item.id}>
    <div className={styles.actionHead}><span>记忆 · {scopeLabel(item, personLabel)}</span><span>{outcome?.kind === "committed" ? "已保存" : outcome?.kind === "skipped" ? "已跳过" : outcome?.kind === "unknown" || outcome?.kind === "undo_unknown" ? "待核对" : outcome?.kind === "unavailable" ? "不可用" : "待处理"}</span></div>
    <p className={styles.actionChange}>{item.previous_text ? <><span>{item.previous_text}</span><span aria-hidden="true"> → </span><strong>{shownText}</strong></> : <strong>{shownText}</strong>}</p>
    <div className={styles.actionSource}>
      <blockquote data-expanded={sourceOpen}>{item.source_excerpt}</blockquote>
      {item.source_excerpt.length > 120 ? <button type="button" onClick={() => setSourceOpen(!sourceOpen)}>{sourceOpen ? "收起原句" : "展开原句"}</button> : null}
    </div>
    {outcome?.kind === "committed" ? <div className={styles.actionReceipt} role="status">{receiptLabel}{onUndo ? <button type="button" onClick={() => onUndo(item.id)}>撤销</button> : null}</div>
      : outcome?.kind === "skipped" ? <p className={styles.actionReceipt} role="status">本次未保存</p>
      : outcome?.kind === "undone" ? <p className={styles.actionReceipt} role="status">已撤销这条记忆</p>
      : outcome?.kind === "unknown" || outcome?.kind === "undo_unknown" ? <div className={styles.actionReceipt} role="status">{outcome.kind === "undo_unknown" ? "撤销结果待核对" : "结果待核对"}{onCheck ? <button type="button" onClick={() => onCheck(item.id)}>核对结果</button> : null}</div>
      : outcome?.kind === "unavailable" ? <p className={styles.actionReceipt} role="alert">来源已失效，不能继续操作。</p>
      : null}
    {!resolved && !outcome && !locked && editing ? <form className={styles.actionEdit} onSubmit={(event) => {
      event.preventDefault();
      const value = draft.trim();
      if (value) onDecide(item.id, conflict ? "accept_new" : "accept", value);
    }}>
      <label htmlFor={`memory-item-edit-${item.id}`}>修改这条记忆</label>
      <textarea id={`memory-item-edit-${item.id}`} maxLength={1000} value={draft} onChange={(event) => setDraft(event.target.value)}/>
      <div><button type="submit" disabled={busy || !draft.trim()}>保存修改</button><button type="button" onClick={() => { setDraft(item.display_text); setEditing(false); }}>取消</button></div>
    </form> : null}
    {!resolved && !outcome && !locked && !editing ? <div className={styles.actionButtons}>
      {conflict ? <>
        <button className={styles.actionPrimary} disabled={busy} type="button" onClick={() => onDecide(item.id, "accept_new")}>采纳新值</button>
        <button disabled={busy} type="button" onClick={() => onDecide(item.id, "keep_old")}>保留旧值</button>
        <button disabled={busy} type="button" onClick={() => onDecide(item.id, "retain_conflict")}>保留两种说法</button>
      </> : canDecide ? <button className={styles.actionPrimary} disabled={busy} type="button" onClick={() => onDecide(item.id, "accept")}>{sensitive ? "确认记住" : primary}</button> : null}
      {canDecide ? <button disabled={busy} type="button" onClick={() => setEditing(true)}>改一下</button> : null}
      <button disabled={busy} type="button" onClick={() => onDecide(item.id, "skip")}>{pass}</button>
      {onComment ? <button className={styles.actionComment} type="button" onClick={() => onComment(item.id)}>补充一句</button> : null}
    </div> : null}
    {locked && !outcome ? <p className={styles.actionHint} role="status">来源或审阅已变化，无法操作。请重新读取当前内容。</p> : null}
    {!locked && !canDecide && !outcome && item.status === "pending" ? <p className={styles.actionHint}>这条内容需要先核对归属或来源。</p> : null}
  </section>;
}

import type { MemoryReviewController } from "./use-memory-review";
import { ContactDecisionCard } from "./contact-decision-card";

export function SessionMemoryCards({ controller, onComment, onCompare, comparison }: {
  controller: MemoryReviewController;
  onComment?: (item: MemoryProposalItem) => void;
  onCompare?: () => void;
  comparison?: ReactNode;
}) {
  const [showAll, setShowAll] = useState(false);
  const review = controller.review;
  if (!review) {
    if (controller.phase === "opening" || controller.phase === "idle") return <p className={styles.actionHint} role="status">正在读取这次可以处理的内容…</p>;
    if (controller.phase === "unknown") return <div className={styles.actionCard} role="status">结果待核对 <button type="button" onClick={() => void controller.reconcile()}>核对结果</button></div>;
    return <div className={styles.actionCard} role="status">{controller.error ?? "这次内容已处理。"}
      {controller.phase === "error" ? <button type="button" onClick={() => void controller.open()}>重试读取</button> : null}
    </div>;
  }
  const items = review.items.filter((item) => item.status === "pending" || Boolean(controller.itemOutcomes[item.id]));
  const shown = showAll ? items : items.slice(0, 3);
  const frozen = controller.frozen || controller.phase === "processed" || controller.phase === "dismissed"
    || review.source_status === "unavailable";
  const contactSource = review.items.find((item) => item.scope !== "self"
    && Boolean(review.person_display_label)
    && item.source_excerpt.includes(review.person_display_label!))?.source_excerpt
    ?? review.person_display_label ?? "";
  const showContact = Boolean((review.contact_decision === "new" && review.person_display_label) || controller.contactOutcome);
  return <div className={styles.actionStack} data-memory-review aria-label="会话中的记忆操作">
    {showContact ? <ContactDecisionCard
      displayLabel={controller.contactOutcome?.receipt?.person_display_label ?? review.person_display_label ?? "联系人"}
      relationshipContext={review.relationship_display_label ?? ""}
      sourceExcerpt={contactSource}
      status={review.contact_status === "ambiguous" ? "ambiguous" : "pending"}
      busy={controller.frozen}
      outcome={controller.contactOutcome}
      onAdd={(displayLabel, relationshipContext) => void controller.decideContactOnly({ displayLabel, relationshipContext })}
      onCorrectName={(displayLabel, relationshipContext) => controller.rebase({ contactDecision: "new", newContactLabel: displayLabel, newContactRelationship: relationshipContext })}
      onPass={() => void controller.rebase({ contactDecision: "none" })}
      onCompare={() => onCompare?.()}
      onCheck={() => void controller.checkContact()}
      onUndo={() => void controller.undoContact()}
      comparison={comparison}/>
      : review.contact_decision === "none" && review.person_display_label ? <p className={styles.actionHint}>本次未添加{review.person_display_label}。</p> : null}
    {shown.map((item) => <MemoryItemCard key={item.id} item={item}
      personLabel={review.person_display_label ?? null}
      busy={frozen || (item.scope !== "self" && review.contact_status !== "resolved")}
      locked={controller.phase === "processed" || controller.phase === "dismissed" || review.source_status === "unavailable"}
      outcome={controller.itemOutcomes[item.id]}
      onDecide={(itemId, decision, editedText) => void controller.decideItem({ itemId, decision, editedText })}
      onCheck={(itemId) => void controller.checkItem(itemId)}
      onUndo={(itemId) => void controller.undoItem(itemId)}
      onComment={onComment ? () => onComment(item) : undefined}/>) }
    {!showAll && items.length > 3 ? <button className={styles.actionMore} type="button" onClick={() => setShowAll(true)}>更多建议 · {items.length - 3}</button> : null}
    {controller.error ? <p className={styles.warning} role="alert">{controller.error}</p> : null}
    {controller.notice ? <p className={styles.message} role="status">{controller.notice}</p> : null}
  </div>;
}
