"use client";

import { useT, type TFunction } from "@/components/locale-provider";
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { validReturnSessionId, withReturnSession } from "../session-return-navigation";
import type { ConversationImageManifest, MemoryDecision, MemoryProposalItem, MemorySourceLocator } from "@talent-signal/contracts";
import type { MemoryItemOutcome } from "./use-memory-review";
import { SourceImageButton, type SourceImage } from "./source-image-button";
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
  sourceImage?: SourceImage | null;
  sourceUnavailable?: boolean;
};

function scopeLabel(item: MemoryProposalItem, personLabel: string | null, t: TFunction): string {
  if (item.scope === "self") return t("关于我");
  if (item.scope === "person") return personLabel ? t("关于{person}", { person: personLabel }) : t("关于对方");
  return personLabel ? t("与{person}的关系", { person: personLabel }) : t("关系");
}

export function MemoryItemCard({ item, personLabel, busy, locked = false, outcome, onDecide, onCheck, onUndo, onComment, sourceImage, sourceUnavailable = false }: Props) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.display_text);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [composing, setComposing] = useState(false);
  const composingRef = useRef(false);
  const editTrigger = useRef<HTMLButtonElement>(null);
  const restoreEditFocus = useRef(false);
  const sourceId = useId();
  const sourceCanCollapse = item.source_excerpt.length > 120;
  useLayoutEffect(() => {
    if (!editing && restoreEditFocus.current) {
      restoreEditFocus.current = false;
      editTrigger.current?.focus({ preventScroll: true });
    }
  }, [editing]);
  function cancelEdit() {
    restoreEditFocus.current = true;
    composingRef.current = false;
    setComposing(false);
    setDraft(item.display_text);
    setEditing(false);
  }
  const conflict = item.judgment_kind === "conflict" && item.admission_status === "needs_judgment";
  const sensitive = item.judgment_kind === "sensitive" && item.admission_status === "needs_judgment";
  const canDecide = (item.admission_status === "eligible" || conflict || sensitive) && item.status === "pending";
  const isUpdate = item.operation === "update";
  const primary = isUpdate ? t("更新记忆") : t("记住");
  const savedDecision = outcome?.receipt?.decisions.find((entry) => entry.proposal_item_id === item.id)?.decision;
  const shownText = outcome?.kind === "committed"
    ? savedDecision === "keep_old" ? item.previous_text ?? item.display_text : outcome.finalText ?? item.display_text
    : item.display_text;
  const receiptLabel = savedDecision === "keep_old" ? t("已保留旧值")
    : savedDecision === "retain_conflict" ? t("已保留两种说法")
    : isUpdate ? t("已更新记忆") : t("已记住");
  const pass = isUpdate ? t("暂不更新") : t("暂不保存");
  const resolved = outcome?.kind === "committed" || outcome?.kind === "skipped" || outcome?.kind === "undone";
  const redacted = sourceUnavailable || outcome?.kind === "unavailable";
  return <section className={styles.actionCard} aria-label={t("记忆 · {scope}", { scope: scopeLabel(item, redacted ? null : personLabel, t) })} data-memory-item-card={item.id}>
    <div className={styles.actionHead}><span>{t("记忆 · {scope}", { scope: scopeLabel(item, redacted ? null : personLabel, t) })}</span><span>{sourceUnavailable ? t("不可用") : outcome?.kind === "committed" ? t("已保存") : outcome?.kind === "skipped" ? t("已跳过") : outcome?.kind === "unknown" || outcome?.kind === "undo_unknown" ? t("待核对") : outcome?.kind === "unavailable" ? t("不可用") : t("待处理")}</span></div>
    {redacted ? null : item.previous_text ? <dl className={styles.actionChange}>
      <div className={styles.actionValue}><dt>{t("原记忆")}</dt><dd>{item.previous_text}</dd></div>
      <div className={styles.actionValue}><dt>{outcome?.kind === "committed" ? t("本次保存") : t("建议更新")}</dt><dd><strong>{shownText}</strong></dd></div>
    </dl> : <p className={styles.actionChange}><strong>{shownText}</strong></p>}
    {redacted ? null : <div className={styles.actionSource}>
      <blockquote id={sourceId} data-collapsed={sourceCanCollapse && !sourceOpen}>{item.source_excerpt}</blockquote>
      {sourceCanCollapse ? <button type="button" aria-expanded={sourceOpen} aria-controls={sourceId} onClick={() => setSourceOpen(!sourceOpen)}>{sourceOpen ? t("收起原句") : t("展开原句")}</button> : null}
      {sourceImage ? <SourceImageButton source={sourceImage}/> : null}
    </div>}
    {sourceUnavailable ? <p className={styles.actionReceipt} role="alert">{t("来源已失效，不能继续操作。")}</p>
      : outcome?.kind === "committed" ? <div className={styles.actionReceipt} role="status">{receiptLabel}{onUndo ? <button type="button" onClick={() => onUndo(item.id)}>{t("撤销")}</button> : null}</div>
      : outcome?.kind === "skipped" ? <p className={styles.actionReceipt} role="status">{t("本次未保存")}</p>
      : outcome?.kind === "undone" ? <p className={styles.actionReceipt} role="status">{t("已撤销这条记忆")}</p>
      : outcome?.kind === "unknown" || outcome?.kind === "undo_unknown" ? <div className={styles.actionReceipt} role="status">{outcome.kind === "undo_unknown" ? t("撤销结果待核对") : t("结果待核对")}{onCheck ? <button type="button" onClick={() => onCheck(item.id)}>{t("核对结果")}</button> : null}</div>
      : outcome?.kind === "unavailable" ? <p className={styles.actionReceipt} role="alert">{t("来源已失效，不能继续操作。")}</p>
      : null}
    {!resolved && !outcome && !locked && !sourceUnavailable && editing ? <form className={styles.actionEdit} onSubmit={(event) => {
      event.preventDefault();
      if (busy || composingRef.current || !canDecide) return;
      const value = draft.trim();
      if (value) onDecide(item.id, conflict ? "accept_new" : "accept", value);
    }} onKeyDown={event => {
      if (event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229) {
        // An IME candidate key belongs to this editor, including engines that
        // omit isComposing on the last candidate Escape.
        event.stopPropagation();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busy) cancelEdit();
      }
    }}>
      <label htmlFor={`memory-item-edit-${item.id}`}>{t("修改这条记忆")}</label>
      <textarea autoFocus id={`memory-item-edit-${item.id}`} maxLength={1000} value={draft} disabled={busy}
        onCompositionStart={() => { composingRef.current = true; setComposing(true); }}
        onCompositionEnd={() => { composingRef.current = false; setComposing(false); }}
        onChange={(event) => setDraft(event.target.value)}/>
      <div><button type="submit" disabled={busy || composing || !draft.trim()}>{t("保存修改")}</button><button disabled={busy} type="button" onClick={cancelEdit}>{t("取消")}</button></div>
    </form> : null}
    {!resolved && !outcome && !locked && !sourceUnavailable && !editing ? <div className={styles.actionButtons}>
      {conflict ? <>
        <button className={styles.actionPrimary} disabled={busy} type="button" onClick={() => onDecide(item.id, "accept_new")}>{t("采纳新值")}</button>
        <button disabled={busy} type="button" onClick={() => onDecide(item.id, "keep_old")}>{t("保留旧值")}</button>
        <button disabled={busy} type="button" onClick={() => onDecide(item.id, "retain_conflict")}>{t("保留两种说法")}</button>
      </> : canDecide ? <button className={styles.actionPrimary} disabled={busy} type="button" onClick={() => onDecide(item.id, "accept")}>{sensitive ? t("确认记住") : primary}</button> : null}
      {canDecide ? <button ref={editTrigger} disabled={busy} type="button" onClick={() => setEditing(true)}>{t("改一下")}</button> : null}
      <button disabled={busy} type="button" onClick={() => onDecide(item.id, "skip")}>{pass}</button>
      {onComment ? <button className={styles.actionComment} type="button" onClick={() => onComment(item.id)}>{t("补充一句")}</button> : null}
    </div> : null}
    {locked && !sourceUnavailable && !outcome ? <p className={styles.actionHint} role="status">{t("来源或审阅已变化，无法操作。请重新读取当前内容。")}</p> : null}
    {!locked && !canDecide && !outcome && item.status === "pending" ? <p className={styles.actionHint}>{t("这条内容需要先核对归属或来源。")}</p> : null}
  </section>;
}

import type { MemoryReviewController } from "./use-memory-review";
import { ContactDecisionCard } from "./contact-decision-card";

type SourceImageContext = {
  binding: string;
  sessionId: string;
  messageId: string;
  images: readonly ConversationImageManifest[];
};

function sourceImageFor(locator: MemorySourceLocator, context?: SourceImageContext): SourceImage | null {
  if (!context || locator.kind !== "image_region" || locator.session_id && locator.session_id !== context.sessionId) return null;
  const index = locator.image_index;
  if (index === undefined || !Number.isInteger(index)) return null;
  const image = context.images[index];
  if (!image || locator.artifact_id !== `conversation-image-${context.messageId}-${index}-${image.attachment_id}`) return null;
  return {
    binding: context.binding, sessionId: context.sessionId, messageId: context.messageId,
    imageIndex: index, fileName: image.file_name, region: locator.region,
  };
}

export function SessionMemoryCards({ controller, onComment, onCompare, comparison, sourceImageContext, sourceText, sourceSessionId }: {
  controller: MemoryReviewController;
  onComment?: (item: MemoryProposalItem) => void;
  onCompare?: () => void;
  comparison?: ReactNode;
  sourceImageContext?: SourceImageContext;
  sourceText?: string;
  sourceSessionId?: string | null;
}) {
  const t = useT();
  const [showAll, setShowAll] = useState(false);
  const review = controller.review;
  if (!review) {
    const recovered = Object.entries(controller.itemOutcomes).filter((entry) => Boolean(entry[1].snapshot));
    const contact = controller.contactOutcome;
    const contactUndone = contact?.kind === "undone";
    const contactUnknown = contact?.kind === "unknown" || contact?.kind === "undo_unknown";
    const contactUnavailable = contact?.kind === "unavailable";
    const contactVisible = contact?.kind === "committed"
      || (contactUndone && contact.receipt?.undo_contact_outcome === "retained");
    if (recovered.length || controller.contactOutcome?.receipt) return <div className={styles.actionStack} data-memory-review aria-label={t("会话中的操作回执")}>
      {controller.error ? <p className={styles.warning} role="alert">{controller.error}</p> : null}
      {controller.notice ? <p className={styles.message} role="status">{controller.notice}</p> : null}
      {contact?.receipt ? <section className={styles.actionCard} role="status">
        <div className={styles.actionHead}><span>{t("联系人")}</span><span>{contactUnavailable ? t("不可用") : contactUndone ? t("已撤销") : contactUnknown ? t("待核对") : t("已处理")}</span></div>
        <p>{contactUnavailable ? t("来源已失效，不能继续添加。") : <>{contact.receipt.person_display_label ?? t("联系人")} · {contactUndone
          ? contact.receipt.undo_contact_outcome === "retained" ? t("已撤销这次添加；联系人因后续记录保留") : t("已撤销本次添加")
          : contactUnknown ? t(contact.kind === "undo_unknown" ? "撤销结果待核对" : "结果待核对") : contact.kind === "skipped" ? t("本次未添加") : t("已添加")}</>}</p>
        {contactVisible && contact.receipt.created_person_id ? <a href={withReturnSession(`/workspace/people/${contact.receipt.created_person_id}`, validReturnSessionId(sourceSessionId))}>{t("查看人物")}</a> : null}
        {contact.kind === "committed" && contact.receipt.item_count === 0 && contact.receipt.undo?.allowed
          ? <button type="button" disabled={controller.frozen} onClick={() => void controller.undoContact()}>{t("撤销")}</button> : null}
        {contactUnknown ? <button type="button" disabled={controller.reconciling} onClick={() => void controller.checkContact()}>{t("核对结果")}</button> : null}
      </section> : null}
      {recovered.map(([itemId, outcome]) => <MemoryItemCard key={itemId} item={outcome.snapshot!}
        personLabel={outcome.personLabel ?? null} busy locked outcome={outcome}
        sourceImage={sourceImageFor(outcome.snapshot!.source_locator, sourceImageContext)}
        onDecide={() => undefined}
        onCheck={() => void controller.checkItem(itemId)}
        onUndo={() => void controller.undoItem(itemId)}/>) }
    </div>;
    if (controller.phase === "opening" || controller.phase === "idle") return <p className={styles.actionHint} role="status">{t("正在读取这次可以处理的内容…")}</p>;
    if (controller.phase === "unknown") return <div className={styles.actionCard} role="status">{t("结果待核对")}<button type="button" onClick={() => void controller.reconcile()}>{t("核对结果")}</button></div>;
    return <div className={styles.actionCard} role="status">{controller.error ?? t("这次内容已处理。")}
      {controller.phase === "error" ? <button type="button" onClick={() => void controller.open()}>{t("重试读取")}</button> : null}
    </div>;
  }
  const items = review.items.filter((item) => item.status === "pending" || Boolean(controller.itemOutcomes[item.id]));
  const shown = showAll ? items : items.slice(0, 3);
  const frozen = controller.frozen || controller.phase === "processed" || controller.phase === "dismissed"
    || review.source_status === "unavailable";
  const contactItem = review.items.find((item) => item.scope !== "self"
    && Boolean(review.person_display_label)
    && item.source_excerpt.includes(review.person_display_label!));
  const sourceSentence = sourceText?.split(/[。！？\n]/u).find((part) =>
    Boolean(review.person_display_label) && part.includes(review.person_display_label!))?.trim();
  const contactSource = contactItem?.source_excerpt ?? sourceSentence ?? review.person_display_label ?? "";
  const imageContext = sourceImageContext
    && review.source_session_id === sourceImageContext.sessionId
    && review.source_message_id === sourceImageContext.messageId ? sourceImageContext : undefined;
  const showContact = Boolean((review.contact_decision === "new" && review.person_display_label) || controller.contactOutcome);
  return <div className={styles.actionStack} data-memory-review aria-label={t("会话中的记忆操作")}>
    {showContact ? <ContactDecisionCard
      displayLabel={controller.contactOutcome?.receipt?.person_display_label ?? review.person_display_label ?? t("联系人")}
      relationshipContext={review.relationship_display_label ?? ""}
      sourceExcerpt={contactSource}
      sourceSessionId={review.source_session_id ?? sourceSessionId}
      sourceUnavailable={review.source_status === "unavailable"}
      sourceImage={sourceImageFor(contactItem?.source_locator ?? (imageContext?.images.length === 1
        ? { kind: "image_region", artifact_id: `conversation-image-${imageContext.messageId}-0-${imageContext.images[0]!.attachment_id}`, image_index: 0 }
        : { kind: "message" }), imageContext)}
      status={review.contact_status === "ambiguous" ? "ambiguous" : "pending"}
      busy={controller.frozen || review.source_status === "unavailable"}
      outcome={controller.contactOutcome}
      onAdd={(displayLabel, relationshipContext) => void controller.decideContactOnly({ displayLabel, relationshipContext })}
      onCorrectName={(displayLabel, relationshipContext) => controller.rebase({ contactDecision: "new", newContactLabel: displayLabel, newContactRelationship: relationshipContext })}
      onPass={() => void controller.rebase({ contactDecision: "none" })}
      onCompare={() => onCompare?.()}
      onCheck={() => void controller.checkContact()}
      onUndo={() => void controller.undoContact()}
      comparison={comparison}/>
      : review.source_status !== "unavailable" && review.contact_decision === "none" && review.person_display_label ? <p className={styles.actionHint}>{t("本次未添加")}{review.person_display_label}。</p> : null}
    {shown.map((item) => <MemoryItemCard key={item.id} item={item}
      personLabel={review.person_display_label ?? null}
      busy={frozen || (item.scope !== "self" && review.contact_status !== "resolved")}
      locked={controller.phase === "processed" || controller.phase === "dismissed" || review.source_status === "unavailable"}
      outcome={controller.itemOutcomes[item.id]}
      sourceUnavailable={review.source_status === "unavailable"}
      sourceImage={sourceImageFor(item.source_locator, imageContext)}
      onDecide={(itemId, decision, editedText) => void controller.decideItem({ itemId, decision, editedText })}
      onCheck={(itemId) => void controller.checkItem(itemId)}
      onUndo={(itemId) => void controller.undoItem(itemId)}
      onComment={onComment ? () => onComment(item) : undefined}/>) }
    {!showAll && items.length > 3 ? <button className={styles.actionMore} type="button" onClick={() => setShowAll(true)}>{t("更多建议 · {count}", { count: items.length - 3 })}</button> : null}
    {controller.error ? <p className={styles.warning} role="alert">{controller.error}</p> : null}
    {controller.notice ? <p className={styles.message} role="status">{controller.notice}</p> : null}
  </div>;
}
