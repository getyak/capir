"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { CaretDown, CaretRight, MagnifyingGlass, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MemoryDecision,
  MemoryProposalItem,
  MemoryProposalReference,
  MemoryScope,
  PersonDirectoryItem,
} from "@talent-signal/contracts";

import { workspaceSessionFetch } from "@/components/workspace-session-request";

import {
  buildCommitDraft,
  eligibleItems,
  expandGroup,
  groupItems,
  groupSelection,
  judgmentItems,
  openDetail,
  openSheet,
  restoreContact,
  selectedCount,
  selectedEffectCounts,
  setDecision,
  setEditedText,
  setItemsSelected,
  skipContact,
  toggleGroup,
  toggleItem,
  visibleItems,
  type MemoryReviewDraftState,
} from "@/lib/memory-review-draft";
import { useMemoryReview, type MemoryReviewPurpose, type MemoryRebaseInput } from "./use-memory-review";
import { SessionMemoryCards } from "./memory-item-card";
import styles from "./memory-review.module.css";

export type MemoryReviewCardProps = {
  binding: string | null;
  proposal: MemoryProposalReference;
  purpose: MemoryReviewPurpose;
  personId?: string | null;
  contextId?: string | null;
  pursuit?: {
    pursuitId: string;
    roleId?: string | null;
    evidenceFragmentId?: string | null;
  } | null;
  entryCapability?: string | null;
  sessionId?: string | null;
  onCommentItem?: (item: MemoryProposalItem) => void;
};

const PREVIEW_LIMIT = 4;

function primaryLabel(
  state: MemoryReviewDraftState,
  review: { person_display_label?: string | null; contact_status: string; person_id?: string | null },
  count: number,
): string {
  const name = review.person_display_label ?? "此人";
  if (state.contactDecision === "none") {
    return count > 0 ? `仅记住关于我的 ${count} 条` : "本次不保存";
  }
  if (state.contactDecision === "new" && review.contact_status === "pending") {
    return count > 0 ? `添加${name}并记住 ${count} 条` : `仅添加${name}`;
  }
  return count > 0 ? `记住 ${count} 条` : "本次不保存";
}

function judgmentLabel(decision: MemoryDecision): string {
  switch (decision) {
    case "keep_old":
      return "保留旧值";
    case "accept_new":
    case "accept":
      return "接受新值";
    case "retain_conflict":
      return "保留冲突";
    default:
      return "跳过";
  }
}

function judgmentExplanation(item: MemoryProposalItem): string {
  const messages: Record<MemoryProposalItem["judgment_kind"], string> = {
    ordinary: "请确认这条内容是否需要保留。",
    conflict: "两次说法不同，由你决定保留哪一种；不会自动覆盖。",
    sensitive: "这条内容较私密，请确认是否有必要记住。",
    ambiguous_attribution: "还不能确定这句话属于谁，请先核对来源。",
    stale_target: "原有记录已变化，请先核对最新内容。",
    self_scope_escape: "这条内容涉及他人或关系，不能只存为关于我的记忆。",
  };
  return messages[item.judgment_kind];
}

function MemorySentence({item}: {item: MemoryProposalItem}) {
  return item.operation !== "add" && item.previous_text
    ? <span className={styles.judgmentChange}><span>{item.previous_text}</span><span aria-hidden="true"> → </span><strong>{item.display_text}</strong></span>
    : <span>{item.display_text}</span>;
}

function ItemRow({
  item,
  checked,
  disabled,
  frozen,
  onToggle,
  onOpenDetail,
}: {
  item: MemoryProposalItem;
  checked: boolean;
  disabled: boolean;
  frozen: boolean;
  onToggle: () => void;
  onOpenDetail: (trigger: HTMLButtonElement) => void;
}) {
  return (
    <li className={styles.itemRow}>
      <label className={styles.check}>
        <input
          aria-label={`选择：${item.display_text}`}
          checked={checked}
          disabled={disabled || frozen}
          onChange={onToggle}
          type="checkbox"
        />
      </label>
      <button
        className={styles.itemText}
        data-memory-item={item.id}
        disabled={frozen}
        onClick={(event) => onOpenDetail(event.currentTarget)}
        type="button"
      >
        <MemorySentence item={item} />
        {item.operation !== "add" ? (
          <small className={styles.itemOperation}>
            {item.operation === "update" ? "更新" : "冲突"}
          </small>
        ) : null}
      </button>
    </li>
  );
}

function groupLabel(scope: MemoryScope, personLabel: string | null): string {
  if (scope === "self") return "关于我";
  if (scope === "person") return personLabel ? `关于${personLabel}` : "关于对方";
  return "我们之间";
}

function GroupSection({
  scope,
  items,
  personLabel,
  state,
  dispatch,
  frozen,
  onOpenItem,
  onOpenSheet,
}: {
  scope: MemoryScope;
  items: MemoryProposalItem[];
  personLabel: string | null;
  state: MemoryReviewDraftState;
  dispatch: (next: MemoryReviewDraftState) => void;
  frozen: boolean;
  onOpenItem: (item: MemoryProposalItem, trigger: HTMLButtonElement) => void;
  onOpenSheet: (scope: MemoryScope) => void;
}) {
  const selection = groupSelection(state, items);
  const expanded = state.expandedGroups[scope];
  const shown = expanded ? items.slice(0, PREVIEW_LIMIT) : [];
  const remaining = items.length - shown.length;
  const preview = items[0];
  const label = groupLabel(scope, personLabel);
  return (
    <section className={styles.group} aria-label={label}>
      <div className={styles.groupHeader}>
        <label className={styles.check}>
          <input
            aria-label={`${selection.state === "all" ? "取消全选" : "全选"}：${label}`}
            checked={selection.state === "all"}
            disabled={frozen}
            onChange={() => dispatch(toggleGroup(state, items))}
            ref={(node) => {
              if (node) node.indeterminate = selection.state === "mixed";
            }}
            type="checkbox"
          />
        </label>
        <button
          aria-expanded={expanded}
          className={styles.groupTitle}
          disabled={frozen}
          onClick={() => dispatch(expandGroup(state, scope, !expanded))}
          type="button"
        >
          <span>{label}</span>
          <small>
            {selection.selected}/{selection.total}
          </small>
          {expanded ? <CaretDown size={14} aria-hidden="true" /> : <CaretRight size={14} aria-hidden="true" />}
        </button>
      </div>
      {expanded ? (
        <>
          <ul className={styles.items}>
            {shown.map((item) => (
              <ItemRow
                checked={Boolean(state.selected[item.id])}
                disabled={item.admission_status !== "eligible"}
                frozen={frozen}
                item={item}
                key={item.id}
                onOpenDetail={(trigger) => onOpenItem(item, trigger)}
                onToggle={() => dispatch(toggleItem(state, item))}
              />
            ))}
          </ul>
          {remaining > 0 ? (
            <button className={styles.more} disabled={frozen} onClick={() => onOpenSheet(scope)} type="button">
              查看其余 {remaining} 条
            </button>
          ) : null}
        </>
      ) : preview ? (
        <button
          className={styles.preview}
          disabled={frozen}
          onClick={() => dispatch(expandGroup(state, scope, true))}
          type="button"
        >
          <MemorySentence item={preview} />
        </button>
      ) : null}
    </section>
  );
}

function Panel({
  state,
  review,
  dispatch,
  frozen,
  returnFocusTo,
  personLabel,
  onOpenItem,
}: {
  state: MemoryReviewDraftState;
  review: { items: MemoryProposalItem[]; person_display_label?: string | null };
  dispatch: (next: MemoryReviewDraftState) => void;
  frozen: boolean;
  returnFocusTo: HTMLElement | null;
  personLabel: string | null;
  onOpenItem: (item: MemoryProposalItem, trigger: HTMLButtonElement) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef(0);
  const focusRowRef = useRef<string | null>(null);
  const scope = state.sheetGroup;
  const detailId = state.detailItemId;
  const detail = scope && detailId
    ? eligibleItems(review.items.filter((item) => item.scope === scope)).find((item) => item.id === detailId) ?? null
    : null;
  useEffect(() => {
    if (!detail && bodyRef.current) {
      bodyRef.current.scrollTop = scrollRef.current;
      if (focusRowRef.current) {
        bodyRef.current
          .querySelector<HTMLElement>(`[data-memory-item="${focusRowRef.current}"]`)
          ?.focus();
        focusRowRef.current = null;
      }
    }
  }, [detail]);
  if (!scope) return null;
  const items = eligibleItems(review.items.filter((item) => item.scope === scope));
  const selection = groupSelection(state, items);
  const needsSearch = items.length > 20;
  const query = state.search.trim().toLocaleLowerCase();
  const filtered = query
    ? items.filter((item) => item.display_text.toLocaleLowerCase().includes(query))
    : items;

  return (
    <Dialog.Root onOpenChange={(open) => { if (!open) dispatch(openSheet(state, null)); }} open>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.backdrop} />
        <Dialog.Content
          aria-describedby={undefined}
          className={`${styles.panel} ts-workspace-theme quiet-workspace`}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusTo?.focus();
          }}
        >
          <header className={styles.panelHeader}>
            {detail ? (
              <button
                className={styles.back}
                onClick={() => {
                  if (state.detailOrigin === "inline") {
                    // Closing the sheet returns focus to the inline trigger via
                    // onCloseAutoFocus.
                    dispatch(openSheet(state, null));
                  } else {
                    focusRowRef.current = detail?.id ?? null;
                    dispatch(openDetail(state, null));
                  }
                }}
                type="button"
              >
                返回
              </button>
            ) : null}
            <div>
              <Dialog.Title className={styles.panelTitle}>
                {groupLabel(scope, personLabel)}
              </Dialog.Title>
              <p className={styles.panelCount}>
                选中 {selection.selected}/{selection.total}
              </p>
            </div>
            <Dialog.Close asChild>
              <button aria-label="关闭" className={styles.close} type="button">
                <X size={16} />
              </button>
            </Dialog.Close>
          </header>
          <div className={styles.panelBody} ref={bodyRef}>
            {detail ? (
              <div className={styles.detail}>
                <p className={styles.detailSentence}>{detail.display_text}</p>
                <dl>
                  <dt>来源摘录</dt>
                  <dd>{detail.source_excerpt}</dd>
                  {detail.speaker ? (
                    <>
                      <dt>说话者</dt>
                      <dd>{detail.speaker}</dd>
                    </>
                  ) : null}
                  {detail.reporter ? (
                    <>
                      <dt>转述者</dt>
                      <dd>{detail.reporter}</dd>
                    </>
                  ) : null}
                  <dt>时间</dt>
                  <dd>
                    {detail.time_status === "unknown"
                      ? "时间未知"
                      : detail.time_status === "future"
                        ? detail.valid_time
                          ? `未来计划 · ${detail.valid_time}`
                          : "未来计划 · 原话只给出相对时间，见来源摘录"
                        : detail.valid_time ?? "未标注"}
                  </dd>
                  {detail.previous_text ? (
                    <>
                      <dt>原句 → 新句</dt>
                      <dd>
                        <span>{detail.previous_text}</span>
                        <span aria-hidden="true"> → </span>
                        <strong>{detail.display_text}</strong>
                      </dd>
                    </>
                  ) : null}
                  <dt>为什么建议记住</dt>
                  <dd>{detail.reason}</dd>
                </dl>
                <label className={styles.editLabel}>
                  编辑保存的句子
                  <textarea
                    maxLength={1000}
                    onChange={(event) =>
                      dispatch(setEditedText(state, detail.id, event.target.value))
                    }
                    rows={3}
                    value={state.editedText[detail.id] ?? detail.display_text}
                  />
                </label>
                {state.editedText[detail.id] !== undefined &&
                state.editedText[detail.id] !== detail.original_display_text ? (
                  <p className={styles.editNote}>
                    编辑后的补充标记为“用户补充”，原摘录仍保留在依据中。
                  </p>
                ) : null}
              </div>
            ) : (
              <>
                {needsSearch ? (
                  <>
                    <input
                      aria-label="在此分组中搜索"
                      className={styles.search}
                      onChange={(event) => dispatch({ ...state, search: event.target.value })}
                      placeholder="搜索此分组…"
                      value={state.search}
                    />
                    {query ? (
                      <div className={styles.searchResultRow}>
                        <span role="status">
                          显示 {filtered.length}/{items.length} 条
                        </span>
                        <button
                          disabled={frozen || filtered.length === 0}
                          onClick={() =>
                            dispatch(
                              setItemsSelected(
                                state,
                                filtered,
                                !filtered.every((item) => state.selected[item.id]),
                              ),
                            )
                          }
                          type="button"
                        >
                          {filtered.every((item) => state.selected[item.id])
                            ? "取消此结果"
                            : "选择此结果"}
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : null}
                <ul className={styles.items}>
                  {filtered.map((item) => (
                    <ItemRow
                      checked={Boolean(state.selected[item.id])}
                      disabled={item.admission_status !== "eligible"}
                      frozen={frozen}
                      item={item}
                      key={item.id}
                      onOpenDetail={(trigger) => {
                        scrollRef.current = bodyRef.current?.scrollTop ?? 0;
                        onOpenItem(item, trigger);
                      }}
                      onToggle={() => dispatch(toggleItem(state, item))}
                    />
                  ))}
                </ul>
              </>
            )}
          </div>
          <footer className={styles.panelFooter}>
            <span>返回后统一保存</span>
            <button
              className={styles.primary}
              disabled={frozen}
              onClick={() => dispatch(openSheet(state, null))}
              type="button"
            >
              完成
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function identityHint(person: PersonDirectoryItem): string {
  const match = person.identity_matches[0];
  if (!match || match.kind === "name") return person.profile?.headline ?? "姓名匹配 · 身份线索待补充";
  const labels: Record<string, string> = {
    email: "邮箱",
    phone: "电话",
    wechat: "微信",
    linkedin_url: "LinkedIn",
    public_profile_url: "公开主页",
    source_native_id: "来源标识",
  };
  const label = labels[match.handle_type] ?? "联系方式";
  return match.kind === "confirmed_handle"
    ? `当前${label}：${match.display_hint}`
    : `历史${label}：${match.display_hint}`;
}

function ChangePersonPanel({
  onCancel,
  onChoose,
  pending,
  failure,
}: {
  onCancel: () => void;
  onChoose: (input: MemoryRebaseInput) => void;
  pending: boolean;
  failure: string | null;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonDirectoryItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newRelationship, setNewRelationship] = useState("");

  async function search() {
    const value = query.normalize("NFKC").trim();
    if (!value) return;
    setSearching(true);
    setSearchError(null);
    try {
      const response = await workspaceSessionFetch("/api/local-integration/people/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: value }),
      });
      if (!response.ok) {
        setSearchError("人物目录暂时不可用。");
        return;
      }
      const body = (await response.json()) as { people?: PersonDirectoryItem[] };
      setResults(body.people ?? []);
    } catch {
      setSearchError("网络暂时不可用。");
    } finally {
      setSearching(false);
    }
  }

  return (
    <section className={styles.changePerson} aria-label="换个人">
      <div className={styles.changeSearch}>
        <MagnifyingGlass aria-hidden="true" size={15} />
        <input
          aria-label="按姓名或已确认联系方式查找人物"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void search();
          }}
          placeholder="按姓名、邮箱或电话查找…"
          type="search"
          value={query}
        />
        <button disabled={searching || pending || !query.trim()} onClick={() => void search()} type="button">
          查找
        </button>
        <button className={styles.textButton} disabled={pending} onClick={onCancel} type="button">
          返回原联系人
        </button>
      </div>
      {searchError ? <p className={styles.warning} role="alert">{searchError}</p> : null}
      {results.length > 0 ? (
        <ul className={styles.changeList}>
          {results.map((person) => (
            <li key={person.id}>
              <div className={styles.changeCandidate}>
                <strong>{person.display_label}</strong>
                <small>{identityHint(person)}</small>
              </div>
              <div className={styles.changeContexts}>
                {person.contexts.length === 0 ? (
                  <button
                    disabled={pending}
                    onClick={() => onChoose({ contactDecision: "existing", personId: person.id, contextId: null })}
                    type="button"
                  >
                    仅关联此人
                  </button>
                ) : (
                  person.contexts.map((context) => (
                    <button
                      disabled={pending}
                      key={context.id}
                      onClick={() =>
                        onChoose({ contactDecision: "existing", personId: person.id, contextId: context.id })
                      }
                      type="button"
                    >
                      {context.display_label ?? "关系情境"}
                    </button>
                  ))
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.changeNew}>
        <p>新建联系人</p>
        <input
          aria-label="新联系人姓名"
          onChange={(event) => setNewName(event.target.value)}
          placeholder="姓名"
          value={newName}
        />
        <input
          aria-label="新联系人关系"
          onChange={(event) => setNewRelationship(event.target.value)}
          placeholder="关系（可留空）"
          value={newRelationship}
        />
        <button
          disabled={pending || !newName.trim()}
          onClick={() =>
            onChoose({
              contactDecision: "new",
              newContactLabel: newName.trim(),
              newContactRelationship: newRelationship.trim(),
            })
          }
          type="button"
        >
          使用新联系人
        </button>
      </div>
      {pending ? <p className={styles.message} role="status">正在根据原始来源重新生成待确认内容…</p> : null}
      {failure ? (
        <p className={styles.warning} role="alert">
          {failure}
          <button className={styles.textButton} onClick={onCancel} type="button">
            保留原联系人
          </button>
        </p>
      ) : null}
    </section>
  );
}

export function MemoryReviewCard(props: MemoryReviewCardProps) {
  return props.purpose === "chat"
    ? <SessionChatMemoryReviewCard {...props}/>
    : <LegacyMemoryReviewCard {...props}/>;
}

function SessionChatMemoryReviewCard(props: MemoryReviewCardProps) {
  const controller = useMemoryReview({
    binding: props.binding,
    proposal: props.proposal,
    purpose: "chat",
    entryCapability: props.entryCapability ?? null,
    sessionId: props.sessionId ?? null,
  });
  const openReview = controller.open;
  useEffect(() => { void openReview(); }, [openReview, props.binding, props.proposal.proposal_id, props.proposal.revision]);
  return <SessionMemoryCards controller={controller} onComment={props.onCommentItem}/>;
}

function LegacyMemoryReviewCard(props: MemoryReviewCardProps) {
  const controller = useMemoryReview({
    binding: props.binding,
    proposal: props.proposal,
    purpose: props.purpose,
    personId: props.personId ?? null,
    contextId: props.contextId ?? null,
    pursuitId: props.pursuit?.pursuitId ?? null,
    pursuitRoleId: props.pursuit?.roleId ?? null,
    pursuitEvidenceFragmentId: props.pursuit?.evidenceFragmentId ?? null,
    entryCapability: props.entryCapability ?? null,
    sessionId: props.sessionId ?? null,
  });
  const state = controller.draft;
  const review = controller.review;
  const dispatchState = controller.dispatchDraft;
  const setState = (next: MemoryReviewDraftState) => {
    if (dispatchState(next)) controller.scheduleDraft();
  };
  const openReview = controller.open;
  // The controller is bound to this exact login + proposal + purpose; the
  // effect only starts the authorized fetch.
  useEffect(() => {
    void openReview();
  }, [openReview, props.binding, props.proposal.proposal_id, props.proposal.revision, props.purpose]);

  const sourceUnavailable = review?.source_status === "unavailable";
  const [opener, setOpener] = useState<HTMLButtonElement | null>(null);
  const detailOpenerRef = useRef<HTMLButtonElement | null>(null);
  const [changing, setChanging] = useState(false);
  const openSheetFrom = (scope: MemoryScope) => {
    setOpener(document.activeElement instanceof HTMLButtonElement ? document.activeElement : null);
    setState(openSheet(state!, scope));
  };
  // Record the actual opener at each disclosure level so Escape/close returns
  // focus to the exact trigger, not a stale one.
  const openInlineDetail = (scope: MemoryScope, item: MemoryProposalItem, trigger: HTMLButtonElement) => {
    setOpener(trigger);
    setState(openDetail(openSheet(state!, scope), item.id, "inline"));
  };
  const openSheetDetail = (item: MemoryProposalItem, trigger: HTMLButtonElement) => {
    // Keep the outer sheet opener intact; the detail level focuses its own row
    // on Back, and closing the sheet returns to the original remaining trigger.
    detailOpenerRef.current = trigger;
    setState(openDetail(state!, item.id, "sheet"));
  };
  const groups = useMemo(
    () => (review && state ? groupItems(visibleItems(review.items, state.contactDecision)) : []),
    [review, state],
  );
  const judgments = useMemo(
    () => (review && state ? judgmentItems(visibleItems(review.items, state.contactDecision)) : []),
    [review, state],
  );

  // Terminal and reconciliation states render from the scoped receipt alone;
  // a closed proposal cannot be opened again, so these must not depend on a
  // freshly opened review or draft.
  if (controller.phase === "receipt" || controller.phase === "undone" || controller.phase === "dismissed" || controller.phase === "processed" || controller.phase === "undoing") {
    const receipt = controller.receipt;
    const applied = receipt?.applied_item_count ?? receipt?.item_count ?? 0;
    const contactOnly = Boolean(receipt?.created_person_id) && applied === 0;
    const updatedCount = receipt?.updated_item_ids.length ?? 0;
    const keptOldCount = receipt?.decisions.filter((entry) => entry.decision === "keep_old").length ?? 0;
    const summary = controller.phase === "processed" ? "这次内容已处理，无需重复保存。" : controller.phase === "dismissed"
      ? "本次不保存已记录"
      : controller.phase === "undone"
      ? "已撤销本次保存"
      : receipt?.created_person_id
        ? contactOnly
          ? `已添加${receipt.person_display_label ?? "联系人"}`
          : `已添加${receipt.person_display_label ?? "联系人"} · 记住 ${applied} 条`
        : applied > 0
          ? updatedCount === applied ? `已更新 ${applied} 条` : updatedCount > 0 ? `已记住 ${applied - updatedCount} 条 · 更新 ${updatedCount} 条` : `已记住 ${applied} 条`
          : keptOldCount > 0
            ? "已按你的判断保留旧值，没有新增记忆"
            : "本次未保存新内容";
    return (
      <section className={styles.card} role="status">
        <p className={styles.receipt}>{summary}</p>
        {(controller.phase !== "undone" || receipt?.undo_contact_outcome === "retained") && receipt?.created_person_id ? (
          <Link className={styles.textButton} href={`/workspace/people/${receipt.created_person_id}`}>
            查看人物
          </Link>
        ) : null}
        {controller.phase === "undone" && receipt?.undo_contact_outcome === "retained" ? (
          <p className={styles.message}>记忆已撤销；联系人已有后续记录，已为你保留。</p>
        ) : null}
        {controller.phase === "receipt" && controller.canUndo ? (
          <button className={styles.textButton} disabled={controller.frozen} onClick={() => void controller.undo()} type="button">
            撤销
          </button>
        ) : null}
        {controller.phase === "dismissed" ? (
          <p className={styles.message}>当前来源版本不会再出现这张卡。</p>
        ) : null}
        {controller.phase === "undoing" ? (
          <p className={styles.message} role="status">正在撤销…</p>
        ) : null}
        {controller.error ? (
          <p className={styles.warning} role="alert">
            {controller.error}
          </p>
        ) : null}
        {controller.phase !== "undone" && controller.phase !== "dismissed" && controller.notice ? (
          <p className={styles.message}>{controller.notice}</p>
        ) : null}
      </section>
    );
  }

  if (controller.phase === "unknown") {
    return (
      <section className={styles.card} aria-busy="true" role="status">
        <p className={styles.message}>
          {controller.reconciling ? "正在核对保存结果…" : controller.notice ?? "正在确认保存结果…"}
        </p>
        <button
          className={styles.primary}
          disabled={!controller.canReconcile}
          onClick={() => void controller.reconcile()}
          type="button"
        >
          核对结果
        </button>
      </section>
    );
  }

  if (controller.phase === "error" && !review) {
    return (
      <section className={styles.card} role="alert">
        <p className={styles.message}>{controller.error ?? "记忆审阅暂时不可用。"}</p>
        <button className={styles.primary} onClick={() => controller.open()} type="button">
          重试
        </button>
      </section>
    );
  }
  if (controller.phase === "opening" && !review) {
    return (
      <section className={styles.card} aria-busy="true">
        <p className={styles.message}>正在整理这次可以记住的内容…</p>
      </section>
    );
  }
  if (!review || !state) return null;

  const count = selectedCount(state, visibleItems(review.items, state.contactDecision));
  const effect = selectedEffectCounts(state, visibleItems(review.items, state.contactDecision));
  // A pending new contact is a real target and must show its header, skip and
  // change-person controls; only a truly self-only draft omits the header.
  const hasContact = Boolean(review.person_id)
    || review.contact_status === "resolved"
    || review.contact_status === "ambiguous"
    || state.contactDecision === "new"
    || Boolean(review.person_display_label);
  const isNewContact = state.contactDecision === "new" && review.contact_status === "pending";
  const personLabel = review.person_display_label ?? null;
  const rebasing = controller.rebaseState === "pending";
  const newContactEnabled = isNewContact;
  // The primary action names the real new/updated Memory count; a keep-only
  // decision is a confirmation, not a claim that something was remembered.
  const label = effect.applied > 0
    ? primaryLabel(state, review, effect.applied)
    : effect.keptOld > 0
      ? "确认保留旧值"
      : primaryLabel(state, review, 0);
  const totalVisible = visibleItems(review.items, state.contactDecision).length;
  // Zero real effect is a dismissal unless an explicit new-contact decision
  // still produces a real effect.
  const shouldDismiss = effect.applied === 0 && effect.keptOld === 0 && !newContactEnabled;

  return (
    <section className={styles.card} data-memory-review aria-label="记忆审阅">
      {hasContact ? (
        <header className={styles.contactHeader}>
          <span aria-hidden="true" className={styles.avatar}>
            {(review.person_display_label ?? "?").slice(0, 1)}
          </span>
          <div className={styles.contactIdentity}>
            <strong>{review.person_display_label ?? "未命名联系人"}</strong>
            <small>
              {state.contactDecision === "none"
                ? review.contact_decision === "new" || review.contact_status === "pending"
                  ? "暂不添加联系人 · 仅保留关于我的内容"
                  : "本次不关联此人 · 仅保留关于我的内容"
                : isNewContact
                  ? `${review.items.some(item => item.source_locator.kind === "image_region") ? "截图来源" : "本次对话"} · 待添加`
                  : review.relationship_display_label ?? "已关联联系人"}
            </small>
            {isNewContact && review.relationship_display_label ? <small>关系记录：{review.relationship_display_label}</small> : null}
          </div>
          {props.purpose !== "chat" ? null : state.contactDecision !== "none" ? (
            <div className={styles.contactActions}>
              <button className={styles.textButton} disabled={controller.frozen} onClick={() => setState(skipContact(state))} type="button">
                {review.contact_status === "pending" ? "暂不添加联系人" : "本次不关联此人"}
              </button>
              <button className={styles.textButton} disabled={controller.frozen || rebasing} onClick={() => setChanging(true)} type="button">
                {state.contactDecision === "new" ? "关联已有联系人" : "更换联系人"}
              </button>
            </div>
          ) : (
            <button className={styles.textButton} disabled={controller.frozen} onClick={() => setState(restoreContact(state, review.contact_decision))} type="button">
              {review.contact_status === "pending" ? "恢复添加" : "恢复关联"}
            </button>
          )}
        </header>
      ) : null}

      {changing ? (
        <ChangePersonPanel
          failure={controller.rebaseError}
          onCancel={() => setChanging(false)}
          onChoose={(input) => {
            void controller.rebase(input).then((ok) => {
              if (ok) setChanging(false);
            });
          }}
          pending={controller.rebaseState === "pending"}
        />
      ) : null}

      {sourceUnavailable ? (
        <p className={styles.warning} role="alert">
          来源已失效，这些内容不能保存。
        </p>
      ) : null}

      {groups.map((group) => (
        <GroupSection
          dispatch={(next) => setState(next)}
          frozen={controller.frozen}
          items={eligibleItems(group.items)}
          key={group.scope}
          onOpenItem={(item, trigger) => openInlineDetail(group.scope, item, trigger)}
          onOpenSheet={openSheetFrom}
          personLabel={personLabel}
          scope={group.scope}
          state={state}
        />
      ))}

      {judgments.length > 0 ? (
        <section className={styles.judgment} aria-label="需要你判断">
          <h3>需要你判断</h3>
          {judgments.map((item) => {
            // Only the actually legal decisions for this change kind are offered.
            const legal: MemoryDecision[] = item.operation === "add"
              ? ["accept", "skip"]
              : ["keep_old", "accept_new", "retain_conflict", "skip"];
            return (
              <article className={styles.judgmentRow} key={item.id}>
                {item.previous_text ? (
                  <p className={styles.judgmentChange}>
                    <span>{item.previous_text}</span>
                    <span aria-hidden="true"> → </span>
                    <strong>{item.display_text}</strong>
                  </p>
                ) : (
                  <p>{item.display_text}</p>
                )}
                <small>{judgmentExplanation(item)}</small>
                <div className={styles.judgmentActions}>
                  {legal.map((decision) => (
                    <button
                      className={state.decisions[item.id] === decision ? styles.decisionActive : styles.decision}
                      disabled={controller.frozen}
                      key={decision}
                      onClick={() => setState(setDecision(state, item.id, decision))}
                      type="button"
                    >
                      {judgmentLabel(decision)}
                    </button>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
      ) : null}

      <footer className={styles.footer}>
        {totalVisible > 0 ? <p>
          已选 {count} 条{effect.keptOld > 0 ? ` · 其中判断 ${effect.keptOld} 条` : ""}{totalVisible > 0 ? ` · 包含折叠内容` : ""}
        </p> : null}
        {shouldDismiss ? (
          <button
            className={styles.primary}
            disabled={controller.frozen || rebasing || sourceUnavailable}
            onClick={() => void controller.dismiss([], "本次不保存")}
            type="button"
          >
            本次不保存
          </button>
        ) : (
          <button
            className={styles.primary}
            disabled={controller.frozen || rebasing || sourceUnavailable}
            onClick={() => {
              const body = buildCommitDraft(state, review);
              void controller.commit({
                contactDecision: body.contact_decision,
                selectedItemIds: body.selected_item_ids,
                editedText: body.edited_text,
                itemDecisions: body.item_decisions,
                expectedItemVersions: body.expected_item_versions,
              });
            }}
            type="button"
          >
            {controller.frozen ? "正在保存…" : label}
          </button>
        )}
        <p className={styles.secondaryLine}>
          {totalVisible === 0 && newContactEnabled ? "先保存姓名，其他信息可以以后补充" : "保存所选内容及必要依据"}
          {!shouldDismiss ? (
            <button
              className={styles.textButton}
              disabled={controller.frozen}
              onClick={() => void controller.dismiss(visibleItems(review.items, state.contactDecision).map((item) => item.id), "本次不保存")}
              type="button"
            >
              本次不保存
            </button>
          ) : null}
        </p>
        {controller.draftStatus === "saving" ? (
          <p className={styles.message} role="status">正在保存草稿…</p>
        ) : controller.draftStatus === "saved" ? (
          <p className={styles.message} role="status">草稿已保存，刷新后仍保留选择</p>
        ) : controller.draftStatus === "error" ? (
          <p className={styles.warning} role="alert">
            草稿尚未同步，本页选择已保留。
            <button className={styles.textButton} disabled={controller.frozen} onClick={() => controller.scheduleDraft()} type="button">
              重试同步
            </button>
          </p>
        ) : null}
        {controller.error ? (
          <p className={styles.warning} role="alert">
            {controller.error}
          </p>
        ) : null}
        {controller.notice ? (
          <p className={styles.message} role="status">
            {controller.notice}
          </p>
        ) : null}
      </footer>

      {state.sheetGroup ? (
        <Panel
          dispatch={(next) => setState(next)}
          frozen={controller.frozen}
          onOpenItem={openSheetDetail}
          personLabel={personLabel}
          returnFocusTo={opener}
          review={review}
          state={state}
        />
      ) : null}
    </section>
  );
}
