"use client";

import {
  maskIdentityHandle,
  parseIdentityHandleQuery,
  ResourceCaptureResponseSchema,
  type IdentityHandleType,
  type PersonDirectoryItem,
  type RelationshipScope,
  type ResourceCaptureResponse,
} from "@talent-signal/contracts";
import {
  ArrowRight,
  CheckCircle,
  CircleNotch,
  Clock,
  Plus,
  ShieldCheck,
  UserPlus,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  type AgentPersonOutcome,
  type AgentPersonTarget,
  agentPersonOutcome,
  agentPersonScopeFields,
  agentRelationshipContexts,
  canCreateDistinctPerson,
  canSelectPersonForIdentityClue,
  confirmedHandlePersonMatches,
  exactPersonNameMatches,
  expiredHandlePersonMatches,
  mergePersonDirectoryMatches,
  personIdentityTemporalRole,
} from "@/lib/agent-person-resolution";
import {
  relationshipIntegrationFetch,
  WORKSPACE_SESSION_EXPIRED_EVENT,
} from "@/components/workspace-session-request";
import { matchesTypeBox } from "@/lib/typebox-validation";
import type { AgentContactDraft } from "@/lib/agent-contact-intake";
import styles from "./agent-create-person-card.module.css";

// Every resource POST keeps its own stable request identity: the request ID
// (server idempotency) and the client-attested observation time travel
// together. Both survive same-intent retries and reset together when the
// draft intent changes, so a retry can never invent a new observation time or
// duplicate an already-committed person or note.
type ResourceRequestIdentity = { requestId: string; capturedAt: string };
// A dispatched request is frozen (identity + exact body + continuation data)
// before its first byte leaves. A lost response leaves the outcome UNKNOWN;
// the only recovery is an explicit retry of the exact same request. Recovery
// state is in memory only — the form warns before a reload/close loses it and
// never claims a rollback.
type FrozenRequestBase = {
  identity: ResourceRequestIdentity;
  body: Record<string, unknown>;
};
type FrozenRequest =
  | (FrozenRequestBase & {
      kind: "source";
      personLabel: string;
      contextLabel: string;
      outcome: AgentPersonOutcome;
      resumeClue: boolean;
    })
  | (FrozenRequestBase & { kind: "clue" })
  | (FrozenRequestBase & { kind: "defer" });
type DispatchOutcome =
  | { outcome: "committed"; receipts: ResourceCaptureResponse[] }
  | { outcome: "rejected"; message: string | null }
  | { outcome: "blocked"; message: string }
  | { outcome: "unknown" };
const CLUE_REJECTED_MESSAGE =
  "关系来源已保存，但已确认身份线索未保存。请审阅或修改线索后重试，也可直接打开已保存的人物。";
const SESSION_BLOCKED_MESSAGE =
  "登录状态已变化，已停止提交。请重新打开工作台核实后继续。";
const WORKSPACE_DISPLACED_MESSAGE =
  "工作台状态已变化或登录已过期，已停止提交。请重新打开工作台核实后继续。";
const WORKSPACE_CONTEXT_MESSAGE =
  "未找到工作台上下文，已停止提交。请重新打开工作台后再试。";
const SETTLE_FAILED_MESSAGE =
  "内容已保存，但打开目标页面未成功。可重试打开，或关闭后从对应列表进入核实。";
const UNEXPECTED_STOP_MESSAGE =
  "发生未预期问题，已停止提交以避免重复写入。请关闭后核实记录。";
const UNKNOWN_NAVIGATE_WARNING =
  "提交结果未知：内容可能已保存，也可能没有。离开不会撤销任何已提交内容；本页的“重试核实”会失效，离开后请自行核实记录。仍要离开？";
const PENDING_NAVIGATE_WARNING =
  "正在提交中，离开后本页无法继续跟踪结果。离开不会撤销任何已提交内容。仍要离开？";
// A completed write is acknowledged and sealed BEFORE any host callback: a
// throwing callback must never unlock it into a new-intent duplicate. The
// stored completion allows a safe re-open.
type SettledCompletion =
  | {
      kind: "person";
      scope: RelationshipScope;
      receipts: ResourceCaptureResponse[];
      outcome: AgentPersonOutcome;
    }
  | { kind: "review"; caseId: string };

function workspaceScopeValue(): string | null {
  return (
    (typeof document !== "undefined"
      ? document
          .querySelector<HTMLElement>("[data-workspace-scope]")
          ?.dataset.workspaceScope?.trim()
      : null) || null
  );
}

// Committed is declared only on structurally valid receipts that are provably
// associated with this frozen request (validated schema, matching
// client_resource_id, matching existing person/context scope, matching
// candidate scope). Anything else stays UNKNOWN with the exact request
// retained — never a bare cast of an arbitrary array.
function validatedReceipts(
  request: FrozenRequest,
  payload: unknown,
): ResourceCaptureResponse[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const receipts = (payload as { receipts?: unknown }).receipts;
  // This form submits exactly one resource per request.
  if (!Array.isArray(receipts) || receipts.length !== 1) {
    return null;
  }
  const expectedClientResourceId = `web-resource:${request.identity.requestId}`;
  for (const receipt of receipts) {
    if (!matchesTypeBox(ResourceCaptureResponseSchema, receipt)) {
      return null;
    }
    const capture = receipt as ResourceCaptureResponse;
    if (capture.resource.client_resource_id !== expectedClientResourceId) {
      return null;
    }
  }
  const first = receipts[0] as ResourceCaptureResponse;
  const body = request.body;
  if (request.kind === "source") {
    if (
      !first.identity.person_id ||
      !first.identity.relationship_context_id
    ) {
      return null;
    }
    if (
      typeof body.person_id === "string" &&
      first.identity.person_id !== body.person_id
    ) {
      return null;
    }
    if (
      typeof body.relationship_context_id === "string" &&
      first.identity.relationship_context_id !==
        body.relationship_context_id
    ) {
      return null;
    }
    return receipts as ResourceCaptureResponse[];
  }
  if (request.kind === "clue") {
    if (
      first.identity.person_id !== body.person_id ||
      first.identity.relationship_context_id !==
        body.relationship_context_id
    ) {
      return null;
    }
    return receipts as ResourceCaptureResponse[];
  }
  const candidates = body.candidate_person_ids;
  if (
    !first.identity.resolution_case_id ||
    !Array.isArray(candidates) ||
    candidates.length === 0
  ) {
    return null;
  }
  const candidateSet = new Set(candidates as string[]);
  if (
    first.identity.person_id !== null &&
    !candidateSet.has(first.identity.person_id)
  ) {
    return null;
  }
  const echoed = first.identity.candidate_person_ids;
  if (
    echoed.length !== candidateSet.size ||
    echoed.some((id) => !candidateSet.has(id))
  ) {
    return null;
  }
  return receipts as ResourceCaptureResponse[];
}
// Frozen after the first source commits: partial-success recovery may only
// complete the missing confirmed clue against this exact saved identity and
// these frozen labels — never create another person or note, and never
// retarget the committed person from a later directory search.
type CommittedPersonSource = {
  scope: RelationshipScope;
  receipt: ResourceCaptureResponse;
  outcome: AgentPersonOutcome;
};
function ensureRequestIdentity(ref: {
  current: ResourceRequestIdentity | null;
}): ResourceRequestIdentity {
  ref.current ??= {
    requestId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
  };
  return ref.current;
}

function identityHandleLabel(type: IdentityHandleType) {
  switch (type) {
    case "email":
      return "邮箱";
    case "phone":
      return "电话";
    case "wechat":
      return "WeChat";
    case "linkedin_url":
      return "LinkedIn";
    case "public_profile_url":
      return "公开资料页";
    case "source_native_id":
      return "来源 ID";
  }
}
function personInitials(value: string) {
  const segments = value.trim().split(/\s+/);
  if (segments.length === 1) {
    return value.slice(0, 2).toUpperCase();
  }
  return segments
    .map((segment) => segment[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function AgentCreatePersonCard({
  currentPersonId,
  initialDraft,
  onCancel,
  onCommitted,
  onDeferred,
  onReviewDuplicates,
}: {
  currentPersonId?: string;
  initialDraft?: AgentContactDraft | null;
  onCancel: () => void;
  onCommitted: (
    scope: RelationshipScope,
    receipts: ResourceCaptureResponse[],
    outcome:
      | "created_person"
      | "created_relationship_context"
      | "reused_relationship",
  ) => void;
  onDeferred: (caseId: string) => void;
  onReviewDuplicates?: () => void;
}) {
  const sourceRequestRef = useRef<ResourceRequestIdentity | null>(null);
  const handleRequestRef = useRef<ResourceRequestIdentity | null>(null);
  const deferRequestRef = useRef<ResourceRequestIdentity | null>(null);
  function resetDraftRequests() {
    sourceRequestRef.current = null;
    handleRequestRef.current = null;
    deferRequestRef.current = null;
  }
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  const [name, setName] = useState(initialDraft?.name ?? "");
  const [identityClue, setIdentityClue] = useState(
    initialDraft?.identityClue ?? "",
  );
  const [identityClueConfirmed, setIdentityClueConfirmed] =
    useState(false);
  const [contextLabel, setContextLabel] = useState(
    initialDraft?.relationshipContext ?? "",
  );
  const [firstNote, setFirstNote] = useState(
    initialDraft?.sourceNote ?? "",
  );
  const [matches, setMatches] = useState<PersonDirectoryItem[]>([]);
  const [lookupState, setLookupState] = useState<
    "error" | "idle" | "loading" | "ready"
  >(initialDraft?.name || initialDraft?.identityClue ? "loading" : "idle");
  const [lookupRevision, setLookupRevision] = useState(0);
  const [target, setTarget] = useState<AgentPersonTarget>({
    mode: "new_person",
  });
  const [differentPersonConfirmed, setDifferentPersonConfirmed] =
    useState(false);
  const [identityDetailsOpen, setIdentityDetailsOpen] = useState(
    !initialDraft || !initialDraft.name || !initialDraft.relationshipContext,
  );
  const [sourceDetailsOpen, setSourceDetailsOpen] = useState(
    !initialDraft ||
      !initialDraft.relationshipContext ||
      !initialDraft.sourceNote,
  );
  const [showAllMatches, setShowAllMatches] = useState(false);
  const [committedSource, setCommittedSource] =
    useState<CommittedPersonSource | null>(null);
  // Explicit request-outcome tracking: pending in flight, or unknown after a
  // lost/malformed response. Edits and target changes lock while set.
  const submitLockRef = useRef(false);
  const [trackedRequest, setTrackedRequest] = useState<{
    phase: "pending" | "unknown";
    request: FrozenRequest;
  } | null>(null);
  // Account/session transitions fail closed; a known-committed but unusable
  // source seals the form against duplicate writes.
  const [sessionBlockedState, setSessionBlocked] = useState(false);
  const [sealed, setSealed] = useState(false);
  // Missing workspace scope fails closed (render-derived; every dispatch
  // re-checks through admissionState()).
  const scopeMissing = workspaceScopeValue() === null;
  const sessionBlocked = sessionBlockedState || scopeMissing;
  // Mount admission: workspace identity captured once, alive only while
  // mounted and unexpired. Late continuations from a dead admission never
  // dispatch POSTs or invoke host callbacks.
  const mountedRef = useRef(false);
  const navigationEndedRef = useRef(false);
  const admissionRef = useRef<{ scope: string } | null>(null);
  // Acknowledged completion, sealed before host callbacks.
  const [completed, setCompleted] = useState<SettledCompletion | null>(
    null,
  );
  const [settleFailed, setSettleFailed] = useState(false);
  const noticeRef = useRef<HTMLDivElement | null>(null);
  const requestTracked = trackedRequest !== null;
  const editsLocked =
    requestTracked ||
    sessionBlocked ||
    sealed ||
    Boolean(completed) ||
    Boolean(committedSource);
  const clueLocked = requestTracked || sessionBlocked || sealed;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (error) {
      errorRef.current?.focus();
    }
  }, [error]);
  useEffect(() => {
    // Warn before reload/close loses the in-memory recovery state. Browser
    // history traversal is not cancelable; the persistent notice names that
    // limitation and the separate popstate guard ends continuation promptly.
    if (!trackedRequest) {
      return;
    }
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [trackedRequest]);
  useEffect(() => {
    // Mount admission: capture the workspace identity once. Missing scope
    // fails closed; the session-expired event fails closed too.
    mountedRef.current = true;
    const scope = workspaceScopeValue();
    admissionRef.current = scope ? { scope } : null;
    const onExpired = () => {
      admissionRef.current = null;
      setSessionBlocked(true);
      setError(SESSION_BLOCKED_MESSAGE);
    };
    window.addEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, onExpired);
    return () => {
      mountedRef.current = false;
      admissionRef.current = null;
      window.removeEventListener(
        WORKSPACE_SESSION_EXPIRED_EVENT,
        onExpired,
      );
    };
  }, []);
  useEffect(() => {
    // The unknown-outcome recovery decision is the primary next step: give
    // it focus, not only errors.
    if (trackedRequest?.phase === "unknown") {
      noticeRef.current?.focus();
    }
  }, [trackedRequest]);
  useEffect(() => {
    if (!trackedRequest) {
      return;
    }
    // Next.js client-side navigation bypasses beforeunload: warn explicitly
    // on link navigation while a request is pending or unknown. Declining
    // prevents the navigation without unmount or any POST; accepting lets it
    // proceed and the dead admission blocks continuation POSTs.
    const currentRoute = window.location.pathname + window.location.search;
    const endAdmission = () => {
      navigationEndedRef.current = true;
      admissionRef.current = null;
      setSealed(true);
      setError("已结束本次创建流程，后续提交已停止。已发出的内容可能已保存，请从人物列表核实。");
    };
    const historyGuard = () => {
      if (window.location.pathname + window.location.search !== currentRoute) {
        endAdmission();
      }
    };
    const linkGuard = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        (anchor.target && anchor.target !== "_self") ||
        anchor.hasAttribute("download")
      ) {
        return;
      }
      const destination = new URL(anchor.href, window.location.href);
      if (
        destination.origin === window.location.origin &&
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search &&
        destination.hash
      ) {
        return;
      }
      const proceed = window.confirm(
        trackedRequest.phase === "unknown"
          ? UNKNOWN_NAVIGATE_WARNING
          : PENDING_NAVIGATE_WARNING,
      );
      if (!proceed) {
        event.preventDefault();
        event.stopPropagation();
      } else {
        // A client transition can retain this component until the destination
        // loads. Revoke admission now, not at the later unmount.
        endAdmission();
      }
    };
    document.addEventListener("click", linkGuard, true);
    window.addEventListener("popstate", historyGuard, true);
    return () => {
      document.removeEventListener("click", linkGuard, true);
      window.removeEventListener("popstate", historyGuard, true);
    };
  }, [trackedRequest]);
  const parsedIdentityClue = useMemo(
    () => parseIdentityHandleQuery(identityClue),
    [identityClue],
  );
  const maskedIdentityClue = parsedIdentityClue
    ? maskIdentityHandle(
        parsedIdentityClue.type,
        parsedIdentityClue.value,
      )
    : null;
  const exactMatches = exactPersonNameMatches(name, matches);
  const currentPersonMatches = currentPersonId
    ? exactMatches.some((person) => person.id === currentPersonId)
    : false;
  const duplicateMatches = currentPersonMatches
    ? exactMatches.filter((person) => person.id !== currentPersonId)
    : [];
  const confirmedHandleMatches =
    confirmedHandlePersonMatches(matches);
  const expiredHandleMatches = expiredHandlePersonMatches(matches);
  const visibleMatches = showAllMatches ? matches : matches.slice(0, 3);
  const newPersonAllowed = canCreateDistinctPerson({
    differentPersonConfirmed,
    lookupState,
    matches,
    name,
  });
  const targetHasContext =
    target.mode === "existing_context" ||
    contextLabel.trim().length > 0;
  const targetSelectable =
    target.mode === "new_person" ||
    canSelectPersonForIdentityClue(target.person, matches);
  const identityChoiceNeedsReview =
    lookupState === "ready" &&
    matches.length > 0 &&
    target.mode === "new_person" &&
    (matches.length > 1 || confirmedHandleMatches.length > 0);
  const ready =
    name.trim().length > 0 &&
    (identityClue.trim().length === 0 ||
      parsedIdentityClue !== null) &&
    targetHasContext &&
    targetSelectable &&
    firstNote.trim().length > 0 &&
    (target.mode !== "new_person" || newPersonAllowed);
  // Keep the complete match set; the intake contract admits 2–20 candidates.
  const reviewCandidateCountValid = matches.length >= 2 && matches.length <= 20;
  const reviewReady =
    identityChoiceNeedsReview &&
    reviewCandidateCountValid &&
    name.trim().length > 0 &&
    contextLabel.trim().length > 0 &&
    firstNote.trim().length > 0;

  useEffect(() => {
    const nameQuery = name.normalize("NFKC").trim();
    const clueQuery = parsedIdentityClue
      ? identityClue.normalize("NFKC").trim()
      : "";
    const queries = [...new Set([nameQuery, clueQuery].filter(Boolean))];
    if (queries.length === 0) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void Promise.all(
        queries.map(async (query) => {
          const response = await relationshipIntegrationFetch(
            "/api/local-integration/people/search",
            {
              method: "POST",
              cache: "no-store",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query }),
              signal: controller.signal,
            },
          );
          const payload = (await response.json()) as
            | { people: PersonDirectoryItem[] }
            | { message?: string };
          if (!response.ok || !("people" in payload)) {
            throw new Error(
              "message" in payload && payload.message
                ? payload.message
                : "无法检查现有人物。",
            );
          }
          return payload.people;
        }),
      )
        .then((groups) => {
          setMatches(mergePersonDirectoryMatches(groups));
          setLookupState("ready");
        })
        .catch((caught: unknown) => {
          if (
            caught instanceof DOMException &&
            caught.name === "AbortError"
          ) {
            return;
          }
          setLookupState("error");
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [
    identityClue,
    lookupRevision,
    name,
    parsedIdentityClue,
  ]);

  function frozenSourceRequest(): Extract<
    FrozenRequest,
    { kind: "source" }
  > {
    const identity = ensureRequestIdentity(sourceRequestRef);
    return {
      kind: "source",
      identity,
      body: {
        request_id: identity.requestId,
        captured_at: identity.capturedAt,
        ...agentPersonScopeFields(target, name, contextLabel),
        type: "note",
        title:
          target.mode === "new_person"
            ? "你提供的首条背景"
            : "智能助理附加的、由你提供的背景",
        value: firstNote.trim(),
      },
      personLabel:
        target.mode === "new_person"
          ? name.trim()
          : target.person.display_label,
      contextLabel:
        target.mode === "existing_context"
          ? target.relationshipContext.display_label
          : contextLabel.trim(),
      outcome: agentPersonOutcome(target),
      resumeClue: Boolean(identityClueConfirmed && parsedIdentityClue),
    };
  }

  function frozenClueRequest(
    scope: RelationshipScope,
  ): Extract<FrozenRequest, { kind: "clue" }> {
    const identity = ensureRequestIdentity(handleRequestRef);
    return {
      kind: "clue",
      identity,
      body: {
        request_id: identity.requestId,
        captured_at: identity.capturedAt,
        scope_mode: "existing",
        person_id: scope.person.id,
        relationship_context_id: scope.relationship_context.id,
        type: "contact",
        value: identityClue.trim(),
        identity_clue_confirmed: true,
      },
    };
  }

  function frozenDeferRequest(): Extract<
    FrozenRequest,
    { kind: "defer" }
  > {
    const identity = ensureRequestIdentity(deferRequestRef);
    return {
      kind: "defer",
      identity,
      body: {
        request_id: identity.requestId,
        captured_at: identity.capturedAt,
        scope_mode: "identity_candidates",
        candidate_person_ids: matches.map((person) => person.id),
        contact_name: name.trim(),
        relationship_context_label: contextLabel.trim(),
        type: "note",
        title: "你提供的、等待确认身份的来源",
        value: firstNote.trim(),
      },
    };
  }

  function admissionState(): "alive" | "unmounted" | "displaced" {
    if (!mountedRef.current || navigationEndedRef.current) {
      return "unmounted";
    }
    const admission = admissionRef.current;
    if (!admission) {
      return "displaced";
    }
    const scope = workspaceScopeValue();
    if (!scope || scope !== admission.scope) {
      return "displaced";
    }
    return "alive";
  }

  async function dispatchFrozen(
    request: FrozenRequest,
    replay: boolean,
  ): Promise<DispatchOutcome> {
    try {
      const response = await relationshipIntegrationFetch(
        "/api/local-integration/resources",
        {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request.body),
        },
      );
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        // Malformed body: the outcome is uncertain. Never claim "unsaved"
        // and never surface a raw parse or transport error.
        return { outcome: "unknown" };
      }
      const message =
        payload &&
        typeof payload === "object" &&
        typeof (payload as { message?: unknown }).message === "string"
          ? (payload as { message: string }).message
          : null;
      if (response.ok) {
        // Committed only with structurally valid receipts provably bound to
        // this frozen request; anything else stays unknown.
        const receipts = validatedReceipts(request, payload);
        return receipts
          ? { outcome: "committed", receipts }
          : { outcome: "unknown" };
      }
      if (response.status === 401 || response.status === 403) {
        // Account/session transitions fail closed: stop mutating entirely.
        return {
          outcome: "blocked",
          message: SESSION_BLOCKED_MESSAGE,
        };
      }
      // A definitive client/validation rejection (a real 4xx answer except a
      // request timeout) means the server did not commit: safe to correct —
      // but only on a FIRST attempt. A 4xx answer to the replay of an unknown
      // request (409 idempotency conflict, withdrawn resource, …) is no proof
      // the original never committed: the uncertainty stays.
      if (
        !replay &&
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408
      ) {
        return { outcome: "rejected", message };
      }
      return { outcome: "unknown" };
    } catch {
      // Transport failure: the server may or may not have committed.
      return { outcome: "unknown" };
    }
  }

  async function dispatchAndTrack(
    request: FrozenRequest,
    replay: boolean,
  ): Promise<DispatchOutcome> {
    if (admissionState() !== "alive") {
      // Fail closed before any additional POST.
      return {
        outcome: "blocked",
        message: WORKSPACE_DISPLACED_MESSAGE,
      };
    }
    setTrackedRequest({ phase: "pending", request });
    const result = await dispatchFrozen(request, replay);
    if (admissionState() === "unmounted") {
      // A late continuation must never reset state of any newer attempt.
      return result;
    }
    if (
      result.outcome === "unknown" ||
      (result.outcome === "blocked" && replay)
    ) {
      // Blocked replays keep the uncertainty warning: no rollback implied.
      setTrackedRequest({ phase: "unknown", request });
    } else {
      setTrackedRequest(null);
    }
    return result;
  }

  function withSubmitLock(action: () => Promise<void>): Promise<void> {
    // Synchronous guard: rapid double clicks admit exactly one submission.
    if (submitLockRef.current) {
      return Promise.resolve();
    }
    submitLockRef.current = true;
    setBusy(true);
    setError("");
    return action()
      .catch(() => {
        // Unexpected internal failure: seal instead of leaving an editable
        // form that could duplicate a possibly committed write. Never
        // silent, never an unsaved claim.
        setSealed(true);
        setError(UNEXPECTED_STOP_MESSAGE);
      })
      .finally(() => {
        submitLockRef.current = false;
        setBusy(false);
      });
  }

  async function runSourceFlow(
    request: Extract<FrozenRequest, { kind: "source" }>,
    replay = false,
  ): Promise<void> {
    const result = await dispatchAndTrack(request, replay);
    if (admissionState() === "unmounted") {
      // Late continuation after unmount: no state, no POST, no callback.
      return;
    }
    if (result.outcome === "unknown") {
      return;
    }
    if (result.outcome === "blocked") {
      setSessionBlocked(true);
      setError(result.message);
      return;
    }
    if (result.outcome === "rejected") {
      setError(result.message ?? "无法保存关系来源。");
      return;
    }
    const first = result.receipts[0];
    if (
      !first?.identity.person_id ||
      !first.identity.relationship_context_id
    ) {
      // Defensive: validated receipts always carry these; seal anyway.
      setSealed(true);
      setError("打开人物页面前，此来源仍需完成身份审阅。");
      return;
    }
    const scope: RelationshipScope = {
      contract_version: first.contract_version,
      person: {
        id: first.identity.person_id,
        display_label: request.personLabel,
      },
      relationship_context: {
        id: first.identity.relationship_context_id,
        display_label: request.contextLabel,
      },
    };
    const saved: CommittedPersonSource = {
      scope,
      receipt: first,
      outcome: request.outcome,
    };
    if (request.resumeClue) {
      // Freeze the committed person, scope and labels before the clue
      // attempt: a clue failure is only ever recoverable as a clue retry
      // against this identity. dispatchAndTrack refuses the follow-up POST
      // when the admission died meanwhile.
      setCommittedSource(saved);
      await runClueFlow(frozenClueRequest(scope), saved);
      return;
    }
    settleCompletion({
      kind: "person",
      scope,
      receipts: result.receipts,
      outcome: request.outcome,
    });
  }

  async function runClueFlow(
    request: Extract<FrozenRequest, { kind: "clue" }>,
    saved: CommittedPersonSource,
    replay = false,
  ): Promise<void> {
    const result = await dispatchAndTrack(request, replay);
    if (admissionState() === "unmounted") {
      return;
    }
    if (result.outcome === "unknown") {
      return;
    }
    if (result.outcome === "blocked") {
      setSessionBlocked(true);
      setError(result.message);
      return;
    }
    if (result.outcome === "rejected") {
      // Definitively not saved: safe correction or omission stays possible
      // against the committed source.
      setError(CLUE_REJECTED_MESSAGE);
      return;
    }
    settleCompletion({
      kind: "person",
      scope: saved.scope,
      receipts: [saved.receipt, ...result.receipts],
      outcome: saved.outcome,
    });
  }

  async function runDeferFlow(
    request: Extract<FrozenRequest, { kind: "defer" }>,
    replay = false,
  ): Promise<void> {
    const result = await dispatchAndTrack(request, replay);
    if (admissionState() === "unmounted") {
      return;
    }
    if (result.outcome === "unknown") {
      return;
    }
    if (result.outcome === "blocked") {
      setSessionBlocked(true);
      setError(result.message);
      return;
    }
    if (result.outcome === "rejected") {
      setError(result.message ?? "无法保存未解决来源。");
      return;
    }
    const caseId =
      result.receipts[0]?.identity.resolution_case_id ?? null;
    if (!caseId) {
      setSealed(true);
      setError("来源已保存，但没有可继续处理的身份审阅案例。");
      return;
    }
    settleCompletion({ kind: "review", caseId });
  }

  async function commitPersonSource() {
    if (sealed || sessionBlocked) {
      return;
    }
    if (trackedRequest) {
      await retryTrackedRequest();
      return;
    }
    // After the first source committed, retries only complete the missing
    // confirmed clue against that exact saved identity: never a second
    // person or note, never a person retargeted by a later search.
    if (committedSource) {
      await completeSavedPerson();
      return;
    }
    if (!ready) {
      setError(
        lookupState === "error"
          ? "创建新人物前，请先检查现有人物。"
          : "请选择人物、关系背景和首个来源。",
      );
      return;
    }
    const request = frozenSourceRequest();
    await withSubmitLock(() => runSourceFlow(request));
  }

  async function completeSavedPerson() {
    const saved = committedSource;
    if (!saved || sealed || sessionBlocked) {
      return;
    }
    if (identityClueConfirmed && parsedIdentityClue) {
      const request = frozenClueRequest(saved.scope);
      await withSubmitLock(() => runClueFlow(request, saved));
      return;
    }
    // Omission path: completing without the clue performs no write at all.
    if (submitLockRef.current) {
      return;
    }
    submitLockRef.current = true;
    try {
      settleCompletion({
        kind: "person",
        scope: saved.scope,
        receipts: [saved.receipt],
        outcome: saved.outcome,
      });
    } finally {
      submitLockRef.current = false;
    }
  }

  function openSavedPerson() {
    if (
      !committedSource ||
      trackedRequest ||
      sealed ||
      sessionBlocked ||
      submitLockRef.current
    ) {
      return;
    }
    submitLockRef.current = true;
    try {
      settleCompletion({
        kind: "person",
        scope: committedSource.scope,
        receipts: [committedSource.receipt],
        outcome: committedSource.outcome,
      });
    } finally {
      submitLockRef.current = false;
    }
  }

  function settleCompletion(completion: SettledCompletion) {
    // Seal and store the acknowledged completion BEFORE any host callback:
    // a throwing callback must never unlock the write into a new-intent
    // duplicate, and the stored completion allows a safe re-open.
    setSealed(true);
    setCompleted(completion);
    setSettleFailed(false);
    invokeHostCallback(completion);
  }

  function invokeHostCallback(completion: SettledCompletion) {
    try {
      if (admissionState() !== "alive") {
        throw new Error(WORKSPACE_DISPLACED_MESSAGE);
      }
      if (completion.kind === "person") {
        onCommitted(
          completion.scope,
          completion.receipts,
          completion.outcome,
        );
      } else {
        onDeferred(completion.caseId);
      }
      setSettleFailed(false);
    } catch {
      // Never silent: the sealed form shows truthful copy and an explicit
      // re-open/exit path.
      setSettleFailed(true);
      setError(
        admissionState() === "alive"
          ? SETTLE_FAILED_MESSAGE
          : "内容已保存，但工作台状态已变化，未打开目标页面。请从对应列表进入核实。",
      );
    }
  }

  async function retryTrackedRequest() {
    const tracked = trackedRequest;
    if (
      !tracked ||
      tracked.phase !== "unknown" ||
      sealed ||
      sessionBlocked
    ) {
      return;
    }
    // The retry replays the exact frozen request. It never re-checks the
    // directory lookup, `ready`, or new_person permission: the frozen
    // identity may now appear in search results as its own committed person.
    const request = tracked.request;
    await withSubmitLock(async () => {
      if (request.kind === "source") {
        await runSourceFlow(request, true);
      } else if (request.kind === "clue") {
        const saved = committedSource;
        if (saved) {
          await runClueFlow(request, saved, true);
        }
      } else {
        await runDeferFlow(request, true);
      }
    });
  }

  async function deferIdentityReview() {
    if (sealed || sessionBlocked || trackedRequest) {
      return;
    }
    if (!reviewReady) {
      setError(
        "保存身份审阅前，请添加预期的关系背景和首个来源。",
      );
      return;
    }
    const request = frozenDeferRequest();
    await withSubmitLock(() => runDeferFlow(request));
  }

  function handleClose() {
    if (trackedRequest) {
      // Closing never implies rollback: say so, describe the exit, and warn
      // that the in-memory retry entry point is lost.
      const proceed = window.confirm(
        trackedRequest.phase === "unknown"
          ? "提交结果未知：内容可能已保存，也可能没有。关闭不会撤销任何已提交内容；本页的“重试核实”会失效，重新打开后请自行核实记录。仍要关闭？"
          : "正在提交中，关闭后本页无法继续跟踪结果。关闭不会撤销任何已提交内容。仍要关闭？",
      );
      if (!proceed) {
        return;
      }
    }
    navigationEndedRef.current = true;
    admissionRef.current = null;
    setSealed(true);
    onCancel();
  }

  // Copy is rendered from the actual request state — never a fixed
  // "no change" / "clue unsaved" claim during pending/unknown/blocked
  // uncertainty.
  function draftStateLine(): string {
    if (trackedRequest) {
      const kind = trackedRequest.request.kind;
      const uncertain = trackedRequest.phase === "unknown";
      if (kind === "source") {
        return uncertain
          ? "提交结果未知 · 内容可能已保存，尚未确认"
          : "正在提交 · 结果尚未确认";
      }
      const label =
        kind === "clue" ? "已确认身份线索" : "待身份审阅来源";
      return `首条来源已保存 · ${label}${
        uncertain ? "提交结果未知，可能已保存" : "正在提交"
      }`;
    }
    if (completed) {
      return "内容已保存 · 未再发生新的变化";
    }
    if (committedSource) {
      return "首条来源已保存 · 后续仅处理身份线索";
    }
    if (sealed) {
      return "操作已停止 · 内容状态请核实记录";
    }
    return "仅为提议 · 尚未发生任何变化";
  }

  return (
    <section
      aria-labelledby="agent-create-title"
      className="context-agent-create"
    >
      <header>
        <span>
          <UserPlus aria-hidden="true" size={16} />
        </span>
        <div>
          <strong id="agent-create-title">
            {initialDraft ? "新联系人草稿" : "创建前先确认人物身份"}
          </strong>
          <p>
            {initialDraft
              ? "智能助理从你的消息中提取了一个提议。任何内容变化前，请审阅身份结果。"
              : "先查找现有身份，再绑定一段关系和一个来源。"}
          </p>
        </div>
        <button
          aria-label="取消人物草稿"
          className="context-icon-button"
          disabled={busy}
          onClick={() => handleClose()}
          type="button"
        >
          <X aria-hidden="true" size={15} />
        </button>
      </header>
      {initialDraft ? (
        <div className="context-agent-create__draft-summary">
          <p>
            <strong>{name || "需要姓名"}</strong>
            <span>{contextLabel || "需要关系背景"}</span>
          </p>
          <small>{firstNote}</small>
          <i>{draftStateLine()}</i>
        </div>
      ) : null}
      {error || scopeMissing ? (
        <p
          className="context-agent-create__error"
          ref={errorRef}
          role="alert"
          tabIndex={-1}
        >
          {error || WORKSPACE_CONTEXT_MESSAGE}
        </p>
      ) : null}
      {trackedRequest ? (
        <div
          className="context-agent-create__pending"
          ref={noticeRef}
          role="status"
          tabIndex={-1}
        >
          <strong>
            {trackedRequest.phase === "pending"
              ? "正在提交…"
              : "提交结果未知"}
          </strong>
          <p>
            {trackedRequest.phase === "pending"
              ? "请稍候，不要关闭页面或重复提交。"
              : "这次提交的结果无法确认：内容可能已保存，也可能没有。已停止自动重发以避免重复写入；请用完全相同的内容重试核实。关闭或刷新不会撤销任何已提交内容。"}
          </p>
          {trackedRequest.phase === "unknown" ? (
            <button
              className="context-secondary-button"
              disabled={busy || sessionBlocked || sealed}
              onClick={() => void retryTrackedRequest()}
              type="button"
            >
              用相同内容重试核实
            </button>
          ) : null}
        </div>
      ) : null}
      {committedSource ? (
        <div className="context-agent-create__committed" role="status">
          <strong>
            已保存：{committedSource.scope.person.display_label} ·{" "}
            {committedSource.scope.relationship_context.display_label}
          </strong>
          <p>
            {trackedRequest && trackedRequest.request.kind === "clue"
              ? trackedRequest.phase === "unknown"
                ? "人物与首条来源已保存。已确认身份线索的提交结果未知，可能已保存；请先用相同内容重试核实，再决定修改或放弃。"
                : "人物与首条来源已保存。正在提交已确认身份线索，请稍候。"
              : "人物与首条来源已保存，不会重复创建或合并。下面仅剩尚未保存的已确认身份线索，可修改、取消确认或放弃。"}
          </p>
        </div>
      ) : null}
      <details
        className="context-agent-create__details"
        onToggle={(event) =>
          setIdentityDetailsOpen(event.currentTarget.open)
        }
        open={identityDetailsOpen}
      >
        <summary>{initialDraft ? "编辑已提取信息" : "联系人信息"}</summary>
      <label>
        <span>人物</span>
        <input
          autoComplete="off"
          disabled={editsLocked}
          maxLength={200}
          onChange={(event) => {
            const nextName = event.target.value;
            setName(nextName);
            setIdentityClueConfirmed(false);
            setMatches([]);
            setLookupState(
              nextName.normalize("NFKC").trim() ||
                identityClue.normalize("NFKC").trim()
                ? "loading"
                : "idle",
            );
            setTarget({ mode: "new_person" });
            setDifferentPersonConfirmed(false);
            setShowAllMatches(false);
            resetDraftRequests();
          }}
          placeholder="例如：陈雅宁"
          value={name}
        />
      </label>
      <label>
        <span>
          已知身份线索 <small>可选</small>
        </span>
        <input
          autoComplete="off"
          disabled={clueLocked}
          maxLength={500}
          onChange={(event) => {
            const nextClue = event.target.value;
            setIdentityClue(nextClue);
            setIdentityClueConfirmed(false);
            setMatches([]);
            setLookupState(
              name.normalize("NFKC").trim() ||
                nextClue.normalize("NFKC").trim()
                ? "loading"
                : "idle",
            );
            setTarget({ mode: "new_person" });
            setDifferentPersonConfirmed(false);
            setShowAllMatches(false);
            resetDraftRequests();
          }}
          placeholder="邮箱、电话、LinkedIn 网址或 wechat:ID"
          value={identityClue}
        />
        <small>
          仅用于账号范围内的查找；结果不会返回原始值。
        </small>
      </label>
      {identityClue.trim() && !parsedIdentityClue ? (
        <p className="context-agent-create__error">
          请使用邮箱、电话、公开资料网址或明确的“wechat:ID”。
        </p>
      ) : null}
      </details>
      <div
        className="context-agent-identity-check"
        data-state={
          committedSource
            ? "resolved"
            : trackedRequest
              ? "pending"
              : sessionBlocked || sealed
                ? "blocked"
                : lookupState
        }
      >
        <header>
          <span>身份检查</span>
          <i>
            {committedSource
              ? "已确定"
              : trackedRequest
                ? trackedRequest.phase === "pending"
                  ? "提交中"
                  : "待核实"
                : lookupState === "loading"
                  ? "检查中"
                  : lookupState === "ready"
                    ? `${matches.length} 个可能匹配`
                    : lookupState === "error"
                      ? "不可用"
                      : "必需"}
          </i>
        </header>
        {committedSource ? (
          <p>
            身份已确定为 {committedSource.scope.person.display_label} ·{" "}
            {committedSource.scope.relationship_context.display_label}
            。不会再根据新的查找结果更改、合并或重新绑定此人物。
          </p>
        ) : trackedRequest || sessionBlocked || sealed ? (
          <p>
            提交处理中或结果未核实，身份与范围已锁定，避免重复写入。
            可在下方通知中重试核实，或关闭本卡片；关闭不会撤销任何已提交内容。
          </p>
        ) : lookupState === "idle" ? (
          <p>
            选择新建或现有身份前，请输入姓名或已知身份线索。
          </p>
        ) : lookupState === "loading" ? (
          <p>
            <CircleNotch aria-hidden="true" className="spin" size={13} />
            仅在你的账号内查找。
          </p>
        ) : lookupState === "error" ? (
          <div className="context-agent-identity-error">
            <p>
              无法检查现有人物，已暂停创建新人物。
            </p>
            <button
              className="context-secondary-button"
              onClick={() => {
                setLookupState("loading");
                setLookupRevision((value) => value + 1);
              }}
              type="button"
            >
              重试身份检查
            </button>
          </div>
        ) : matches.length > 0 ? (
          <div className="context-agent-person-matches">
            <p>
              已确认账号标识是当前身份依据。过期标识仅作为审阅线索；绑定仍由你决定。
            </p>
            {visibleMatches.map((person) => {
              const temporalRole =
                personIdentityTemporalRole(person);
              const selectable =
                canSelectPersonForIdentityClue(person, matches);
              return (
                <article
                  data-selectable={selectable}
                  data-selected={
                    target.mode !== "new_person" &&
                    target.person.id === person.id
                  }
                  data-temporal-role={temporalRole}
                  key={person.id}
                >
                <header>
                  <span>{personInitials(person.display_label)}</span>
                  <p>
                    <strong>{person.display_label}</strong>
                    <small>
                      {person.context_count}{" "}
                      {person.context_count === 1
                        ? "段关系"
                        : "段关系"}{" "}
                      · {person.capture_count} 个来源
                    </small>
                  </p>
                  <i className="context-agent-temporal-status">
                    {temporalRole === "current" ? (
                      <>
                        <ShieldCheck aria-hidden="true" size={12} />
                        当前线索
                      </>
                    ) : temporalRole === "historical" ? (
                      <>
                        <Clock aria-hidden="true" size={12} />
                        历史线索
                      </>
                    ) : (
                      "仅姓名"
                    )}
                  </i>
                </header>
                <ul
                  aria-label={`${person.display_label} 的匹配原因`}
                  className="context-agent-match-reasons"
                >
                  {person.identity_matches.map((match) => (
                    <li
                      data-kind={match.kind}
                      key={
                        match.kind === "name"
                          ? "name"
                          : `${match.handle_type}:${match.display_hint}`
                      }
                    >
                      {match.kind === "name" ? (
                        <>仅姓名匹配</>
                      ) : match.kind === "expired_handle" ? (
                        <>
                          <Clock aria-hidden="true" size={12} />
                          已过期{" "}
                          {identityHandleLabel(match.handle_type)} ·{" "}
                          {match.display_hint} · 需要新来源
                        </>
                      ) : (
                        <>
                          <ShieldCheck
                            aria-hidden="true"
                            size={12}
                          />
                          已确认{" "}
                          {identityHandleLabel(match.handle_type)} ·{" "}
                          {match.display_hint}
                          {match.source_resource_id
                            ? " · 已关联来源"
                            : ""}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
                {temporalRole !== "name_only" ? (
                  <p className="context-agent-temporal-note">
                    {selectable
                      ? temporalRole === "current"
                        ? "当前已关联来源的权威身份。经你明确选择后，可在此附加新来源。"
                        : "当前没有归属者。只有结合新来源和你的明确选择，才能重新确认这条历史线索。"
                      : "仅用于对比。当另一个人持有当前归属时，不能将此来源附到这里。"}
                  </p>
                ) : null}
                <div>
                  {agentRelationshipContexts(person).map((context) => (
                    <button
                      data-active={
                        target.mode === "existing_context" &&
                        target.relationshipContext.id === context.id
                      }
                      disabled={!selectable}
                      key={context.id}
                      onClick={() => {
                        setTarget({
                          mode: "existing_context",
                          person,
                          relationshipContext: context,
                        });
                        setName(person.display_label);
                        setContextLabel(context.display_label);
                        setDifferentPersonConfirmed(false);
                        resetDraftRequests();
                      }}
                      type="button"
                    >
                      <CheckCircle aria-hidden="true" size={13} />
                      {context.display_label}
                    </button>
                  ))}
                  <button
                    data-active={
                      target.mode === "existing_person_new_context" &&
                      target.person.id === person.id
                    }
                    disabled={!selectable}
                    onClick={() => {
                      setTarget({
                        mode: "existing_person_new_context",
                        person,
                      });
                      setName(person.display_label);
                      setDifferentPersonConfirmed(false);
                      resetDraftRequests();
                    }}
                    type="button"
                  >
                    <Plus aria-hidden="true" size={13} />
                    新建关系
                  </button>
                </div>
                </article>
              );
            })}
            {matches.length > visibleMatches.length ? (
              <button
                className="context-agent-show-matches"
                onClick={() => setShowAllMatches(true)}
                type="button"
              >
                再显示 {matches.length - visibleMatches.length} 个可能匹配
              </button>
            ) : showAllMatches && matches.length > 3 ? (
              <button
                className="context-agent-show-matches"
                onClick={() => setShowAllMatches(false)}
                type="button"
              >
                收起匹配
              </button>
            ) : null}
            {duplicateMatches.length > 0 && onReviewDuplicates ? (
              <button
                className="context-agent-create-distinct"
                onClick={onReviewDuplicates}
                type="button"
              >
                审阅{duplicateMatches.length === 1 ? "可能重复项" : `${duplicateMatches.length} 个可能重复项`}
                <small>
                  打开可逆的合并预览；此联系人草稿不会直接合并任何内容。
                </small>
              </button>
            ) : null}
          </div>
        ) : (
          <p>
            没有找到匹配姓名或已确认身份线索的现有人物，可以创建新人物。
          </p>
        )}
        {!editsLocked &&
        lookupState === "ready" &&
        (exactMatches.length > 0 || expiredHandleMatches.length > 0) &&
        confirmedHandleMatches.length === 0 &&
        target.mode === "new_person" ? (
          <label className="context-agent-distinct-person">
            <input
              checked={differentPersonConfirmed}
              onChange={(event) => {
                setDifferentPersonConfirmed(event.target.checked);
                resetDraftRequests();
              }}
              type="checkbox"
            />
            <span>
              这与现有身份线索指向的不是同一个人
              <small>
                {expiredHandleMatches.length > 0
                  ? "这条线索曾有归属但已不再有效，因此必须确认。"
                  : "账号范围内已存在完全相同的姓名，因此必须确认。"}
              </small>
            </span>
          </label>
        ) : null}
        {lookupState === "ready" &&
        confirmedHandleMatches.length > 0 &&
        (Boolean(committedSource)
          ? !requestTracked
          : !editsLocked && target.mode === "new_person") ? (
          <div
            className="context-agent-handle-owner"
            role="note"
          >
            <ShieldCheck aria-hidden="true" size={15} />
            <p>
              <strong>
                当前归属：{" "}
                {confirmedHandleMatches
                  .map((person) => person.display_label)
                  .join(", ")}
              </strong>
              <small>
                {committedSource
                  ? `人物已固定为 ${committedSource.scope.person.display_label}。请核对这条线索是否属于此人；不确定时请取消确认，直接打开已保存的人物。`
                  : reviewCandidateCountValid
                    ? "请选择当前人物、移除线索，或将此来源保留为未解决。历史归属者仍可用于对比，但不能接收此来源。"
                    : "如果确认是同一人，请选择当前人物；否则先移除线索，再继续核对。身份未确认前，此来源不会保存。"}
              </small>
            </p>
          </div>
        ) : null}
        {!editsLocked && identityChoiceNeedsReview && matches.length > 20 ? (
          <p role="status">
            匹配到 {matches.length} 个人物。请补充姓名或身份线索以缩小范围，或先选择已核实的人物。
            当前不会提交待审阅来源，也不会省略候选人物。
          </p>
        ) : null}
        {!editsLocked &&
        lookupState === "ready" &&
        matches.length > 0 &&
        confirmedHandleMatches.length === 0 &&
        target.mode !== "new_person" ? (
          <button
            className="context-agent-create-distinct"
            onClick={() => {
              setTarget({ mode: "new_person" });
              setContextLabel("");
              setDifferentPersonConfirmed(false);
              resetDraftRequests();
            }}
            type="button"
          >
            改为创建另一个人
          </button>
        ) : null}
      </div>
      {parsedIdentityClue && maskedIdentityClue ? (
        <label className="context-agent-distinct-person">
          <input
            checked={identityClueConfirmed}
            disabled={
              clueLocked ||
              (!committedSource &&
                (lookupState !== "ready" || identityChoiceNeedsReview))
            }
            onChange={(event) => {
              setIdentityClueConfirmed(event.target.checked);
              handleRequestRef.current = null;
            }}
            type="checkbox"
          />
          <span>
            将 {maskedIdentityClue} 保存为已确认的
            {identityHandleLabel(parsedIdentityClue.type)}线索
            <small>
              {committedSource
                ? "身份已确定。这条线索只会附加到上面已保存的人物。"
                : identityChoiceNeedsReview
                  ? "确认这条线索前，请先选择身份。"
                  : "仅保存哈希、遮蔽提示、受治理来源和审阅期限，不保存原始值。邮箱、电话与微信线索每年复核。"}
            </small>
          </span>
        </label>
      ) : null}
      <details
        className="context-agent-create__details"
        onToggle={(event) => setSourceDetailsOpen(event.currentTarget.open)}
        open={sourceDetailsOpen}
      >
        <summary>关系与来源</summary>
        <label>
          <span>关系背景</span>
          <input
            autoComplete="off"
            disabled={
              editsLocked || target.mode === "existing_context"
            }
            maxLength={200}
            onChange={(event) => {
              setContextLabel(event.target.value);
              resetDraftRequests();
            }}
            placeholder="例如：合作项目 · 首次沟通"
            value={contextLabel}
          />
        </label>
        <label>
          <span>首个来源</span>
          <textarea
            disabled={editsLocked}
            maxLength={8_000}
            onChange={(event) => {
              setFirstNote(event.target.value);
              resetDraftRequests();
            }}
            placeholder="粘贴由你提供、可说明为何创建此关系的备注。"
            rows={3}
            value={firstNote}
          />
        </label>
      </details>
      <footer>
        <p>
          {completed
            ? "内容已保存；此处不会产生新的写入。"
            : trackedRequest
              ? "提交结果确认前内容已锁定。刷新、关闭或浏览器后退会失去本页的核实入口，不会撤销已提交内容；请先在此核实结果。"
              : committedSource
                ? "人物与首条来源已保存，不会重复写入；线索可修改、取消确认或放弃。"
                : target.mode === "existing_context"
                  ? "这会将备注附到所选的现有关系。"
                  : target.mode === "existing_person_new_context"
                    ? "这会保留现有人物，仅创建独立的关系背景。"
                    : "只有完成账号范围内的身份检查后，才会创建一个独立人物。"}{" "}
          它不会合并人物或联系任何人。
        </p>
        <div className="context-agent-create__footer-actions">
          {reviewReady && !editsLocked ? (
            <button
              className="context-secondary-button"
              disabled={busy}
              onClick={() => void deferIdentityReview()}
              type="button"
            >
              保存待身份审阅
            </button>
          ) : null}
          {completed && settleFailed ? (
            <button
              className="context-secondary-button"
              disabled={busy}
              onClick={() => invokeHostCallback(completed)}
              type="button"
            >
              重试打开
            </button>
          ) : null}
          {committedSource ? (
            <button
              className="context-secondary-button"
              disabled={busy || requestTracked || sealed || sessionBlocked}
              onClick={() => openSavedPerson()}
              type="button"
            >
              打开已保存的人物
            </button>
          ) : null}
          <button
            className={`context-primary-button context-primary-button--compact ${styles.primaryAction}`}
            onFocus={(event) => {
              if (event.currentTarget.matches(":focus-visible")) {
                event.currentTarget.scrollIntoView({
                  block: "nearest",
                  behavior: "instant",
                  inline: "nearest",
                });
              }
            }}
            disabled={
              busy ||
              requestTracked ||
              sealed ||
              sessionBlocked ||
              (committedSource
                ? !(
                    identityClue.trim().length === 0 ||
                    parsedIdentityClue !== null
                  )
                : !ready)
            }
            onClick={() => void commitPersonSource()}
            type="button"
          >
            {busy ? (
              <CircleNotch aria-hidden="true" className="spin" size={16} />
            ) : (
              <ArrowRight aria-hidden="true" size={16} />
            )}
            {busy
              ? "保存中"
              : committedSource
                ? identityClueConfirmed && parsedIdentityClue
                  ? "保存线索并完成"
                  : "完成并打开人物"
                : target.mode === "existing_context"
                  ? "附加来源"
                  : target.mode === "existing_person_new_context"
                    ? "添加关系"
                    : "创建新人物"}
          </button>
        </div>
      </footer>
    </section>
  );
}
