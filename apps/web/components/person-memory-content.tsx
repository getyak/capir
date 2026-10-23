"use client";

import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { PencilSimple, ArrowSquareOut, CaretDown, Trash } from "@phosphor-icons/react";
import type { MemoryRecallItem, PersonDirectoryItem } from "@talent-signal/contracts";
import { Button } from "./ui/button";
import { useT } from "./locale-provider";
import { ResearchNotebook, researchNoteMetadata } from "./research-notebook";
import { usePersonMemory, type MemoryEdit } from "./person-memory-controller";
import { MEMORY_SCOPE_LABELS, canEditMemory, memoryAttribution, memoryDate, memoryGroups, memorySourceLabel, memorySources } from "@/lib/person-memory-projection";
import { validReturnSessionId, withReturnSession } from "./session-return-navigation";
import styles from "@/app/workspace/people/[id]/person-memory.module.css";

type Mode = "memory" | "reading" | "raw";
type FocusRequest = { binding: string; personId: string } & (
  { kind: "edit"; id: string; action?: "delete"; owner: Element | null } |
  { kind: "page"; previous: Set<string | undefined>; button: HTMLButtonElement | null | undefined }
);

function SourceExcerpts({ item }: { item: MemoryRecallItem }) {
  const refs = memorySources(item);
  if (!refs.length) return <p className={styles.quiet}>来源摘录未保留或已不可用。</p>;
  return <ol className={styles.sourcesList}>{refs.map((ref, index) => {
    const sessionId = validReturnSessionId(ref.source_session_id ?? (ref.locator.kind !== "document" ? ref.locator.session_id : null));
    return <li key={index}>
      <div className={styles.sourceHeading}><span>{memorySourceLabel(ref)}</span>
        {sessionId ? <Link href={`/workspace/sessions/${sessionId}`}>打开来源对话 <ArrowSquareOut size={13} aria-hidden="true" /></Link> : null}
      </div>
      <blockquote>{ref.excerpt}</blockquote>
      <dl className={styles.sourceMetadata}>
        {item.speaker ? <><dt>说话者</dt><dd>{item.speaker}</dd></> : null}
        {item.reporter ? <><dt>转述者</dt><dd>{item.reporter}</dd></> : null}
        <dt>来源时间</dt><dd>{memoryDate(item.observed_time)}</dd>
        {item.conflict_group_id ? <><dt>冲突组</dt><dd>{item.conflict_group_id} · 待核对</dd></> : null}
        {ref.capture_id ? <><dt>采集标识</dt><dd>{ref.capture_id}</dd></> : null}
        {ref.source_resource_id ? <><dt>来源标识</dt><dd>{ref.source_resource_id}</dd></> : null}
        {ref.locator.kind === "message" && ref.locator.message_id ? <><dt>消息标识</dt><dd>{ref.locator.message_id}</dd></> : null}
        {ref.locator.kind === "image_region" ? <><dt>图像标识</dt><dd>{ref.locator.artifact_id}{ref.locator.region ? ` · 区域 ${ref.locator.region.x}, ${ref.locator.region.y}, ${ref.locator.region.width}, ${ref.locator.region.height}` : ""}</dd></> : null}
      </dl>
    </li>;
  })}</ol>;
}

function MemoryTime({ item }: { item: MemoryRecallItem }) {
  if (item.time_status === "future") return <span>来源中的计划{item.valid_time ? ` · ${memoryDate(item.valid_time)}` : " · 相对时间见来源"}（结果待核对）</span>;
  if (item.time_status === "past") return <span>历史记录{item.valid_time ? ` · ${memoryDate(item.valid_time)}` : ""}</span>;
  if (item.time_status === "unknown") return <span>时间未知</span>;
  return <span>{memoryDate(item.valid_time ?? item.observed_time)}</span>;
}

function MemoryEditor({ edit, onChange, onSave, onCancel, onRefresh }: {
  edit: MemoryEdit; onChange: (value: string) => void; onSave: () => Promise<void>; onCancel: () => void; onRefresh: () => Promise<void>;
}) {
  const t = useT();
  const composing = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  useLayoutEffect(() => {
    // Source retraction may move the retained draft outside its removed row.
    // Reclaim only unclaimed focus; a user who moved elsewhere keeps it.
    if (edit.phase === "conflict" && document.activeElement === document.body) {
      form.current?.querySelector<HTMLElement>("textarea, button")?.focus();
    }
  }, [edit.phase, edit.itemId]);
  const frozen = edit.phase === "saving" || edit.phase === "unknown";
  function save() { if (!composing.current) void onSave(); }
  if (edit.action === "delete") return <form ref={form} className={styles.editor} aria-label={t("删除记忆确认")}
    onSubmit={event => { event.preventDefault(); save(); }}
    onKeyDown={event => { if (event.key === "Escape" && !frozen) { event.preventDefault(); onCancel(); } }}>
    <p className={styles.editLabel}>{t("删除这条记忆？")}</p>
    <p className={styles.memoryText}>{edit.draft}</p>
    <p className={styles.quiet}>{t("删除后不再作为已确认记忆使用。原始对话会保留。")}</p>
    {edit.error ? <p className={styles.error} role="alert">{edit.error}</p> : null}
    <div className={styles.editActions}>
      <Button variant="ghost" autoFocus={edit.phase === "editing"} disabled={frozen} onClick={onCancel}>取消</Button>
      {edit.phase === "unknown" ? <Button variant="outline" onClick={save}>{t("核对并重试删除")}</Button>
        : edit.phase === "conflict" ? <Button variant="outline" onClick={() => void onRefresh()}>核对最新记忆</Button>
          : <Button variant="outline" type="submit" disabled={frozen}>{frozen ? t("正在删除并核对…") : t("确认删除记忆")}</Button>}
    </div>
  </form>;
  return <form ref={form} className={styles.editor} onSubmit={event => { event.preventDefault(); save(); }}>
    <label className={styles.editLabel} htmlFor={`memory-draft-${edit.itemId}`}>修改这条记忆</label>
    <textarea id={`memory-draft-${edit.itemId}`} autoFocus={edit.phase === "editing"} rows={3} maxLength={1000} value={edit.draft} disabled={frozen}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onChange={event => onChange(event.target.value)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
        if (event.key === "Escape" && !frozen) { event.preventDefault(); onCancel(); }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); }
      }} />
    <div className={styles.editHint}><span>修改保留原句与来源</span><span>{edit.draft.length}/1000</span></div>
    {edit.error ? <p className={styles.error} role="alert">{edit.error}</p> : null}
    <div className={styles.editActions}>
      {edit.phase === "unknown" ? <Button className={styles.saveButton} variant="outline" onClick={save}>核对并重试</Button>
        : edit.phase === "conflict" ? <Button className={styles.saveButton} variant="outline" onClick={() => void onRefresh()}>核对最新记忆</Button>
          : <Button className={styles.saveButton} type="submit" disabled={frozen || !edit.draft.trim() || edit.draft.trim().length > 1000}>{frozen ? "正在保存并核对…" : "保存修改"}</Button>}
      <Button variant="ghost" disabled={frozen} onClick={onCancel}>取消</Button>
    </div>
  </form>;
}

export function PersonMemoryContent({ personId, binding, entryCapability, initialItems, hasMore = false, nextCursor = null, contexts = [], returnSessionId = null }: {
  personId: string; binding: string; entryCapability: string; initialItems: MemoryRecallItem[];
  hasMore?: boolean; nextCursor?: string | null; contexts?: PersonDirectoryItem["contexts"]; returnSessionId?: string | null;
}) {
  const t = useT();
  const controller = usePersonMemory({ personId, binding, entryCapability, items: initialItems, hasMore, nextCursor });
  const [mode, setMode] = useState<Mode>("memory");
  const root = useRef<HTMLDivElement>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const handledFocus = useRef<FocusRequest | null>(null);
  const ordinary = controller.items.filter(item => !researchNoteMetadata(item));
  const research = controller.items.filter(item => item.evidence_retained && researchNoteMetadata(item));
  const groups = memoryGroups(ordinary);
  const raw = ordinary.filter(item => memorySources(item).length > 0);
  const edit = controller.edit;

  useLayoutEffect(() => {
    if (!focusRequest || handledFocus.current === focusRequest) return;
    if (focusRequest.kind === "edit" ? controller.edit !== null : controller.loadingMore) return;
    handledFocus.current = focusRequest;
    if (focusRequest.binding !== binding || focusRequest.personId !== personId) return;
    const modeButton = root.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    if (focusRequest.kind === "edit") {
      const active = document.activeElement;
      if (active !== focusRequest.owner && active !== document.body && active?.isConnected) return;
      const selector = focusRequest.action === "delete" ? "[data-memory-delete]" : "[data-memory-edit]";
      const button = Array.from(root.current?.querySelectorAll<HTMLButtonElement>(selector) ?? [])
        .find(element => (focusRequest.action === "delete" ? element.dataset.memoryDelete : element.dataset.memoryEdit) === focusRequest.id);
      (button ?? modeButton)?.focus();
      return;
    }
    const active = document.activeElement;
    if (active !== focusRequest.button && active !== document.body && active?.isConnected) return;
    const firstNew = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-memory-item]") ?? [])
      .find(element => !focusRequest.previous.has(element.dataset.memoryItem));
    (firstNew ?? root.current?.querySelector<HTMLElement>("[data-memory-load-more]") ?? modeButton)?.focus();
  }, [focusRequest, controller.edit, controller.loadingMore, controller.items, controller.hasMore, binding, personId]);

  function restoreFocus(id: string, action?: "delete", owner = document.activeElement) {
    // Wait for React's DOM commit, which may happen after the next frame.
    setFocusRequest({ kind: "edit", id, action, owner, binding, personId });
  }
  async function save() {
    const owner = document.activeElement;
    const id = await controller.save();
    if (id) restoreFocus(id, edit?.action, owner);
  }
  async function loadMore() {
    const loadingButton = root.current?.querySelector<HTMLButtonElement>("[data-memory-load-more]");
    const previous = new Set(Array.from(root.current?.querySelectorAll<HTMLElement>("[data-memory-item]") ?? [])
      .map(element => element.dataset.memoryItem));
    if (!await controller.loadMore()) return;
    setFocusRequest({ kind: "page", previous, button: loadingButton, binding, personId });
  }
  function contextLink(item: MemoryRecallItem) {
    const context = contexts.find(entry => entry.id === item.relationship_context_id);
    return context ? <Link className={styles.memoryContext} href={withReturnSession(`/workspace?person=${encodeURIComponent(personId)}&context=${encodeURIComponent(context.id)}`, returnSessionId)}>{context.display_label ?? "关系情境"}</Link> : null;
  }

  const editor = edit ? <MemoryEditor edit={edit} onChange={controller.change} onSave={save}
    onCancel={() => { controller.cancel(); restoreFocus(edit.itemId, edit.action); }} onRefresh={controller.refreshConflict} /> : null;

  return <div ref={root}>
    <section className={styles.section} aria-labelledby="person-memory-accepted">
      <div className={styles.sectionHeading}><h2 className={styles.sectionTitle} id="person-memory-accepted">已确认记忆</h2>
        <span className={styles.sectionCount}>{controller.loadError && !ordinary.length ? "暂不可读取" : <>{ordinary.length}{controller.hasMore ? "+" : ""} 条</>}</span></div>
      <nav className={styles.layers} aria-label="记忆阅读方式">
        {([ ["memory", "逐条记忆"], ["reading", "阅读概览"], ["raw", "原始摘录"] ] as const).map(([value, label]) =>
          <button key={value} className={styles.layer} aria-pressed={mode === value} disabled={Boolean(edit)} type="button" onClick={() => setMode(value)}>{label}</button>)}
      </nav>
      {controller.loadError ? <p className={styles.error} role="alert">{controller.loadError}</p> : null}
      {controller.notice ? <p className={styles.saveNotice} role="status">{controller.notice}</p> : null}
      {edit && !ordinary.some(item => item.id === edit.itemId) ? editor : null}
      {mode === "memory" ? <>
        {!ordinary.length ? !controller.loadError && <div className={styles.emptyMemory}>
          <h3>{controller.hasMore ? "这一页还没有已确认的记忆" : "还没有已确认的记忆"}</h3>
          <p>{controller.hasMore ? "还有已保存内容，可继续加载查看。" : "可以在相关对话里补充背景。有可保存的内容时，先由你核对，再留下记忆。"}</p>
        </div> : groups.map(group =>
          <article className={styles.scopeGroup} key={group.scope}>
            <h3 className={styles.scopeTitle}>{MEMORY_SCOPE_LABELS[group.scope]}</h3>
            <ul className={styles.memoryList}>{group.items.map(item => <li className={styles.memoryItem} data-memory-item={item.id} tabIndex={-1} data-conflict-group={item.conflict_group_id ?? undefined} key={item.id}>
              {edit?.itemId === item.id ? editor : <>
                <div className={styles.memoryLine}><p className={styles.memoryText}>{item.display_text}</p>
                  {canEditMemory(item) ? <><button className={styles.editButton} data-memory-edit={item.id} disabled={Boolean(edit) || controller.loadingMore}
                    aria-label={`修改记忆：${item.display_text}`} type="button" onClick={() => controller.begin(item)}>
                    <PencilSimple size={15} aria-hidden="true" /><span>修改</span>
                  </button><button className={styles.editButton} data-memory-delete={item.id} disabled={Boolean(edit) || controller.loadingMore}
                    aria-label={t("删除记忆：{text}", { text: item.display_text })} type="button" onClick={() => controller.beginDelete(item)}>
                    <Trash size={15} aria-hidden="true" /><span>删除</span>
                  </button></> : null}</div>
                <div className={styles.memoryKind}><span>{memoryAttribution(item)}</span><MemoryTime item={item} />{contextLink(item)}</div>
              </>}
              <details className={styles.evidence}><summary>查看依据 <CaretDown size={12} aria-hidden="true" /></summary>
                {item.original_display_text && item.display_text !== item.original_display_text ? <div className={styles.original}><span>修改前保存的原句</span><p>{item.original_display_text}</p></div> : null}
                <SourceExcerpts item={item} />
              </details>
            </li>)}</ul>
          </article>)}
      </> : mode === "reading" ? <div className={styles.reading}>
        <p className={styles.layerHelp}>按已确认记忆整理的阅读视图，不新增事实。修改请回到逐条记忆。</p>
        {!groups.length ? !controller.loadError && <p className={styles.quiet}>{controller.hasMore ? "当前已加载内容中还没有阅读概览，可继续加载查看。" : "确认记忆后，这里会形成阅读概览。"}</p> : groups.map(group => <article key={group.scope}>
          <h3 className={styles.scopeTitle}>{MEMORY_SCOPE_LABELS[group.scope]}</h3>
          {group.items.map(item => <div className={styles.readingParagraph} data-memory-item={item.id} tabIndex={-1} data-conflict-group={item.conflict_group_id ?? undefined} key={item.id}><p>{item.display_text}</p><small>{memoryAttribution(item)} · <MemoryTime item={item} /></small></div>)}
        </article>)}
      </div> : <div className={styles.raw}>
        <p className={styles.layerHelp}>仅显示仍在保留的来源摘录。原话和来源时间保留，不代替已确认记忆。</p>
        {!raw.length ? !controller.loadError && <p className={styles.quiet}>{controller.hasMore ? "当前已加载内容中没有可读取的摘录，可继续加载查看。" : "暂无可读取的原始摘录。未保留、已删除或不可用的来源不会显示。"}</p> : raw.map(item => <article className={styles.rawItem} data-memory-item={item.id} tabIndex={-1} data-conflict-group={item.conflict_group_id ?? undefined} key={item.id}><h3>{item.display_text}</h3>{item.conflict_group_id ? <p className={styles.conflictNote}>存在冲突 · 待核对</p> : null}<SourceExcerpts item={item} /></article>)}
      </div>}
      {controller.hasMore ? <div className={styles.pagination}><Button data-memory-load-more variant="ghost" disabled={controller.loadingMore || Boolean(edit)} onClick={() => void loadMore()}>{controller.loadingMore ? "正在加载…" : "继续加载记忆"}</Button><span>还有已保存内容</span></div> : null}
    </section>
    {research.length ? <details className={styles.researchDisclosure}><summary>研究笔记 <span>AI 整理 · 待复核</span><CaretDown size={14} aria-hidden="true" /></summary><ResearchNotebook items={research} /></details> : null}
  </div>;
}
