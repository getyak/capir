"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MemoryCommitResponse,
  MemoryContactOnlyDecisionResponse,
  MemoryDecision,
  MemoryItemDecisionResponse,
  MemoryProposalReference,
  MemoryProposalItem,
  MemoryReceipt,
  MemoryReviewView,
  MemoryScopedOperationView,
  MemorySurface,
} from "@talent-signal/contracts";

import {
  buildDraftRequest,
  createDraftState,
  type MemoryReviewDraftState,
} from "@/lib/memory-review-draft";
import { workspaceSessionFetch } from "@/components/workspace-session-request";

export type MemoryReviewPurpose = MemorySurface;

/**
 * Session-only recovery locator. It deliberately contains no review
 * credential, no selection, no item text and no accepted fact. A credential
 * lives only in memory and is re-minted by the authenticated review entry.
 */
type Locator = {
  version: 1;
  binding: string;
  proposal_id: string;
  purpose: MemoryReviewPurpose;
  person_id: string | null;
  relationship_context_id: string | null;
  operation_key: string | null;
  item_pending_id?: string | null;
  item_operation_keys?: Record<string, string>;
  contact_operation_key?: string | null;
  contact_pending?: boolean;
  contact_undo_key?: string | null;
  item_undo_keys?: Record<string, string>;
  /** Non-sensitive compensation idempotency key so a lost undo response can
   *  reconcile the same operation after a reload. */
  undo_key: string | null;
  /** Non-sensitive terminal marker: this source version was already dismissed. */
  dismissed?: boolean;
};

export type MemoryItemOutcome = {
  kind: "committed" | "skipped" | "unknown" | "undo_unknown" | "undone" | "unavailable";
  receipt: MemoryReceipt | null;
  operationKey: string;
  finalText?: string | null;
  snapshot?: MemoryProposalItem;
  personLabel?: string | null;
};

export type MemoryReviewPhase =
  | "idle"
  | "opening"
  | "review"
  | "saving"
  | "unknown"
  | "receipt"
  | "undoing"
  | "undone"
  | "dismissed"
  | "processed"
  | "error";

export interface MemoryReviewController {
  phase: MemoryReviewPhase;
  draftStatus: "idle" | "saving" | "saved" | "error";
  review: MemoryReviewView | null;
  draft: MemoryReviewDraftState | null;
  receipt: MemoryReceipt | null;
  itemOutcomes: Record<string, MemoryItemOutcome>;
  contactOutcome: MemoryItemOutcome | null;
  error: string | null;
  notice: string | null;
  frozen: boolean;
  canUndo: boolean;
  reconciling: boolean;
  canReconcile: boolean;
  open: () => Promise<true | undefined>;
  dispatchDraft: (next: MemoryReviewDraftState) => boolean;
  scheduleDraft: () => void;
  flushDraft: () => Promise<boolean>;
  commit: (body: MemoryCommitInput) => Promise<MemoryCommitResponse | null>;
  decideItem: (input: { itemId: string; decision: MemoryDecision; editedText?: string }) => Promise<MemoryItemDecisionResponse | null>;
  decideContactOnly: (input: { displayLabel: string; relationshipContext: string }) => Promise<MemoryContactOnlyDecisionResponse | null>;
  checkContact: () => Promise<void>;
  undoContact: () => Promise<boolean>;
  refreshReview: (decided?: { id: string; kind: "committed" | "skipped" }) => Promise<boolean>;
  undoItem: (itemId: string) => Promise<boolean>;
  checkItem: (itemId: string) => Promise<void>;
  dismiss: (itemIds: string[], reason: string) => Promise<boolean>;
  reconcile: () => Promise<void>;
  undo: () => Promise<MemoryUndoOutcome>;
  rebase: (input: MemoryRebaseInput) => Promise<boolean>;
  rebaseState: "idle" | "pending" | "error";
  rebaseError: string | null;
}

export interface MemoryCommitInput {
  contactDecision: "existing" | "new" | "none";
  selectedItemIds: string[];
  editedText: Record<string, string>;
  itemDecisions: Record<string, string>;
  expectedItemVersions: Record<string, number>;
}

export interface MemoryRebaseInput {
  contactDecision: "existing" | "new" | "none";
  personId?: string | null;
  contextId?: string | null;
  newContactLabel?: string | null;
  newContactRelationship?: string | null;
}

export type MemoryUndoOutcome =
  | { kind: "undone" }
  | { kind: "conflict"; message: string }
  | { kind: "failed"; message: string };

function locatorKey(binding: string, proposalId: string, purpose: MemoryReviewPurpose): string {
  return `get40:memory-locator:${binding}:${proposalId}:${purpose}`;
}

function readLocator(key: string): Locator | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Locator;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocator(key: string, locator: Locator): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(locator));
  } catch {
    // Session storage is best-effort recovery, never an authority.
  }
}

function writeRequiredLocator(key: string, locator: Locator): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(locator));
    return window.sessionStorage.getItem(key) === JSON.stringify(locator);
  } catch {
    return false;
  }
}

/**
 * Shared Memory review controller. Every call is bound to the current rendered
 * login through the `x-workspace-session` header; the browser never supplies
 * account or user authority. Response-loss recovery keeps only the exact
 * operation ID in a session-only locator and re-authorizes before any display.
 */
export function useMemoryReview(options: {
  binding: string | null;
  proposal: MemoryProposalReference | null;
  purpose: MemoryReviewPurpose;
  personId?: string | null;
  contextId?: string | null;
  pursuitId?: string | null;
  pursuitRoleId?: string | null;
  pursuitEvidenceFragmentId?: string | null;
  entryCapability?: string | null;
  sessionId?: string | null;
}): MemoryReviewController {
  const { binding, proposal, purpose } = options;
  // Stable entry keys: a parent rerender with a new proposal object identity
  // must not reopen the review or discard pending draft/terminal state.
  const proposalId = proposal?.proposal_id ?? null;
  const proposalRevision = proposal?.revision ?? null;
  const personId = options.personId ?? null;
  const contextId = options.contextId ?? null;
  const pursuitId = options.pursuitId ?? null;
  const pursuitRoleId = options.pursuitRoleId ?? null;
  const pursuitEvidenceFragmentId = options.pursuitEvidenceFragmentId ?? null;
  const sessionId = options.sessionId ?? null;
  const key = binding && proposalId ? locatorKey(binding, proposalId, purpose) : null;

  const [phase, setPhase] = useState<MemoryReviewPhase>("idle");
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [review, setReview] = useState<MemoryReviewView | null>(null);
  const [draft, setDraft] = useState<MemoryReviewDraftState | null>(null);
  const [receipt, setReceipt] = useState<MemoryReceipt | null>(null);
  const [itemOutcomes, setItemOutcomes] = useState<Record<string, MemoryItemOutcome>>({});
  const [contactOutcome, setContactOutcome] = useState<MemoryItemOutcome | null>(null);
  const recoveredItemSnapshots = useRef<Record<string, MemoryProposalItem>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [locator, setLocator] = useState<Locator | null>(null);
  const [rebaseState, setRebaseState] = useState<"idle" | "pending" | "error">("idle");
  const [rebaseError, setRebaseError] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const draftRef = useRef<MemoryReviewDraftState | null>(null);
  const reviewRef = useRef<MemoryReviewView | null>(null);
  const draftSavingRef = useRef(false);
  const draftPendingRef = useRef(false);
  const draftDirtyRef = useRef(false);
  const draftErrorRef = useRef(false);
  const draftVersionRef = useRef(0);
  const openedKeyRef = useRef<string | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const operationRef = useRef<string | null>(null);
  const credentialRef = useRef<string | null>(null);
  const scopeRef = useRef<string | null>(null);
  const undoKeyRef = useRef<string | null>(null);
  const capabilityRef = useRef<string | null>(options.entryCapability ?? null);
  const inflight = useRef(false);
  const previousBinding = useRef(binding);
  useEffect(() => {
    if (previousBinding.current === binding) return;
    previousBinding.current = binding;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = null;
    openedKeyRef.current = null;
    operationRef.current = null;
    credentialRef.current = null;
    scopeRef.current = null;
    undoKeyRef.current = null;
    reviewRef.current = null;
    draftRef.current = null;
    inflight.current = false;
    setReview(null);
    setDraft(null);
    setReceipt(null);
    setItemOutcomes({});
    setContactOutcome(null);
    recoveredItemSnapshots.current = {};
    setLocator(null);
    setError(null);
    setNotice(null);
    setPhase("idle");
  }, [binding]);
  // A refreshed server capability must replace the old token even when the
  // current review does not need to reopen.
  useEffect(() => { capabilityRef.current = options.entryCapability ?? null; }, [options.entryCapability]);

  const request = useCallback(
    async (path: string, init: RequestInit = {}) => {
      if (!binding) throw new Error("登录状态已改变。");
      // Reuse the production workspace binding guard: the proxy requires the
      // rendered account header and the route revalidates the login binding.
      return workspaceSessionFetch(path, {
        ...init,
        cache: "no-store",
        headers: {
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          "x-workspace-session": binding,
          ...(capabilityRef.current
            ? { "x-memory-entry-capability": capabilityRef.current }
            : {}),
          ...(init.headers ?? {}),
        },
      });
    },
    [binding],
  );

  const ensureCapability = useCallback(async (): Promise<string | null> => capabilityRef.current, []);

  const errorMessage = useCallback(async (response: Response, fallback: string) => {
    let code: string | null = null;
    let message: string | null = null;
    try {
      const body = (await response.json()) as {
        message?: string;
        code?: string;
        error?: { code?: string; message?: string };
      };
      code = body.code ?? body.error?.code ?? null;
      message = body.message ?? body.error?.message ?? null;
    } catch {
      // fall through to the caller's fallback
    }
    const correctable: Record<string, string> = {
      MEMORY_RELATIONSHIP_CONTEXT_REQUIRED: "这类关系记忆需要先确定关系名称，请重试。",
      MEMORY_SOURCE_UNAVAILABLE: "来源已失效，这些内容不能保存。",
      MEMORY_SOURCE_REVOKED: "来源已撤销，这些内容不能保存。",
      MEMORY_PURSUIT_ASSOCIATION_STALE: "这段寻访证据已变化，请从寻访重新打开。",
      MEMORY_REVIEW_REBASE_REQUIRED: "提案已有更新，请刷新后重新确认。",
      MEMORY_ITEM_REVISION_CONFLICT: "有内容已被修改，请刷新后重新确认。",
      MEMORY_REVIEW_DRAFT_STALE: "审阅已在别处更新，已按最新版本重排。",
      MEMORY_PROPOSAL_CLOSED: "这次提案已结束，无需重复保存。",
      MEMORY_CONTACT_ALREADY_EXISTS: "这个联系人已存在，请选择已有联系人。",
      MEMORY_IDENTITY_AMBIGUOUS: "有同名联系人，请重新选择并核对联系人后再保存。",
      MEMORY_IDENTITY_NOT_AUTHORIZED: "请先选择并确认这位联系人，再保存相关内容。",
      MEMORY_REVIEW_EXPIRED: "这次审阅已过期，请刷新后重新确认。",
      MEMORY_NO_MATERIAL_CHANGE: "没有新的可保存变化。",
      MEMORY_UNDO_SCOPE_MISMATCH: "本次保存包含其他范围的改动，请在原审阅里撤销。",
      MEMORY_COMMIT_STALE: "内容已有后续修改，本次未撤销。",
      MEMORY_UNDO_BLOCKED: "保存后的内容已变化，本次未撤销。请先查看最新记录。",
    };
    if (code && correctable[code]) return correctable[code];
    // Only ever surface a human-readable Chinese server message; never raw
    // internal English or schema jargon.
    if (message && /\p{Script=Han}/u.test(message) && message.length <= 200) return message;
    return fallback;
  }, []);

  const reconcileKey = useCallback(
    async (operationKey: string): Promise<void> => {
      if (!binding) return;
      setPhase("unknown");
      setReconciling(true);
      try {
        const response = await request(
          `/api/memory/operation-views/${operationKey}?purpose=${purpose}${
            personId ? `&person_id=${personId}` : ""
          }${contextId ? `&relationship_context_id=${contextId}` : ""}`,
          { method: "GET" },
        );
        if (!response.ok) {
          // A 4xx from the operation read is never proof the commit is absent:
          // 404 can mean pending, 401/403 a stale entry, 429 a throttle. Keep the
          // exact key and report a truthful status; only the commit endpoint's
          // own definitive rejection clears it.
          if (response.status === 401 || response.status === 403) {
            setError("审阅入口已过期，请重新打开这段对话后核对。");
            setPhase("unknown");
            setNotice("正在确认保存结果…");
            return;
          }
          setNotice("正在确认保存结果…");
          return;
        }
        const view = (await response.json()) as MemoryScopedOperationView;
        if (view.state === "applied" || view.state === "undone") {
          setReceipt(view.visible_receipt ?? null);
          setPhase(view.state === "undone" ? "undone" : "receipt");
          setNotice(null);
        } else if (view.state === "source_revoked") {
          setError("来源已失效，这些内容不能保存。");
          setPhase("error");
          setNotice(null);
        } else {
          setNotice("正在确认保存结果…");
        }
      } catch {
        setNotice("正在确认保存结果…");
      } finally {
        setReconciling(false);
      }
    },
    [binding, request, purpose, personId, contextId],
  );

  const reconcileItemKey = useCallback(async (itemId: string, operationKey: string): Promise<void> => {
    setReconciling(true);
    try {
      const response = await request(
        `/api/memory/operation-views/${operationKey}?purpose=${purpose}${personId ? `&person_id=${personId}` : ""}${contextId ? `&relationship_context_id=${contextId}` : ""}`,
        { method: "GET" },
      );
      if (!response.ok) {
        setPhase("unknown");
        setNotice("正在核对这一条的结果…");
        return;
      }
      const view = (await response.json()) as MemoryScopedOperationView;
      if ((view.state === "applied" || view.state === "undone") && view.visible_receipt) {
        if (view.item_snapshot) recoveredItemSnapshots.current[itemId] = view.item_snapshot;
        else delete recoveredItemSnapshots.current[itemId];
        const pendingUndo = key ? Boolean(readLocator(key)?.item_undo_keys?.[itemId]) : false;
        if (view.state === "applied" && pendingUndo) {
          setItemOutcomes((previous) => ({ ...previous, [itemId]: {
            kind: "undo_unknown", receipt: view.visible_receipt, operationKey,
          } }));
          setPhase("unknown");
          setNotice("正在核对撤销结果…");
          return;
        }
        setItemOutcomes((previous) => ({ ...previous, [itemId]: {
          kind: view.state === "undone" ? "undone" : "committed", receipt: view.visible_receipt, operationKey,
          finalText: view.applied_display_text ?? null,
          ...(view.item_snapshot ? { snapshot: view.item_snapshot } : {}),
          personLabel: view.person_display_label ?? null,
        } }));
        if (view.state === "undone" && key) {
          const current = readLocator(key);
          if (current) {
            const undoKeys = { ...(current.item_undo_keys ?? {}) };
            delete undoKeys[itemId];
            writeLocator(key, { ...current, item_undo_keys: undoKeys });
          }
        }
        operationRef.current = null;
        if (key) {
          const current = readLocator(key);
          if (current) {
            const next = { ...current, operation_key: null, item_pending_id: null };
            setLocator(next);
            writeLocator(key, next);
          }
        }
        setPhase("review");
        setNotice(null);
      } else if (view.state === "skipped" && view.dismissed_item_id === itemId) {
        if (view.item_snapshot) recoveredItemSnapshots.current[itemId] = view.item_snapshot;
        else delete recoveredItemSnapshots.current[itemId];
        setItemOutcomes((previous) => ({ ...previous, [itemId]: {
          kind: "skipped", receipt: null, operationKey,
          ...(view.item_snapshot ? { snapshot: view.item_snapshot } : {}),
          personLabel: view.person_display_label ?? null,
        } }));
        operationRef.current = null;
        if (key) {
          const current = readLocator(key);
          if (current) {
            const next = { ...current, operation_key: null, item_pending_id: null };
            setLocator(next);
            writeLocator(key, next);
          }
        }
        setPhase("review");
        setNotice(null);
      } else if (view.state === "source_revoked") {
        delete recoveredItemSnapshots.current[itemId];
        setItemOutcomes((previous) => ({ ...previous, [itemId]: {
          kind: "unavailable", receipt: null, operationKey,
        } }));
        setPhase("error");
        setError("来源已失效，这一条不能继续操作。");
      } else {
        setPhase("unknown");
        setNotice("正在核对这一条的结果…");
      }
    } catch {
      setPhase("unknown");
      setNotice("正在核对这一条的结果…");
    } finally {
      setReconciling(false);
    }
  }, [request, purpose, personId, contextId, key]);

  const reconcileContactKey = useCallback(async (operationKey: string): Promise<void> => {
    setReconciling(true);
    try {
      const response = await request(`/api/memory/operation-views/${operationKey}?purpose=${purpose}${personId ? `&person_id=${personId}` : ""}${contextId ? `&relationship_context_id=${contextId}` : ""}`, { method: "GET" });
      if (!response.ok) {
        setContactOutcome({ kind: "unknown", receipt: null, operationKey });
        setPhase("unknown");
        return;
      }
      const view = (await response.json()) as MemoryScopedOperationView;
      if ((view.state === "applied" || view.state === "undone") && view.visible_receipt) {
        const undoPending = key ? Boolean(readLocator(key)?.contact_undo_key) : false;
        if (view.state === "applied" && undoPending) {
          setContactOutcome({ kind: "undo_unknown", receipt: view.visible_receipt, operationKey });
          setPhase("unknown");
          setNotice("正在核对联系人撤销结果…");
          return;
        }
        setContactOutcome({ kind: view.state === "undone" ? "undone" : "committed", receipt: view.visible_receipt, operationKey });
        if (view.state === "undone" && key) {
          const current = readLocator(key);
          if (current) writeLocator(key, { ...current, contact_undo_key: null });
        }
        operationRef.current = null;
        if (key) {
          const current = readLocator(key);
          if (current) {
            const next = { ...current, operation_key: null, contact_pending: false };
            setLocator(next);
            writeLocator(key, next);
          }
        }
        setPhase("review");
        setNotice(null);
      } else if (view.state === "source_revoked") {
        setContactOutcome({ kind: "unavailable", receipt: null, operationKey });
        setPhase("error");
        setError("来源已失效，联系人结果不能从这里继续操作。");
      } else {
        setContactOutcome({ kind: "unknown", receipt: null, operationKey });
        setPhase("unknown");
        setNotice("正在核对联系人结果…");
      }
    } catch {
      setContactOutcome({ kind: "unknown", receipt: null, operationKey });
      setPhase("unknown");
    } finally {
      setReconciling(false);
    }
  }, [request, purpose, personId, contextId, key]);

  const open = useCallback(async () => {
    if (!binding || !proposalId || inflight.current) return;
    const entryKey = `${proposalId}:${proposalRevision}:${purpose}:${personId ?? ""}:${contextId ?? ""}`;
    if (openedKeyRef.current === entryKey && reviewRef.current && !operationRef.current) return;
    inflight.current = true;
    setPhase("opening");
    setError(null);
    setNotice(null);
    const existing = key ? readLocator(key) : null;
    if (existing?.contact_operation_key && !existing.contact_pending) {
      await reconcileContactKey(existing.contact_operation_key);
    }
    if (existing?.item_operation_keys) {
      for (const [itemId, operationKey] of Object.entries(existing.item_operation_keys)) {
        if (itemId === existing.item_pending_id && operationKey === existing.operation_key) continue;
        await reconcileItemKey(itemId, operationKey);
      }
    }
    if (existing?.dismissed) {
      // A dismissed source version stays dismissed; do not offer a retry card.
      inflight.current = false;
      setLocator(existing);
      setPhase("dismissed");
      setNotice("本次不保存已记录。");
      return;
    }
    if (existing) {
      setLocator(existing);
      undoKeyRef.current = existing.undo_key ?? null;
    }
    // An unresolved operation is authoritative: reconcile it before opening a
    // fresh review, and never clear the key while its outcome is unknown. A
    // current entry capability is obtained first so the scoped operation read
    // is authorized even after a reload.
    if (existing?.operation_key) {
      operationRef.current = existing.operation_key;
      inflight.current = false;
      await ensureCapability();
      if (existing.contact_pending) {
        await reconcileContactKey(existing.operation_key);
        if (key && readLocator(key)?.operation_key) return;
      } else if (existing.item_pending_id) {
        await reconcileItemKey(existing.item_pending_id, existing.operation_key);
        if (key && readLocator(key)?.operation_key) return;
      } else {
        await reconcileKey(existing.operation_key);
        return;
      }
    }
    // A normal Session poll or parent rerender with the same entry keys must
    // not reopen and overwrite pending draft/receipt state.
    if (openedKeyRef.current === entryKey && reviewRef.current) {
      // Already handled for this entry; leave the current phase (review or
      // terminal receipt) untouched.
      inflight.current = false;
      return;
    }
    try {
      const capability = await ensureCapability();
      if (!capability && !options.entryCapability && sessionId) {
        setError("审阅入口已失效，请重新打开这段对话。");
        setPhase("error");
        return;
      }
      const response = await request(
        `/api/memory/proposals/${proposalId}/reviews`,
        {
          method: "POST",
          body: JSON.stringify({
            purpose,
            person_id: personId,
            relationship_context_id: contextId,
            ...(pursuitId
              ? {
                  pursuit_id: pursuitId,
                  pursuit_role_id: pursuitRoleId,
                  pursuit_role_evidence_fragment_id: pursuitEvidenceFragmentId,
                }
              : {}),
          }),
        },
      );
      if (!response.ok) {
        const terminal = await response.clone().json().catch(() => null);
        const code = terminal?.error?.code ?? terminal?.code;
        const details = terminal?.error?.details ?? terminal?.details;
        if (code === "MEMORY_REVIEW_DISMISSED") {
          setPhase("dismissed"); setNotice("本次不保存已记录。"); setError(null);
          return;
        }
        if (code === "MEMORY_REVIEW_PROCESSED" && typeof details?.operation_key === "string") {
          const recovered: Locator = { version: 1, binding, proposal_id: proposalId, purpose, person_id: personId,
            relationship_context_id: contextId, operation_key: details.operation_key, undo_key: null };
          if (key) writeLocator(key, recovered);
          setLocator(recovered); operationRef.current = details.operation_key;
          inflight.current = false;
          await reconcileKey(details.operation_key);
          return;
        }
        if (code === "MEMORY_REVIEW_PROCESSED") {
          setPhase("processed"); setNotice(null); setError(null);
          return;
        }
        // A committed/closed proposal can still recover its scoped operation.
        if (existing?.operation_key) {
          inflight.current = false;
          operationRef.current = existing.operation_key;
          await reconcileKey(existing.operation_key);
          return;
        }
        setError(await errorMessage(response, "无法打开这次记忆审阅。"));
        setPhase("error");
        return;
      }
      const body = (await response.json()) as {
        review_credential?: string;
        review: MemoryReviewView;
      };
      credentialRef.current = body.review_credential ?? null;
      scopeRef.current = body.review.review_scope_id;
      openedKeyRef.current = entryKey;
      const freshIds = new Set(body.review.items.map((item) => item.id));
      const recovered = Object.values(recoveredItemSnapshots.current).filter((item) => !freshIds.has(item.id));
      const mergedReview: MemoryReviewView = { ...body.review, items: [...recovered, ...body.review.items] };
      reviewRef.current = mergedReview;
      setReview(mergedReview);
      const seeded = createDraftState(body.review, draftRef.current);
      draftRef.current = seeded;
      setDraft(seeded);
      setReceipt(null);
      const next: Locator = {
        version: 1,
        binding,
        proposal_id: proposalId ?? "",
        purpose,
        person_id: personId,
        relationship_context_id: contextId,
        operation_key: null,
        item_pending_id: null,
        item_operation_keys: existing?.item_operation_keys ?? {},
        contact_operation_key: existing?.contact_operation_key ?? null,
        contact_pending: false,
        undo_key: existing?.undo_key ?? null,
      };
      operationRef.current = null;
      setLocator(next);
      if (key) writeLocator(key, next);
      setPhase("review");
      return true;
    } catch {
      setError("网络暂时不可用，请稍后重试。");
      setPhase("error");
    } finally {
      inflight.current = false;
    }
  }, [binding, proposalId, proposalRevision, purpose, personId, contextId, pursuitId, pursuitRoleId, pursuitEvidenceFragmentId, request, errorMessage, key, reconcileKey, reconcileItemKey, reconcileContactKey, ensureCapability, sessionId, options.entryCapability]);

  const dispatchDraft = useCallback((next: MemoryReviewDraftState) => {
    const previous = draftRef.current;
    const review = reviewRef.current;
    draftRef.current = next;
    let changed = false;
    // Pure disclosure (expand/sheet/detail/search) must not dirty the draft;
    // only a semantic selection/edit/decision/contact-mode change does.
    if (previous && review) {
      const before = JSON.stringify(buildDraftRequest(previous, review));
      const after = JSON.stringify(buildDraftRequest(next, review));
      if (before !== after) {
        changed = true;
        draftDirtyRef.current = true;
        draftVersionRef.current += 1;
      }
    } else {
      changed = true;
      draftDirtyRef.current = true;
      draftVersionRef.current += 1;
    }
    setDraft(next);
    return changed;
  }, []);

  /**
   * One serialized draft request queue. Only one PUT is ever in flight; a newer
   * local intent is coalesced and sent by the in-flight loop after the current
   * ack. Every ack updates the revision even when a newer intent is pending, and
   * a 409 re-reads current authority without overlaying the server draft over
   * the user's locally touched choices.
   */
  const runDraftSave = useCallback(async (): Promise<void> => {
    if (!draftDirtyRef.current) return;
    if (draftSavingRef.current) {
      draftPendingRef.current = true;
      return;
    }
    draftSavingRef.current = true;
    let retried = false;
    try {
      for (;;) {
        draftPendingRef.current = false;
        const review = reviewRef.current;
        const state = draftRef.current;
        const credential = credentialRef.current;
        const scopeId = scopeRef.current;
        const version = draftVersionRef.current;
        if (!binding || !review || !state || !credential || !scopeId) return;
        const send = async () =>
          request(`/api/memory/reviews/${scopeId}/draft`, {
            method: "PUT",
            headers: { "x-memory-review-credential": credential },
            body: JSON.stringify({
              expected_review_revision: reviewRef.current!.review_revision,
              ...buildDraftRequest(state, reviewRef.current!),
            }),
          });
        let response: Response;
        try {
          response = await send();
        } catch {
          draftErrorRef.current = true;
          setDraftStatus("error");
          return;
        }
        if (response.ok) {
          const result = (await response.json()) as { review: MemoryReviewView };
          // Always advance the revision from the ack so the next save uses the
          // current server revision.
          reviewRef.current = result.review;
          setReview(result.review);
          draftErrorRef.current = false;
          retried = false;
          if (draftVersionRef.current !== version) continue;
          draftDirtyRef.current = false;
          setDraftStatus("saved");
          return;
        }
        if (response.status === 409) {
          // Fetch current authority/revision but keep the latest local choices.
          const reread = await request(`/api/memory/reviews/${scopeId}`, {
            method: "GET",
            headers: { "x-memory-review-credential": credential },
          });
          if (reread.ok) {
            const latest = (await reread.json()) as { review: MemoryReviewView };
            reviewRef.current = latest.review;
            setReview(latest.review);
          }
          if (!retried) {
            retried = true;
            continue;
          }
          draftErrorRef.current = true;
          setDraftStatus("error");
          return;
        }
        draftErrorRef.current = true;
        setDraftStatus("error");
        return;
      }
    } finally {
      draftSavingRef.current = false;
    }
  }, [binding, request]);

  const scheduleDraft = useCallback(() => {
    if (!binding || !reviewRef.current) return;
    if (!draftDirtyRef.current) return;
    setDraftStatus("saving");
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      draftTimerRef.current = null;
      void runDraftSave();
    }, 600);
  }, [binding, runDraftSave]);

  /** Await any in-flight save and then the final queued intent. */
  const flushDraft = useCallback(async (): Promise<boolean> => {
    if (draftTimerRef.current) {
      clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    while (draftSavingRef.current) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (draftDirtyRef.current) {
      await runDraftSave();
    }
    return !draftErrorRef.current;
  }, [runDraftSave]);

  const commit = useCallback(
    async (body: MemoryCommitInput): Promise<MemoryCommitResponse | null> => {
      const credential = credentialRef.current;
      const reviewScopeId = scopeRef.current;
      if (!binding || !proposalId || !credential || !reviewScopeId) {
        setError("审阅凭证无效，请重新打开审阅。");
        setPhase("error");
        return null;
      }
      // Freeze this operation before the first await so a fast double click
      // cannot create two commit keys; the flush must succeed before the
      // authoritative commit starts. Locks become visible immediately.
      if (inflight.current) return null;
      inflight.current = true;
      setPhase("saving");
      setError(null);
      let flushed = false;
      try {
        flushed = await flushDraft();
      } finally {
        if (!flushed) inflight.current = false;
      }
      if (!flushed) {
        setError("草稿尚未同步，请修正后重试；本次未提交。");
        setPhase("review");
        return null;
      }
      if (!inflight.current) return null;
      const operationKey = crypto.randomUUID();
      const commitBody = {
        idempotency_key: operationKey,
        expected_proposal_revision: reviewRef.current?.proposal_revision ?? proposalRevision ?? 1,
        contact_decision: body.contactDecision,
        selected_item_ids: body.selectedItemIds,
        edited_text: body.editedText,
        item_decisions: body.itemDecisions,
        expected_item_versions: body.expectedItemVersions,
        ...(body.contactDecision === "new"
          ? {
              new_contact: {
                display_label: review?.person_display_label ?? "新联系人",
                relationship_context: review?.relationship_display_label ?? "",
              },
            }
          : {}),
        reason: "用户在共享记忆中确认所选内容。",
      };
      const next: Locator = {
        version: 1,
        binding,
        proposal_id: proposalId ?? "",
        purpose,
        person_id: personId,
        relationship_context_id: contextId,
        operation_key: operationKey,
        undo_key: null,
      };
      operationRef.current = operationKey;
      setLocator(next);
      if (key) writeLocator(key, next);
      try {
        const response = await request(
          `/api/memory/reviews/${reviewScopeId}/commits`,
          {
            method: "POST",
            headers: { "x-memory-review-credential": credential },
            body: JSON.stringify(commitBody),
          },
        );
        if (!response.ok) {
          const message = await errorMessage(response, "尚未保存。");
          if (response.status >= 400 && response.status < 500) {
            // The commit endpoint's own definitive rejection is the only place
            // the frozen operation key is cleared; the draft is preserved.
            if (key) {
              const current = readLocator(key);
              if (current) {
                const cleared: Locator = { ...current, operation_key: null };
                setLocator(cleared);
                writeLocator(key, cleared);
              }
            }
            operationRef.current = null;
            setError(message);
            setPhase("review");
            return null;
          }
          setError(null);
          setNotice("正在确认保存结果…");
          setPhase("unknown");
          return null;
        }
        const result = (await response.json()) as MemoryCommitResponse;
        setReceipt(result.receipt);
        setPhase("receipt");
        setNotice(null);
        return result;
      } catch {
        // Frozen operation ID: never create a fresh ID on an unknown response.
        setNotice("正在确认保存结果…");
        setPhase("unknown");
        return null;
      } finally {
        inflight.current = false;
      }
    },
    [binding, proposalId, proposalRevision, purpose, personId, contextId, request, review, key, errorMessage, flushDraft],
  );

  const refreshReview = useCallback(async (decided?: { id: string; kind: "committed" | "skipped" }): Promise<boolean> => {
    if (!proposalId || !binding) return false;
    try {
      const response = await request(`/api/memory/proposals/${proposalId}/reviews`, {
        method: "POST",
        body: JSON.stringify({
          purpose,
          person_id: personId,
          relationship_context_id: contextId,
          ...(pursuitId ? {
            pursuit_id: pursuitId,
            pursuit_role_id: pursuitRoleId,
            pursuit_role_evidence_fragment_id: pursuitEvidenceFragmentId,
          } : {}),
        }),
      });
      if (!response.ok) {
        const body = await response.clone().json().catch(() => null);
        const code = body?.error?.code ?? body?.code;
        if (code === "MEMORY_REVIEW_PROCESSED" || code === "MEMORY_REVIEW_DISMISSED") {
          setPhase(code === "MEMORY_REVIEW_PROCESSED" ? "processed" : "dismissed");
          return true;
        }
        setError(await errorMessage(response, "剩余内容暂时无法读取，请稍后核对。"));
        return false;
      }
      const body = (await response.json()) as { review_credential?: string; review: MemoryReviewView };
      credentialRef.current = body.review_credential ?? null;
      scopeRef.current = body.review.review_scope_id;
      const freshIds = new Set(body.review.items.map((item) => item.id));
      const retained = (reviewRef.current?.items ?? [])
        .filter((item) => !freshIds.has(item.id) && (item.status !== "pending" || item.id === decided?.id))
        .map((item) => item.id === decided?.id ? { ...item, status: decided.kind } : item);
      const merged: MemoryReviewView = { ...body.review, items: [...retained, ...body.review.items] };
      reviewRef.current = merged;
      setReview(merged);
      const next = createDraftState(body.review);
      draftRef.current = next;
      setDraft(next);
      setError(null);
      return true;
    } catch {
      setError("剩余内容暂时无法读取，请稍后核对。");
      return false;
    }
  }, [proposalId, binding, request, purpose, personId, contextId, pursuitId, pursuitRoleId, pursuitEvidenceFragmentId, errorMessage]);

  const decideItem = useCallback(async (input: {
    itemId: string;
    decision: MemoryDecision;
    editedText?: string;
  }): Promise<MemoryItemDecisionResponse | null> => {
    const current = reviewRef.current;
    const credential = credentialRef.current;
    const scopeId = scopeRef.current;
    const item = current?.items.find((entry) => entry.id === input.itemId);
    if (!binding || !proposalId || !current || !credential || !scopeId || !item || item.status !== "pending" || inflight.current) return null;
    const contactDecision = item.scope === "self" ? "none" : current.contact_decision;
    if (contactDecision === "new" || (item.scope !== "self" && current.contact_status !== "resolved")) {
      setError("请先确认联系人，再处理关于对方的记忆。");
      return null;
    }
    inflight.current = true;
    setPhase("saving");
    setError(null);
    const operationKey = crypto.randomUUID();
    const priorLocator = key ? readLocator(key) : null;
    const nextLocator: Locator = {
      ...(priorLocator ?? {}),
      version: 1, binding, proposal_id: proposalId, purpose,
      person_id: personId, relationship_context_id: contextId,
      operation_key: operationKey, item_pending_id: item.id,
      item_operation_keys: { ...(priorLocator?.item_operation_keys ?? {}), [item.id]: operationKey },
      undo_key: priorLocator?.undo_key ?? null,
    };
    if (!key || !writeRequiredLocator(key, nextLocator)) {
      inflight.current = false;
      setPhase("review");
      setError("浏览器无法保存这次操作，已停止提交；请稍后重试。");
      return null;
    }
    operationRef.current = operationKey;
    setLocator(nextLocator);
    try {
      const response = await request(`/api/memory/reviews/${scopeId}/item-decisions`, {
        method: "POST",
        headers: { "x-memory-review-credential": credential },
        body: JSON.stringify({
          idempotency_key: operationKey,
          expected_proposal_revision: current.proposal_revision,
          expected_review_revision: current.review_revision,
          item_id: item.id,
          expected_item_added_revision: item.added_revision,
          ...(item.previous_revision ? { expected_item_version: item.previous_revision } : {}),
          contact_decision: contactDecision,
          decision: input.decision,
          ...(input.editedText ? { edited_text: input.editedText } : {}),
          reason: input.decision === "skip" ? "用户选择暂不保存。" : "用户确认这一条记忆。",
        }),
      });
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          operationRef.current = null;
          if (key) {
            const itemKeys = { ...nextLocator.item_operation_keys };
            delete itemKeys[item.id];
            writeLocator(key, { ...nextLocator, operation_key: null, item_pending_id: null, item_operation_keys: itemKeys });
          }
          setError(await errorMessage(response, "这一条尚未保存。"));
          setPhase("review");
          return null;
        }
        setItemOutcomes((previous) => ({ ...previous, [item.id]: { kind: "unknown", receipt: null, operationKey } }));
        setNotice("正在核对这一条的结果…");
        setPhase("unknown");
        return null;
      }
      const result = (await response.json()) as MemoryItemDecisionResponse;
      const snapshot: MemoryProposalItem = { ...item, status: result.kind };
      recoveredItemSnapshots.current[item.id] = snapshot;
      setItemOutcomes((previous) => ({ ...previous, [item.id]: { kind: result.kind, receipt: result.receipt, operationKey,
        finalText: result.applied_display_text ?? null, snapshot,
        personLabel: current.person_display_label ?? null } }));
      operationRef.current = null;
      if (key) writeLocator(key, { ...nextLocator, operation_key: null, item_pending_id: null });
      setPhase("review");
      setNotice(null);
      await refreshReview({ id: item.id, kind: result.kind });
      return result;
    } catch {
      setItemOutcomes((previous) => ({ ...previous, [item.id]: { kind: "unknown", receipt: null, operationKey } }));
      setNotice("正在核对这一条的结果…");
      setPhase("unknown");
      return null;
    } finally {
      inflight.current = false;
    }
  }, [binding, proposalId, purpose, personId, contextId, request, key, refreshReview, errorMessage]);

  const decideContactOnly = useCallback(async (input: {
    displayLabel: string;
    relationshipContext: string;
  }): Promise<MemoryContactOnlyDecisionResponse | null> => {
    const current = reviewRef.current;
    const credential = credentialRef.current;
    const scopeId = scopeRef.current;
    if (!binding || !proposalId || !current || !credential || !scopeId || inflight.current) return null;
    if (current.contact_decision !== "new" || current.contact_status === "ambiguous") {
      setError("请先核对同名联系人，再决定添加或关联。");
      return null;
    }
    const label = input.displayLabel.trim();
    if (!label) return null;
    const operationKey = crypto.randomUUID();
    const prior = key ? readLocator(key) : null;
    const next: Locator = {
      ...(prior ?? {}),
      version: 1, binding, proposal_id: proposalId, purpose,
      person_id: personId, relationship_context_id: contextId,
      operation_key: operationKey, contact_operation_key: operationKey,
      contact_pending: true, item_operation_keys: prior?.item_operation_keys ?? {},
      undo_key: prior?.undo_key ?? null,
    };
    if (!key || !writeRequiredLocator(key, next)) {
      setError("浏览器无法保存这次操作，已停止提交；请稍后重试。");
      return null;
    }
    inflight.current = true;
    operationRef.current = operationKey;
    setLocator(next);
    setPhase("saving");
    setError(null);
    try {
      const response = await request(`/api/memory/reviews/${scopeId}/contact-decisions`, {
        method: "POST",
        headers: { "x-memory-review-credential": credential },
        body: JSON.stringify({
          idempotency_key: operationKey,
          expected_proposal_revision: current.proposal_revision,
          display_label: label,
          relationship_context: input.relationshipContext.trim(),
          reason: "用户确认添加这位联系人。",
        }),
      });
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          operationRef.current = null;
          writeLocator(key, { ...next, operation_key: null, contact_operation_key: null, contact_pending: false });
          setError(await errorMessage(response, "联系人尚未添加。"));
          setPhase("review");
          return null;
        }
        setContactOutcome({ kind: "unknown", receipt: null, operationKey });
        setPhase("unknown");
        setNotice("正在核对联系人结果…");
        return null;
      }
      const result = (await response.json()) as MemoryContactOnlyDecisionResponse;
      setContactOutcome({ kind: "committed", receipt: result.receipt, operationKey });
      operationRef.current = null;
      writeLocator(key, { ...next, operation_key: null, contact_pending: false });
      setPhase("review");
      setNotice(null);
      await refreshReview();
      return result;
    } catch {
      setContactOutcome({ kind: "unknown", receipt: null, operationKey });
      setPhase("unknown");
      setNotice("正在核对联系人结果…");
      return null;
    } finally {
      inflight.current = false;
    }
  }, [binding, proposalId, purpose, personId, contextId, key, request, errorMessage, refreshReview]);

  const undoContact = useCallback(async (): Promise<boolean> => {
    const outcome = contactOutcome;
    if (!outcome || outcome.kind !== "committed" || !key || inflight.current) return false;
    const prior = readLocator(key);
    if (!prior) return false;
    const undoKey = prior.contact_undo_key ?? crypto.randomUUID();
    if (!writeRequiredLocator(key, { ...prior, contact_undo_key: undoKey })) {
      setError("浏览器无法保存这次撤销操作，已停止提交。");
      return false;
    }
    inflight.current = true;
    const operationKey = outcome.operationKey;
    try {
      const viewResponse = await request(`/api/memory/operation-views/${operationKey}?purpose=${purpose}${personId ? `&person_id=${personId}` : ""}${contextId ? `&relationship_context_id=${contextId}` : ""}`, { method: "GET" });
      if (!viewResponse.ok) { setError("无法核对联系人保存结果，本次尚未撤销。"); return false; }
      const view = (await viewResponse.json()) as MemoryScopedOperationView;
      if (view.state === "undone") {
        setContactOutcome({ kind: "undone", receipt: view.visible_receipt, operationKey });
        writeLocator(key, { ...prior, contact_undo_key: null });
        return true;
      }
      if (!view.undo.allowed || !view.commit_revision) { setError("联系人已有后续记录，不能从这里撤销。"); return false; }
      const response = await request(`/api/memory/operation-views/${operationKey}/undo`, {
        method: "POST",
        body: JSON.stringify({
          idempotency_key: undoKey, expected_commit_revision: view.commit_revision,
          purpose, person_id: personId, relationship_context_id: contextId,
          reason: "用户撤销本次联系人添加。",
        }),
      });
      if (!response.ok) { setError(await errorMessage(response, "联系人尚未撤销。")); return false; }
      const body = (await response.json()) as { receipt: MemoryReceipt };
      setContactOutcome({ kind: "undone", receipt: body.receipt, operationKey });
      const current = readLocator(key);
      if (current) writeLocator(key, { ...current, contact_undo_key: null });
      setError(null);
      return true;
    } catch {
      setContactOutcome({ kind: "undo_unknown", receipt: outcome.receipt, operationKey });
      setNotice("正在核对联系人撤销结果…");
      return false;
    } finally { inflight.current = false; }
  }, [contactOutcome, key, request, purpose, personId, contextId, errorMessage]);

  const undoItem = useCallback(async (itemId: string): Promise<boolean> => {
    const outcome = itemOutcomes[itemId];
    if (!outcome || outcome.kind !== "committed" || !key || inflight.current) return false;
    const operationKey = outcome.operationKey;
    const prior = readLocator(key);
    if (!prior) return false;
    const undoKey = prior.item_undo_keys?.[itemId] ?? crypto.randomUUID();
    const pending: Locator = { ...prior, item_undo_keys: { ...(prior.item_undo_keys ?? {}), [itemId]: undoKey } };
    if (!writeRequiredLocator(key, pending)) {
      setError("浏览器无法保存这次撤销操作，已停止提交。");
      return false;
    }
    inflight.current = true;
    try {
      const viewResponse = await request(`/api/memory/operation-views/${operationKey}?purpose=${purpose}${personId ? `&person_id=${personId}` : ""}${contextId ? `&relationship_context_id=${contextId}` : ""}`, { method: "GET" });
      if (!viewResponse.ok) {
        setError("无法核对这次保存，撤销尚未进行。");
        return false;
      }
      const view = (await viewResponse.json()) as MemoryScopedOperationView;
      if (view.state === "undone") {
        setItemOutcomes((previous) => ({ ...previous, [itemId]: {
          ...previous[itemId], kind: "undone", receipt: view.visible_receipt, operationKey,
        } }));
        return true;
      }
      if (!view.undo.allowed || !view.commit_revision) {
        setError("这条记忆已变化，不能从这里撤销。");
        return false;
      }
      const response = await request(`/api/memory/operation-views/${operationKey}/undo`, {
        method: "POST",
        body: JSON.stringify({
          idempotency_key: undoKey,
          expected_commit_revision: view.commit_revision,
          purpose,
          person_id: personId,
          relationship_context_id: contextId,
          reason: "用户撤销这一条记忆。",
        }),
      });
      if (!response.ok) {
        setError(await errorMessage(response, "这条记忆尚未撤销。"));
        return false;
      }
      const body = (await response.json()) as { receipt: MemoryReceipt };
      setItemOutcomes((previous) => ({ ...previous, [itemId]: {
        ...previous[itemId], kind: "undone", receipt: body.receipt, operationKey,
      } }));
      const current = readLocator(key);
      if (current) {
        const undoKeys = { ...(current.item_undo_keys ?? {}) };
        delete undoKeys[itemId];
        writeLocator(key, { ...current, item_undo_keys: undoKeys });
      }
      setError(null);
      return true;
    } catch {
      setItemOutcomes((previous) => ({ ...previous, [itemId]: {
        ...previous[itemId], kind: "undo_unknown", receipt: outcome.receipt, operationKey,
      } }));
      setNotice("正在核对撤销结果…");
      return false;
    } finally {
      inflight.current = false;
    }
  }, [itemOutcomes, key, request, purpose, personId, contextId, errorMessage]);

  const checkItem = useCallback(async (itemId: string): Promise<void> => {
    const operationKey = itemOutcomes[itemId]?.operationKey;
    if (operationKey) await reconcileItemKey(itemId, operationKey);
  }, [itemOutcomes, reconcileItemKey]);

  const dismiss = useCallback(
    async (itemIds: string[], reason: string): Promise<boolean> => {
      const credential = credentialRef.current;
      const reviewScopeId = scopeRef.current;
      if (!binding || !credential || !reviewScopeId || !review) return false;
      try {
        const response = await request(
          `/api/memory/reviews/${reviewScopeId}/dismissals`,
          {
            method: "POST",
            headers: { "x-memory-review-credential": credential },
            body: JSON.stringify({
              idempotency_key: crypto.randomUUID(),
              expected_review_revision: review.review_revision,
              item_ids: itemIds,
              reason,
            }),
          },
        );
        if (!response.ok) {
          setError(await errorMessage(response, "本次未保存。"));
          return false;
        }
        const result = (await response.json()) as {
          dismissed_item_ids?: string[];
          proposal_status?: string;
        };
        if (result.proposal_status === "dismissed") {
          setPhase("dismissed");
          setNotice("本次不保存已记录。");
          if (key) {
            const current = readLocator(key);
            if (current) {
              const next: Locator = { ...current, operation_key: null, dismissed: true };
              setLocator(next);
              writeLocator(key, next);
            }
          }
          return true;
        }
        // A partial dismissal re-reads the remaining projection so the card
        // cannot offer a stale save of already-dismissed items.
        const reread = await request(`/api/memory/reviews/${reviewScopeId}`, {
          method: "GET",
          headers: { "x-memory-review-credential": credential },
        });
        if (reread.ok) {
          const latest = (await reread.json()) as { review: MemoryReviewView };
          reviewRef.current = latest.review;
          setReview(latest.review);
          const rebased = createDraftState(latest.review, draftRef.current);
          draftRef.current = rebased;
          setDraft(rebased);
        }
        setNotice(`已跳过 ${result.dismissed_item_ids?.length ?? itemIds.length} 条。`);
        return true;
      } catch {
        setError("网络暂时不可用，本次未保存。");
        return false;
      }
    },
    [binding, review, request, errorMessage, key],
  );

  const reconcile = useCallback(async () => {
    const operationKey = operationRef.current ?? locator?.operation_key ?? null;
    if (!operationKey) return;
    if (locator?.contact_pending) await reconcileContactKey(operationKey);
    else if (locator?.item_pending_id) await reconcileItemKey(locator.item_pending_id, operationKey);
    else await reconcileKey(operationKey);
  }, [locator, reconcileKey, reconcileItemKey, reconcileContactKey]);
  const checkContact = useCallback(async () => {
    const operationKey = contactOutcome?.operationKey ?? locator?.contact_operation_key;
    if (operationKey) await reconcileContactKey(operationKey);
  }, [contactOutcome, locator, reconcileContactKey]);

  const rebase = useCallback(
    async (input: MemoryRebaseInput): Promise<boolean> => {
      if (!binding || !proposalId || inflight.current) return false;
      inflight.current = true;
      setRebaseState("pending");
      setRebaseError(null);
      try {
        if (!(await flushDraft())) {
          setRebaseState("error");
          setRebaseError("草稿尚未同步，请重试；联系人尚未切换。");
          return false;
        }
        const response = await request(
          `/api/memory/proposals/${proposalId}/rebases`,
          {
            method: "POST",
            body: JSON.stringify({
              idempotency_key: crypto.randomUUID(),
              expected_proposal_revision:
                reviewRef.current?.proposal_revision ?? proposalRevision ?? 1,
              contact_decision: input.contactDecision,
              identity_authority: "human_selection",
              person_id: input.personId ?? null,
              relationship_context_id: input.contextId ?? null,
              ...(input.newContactLabel
                ? {
                    new_contact: {
                      display_label: input.newContactLabel,
                      relationship_context: input.newContactRelationship ?? "",
                    },
                  }
                : {}),
              reason: "用户在共享记忆中明确选择新的联系人。",
            }),
          },
        );
        if (!response.ok) {
          setRebaseState("error");
          setRebaseError(await errorMessage(response, "无法切换联系人。"));
          return false;
        }
        setRebaseState("idle");
        // A guarded rebase regenerates and freezes a fresh review; re-open it
        // with a newly authenticated credential instead of retargeting old
        // assertions.
        openedKeyRef.current = null;
        credentialRef.current = null;
        scopeRef.current = null;
        reviewRef.current = null;
        setReview(null);
        // Keep the stable-ID intent privately across a failed re-open. The
        // old review/credential are no longer actionable; new target items
        // have new IDs and will remain unchecked.
        setDraft(null);
        inflight.current = false;
        const reopened = await open();
        if (!reopened) {
          setRebaseState("error");
          const message = "联系人已切换，但新内容尚未读取成功。请重试读取审阅，再继续选择。";
          setRebaseError(message);
          setError(message);
          return false;
        }
        setNotice("已按所选联系人重新整理，请重新勾选关于对方和关系的内容。");
        return true;
      } catch {
        setRebaseState("error");
        setRebaseError("网络暂时不可用，未能切换联系人。");
        return false;
      } finally {
        inflight.current = false;
      }
    },
    [binding, proposalId, proposalRevision, request, errorMessage, open, flushDraft],
  );

  const undo = useCallback(async (): Promise<MemoryUndoOutcome> => {
    const operationKey = operationRef.current ?? locator?.operation_key ?? null;
    if (!binding || !operationKey) {
      return { kind: "failed", message: "没有可撤销的本次保存。" };
    }
    // Reuse one exact compensation key so a lost response reconciles the same
    // operation instead of creating a fresh one; it survives a reload through
    // the non-sensitive locator.
    const idempotencyKey = undoKeyRef.current ?? crypto.randomUUID();
    undoKeyRef.current = idempotencyKey;
    if (key) {
      const current = readLocator(key);
      if (current) {
        const next: Locator = { ...current, undo_key: idempotencyKey };
        setLocator(next);
        writeLocator(key, next);
      }
    }
    setPhase("undoing");
    try {
      const viewResponse = await request(
        `/api/memory/operation-views/${operationKey}?purpose=${purpose}${
          personId ? `&person_id=${personId}` : ""
        }${contextId ? `&relationship_context_id=${contextId}` : ""}`,
        { method: "GET" },
      );
      if (!viewResponse.ok) {
        setPhase("receipt");
        setError("无法确认撤销范围，请稍后核对。");
        return { kind: "failed", message: "无法确认撤销范围。" };
      }
      const view = (await viewResponse.json()) as MemoryScopedOperationView;
      if (view.state === "undone" && view.visible_receipt) {
        undoKeyRef.current = null;
        setReceipt(view.visible_receipt);
        setPhase("undone");
        setNotice("已撤销本次保存。");
        if (key) {
          const current = readLocator(key);
          if (current) {
            const next: Locator = { ...current, undo_key: null };
            setLocator(next);
            writeLocator(key, next);
          }
        }
        return { kind: "undone" };
      }
      if (!view.undo.allowed || !view.commit_revision) {
        setPhase("receipt");
        const message = view.state === "source_revoked"
          ? "来源授权已撤回，本次记录仅供查看，不能从这里撤销。"
          : view.state === "unavailable"
            ? "暂时无法核对保存记录，本次尚未撤销。"
            : "本次保存包含当前页面范围之外的内容，请回到原对话撤销。";
        setError(message);
        return { kind: "conflict", message };
      }
      const response = await request(`/api/memory/operation-views/${operationKey}/undo`, {
        method: "POST",
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          expected_commit_revision: view.commit_revision,
          purpose,
          person_id: personId,
          relationship_context_id: contextId,
          reason: "用户撤销本次保存。",
        }),
      });
      if (!response.ok) {
        setPhase("receipt");
        const message = await errorMessage(response, "本次尚未撤销。");
        setError(message);
        return { kind: "conflict", message };
      }
      undoKeyRef.current = null;
      const undoneReceipt = (await response.json()) as { receipt: MemoryReceipt };
      setReceipt(undoneReceipt.receipt);
      setPhase("undone");
      setNotice("已撤销本次保存。");
      // Keep the non-sensitive operation locator so a refresh can reconcile and
      // display the actual undone receipt without reopening a closed proposal.
      if (key) {
        const current = readLocator(key);
        if (current) {
          const next: Locator = { ...current, undo_key: null };
          setLocator(next);
          writeLocator(key, next);
        }
      }
      return { kind: "undone" };
    } catch {
      setPhase("receipt");
      setError("撤销结果尚未确认，请稍后核对。");
      return { kind: "failed", message: "撤销结果尚未确认，请稍后核对。" };
    }
  }, [binding, locator, request, purpose, personId, contextId, key, errorMessage]);

  return {
    phase,
    draftStatus,
    review,
    draft,
    receipt,
    itemOutcomes,
    contactOutcome,
    error,
    notice,
    frozen: rebaseState === "pending" || phase === "saving" || phase === "unknown" || phase === "undoing" || phase === "opening",
    canUndo: phase === "receipt",
    reconciling,
    canReconcile: phase === "unknown" && !reconciling,
    open,
    dispatchDraft,
    scheduleDraft,
    flushDraft,
    commit,
    decideItem,
    decideContactOnly,
    checkContact,
    undoContact,
    refreshReview,
    undoItem,
    checkItem,
    dismiss,
    reconcile,
    undo,
    rebase,
    rebaseState,
    rebaseError,
  };
}
