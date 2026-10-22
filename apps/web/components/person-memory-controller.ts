"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MemoryItemMutationResponse, MemoryRecallItem, MemoryRecallResponse } from "@talent-signal/contracts";
import { WORKSPACE_SESSION_EXPIRED_EVENT, workspaceSessionFetch } from "./workspace-session-request";
import { canEditMemory } from "@/lib/person-memory-projection";
import { invalidateWorkspaceDirectory } from "@/lib/workspace-directory-cache";
import { subscribePersonMemoryInvalidation } from "@/lib/person-memory-invalidation";

export type MemoryEditPhase = "editing" | "saving" | "unknown" | "conflict";
type Attempt = { id: string; version: number; key: string; text: string; replacement: MemoryRecallItem | null; original: MemoryRecallItem; action: "correct" | "delete"; acknowledged: boolean };
export type MemoryEdit = { itemId: string; draft: string; phase: MemoryEditPhase; error: string | null; action?: "delete" };
type Options = { personId: string; binding: string; entryCapability: string; items: MemoryRecallItem[]; hasMore: boolean; nextCursor: string | null };

class MemoryReadError extends Error {
  constructor(public status: number, public code: string | null = null) { super("Memory read unavailable"); }
}

async function memoryErrorCode(response: Response): Promise<string | null> {
  try {
    const payload = await response.clone().json() as { code?: unknown; error?: { code?: unknown } };
    const code = payload?.code ?? payload?.error?.code;
    return typeof code === "string" ? code : null;
  } catch { return null; }
}

export function usePersonMemory(options: Options) {
  const [items, setItems] = useState(options.items);
  const [edit, setEdit] = useState<MemoryEdit | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(options.hasMore);
  const [nextCursor, setNextCursor] = useState(options.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const refresh = useRef({ revision: 0, pending: false, allowEditing: false });
  const attempt = useRef<Attempt | null>(null);
  const busy = useRef(false);
  const pageBusy = useRef(false);
  const generation = useRef(0);
  const expired = useRef(false);
  const confirmed = useRef(new Map<string, MemoryRecallItem>());
  const deleted = useRef(new Set<string>());
  const signature = useMemo(() => JSON.stringify({ items: options.items, hasMore: options.hasMore, nextCursor: options.nextCursor }),
    [options.items, options.hasMore, options.nextCursor]);
  const sourceSignature = useRef(signature);
  const capability = useRef(options.entryCapability);
  const current = useRef({ items, edit });
  useLayoutEffect(() => { current.current = { items, edit }; }, [items, edit]);
  useEffect(() => { capability.current = options.entryCapability; }, [options.entryCapability]);
  useEffect(() => () => { generation.current += 1; }, []);
  useLayoutEffect(() => {
    generation.current += 1;
    busy.current = false; pageBusy.current = false; attempt.current = null; expired.current = false;
    capability.current = options.entryCapability;
    confirmed.current.clear(); deleted.current.clear(); sourceSignature.current = signature;
    refresh.current = { revision: 0, pending: false, allowEditing: false };
    // The external authenticated entry changed; retaining local state would expose another scope.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEdit(null); setNotice(null); setLoadError(null); setLoadingMore(false);
    // Binding changes must discard the prior account's private material.
    setItems(options.items); setHasMore(options.hasMore); setNextCursor(options.nextCursor);
    // The entry identity owns the lifecycle; a refreshed capability preserves drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.binding, options.personId]);
  useEffect(() => {
    if (expired.current) return;
    if (sourceSignature.current === signature) return;
    sourceSignature.current = signature;
    // Once a live invalidation has happened, a server component snapshot may
    // predate that operation. Re-read authority instead of restoring its rows.
    if (refresh.current.revision > 0) {
      refresh.current.revision += 1; refresh.current.pending = true; refresh.current.allowEditing = true;
      setRefreshTick(value => value + 1);
      return;
    }
    // A fresh server snapshot retracts obsolete sources even while a draft is
    // open. A known pre-save snapshot cannot rewind a read-back correction.
    const incoming = options.items.filter(item => !deleted.current.has(item.id));
    for (const [oldId, replacement] of confirmed.current) {
      const oldIndex = incoming.findIndex(item => item.id === oldId);
      if (oldIndex >= 0) {
        incoming.splice(oldIndex, 1);
        if (!incoming.some(item => item.id === replacement.id || item.supersedes_id === replacement.id)) incoming.splice(oldIndex, 0, replacement);
      }
    }
    // Synchronize an authoritative refreshed server snapshot, including source retractions.
    // A stale ancestor may be replaced by an intermediate correction that was
    // itself deleted later. Filter after merging the full correction ledger.
    setItems(incoming.filter(item => !deleted.current.has(item.id))); setHasMore(options.hasMore); setNextCursor(options.nextCursor); setLoadError(null);
    const active = current.current.edit;
    if (active && !attempt.current) {
      const prior = current.current.items.find(item => item.id === active.itemId);
      const refreshed = incoming.find(item => item.id === active.itemId);
      if (!refreshed || !prior || JSON.stringify(refreshed) !== JSON.stringify(prior)) {
        setEdit({ ...active, phase: "conflict", error: "来源或记忆已有变化。草稿已保留，请核对最新内容后再修改。" });
      }
    }
    // The serialized source is the dependency; option object identities and a
    // capability refresh alone never discard a draft or repeat a data reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  const expire = useCallback(() => {
    if (expired.current) return;
    expired.current = true;
    generation.current += 1; attempt.current = null; busy.current = false; pageBusy.current = false;
    confirmed.current.clear(); deleted.current.clear(); capability.current = "";
    refresh.current.pending = false; refresh.current.revision += 1;
    setItems([]); setEdit(null); setHasMore(false); setNextCursor(null); setLoadingMore(false); setNotice(null);
    setLoadError("登录已变化，请重新登录后查看记忆。");
    invalidateWorkspaceDirectory(undefined, "discard");
  }, []);
  useEffect(() => {
    window.addEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expire);
    return () => window.removeEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expire);
  }, [expire]);

  const request = useCallback(async (path: string, init: RequestInit = {}) => {
    if (expired.current) throw new MemoryReadError(409, "session_stale");
    const requestEpoch = generation.current;
    const response = await workspaceSessionFetch(path, {
      ...init, cache: "no-store", headers: { "x-workspace-session": options.binding,
        "x-memory-entry-capability": capability.current,
        ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
    if (response.status === 409) {
      const code = await memoryErrorCode(response);
      if (requestEpoch === generation.current && code === "session_stale") {
        expire();
        // Server-rendered profile fields and chrome belong to the same private
        // boundary as the client Memory; clear the whole mounted surface.
        window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT));
      }
    }
    return response;
  }, [options.binding, expire]);

  const readPage = useCallback(async (cursor: string | null, epoch: number): Promise<MemoryRecallResponse> => {
    if (epoch !== generation.current) throw new Error("Memory scope changed");
    const query = new URLSearchParams({ surface: "people", person_id: options.personId, limit: "50" });
    if (cursor) query.set("cursor", cursor);
    const response = await request(`/api/memory/items?${query}`);
    if (epoch !== generation.current) throw new Error("Memory scope changed");
    if (!response.ok) throw new MemoryReadError(response.status, await memoryErrorCode(response));
    const data = await response.json() as MemoryRecallResponse;
    if (epoch !== generation.current) throw new Error("Memory scope changed");
    if (!Array.isArray(data.items) || (data.person_id && data.person_id !== options.personId)
      || (data.has_more && (typeof data.next_cursor !== "string" || !data.next_cursor))) throw new Error("Invalid memory page");
    return data;
  }, [options.personId, request]);

  const readSnapshot = useCallback(async (epoch: number): Promise<MemoryRecallItem[]> => {
    let cursor: string | null = null;
    const refreshed: MemoryRecallItem[] = [];
    const seen = new Set<string>();
    do {
      const page = await readPage(cursor, epoch); refreshed.push(...page.items);
      cursor = page.has_more ? page.next_cursor ?? null : null;
      if (cursor && seen.has(cursor)) throw new Error("Repeated cursor");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return refreshed;
  }, [readPage]);

  // Layout registration precedes the sibling review card's receipt effect.
  // Events are scoped hints, never authority to add or remove a Memory row.
  useLayoutEffect(() => subscribePersonMemoryInvalidation((binding, personId) => {
    if (expired.current || binding !== options.binding || personId !== options.personId) return;
    refresh.current.revision += 1; refresh.current.pending = true;
    setRefreshTick(value => value + 1);
  }), [options.binding, options.personId]);

  useEffect(() => {
    const activeEdit = current.current.edit;
    if (!refresh.current.pending || expired.current || busy.current || pageBusy.current
      || activeEdit && (!refresh.current.allowEditing || attempt.current || !["editing", "conflict"].includes(activeEdit.phase))) return;
    const epoch = generation.current;
    const revision = refresh.current.revision;
    refresh.current.pending = false;
    pageBusy.current = true;
    setLoadingMore(true);
    void (async () => {
      try {
        const snapshot = await readSnapshot(epoch);
        if (epoch !== generation.current || revision !== refresh.current.revision) return;
        refresh.current.allowEditing = false;
        setItems(snapshot.filter(item => !deleted.current.has(item.id)));
        setHasMore(false); setNextCursor(null); setLoadError(null);
        const active = current.current.edit;
        if (active && !attempt.current) {
          const previous = current.current.items.find(item => item.id === active.itemId);
          const latest = snapshot.find(item => item.id === active.itemId);
          if (!previous || !latest || JSON.stringify(previous) !== JSON.stringify(latest)) {
            setEdit({ ...active, phase: "conflict", error: "来源或记忆已有变化。草稿已保留，请核对最新内容后再修改。" });
          }
        }
      } catch (caught) {
        if (epoch !== generation.current || revision !== refresh.current.revision) return;
        refresh.current.allowEditing = false;
        if (caught instanceof MemoryReadError && [401, 403, 404, 410].includes(caught.status)) {
          setItems([]); setEdit(null); setHasMore(false); setNextCursor(null); setNotice(null);
        }
        setLoadError("最新记忆暂时无法读取，请重新打开人物页面核对。");
      } finally {
        if (epoch === generation.current) {
          pageBusy.current = false; setLoadingMore(false);
          if (refresh.current.pending) setRefreshTick(value => value + 1);
        }
      }
    })();
  }, [refreshTick, edit, loadingMore, readSnapshot]);

  const begin = useCallback((item: MemoryRecallItem) => {
    if (expired.current || busy.current || pageBusy.current || attempt.current || current.current.edit || !canEditMemory(item)) return;
    setNotice(null); setEdit({ itemId: item.id, draft: item.display_text, phase: "editing", error: null });
  }, []);
  const beginDelete = useCallback((item: MemoryRecallItem) => {
    if (expired.current || busy.current || pageBusy.current || attempt.current || current.current.edit || !canEditMemory(item)) return;
    setNotice(null); setEdit({ itemId: item.id, draft: item.display_text, phase: "editing", error: null, action: "delete" });
  }, []);
  const change = useCallback((draft: string) => {
    if (expired.current || busy.current || attempt.current) return;
    setEdit(value => value && value.action !== "delete" ? { ...value, draft, error: null } : value);
  }, []);
  const cancel = useCallback(() => {
    if (busy.current || attempt.current) return;
    setEdit(null);
  }, []);

  const save = useCallback(async () => {
    if (expired.current || busy.current || pageBusy.current) return null;
    const active = current.current.edit;
    const original = attempt.current?.original ?? (active && current.current.items.find(item => item.id === active.itemId));
    if (!active || !original || active.phase === "conflict" || (!attempt.current && !canEditMemory(original))) return null;
    // A second activation can arrive after readback but before React commits.
    if (!attempt.current && (deleted.current.has(original.id) || confirmed.current.has(original.id))) return null;
    if (!attempt.current) {
      const text = active.draft.trim();
      if (!text || text.length > 1000) { setEdit({ ...active, error: "请填写 1–1000 字的记忆。" }); return null; }
      if (active.action !== "delete" && text === original.display_text) { setEdit(null); return original.id; }
      attempt.current = { id: original.id, version: original.version, key: crypto.randomUUID(), text, replacement: null, original,
        action: active.action === "delete" ? "delete" : "correct", acknowledged: false };
    }
    const operation = attempt.current;
    const epoch = generation.current;
    busy.current = true; setNotice(null); setEdit({ ...active, phase: "saving", error: null });
    try {
      // Unknown-result retries use the identical item, version, text and key.
      if (!operation.acknowledged) {
        const response = await request(`/api/memory/items/${operation.id}/mutations`, { method: "POST", body: JSON.stringify({
          operation: operation.action, expected_version: operation.version, idempotency_key: operation.key,
          ...(operation.action === "correct" ? { display_text: operation.text } : {}),
          reason: operation.action === "delete" ? "用户在人物页面确认删除已确认记忆。" : "用户在人物页面修改已确认记忆。",
        }) });
        if (epoch !== generation.current) return null;
        if (!response.ok) {
          if (response.status === 401) {
            attempt.current = null; setItems([]); setEdit(null); setHasMore(false);
            setLoadError("登录已失效，无法核对修改结果。请重新登录。"); return null;
          }
          if ([403, 404, 410].includes(response.status)) {
            // A write denial does not revoke read authority. Validate the
            // signed read scope before retracting any saved item or excerpt.
            attempt.current = null;
            try {
              const snapshot = await readSnapshot(epoch);
              if (epoch !== generation.current) return null;
              setItems(snapshot); setHasMore(false); setNextCursor(null);
              const readable = snapshot.find(item => item.id === operation.id);
              setEdit({ ...active, phase: "conflict", error: readable
                ? "这条记忆仍可读取，但当前没有修改权限或记录已变化。草稿已保留，可取消编辑。"
                : "原记忆已不在当前可读取范围。草稿已保留，可取消编辑后查看最新记录。" });
            } catch (caught) {
              if (epoch !== generation.current) return null;
              if (caught instanceof MemoryReadError && [401, 403, 404, 410].includes(caught.status)) {
                setItems([]); setEdit(null); setHasMore(false);
                setLoadError("读取范围已不可用，请重新打开人物页面。");
              } else setEdit({ ...active, phase: "conflict", error: "未保存，暂时无法核对读取范围。草稿已保留，请核对最新记忆。" });
            }
            return null;
          }
          if (response.status === 409) {
            attempt.current = null; setEdit({ ...active, phase: "conflict", error: "记忆已变化。草稿已保留，请核对最新内容后再修改。" });
            return null;
          }
          if (response.status >= 400 && response.status < 500) {
            attempt.current = null; setEdit({ ...active, phase: "editing", error: "未保存，草稿已保留。请检查内容后重试。" }); return null;
          }
          throw new Error("Mutation result unknown");
        }
        const body = await response.json() as MemoryItemMutationResponse;
        if (epoch !== generation.current) return null;
        if (operation.action === "delete") {
          if (body.status !== "deleted" || body.item !== null || body.operation_key !== operation.key) throw new Error("Deletion receipt not verified");
        } else {
          if (body.status !== "active" || !body.item || body.item.display_text !== operation.text
            || body.item.supersedes_id !== operation.id || body.item.id === operation.id) throw new Error("Mutation receipt not verified");
          operation.replacement = body.item;
        }
        operation.acknowledged = true;
      }
      // An acknowledgement is insufficient: read back the governed projection.
      if (operation.action === "delete") {
        const snapshot = await readSnapshot(epoch);
        if (epoch !== generation.current) return null;
        if (snapshot.some(item => item.id === operation.id)) throw new Error("Deletion not reflected in recall");
        deleted.current.add(operation.id);
        for (const [oldID, replacement] of confirmed.current) if (replacement.id === operation.id) {
          confirmed.current.delete(oldID); deleted.current.add(oldID);
        }
        setItems(snapshot); setHasMore(false); setNextCursor(null);
        attempt.current = null; setEdit(null); setNotice("记忆已删除，并已核对当前列表。原始对话未删除。");
        return operation.id;
      }
      const replacement = operation.replacement;
      if (!replacement) throw new Error("Mutation receipt not verified");
      let cursor: string | null = null;
      const seen = new Set<string>();
      let persisted: MemoryRecallItem | undefined;
      const readItems: MemoryRecallItem[] = [];
      let readHasMore = false;
      let readCursor: string | null = null;
      do {
        const page = await readPage(cursor, epoch);
        if (epoch !== generation.current) return null;
        readItems.push(...page.items); readHasMore = Boolean(page.has_more); readCursor = page.next_cursor ?? null;
        persisted = page.items.find(item => item.id === replacement.id);
        if (persisted) break;
        cursor = page.has_more ? page.next_cursor ?? null : null;
        if (cursor && seen.has(cursor)) throw new Error("Repeated memory cursor");
        if (cursor) seen.add(cursor);
      } while (cursor);
      if (!persisted || persisted.display_text !== operation.text || persisted.version !== replacement.version
        || persisted.scope !== original.scope || persisted.subject_id !== original.subject_id
        || persisted.relationship_context_id !== original.relationship_context_id || !canEditMemory(persisted)) {
        // A complete, authorized read resolves availability, even when another
        // window has superseded or deleted the acknowledged replacement.
        attempt.current = null; setItems(readItems); setHasMore(readHasMore); setNextCursor(readCursor);
        setEdit({ ...active, phase: "conflict", error: "已收到修改回执，但最新记录随后变化或已不再当前。草稿已保留，请核对最新记忆或取消编辑。" });
        return null;
      }
      confirmed.current.set(operation.id, persisted);
      setItems(value => {
        const next = value.filter(item => item.id !== persisted!.id);
        const index = next.findIndex(item => item.id === operation.id);
        if (index >= 0) next.splice(index, 1, persisted!); else next.push(persisted!);
        return next;
      });
      attempt.current = null; setEdit(null); setNotice("修改已保存，并已核对最新记忆。");
      return persisted.id;
    } catch (caught) {
      if (epoch !== generation.current) return null;
      if (caught instanceof MemoryReadError && [401, 403, 404, 410].includes(caught.status)) {
        attempt.current = null; setItems([]); setHasMore(false); setEdit(null);
        setLoadError("访问范围已不可用，无法核对修改结果。请重新打开人物页面。");
      } else {
        setEdit({ ...active, phase: "unknown", error: operation.action === "delete"
          ? "删除结果还不能确认。请核对并重试，将复用同一次请求。"
          : "保存结果还不能确认。草稿已保留；核对时会复用同一次请求。" });
      }
      return null;
    } finally { if (epoch === generation.current) busy.current = false; }
  }, [readPage, readSnapshot, request]);

  const refreshConflict = useCallback(async () => {
    const active = current.current.edit;
    if (expired.current || !active || busy.current || pageBusy.current) return;
    const epoch = generation.current;
    busy.current = true;
    try {
      const refreshed = await readSnapshot(epoch);
      if (epoch !== generation.current) return;
      setItems(refreshed); setHasMore(false); setNextCursor(null);
      const newest = refreshed.find(item => item.id === active.itemId || (active.action !== "delete" && item.supersedes_id === active.itemId));
      if (newest && canEditMemory(newest)) setEdit({ ...active, itemId: newest.id, ...(active.action === "delete" ? { draft: newest.display_text } : {}),
        phase: "editing", error: active.action === "delete" ? "已载入当前记录，请再次核对后决定是否删除。" : "已载入最新记忆，草稿仍保留。核对后保存将基于最新版本。" });
      else if (newest) setEdit({ ...active, itemId: newest.id, phase: "conflict", error: "这条记忆仍可读取，但当前没有修改权限。草稿已保留，可取消编辑。" });
      else setEdit({ ...active, phase: "conflict", error: "原记忆已连续更新或不可用。草稿已保留；请取消本次编辑后，从最新记录重新修改。" });
    } catch (caught) {
      if (epoch !== generation.current) return;
      if (caught instanceof MemoryReadError && [401, 403, 404, 410].includes(caught.status)) {
        setItems([]); setEdit(null); setHasMore(false); setNotice(null);
        setLoadError("记忆或访问范围已不可用，请重新打开人物页面。");
      } else setEdit({ ...active, error: "无法读取最新记忆，草稿仍保留。请稍后核对。" });
    } finally { if (epoch === generation.current) busy.current = false; }
  }, [readSnapshot]);

  const loadMore = useCallback(async () => {
    if (expired.current || !hasMore || !nextCursor || pageBusy.current || busy.current) return;
    const epoch = generation.current;
    pageBusy.current = true; setLoadingMore(true); setLoadError(null);
    try {
      const page = await readPage(nextCursor, epoch);
      if (epoch !== generation.current) return;
      if (page.has_more && page.next_cursor === nextCursor) throw new Error("Repeated memory cursor");
      setItems(value => { const ids = new Set(value.map(item => item.id)); return [...value, ...page.items.filter(item => !ids.has(item.id))]; });
      setHasMore(Boolean(page.has_more)); setNextCursor(page.next_cursor ?? null);
      return true;
    } catch (caught) {
      if (epoch !== generation.current) return;
      if (caught instanceof MemoryReadError && [401, 403, 404, 410].includes(caught.status)) {
        setItems([]); setEdit(null); setHasMore(false);
        setLoadError("记忆或访问范围已不可用，请重新打开人物页面。");
      } else setLoadError("未能加载更多记忆，已有内容保留。请重试。");
    } finally { if (epoch === generation.current) { pageBusy.current = false; setLoadingMore(false); } }
  }, [hasMore, nextCursor, readPage]);
  return { items, edit, notice, hasMore, loadingMore, loadError, begin, beginDelete, change, cancel, save, refreshConflict, loadMore };
}
