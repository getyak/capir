"use client";

import type {
  PersonDirectoryItem,
  PublicResearchResponse,
  RelationshipResourceDetail,
  RelationshipResourceListItem,
  ResourceCaptureResponse,
  SourceAuthorizationDecisionResponse,
} from "@talent-signal/contracts";
import {
  ArrowRight,
  ChatCircleDots,
  Check,
  CheckCircle,
  CircleNotch,
  FileImage,
  LinkSimple,
  PencilSimple,
  Plus,
  Prohibit,
  Quotes,
  ShieldCheck,
  Sparkle,
  Trash,
  UploadSimple,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type FocusEvent } from "react";
import styles from "./relationship-resource-composer.module.css";

import type { ConversationTranscriptMessage } from "@/lib/conversation-transcript";
import { ConversationTranscriptComposer } from "./conversation-transcript-composer";
import { fieldLabel, formatDate, reviewLabel, resourceKindLabel, resourceStateLabel, fragmentLocationLabel, fragmentReviewLabel, fragmentAttributionLabel } from "./relationship-display";
import {
  relationshipIntegrationFetch,
  relationshipIntegrationSessionExpired,
} from "@/components/workspace-session-request";

type ResourceMode = "conversation" | "note" | "document" | "url";

const relationshipResourceListRequests = new Map<
  string,
  Promise<RelationshipResourceListItem[]>
>();

export function loadRelationshipResourceList(
  personId: string,
  relationshipContextId: string,
  { fresh = false }: { fresh?: boolean } = {},
) {
  const query = new URLSearchParams({
    person_id: personId,
    relationship_context_id: relationshipContextId,
  });
  const key = query.toString();
  const existing = relationshipResourceListRequests.get(key);
  if (!fresh && existing) {
    return existing;
  }

  const request = relationshipIntegrationFetch(
    `/api/local-integration/resources?${query}`,
    { cache: "no-store" },
  ).then(async (response) => {
    const payload = (await response.json()) as
      | { resources: RelationshipResourceListItem[] }
      | { message?: string };
    if (!response.ok || !("resources" in payload)) {
      throw new Error(
        "message" in payload && payload.message
          ? payload.message
          : "无法加载关系来源。",
      );
    }
    return payload.resources;
  });

  if (!fresh) {
    relationshipResourceListRequests.set(key, request);
    const clear = () => {
      if (relationshipResourceListRequests.get(key) === request) {
        relationshipResourceListRequests.delete(key);
      }
    };
    void request.then(clear, clear);
  }
  return request;
}

/** Relationship changes retire the complete ephemeral reader and its drafts. */
export function RelationshipResourceComposer(props: Parameters<typeof ScopedRelationshipResourceComposer>[0]) {
  return <ScopedRelationshipResourceComposer key={JSON.stringify([props.personId, props.relationshipContextId])} {...props} />;
}

function ScopedRelationshipResourceComposer({
  personId,
  relationshipContextId,
  scopeLabel,
  onCommitted,
  onEvidenceChanged,
  onIdentityCorrected,
  onReviewCapture,
  onScreenshot,
}: {
  personId: string;
  relationshipContextId: string;
  scopeLabel: string;
  onCommitted: (receipts: ResourceCaptureResponse[]) => void;
  onEvidenceChanged: (
    announcement?: string,
    relationshipRemoved?: boolean,
  ) => void | Promise<void>;
  onIdentityCorrected: (input: {
    captureId: string;
    captureIdsRebound: number;
    personId: string;
    relationshipContextId: string;
  }) => Promise<"opened" | "session_expired" | "unavailable">;
  onReviewCapture: (captureId: string) => void | Promise<void>;
  onScreenshot: () => void;
}) {
  const reviewTitleRef = useRef<HTMLHeadingElement | null>(null);
  const sourceAuthorizationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteResourceTriggerRef = useRef<HTMLButtonElement | null>(null);
  function revealDecisionControl(event: FocusEvent<HTMLElement>) {
    const target = event.target;
    if (target instanceof HTMLElement && target.matches("button:focus-visible, input:focus-visible, textarea:focus-visible")) {
      target.scrollIntoView({ block: "nearest", behavior: "instant" });
    }
  }
  const sourceReadVersion = useRef(0);
  const readingTriggerRef = useRef<HTMLButtonElement | null>(null);
  const pendingReadingRef = useRef<{
    resource: RelationshipResourceDetail;
    trigger: HTMLButtonElement;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const requestCapturedAtRef = useRef<string | null>(null);
  const [mode, setMode] = useState<ResourceMode>("note");
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [transcriptMessages, setTranscriptMessages] = useState<
    ConversationTranscriptMessage[]
  >([]);
  const [transcriptAttributionReviewed, setTranscriptAttributionReviewed] =
    useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [documentKind, setDocumentKind] = useState<
    "resume" | "document"
  >("resume");
  const [saveDiscoveredLinks, setSaveDiscoveredLinks] = useState(false);
  const [busyOperation, setBusyOperation] = useState<string | null>(null);
  const busy = busyOperation !== null;
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{
    resources: number;
    linksFound: number;
    warnings: number;
  } | null>(null);
  const [resources, setResources] = useState<
    RelationshipResourceListItem[]
  >([]);
  const [selectedResource, setSelectedResource] =
    useState<RelationshipResourceDetail | null>(null);
  useEffect(() => {
    const pending = pendingReadingRef.current;
    pendingReadingRef.current = null;
    if (
      !pending || pending.resource !== selectedResource ||
      !pending.trigger.isConnected || document.activeElement !== pending.trigger
    ) return;
    const title = reviewTitleRef.current;
    title?.scrollIntoView({ block: "start", behavior: "instant" });
    title?.focus({ preventScroll: true });
  }, [selectedResource]);

  useEffect(() => () => {
    sourceReadVersion.current += 1;
    pendingReadingRef.current = null;
    readingTriggerRef.current = null;
  }, [personId, relationshipContextId]);

  const [claimEdits, setClaimEdits] = useState<Record<string, string>>({});
  const [resourceLoading, setResourceLoading] = useState(true);
  const [deleteResourceConfirm, setDeleteResourceConfirm] =
    useState(false);
  const [researchApproval, setResearchApproval] = useState(false);
  const [researchPageCount, setResearchPageCount] = useState(1);
  const [researchLinkDepth, setResearchLinkDepth] = useState(0);
  const [researchResult, setResearchResult] =
    useState<PublicResearchResponse | null>(null);
  const identityCorrectionRequestRef = useRef<string | null>(null);
  const [identityCorrectionOpen, setIdentityCorrectionOpen] =
    useState(false);
  const [identityPeople, setIdentityPeople] = useState<
    PersonDirectoryItem[]
  >([]);
  const [identityPeopleLoading, setIdentityPeopleLoading] =
    useState(false);
  const [identityTargetMode, setIdentityTargetMode] = useState<
    "existing" | "new"
  >("existing");
  const [identityTargetPersonId, setIdentityTargetPersonId] =
    useState("");
  const [identityTargetContextId, setIdentityTargetContextId] =
    useState("");
  const [identityNewPersonLabel, setIdentityNewPersonLabel] =
    useState("");
  const [identityNewContextLabel, setIdentityNewContextLabel] =
    useState("");
  const [identityCorrectionReason, setIdentityCorrectionReason] =
    useState("");
  const sourceAuthorizationRequestRef = useRef<string | null>(null);
  const [sourceAuthorizationOpen, setSourceAuthorizationOpen] =
    useState(false);
  const [sourceAuthorizationReason, setSourceAuthorizationReason] =
    useState("");
  const [
    sourceAuthorizationExpiresAt,
    setSourceAuthorizationExpiresAt,
  ] = useState("");

  const identityTargetPerson =
    identityPeople.find(
      (person) => person.id === identityTargetPersonId,
    ) ?? null;

  function resetIdentityCorrectionRequest() {
    identityCorrectionRequestRef.current = null;
  }

  function resetSourceAuthorizationDecision() {
    sourceAuthorizationRequestRef.current = null;
    setSourceAuthorizationReason("");
    setSourceAuthorizationExpiresAt("");
  }

  async function beginIdentityCorrection() {
    setDeleteResourceConfirm(false);
    setSourceAuthorizationOpen(false);
    resetSourceAuthorizationDecision();
    setIdentityCorrectionOpen(true);
    setIdentityPeopleLoading(true);
    setError("");
    try {
      const response = await relationshipIntegrationFetch(
        "/api/local-integration/people",
        { cache: "no-store" },
      );
      const payload = (await response.json()) as
        | { people: PersonDirectoryItem[] }
        | { message?: string };
      if (!response.ok || !("people" in payload)) {
        throw new Error(
          "message" in payload && payload.message
            ? payload.message
            : "无法加载现有人才。",
        );
      }
      const alternatives = payload.people.filter(
        (person) => person.id !== personId,
      );
      setIdentityPeople(alternatives);
      setIdentityTargetPersonId("");
      setIdentityTargetContextId("");
      setIdentityTargetMode(
        alternatives.length > 0 ? "existing" : "new",
      );
      resetIdentityCorrectionRequest();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "无法加载现有人才。",
      );
    } finally {
      setIdentityPeopleLoading(false);
    }
  }

  async function correctSelectedResourceIdentity() {
    if (!selectedResource || !identityCorrectionReason.trim()) {
      return;
    }
    const existingContext =
      identityTargetMode === "existing" &&
      identityTargetPerson?.contexts.find(
        (context) => context.id === identityTargetContextId,
      );
    const createsContext =
      identityTargetMode === "existing" &&
      identityTargetContextId === "__new__";
    const target =
      identityTargetMode === "existing" && identityTargetPerson
        ? {
            status: "existing_person" as const,
            person_id: identityTargetPerson.id,
            relationship_context: existingContext
              ? {
                  status: "existing" as const,
                  relationship_context_id: existingContext.id,
                }
              : {
                  status: "proposed" as const,
                  label: identityNewContextLabel.trim(),
                  purpose:
                    "将受治理来源更正到你选择的关系背景",
                },
          }
        : {
            status: "new_person" as const,
            display_label: identityNewPersonLabel.trim(),
            relationship_context: {
              status: "proposed" as const,
              label: identityNewContextLabel.trim(),
              purpose:
                "将受治理来源更正到新建人物及其关系背景",
            },
          };
    const targetReady =
      target.status === "existing_person"
        ? Boolean(
            identityTargetPerson &&
              (existingContext ||
                (createsContext && identityNewContextLabel.trim())),
          )
        : Boolean(
            identityNewPersonLabel.trim() &&
              identityNewContextLabel.trim(),
          );
    if (!targetReady) {
      return;
    }

    setBusyOperation("正在更正身份…");
    setError("");
    identityCorrectionRequestRef.current ??= crypto.randomUUID();
    try {
      const response = await relationshipIntegrationFetch(
        `/api/local-integration/captures/${selectedResource.resource.capture_id}/identity-corrections`,
        {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotency_key: identityCorrectionRequestRef.current,
            expected_capture_version:
              selectedResource.resource.capture_version,
            expected_person_id: personId,
            expected_relationship_context_id:
              relationshipContextId,
            reason: identityCorrectionReason.trim(),
            binding_basis:
              "你已检查此受治理来源，并明确选择更正后的人物与关系背景。",
            target,
          }),
        },
      );
      const payload = (await response.json()) as
        | {
            capture_ids_rebound: string[];
            claims_reopened: number;
            person_id: string;
            relationship_context_id: string;
          }
        | { message?: string };
      if (
        relationshipIntegrationSessionExpired(response.status, payload)
      ) {
        return;
      }
      if (!response.ok || !("person_id" in payload)) {
        throw new Error(
          "message" in payload && payload.message
            ? payload.message
            : "无法更正来源身份。",
        );
      }
      const readback = await onIdentityCorrected({
        captureId: selectedResource.resource.capture_id,
        captureIdsRebound: payload.capture_ids_rebound.length,
        personId: payload.person_id,
        relationshipContextId: payload.relationship_context_id,
      });
      if (readback === "unavailable") {
        setError(
          "身份更正已记录，但无法读回更正后的关系。请重新加载后再做其他决定。",
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "无法更正来源身份。",
      );
    } finally {
      setBusyOperation(null);
    }
  }

  async function loadResources() {
    setResourceLoading(true);
    try {
      setResources(
        await loadRelationshipResourceList(
          personId,
          relationshipContextId,
          { fresh: true },
        ),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "无法加载关系来源。",
      );
    } finally {
      setResourceLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    void loadRelationshipResourceList(personId, relationshipContextId)
      .then((resources) => {
        if (active) {
          setResources(resources);
        }
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "无法加载关系来源。",
          );
        }
      })
      .finally(() => {
        if (active) {
          setResourceLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [personId, relationshipContextId]);

  async function openResource(resourceId: string, trigger?: HTMLButtonElement) {
    const version = ++sourceReadVersion.current;
    pendingReadingRef.current = null;
    setBusyOperation((current) => current === "正在读取研究状态…" ? null : current);
    setError("");
    try {
      const response = await relationshipIntegrationFetch(
        `/api/local-integration/resources?resource_id=${encodeURIComponent(
          resourceId,
        )}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as
        | RelationshipResourceDetail
        | { message?: string };
      if (!response.ok || !("fragments" in payload)) {
        throw new Error(
          "message" in payload && payload.message
            ? payload.message
            : "无法打开来源依据。",
        );
      }
      if (version !== sourceReadVersion.current) return;
      if (trigger) {
        readingTriggerRef.current = trigger;
        pendingReadingRef.current = { resource: payload, trigger };
      }
      setSelectedResource(payload);
      setClaimEdits(
        Object.fromEntries(
          payload.claim_proposals.map((claim) => [
            claim.id,
            claim.reviewed_value ?? claim.proposed_value ?? "",
          ]),
        ),
      );
      setResearchApproval(false);
      setResearchResult(null);
      setIdentityCorrectionOpen(false);
      setIdentityCorrectionReason("");
      resetIdentityCorrectionRequest();
      setSourceAuthorizationOpen(false);
      resetSourceAuthorizationDecision();
      if (
        payload.resource.kind === "public_url" &&
        payload.resource.input_channel !== "api_connector" &&
        payload.resource.source_locator
      ) {
        try {
          await refreshResearchStatus(payload.resource.id, () => version === sourceReadVersion.current);
        } catch (caught) {
          if (version === sourceReadVersion.current) setError(
            caught instanceof Error
              ? caught.message
              : "来源已打开，但无法恢复此前的研究状态。",
          );
        }
      }
    } catch (caught) {
      if (version === sourceReadVersion.current) setError(
        caught instanceof Error
          ? caught.message
          : "无法打开来源依据。",
      );
    }
  }

  async function loadLatestResearch(
    seedResourceId: string,
  ): Promise<PublicResearchResponse | null> {
    const query = new URLSearchParams({
      seed_resource_id: seedResourceId,
    });
    const response = await relationshipIntegrationFetch(
      `/api/local-integration/research?${query}`,
      { cache: "no-store" },
    );
    const payload = (await response.json()) as
      | PublicResearchResponse
      | null
      | { message?: string };
    if (!response.ok) {
      throw new Error(
        payload &&
          "message" in payload &&
          typeof payload.message === "string"
          ? payload.message
          : "无法恢复此前的公开研究状态。",
      );
    }
    if (payload === null || "task_id" in payload) {
      return payload;
    }
    throw new Error(
      "无法恢复此前的公开研究状态。",
    );
  }

  async function refreshResearchStatus(seedResourceId?: string, isCurrent = () => true) {
    const version = sourceReadVersion.current;
    const current = () => version === sourceReadVersion.current && isCurrent();
    const resourceId =
      seedResourceId ?? selectedResource?.resource.id;
    if (!resourceId) {
      return;
    }
    setBusyOperation("正在读取研究状态…");
    setError("");
    try {
      const result = await loadLatestResearch(resourceId);
      if (current()) setResearchResult(result);
    } catch (caught) {
      if (current()) setError(
        caught instanceof Error
          ? caught.message
          : "无法恢复此前的公开研究状态。",
      );
      throw caught;
    } finally {
      if (current()) setBusyOperation(null);
    }
  }

  async function researchSelectedResource() {
    if (
      !selectedResource ||
      selectedResource.resource.kind !== "public_url" ||
      !selectedResource.resource.source_locator
    ) {
      return;
    }
    let domain: string;
    try {
      domain = new URL(
        selectedResource.resource.source_locator,
      ).hostname.toLowerCase();
    } catch {
      setError("已保存的公开网址无效。")
      return;
    }
    setBusyOperation("正在查阅公开资料…");
    setError("");
    setResearchResult(null);
    try {
      const response = await relationshipIntegrationFetch(
        "/api/local-integration/research",
        {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
          request_id: crypto.randomUUID(),
          person_id: personId,
          relationship_context_id: relationshipContextId,
          seed_resource_id: selectedResource.resource.id,
          expected_seed_url:
            selectedResource.resource.source_locator,
          allowed_domain: domain,
          maximum_page_count: researchPageCount,
          maximum_link_depth: researchLinkDepth,
          }),
        },
      );
      const payload = (await response.json()) as
        | PublicResearchResponse
        | { message?: string };
      if (!response.ok || !("task_id" in payload)) {
        throw new Error(
          "message" in payload && payload.message
            ? payload.message
            : "无法完成有边界的公开研究。",
        );
      }
      setResearchResult(payload);
      setResearchApproval(false);
      await loadResources();
      onEvidenceChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "无法完成有边界的公开研究。",
      );
    } finally {
      setBusyOperation(null);
    }
  }

  async function decideFragment(
    fragmentId: string,
    currentStatus: "proposed" | "reviewed" | "rejected",
    decision: "reviewed" | "rejected",
  ) {
    setBusyOperation("正在保存提取审阅…");
    setError("");
    try {
      const response = await relationshipIntegrationFetch(
        `/api/local-integration/evidence-fragments/${fragmentId}/reviews`,
        {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotency_key: crypto.randomUUID(),
            expected_review_status: currentStatus,
            expected_last_review_id: null,
            decision,
            reason:
              decision === "reviewed"
                ? "你已将提取结果与可见来源进行比较。"
                : "你认为提取结果不可靠并予以驳回。",
          }),
        },
      );
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(
          payload.message ?? "无法保存依据审阅。",
        );
      }
      if (selectedResource) {
        await openResource(selectedResource.resource.id);
      }
      await loadResources();
      onEvidenceChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "无法保存依据审阅。",
      );
    } finally {
      setBusyOperation(null);
    }
  }

  async function decideClaim(
    claim: RelationshipResourceDetail["claim_proposals"][number],
    decision: "confirm" | "dismiss" | "leave_unresolved",
  ) {
    if (!selectedResource) {
      return;
    }
    const correctedValue = claimEdits[claim.id]?.trim() ?? "";
    if (decision === "confirm" && !correctedValue) {
      setError("请添加你打算确认的值。")
      return;
    }
    const resourceId = selectedResource.resource.id;
    setBusyOperation("正在保存事实决定…");
    setError("");
    try {
      const response = await relationshipIntegrationFetch(
        `/api/local-integration/resource-claims/${claim.id}/decisions`,
        {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotency_key: crypto.randomUUID(),
            expected_assertion_version: claim.version,
            ...(claim.review_token ? { expected_review_token: claim.review_token } : {}),
            decision,
            ...(decision === "confirm"
              ? { corrected_value: correctedValue }
              : {}),
          }),
        },
      );
      const payload = (await response.json()) as { message?: string };
      if (!response.ok) {
        throw new Error(
          payload.message ?? "无法保存事实决定。",
        );
      }
      await openResource(resourceId);
      await loadResources();
      onEvidenceChanged();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "无法保存事实决定。",
      );
    } finally {
      setBusyOperation(null);
    }
  }

  async function deleteSelectedResource() {
    if (!selectedResource) {
      return;
    }
    setBusyOperation("正在删除来源…");
    setError("");
    try {
      const response = await relationshipIntegrationFetch(
        `/api/local-integration/captures/${selectedResource.resource.capture_id}/deletion`,
        {
          method: "POST",
          cache: "no-store",
        },
      );
      const payload = (await response.json()) as {
        message?: string;
        compilation?: { status?: string } | null;
        compilation_error?: string | null;
      };
      if (!response.ok) {
        throw new Error(
          payload.message ?? "无法删除来源。",
        );
      }
      setSelectedResource(null);
      setDeleteResourceConfirm(false);
      const relationshipRemoved =
        !payload.compilation && !payload.compilation_error;
      const announcement = payload.compilation?.status === "published"
        ? "来源及相关内容已删除，关系记录已按剩余来源更新。"
        : payload.compilation_error
          ? `来源已删除，关系记录暂未更新：${payload.compilation_error}`
          : "来源及相关内容已删除，此关系已无可用记录。";
      if (relationshipRemoved) {
        onEvidenceChanged(announcement, true);
        return;
      }
      await loadResources();
      onEvidenceChanged(announcement);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "无法删除来源。",
      );
    } finally {
      setBusyOperation(null);
    }
  }

  async function decideSelectedSourceAuthorization() {
    if (!selectedResource || !sourceAuthorizationReason.trim()) {
      return;
    }
    const decision =
      selectedResource.resource.source_authorization_state ===
      "authorized"
        ? "revoke"
        : "restore";
    let authorizationExpiresAt: string | undefined;
    if (decision === "restore" && sourceAuthorizationExpiresAt) {
      const parsedExpiry = new Date(sourceAuthorizationExpiresAt);
      if (
        !Number.isFinite(parsedExpiry.getTime()) ||
        parsedExpiry <= new Date()
      ) {
        setError(
          "请选择未来的来源授权截止时间。",
        );
        return;
      }
      authorizationExpiresAt = parsedExpiry.toISOString();
    }
    const resourceId = selectedResource.resource.id;
    setBusyOperation("正在更新来源授权…");
    setError("");
    sourceAuthorizationRequestRef.current ??= crypto.randomUUID();
    try {
      const response = await relationshipIntegrationFetch(
        `/api/local-integration/captures/${selectedResource.resource.capture_id}/source-authorization`,
        {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            idempotency_key:
              sourceAuthorizationRequestRef.current,
            expected_capture_version:
              selectedResource.resource.capture_version,
            decision,
            reason: sourceAuthorizationReason.trim(),
            ...(authorizationExpiresAt
              ? {
                  authorization_expires_at:
                    authorizationExpiresAt,
                }
              : {}),
          }),
        },
      );
      const payload = (await response.json()) as
        | SourceAuthorizationDecisionResponse
        | { message?: string };
      if (!response.ok || !("authorization_state" in payload)) {
        throw new Error(
          "message" in payload && payload.message
            ? payload.message
            : "无法更改来源授权。",
        );
      }
      await openResource(resourceId);
      await loadResources();
      setSourceAuthorizationOpen(false);
      resetSourceAuthorizationDecision();
      const externalEffectFollowUp =
        payload.external_effects_requiring_follow_up > 0
          ? ` 仍有 ${payload.external_effects_requiring_follow_up} 项外部效果需要你跟进；不会把已经完成的事项表述为已撤销。`
          : "";
      const authorizationMessage =
        payload.decision === "revoke"
          ? payload.compilation
            ? `来源访问权限已撤销。已撤回 ${payload.states_retracted} 项确认状态，并使用仍获授权的来源更新关系记录。`
            : `来源访问权限已撤销。关系记录暂未更新：${
                payload.compilation_error ??
                "没有可发布的已授权关系记忆"
              }`
          : payload.compilation
            ? `来源访问权限已恢复，可供审阅。共有 ${payload.claims_reopened} 项声明待处理；此前的结论或行动均未自动恢复。`
            : `来源访问权限已恢复，可供审阅。关系记录暂未更新：${
                payload.compilation_error ??
                "恢复的依据仍需审阅"
              }`;
      await onEvidenceChanged(
        `${authorizationMessage}${externalEffectFollowUp}`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "无法更改来源授权。",
      );
    } finally {
      setBusyOperation(null);
    }
  }

  function resetRequest() {
    requestIdRef.current = null;
    requestCapturedAtRef.current = null;
    setReceipt(null);
    setError("");
  }

  async function submit() {
    if (
      (mode === "document" && !file) ||
      (mode === "conversation" &&
        (transcriptMessages.length === 0 ||
          !transcriptAttributionReviewed)) ||
      (mode !== "document" && mode !== "conversation" && !value.trim())
    ) {
      setError(
        mode === "document"
          ? "请选择一份简历或文档。"
          : mode === "conversation"
            ? "请分析对话转写并确认每个说话人标签。"
          : "请添加你希望保留的背景。",
      );
      return;
    }
    if (!requestIdRef.current) {
      requestIdRef.current = crypto.randomUUID();
      requestCapturedAtRef.current = new Date().toISOString();
    }
    const capturedAt = requestCapturedAtRef.current;
    if (!capturedAt) {
      setError("无法保留来源观察时间。")
      return;
    }
    setBusyOperation("正在保存资料…");
    setError("");
    try {
      let response: Response;
      if (mode === "document" && file) {
        const form = new FormData();
        form.set("request_id", requestIdRef.current);
        form.set("captured_at", capturedAt);
        form.set("person_id", personId);
        form.set("relationship_context_id", relationshipContextId);
        form.set("document_kind", documentKind);
        form.set(
          "save_discovered_links",
          saveDiscoveredLinks ? "true" : "false",
        );
        form.set("file", file);
        response = await relationshipIntegrationFetch(
          "/api/local-integration/resources",
          {
            method: "POST",
            body: form,
            cache: "no-store",
          },
        );
      } else {
        response = await relationshipIntegrationFetch(
          "/api/local-integration/resources",
          {
            method: "POST",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
            request_id: requestIdRef.current,
            captured_at: capturedAt,
            person_id: personId,
            relationship_context_id: relationshipContextId,
            type: mode,
            title: title.trim() || undefined,
            value: value.trim(),
            ...(mode === "conversation"
              ? {
                  transcript_messages: transcriptMessages,
                  attribution_reviewed: transcriptAttributionReviewed,
                }
              : {}),
            }),
          },
        );
      }
      const payload = (await response.json()) as
        | {
            receipts: ResourceCaptureResponse[];
            discovered_links: string[];
            parser_warnings: string[];
          }
        | { message?: string };
      if (!response.ok || !("receipts" in payload)) {
        throw new Error(
          "message" in payload && payload.message
            ? payload.message
            : "无法附加背景。",
        );
      }
      setReceipt({
        resources: payload.receipts.length,
        linksFound: payload.discovered_links.length,
        warnings: payload.parser_warnings.length,
      });
      setTitle("");
      setValue("");
      setTranscriptMessages([]);
      setTranscriptAttributionReviewed(false);
      setFile(null);
      onCommitted(payload.receipts);
      await loadResources();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "无法附加背景。",
      );
    } finally {
      setBusyOperation(null);
    }
  }

  return (
    <section
      aria-labelledby="add-context-title"
      className="context-resource-composer"
      id="relationship-resources"
    >
      <div className="context-resource-composer__heading">
        <div>
          <p className="eyebrow">添加背景</p>
          <h2 id="add-context-title">补充这位联系人的背景</h2>
          <p>
            附加到 {scopeLabel}。每个来源都保留各自的权限、依据位置与删除路径。
          </p>
        </div>
        <div aria-label="背景来源类型" role="tablist">
          <button
            aria-selected={mode === "note"}
            onClick={() => {
              setMode("note");
              resetRequest();
            }}
            role="tab"
            type="button"
          >
            <PencilSimple aria-hidden="true" size={16} />
            备注
          </button>
          <button
            aria-selected={mode === "conversation"}
            onClick={() => {
              setMode("conversation");
              resetRequest();
            }}
            role="tab"
            type="button"
          >
            <ChatCircleDots aria-hidden="true" size={16} />
            对话转写
          </button>
          <button
            aria-selected={mode === "document"}
            onClick={() => {
              setMode("document");
              resetRequest();
            }}
            role="tab"
            type="button"
          >
            <UploadSimple aria-hidden="true" size={16} />
            文件
          </button>
          <button
            aria-selected={mode === "url"}
            onClick={() => {
              setMode("url");
              resetRequest();
            }}
            role="tab"
            type="button"
          >
            <LinkSimple aria-hidden="true" size={16} />
            链接
          </button>
          <button onClick={onScreenshot} type="button">
            <FileImage aria-hidden="true" size={16} />
            截图
          </button>
        </div>
      </div>

      {mode === "conversation" ? (
        <ConversationTranscriptComposer
          attributionReviewed={transcriptAttributionReviewed}
          messages={transcriptMessages}
          onAttributionReviewedChange={(reviewed) => {
            setTranscriptAttributionReviewed(reviewed);
            resetRequest();
          }}
          onMessagesChange={(messages) => {
            setTranscriptMessages(messages);
            resetRequest();
          }}
          onTitleChange={(nextTitle) => {
            setTitle(nextTitle);
            resetRequest();
          }}
          onValueChange={(nextValue) => {
            setValue(nextValue);
            resetRequest();
          }}
          title={title}
          value={value}
        />
      ) : mode === "document" ? (
        <div className="context-resource-composer__document">
          <input
            accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
            className="sr-only"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              resetRequest();
            }}
            ref={fileInputRef}
            type="file"
          />
          <button
            className="context-resource-file"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <UploadSimple aria-hidden="true" size={20} />
            <span>
              <strong>{file?.name ?? "选择 PDF、DOCX、TXT 或 Markdown"}</strong>
              <small>
                {file
                  ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
                  : "原始文件仅临时解析，不会保留。"}
              </small>
            </span>
          </button>
          <label>
            <span>文档用途</span>
            <select
              onChange={(event) => {
                setDocumentKind(
                  event.target.value as "resume" | "document",
                );
                resetRequest();
              }}
              value={documentKind}
            >
              <option value="resume">简历</option>
              <option value="document">补充文档</option>
            </select>
          </label>
          <label className="context-resource-checkbox">
            <input
              checked={saveDiscoveredLinks}
              onChange={(event) => {
                setSaveDiscoveredLinks(event.target.checked);
                resetRequest();
              }}
              type="checkbox"
            />
            <span>
              将可见网址保存为研究种子
              <small>
                这不会抓取页面，也不会授权深度研究。
              </small>
            </span>
          </label>
        </div>
      ) : (
        <div className="context-resource-composer__text">
          <label>
            <span>{mode === "note" ? "备注标题" : "链接名称"}</span>
            <input
              maxLength={240}
              onChange={(event) => {
                setTitle(event.target.value);
                resetRequest();
              }}
              placeholder={
                mode === "note"
                  ? "例如：准备周四通话"
                  : "例如：作品集或公开资料页"
              }
              value={title}
            />
          </label>
          <label>
            <span>{mode === "note" ? "你的备注" : "公开网址"}</span>
            {mode === "note" ? (
              <textarea
                maxLength={40_000}
                onChange={(event) => {
                  setValue(event.target.value);
                  resetRequest();
                }}
                placeholder="你希望未来的自己记住什么？这始终是你撰写的备注，不是对方陈述。"
                rows={3}
                value={value}
              />
            ) : (
              <input
                maxLength={2_000}
                onChange={(event) => {
                  setValue(event.target.value);
                  resetRequest();
                }}
                placeholder="https://"
                type="url"
                value={value}
              />
            )}
          </label>
        </div>
      )}

      {error ? (
        <p className="context-resource-composer__error" role="alert">
          <Warning aria-hidden="true" size={16} />
          {error}
        </p>
      ) : null}
      {receipt ? (
        <p className="context-resource-composer__receipt" role="status">
          <CheckCircle aria-hidden="true" size={17} weight="fill" />
          已添加 {receipt.resources} 份资料
          {receipt.linksFound > 0
            ? ` · 发现 ${receipt.linksFound} 个可见链接`
            : ""}
          {receipt.warnings > 0
            ? ` · 保留 ${receipt.warnings} 条解析警告`
            : ""}
        </p>
      ) : null}
      <footer>
        <p>
          每个来源都可单独审阅；保存网址并不代表获准抓取。
        </p>
        <button
          className="context-primary-button context-primary-button--compact"
          disabled={
            busy ||
            (mode === "document"
              ? !file
              : mode === "conversation"
                ? transcriptMessages.length === 0 ||
                  !transcriptAttributionReviewed
                : !value.trim())
          }
          onClick={() => void submit()}
          type="button"
        >
          {busy ? (
            <CircleNotch aria-hidden="true" className="spin" size={17} />
          ) : (
            <Plus aria-hidden="true" size={17} />
          )}
          {busyOperation === "正在保存资料…" ? busyOperation : "附加到人物"}
        </button>
      </footer>

      <div className="context-resource-ledger">
        <div>
          <h3>此关系的来源</h3>
          <span>
            {resourceLoading
              ? "加载中……"
              : `${resources.length} 份资料`}
          </span>
        </div>
        {resources.length > 0 ? (
          <div className="context-resource-ledger__list">
            {resources.map((resource) => (
              <button
                data-state={resource.processing_state}
                key={resource.id}
                className={styles.readingTarget}
                onClick={(event) => void openResource(resource.id, event.currentTarget)}
                type="button"
              >
                <span>
                  {resource.kind === "personal_note" ? (
                    <PencilSimple aria-hidden="true" size={17} />
                  ) : resource.kind === "conversation_transcript" ? (
                    <ChatCircleDots aria-hidden="true" size={17} />
                  ) : resource.kind === "public_url" ? (
                    <LinkSimple aria-hidden="true" size={17} />
                  ) : (
                    <UploadSimple aria-hidden="true" size={17} />
                  )}
                </span>
                <p>
                  <strong>{resource.display_name}</strong>
                  <small>
                    {resourceKindLabel(resource.kind)} ·{" "}
                    {resource.source_authorization_state === "revoked"
                      ? "访问已撤销 · 依据已从记忆中排除"
                      : resource.source_authorization_state === "expired"
                        ? "授权已过期 · 依据已从记忆中排除"
                      : resource.proposed_fragment_count > 0
                      ? `${resource.proposed_fragment_count} 个摘录需要审阅`
                      : resource.pending_claim_count > 0
                        ? `${resource.pending_claim_count} 项事实需要审阅${
                            resource.conflicted_claim_count > 0
                              ? ` · ${resource.conflicted_claim_count} 项冲突`
                              : ""
                          }`
                      : "依据已审阅"}
                    {resource.duplicate_of_resource_id
                      ? " · 重复项已保留"
                      : ""}
                    {resource.source_authorization_state ===
                      "authorized" &&
                    resource.source_authorization_expires_at
                      ? ` · 授权至 ${formatDate(
                          resource.source_authorization_expires_at,
                        )}`
                      : ""}
                  </small>
                </p>
                <i>
                  {resourceStateLabel(resource)}
                </i>
              </button>
            ))}
          </div>
        ) : resourceLoading ? null : (
          <p className="context-resource-ledger__empty">
            尚未附加其他备注、对话转写、文件或链接。
          </p>
        )}
      </div>

      {selectedResource ? (
        <div className={`context-resource-review ${styles.review}`}>
          <header className={styles.reviewHeader}>
            <div className={styles.reviewTitle}>
              <p className="eyebrow">依据审阅</p>
              <h3 className={styles.readingTarget} ref={reviewTitleRef} tabIndex={-1}>
                {selectedResource.resource.display_name}
              </h3>
              <span>
                {resourceKindLabel(selectedResource.resource.kind)} ·{" "}
                {selectedResource.resource.source_authorization_state !==
                "authorized"
                  ? selectedResource.resource.source_authorization_state ===
                    "expired"
                    ? "授权已过期"
                    : "访问已撤销"
                  : `${selectedResource.fragments.length} 个可定位片段`}
              </span>
            </div>
            <div
              className={`context-resource-review__actions ${styles.reviewActions}`}
              onFocusCapture={(event) => {
                const target = event.target;
                if (target instanceof HTMLButtonElement && target.matches(":focus-visible")) {
                  target.scrollIntoView({ block: "nearest", behavior: "instant" });
                }
              }}
            >
              <button
                aria-expanded={identityCorrectionOpen}
                className="context-text-button"
                onClick={() => {
                  if (identityCorrectionOpen) {
                    setIdentityCorrectionOpen(false);
                  } else {
                    void beginIdentityCorrection();
                  }
                }}
                type="button"
              >
                <PencilSimple aria-hidden="true" size={15} />
                人物不对？
              </button>
              <button
                aria-expanded={sourceAuthorizationOpen}
                ref={sourceAuthorizationTriggerRef}
                className="context-text-button"
                onClick={() => {
                  setDeleteResourceConfirm(false);
                  setIdentityCorrectionOpen(false);
                  if (sourceAuthorizationOpen) {
                    setSourceAuthorizationOpen(false);
                    resetSourceAuthorizationDecision();
                  } else {
                    setSourceAuthorizationOpen(true);
                  }
                }}
                type="button"
              >
                {selectedResource.resource
                  .source_authorization_state === "authorized" ? (
                  <Prohibit aria-hidden="true" size={15} />
                ) : (
                  <ShieldCheck aria-hidden="true" size={15} />
                )}
                {selectedResource.resource
                  .source_authorization_state === "authorized"
                  ? "撤销访问"
                  : selectedResource.resource
                        .source_authorization_state === "expired"
                    ? "续期访问"
                    : "恢复访问"}
              </button>
              <button
                aria-expanded={deleteResourceConfirm}
                ref={deleteResourceTriggerRef}
                className="context-text-button"
                onClick={() => {
                  setSourceAuthorizationOpen(false);
                  resetSourceAuthorizationDecision();
                  setDeleteResourceConfirm((current) => !current);
                }}
                type="button"
              >
                <Trash aria-hidden="true" size={15} />
                删除来源
              </button>
              <button
                aria-label="关闭依据审阅"
                className="context-icon-button"
                onClick={() => {
                  sourceReadVersion.current += 1;
                  pendingReadingRef.current = null;
                  setBusyOperation((current) => current === "正在读取研究状态…" ? null : current);
                  const trigger = readingTriggerRef.current;
                  readingTriggerRef.current = null;
                  if (trigger?.isConnected) {
                    trigger.scrollIntoView({ block: "nearest", behavior: "instant" });
                    trigger.focus({ preventScroll: true });
                  }
                  setSelectedResource(null);
                  setClaimEdits({});
                  setDeleteResourceConfirm(false);
                  setResearchApproval(false);
                  setResearchResult(null);
                  setIdentityCorrectionOpen(false);
                  setIdentityCorrectionReason("");
                  resetIdentityCorrectionRequest();
                  setSourceAuthorizationOpen(false);
                  resetSourceAuthorizationDecision();
                }}
                type="button"
              >
                <X aria-hidden="true" size={17} />
              </button>
            </div>
          </header>
          {sourceAuthorizationOpen ? (
            <section
              className={`context-identity-correction ${styles.decision}`}
              onFocusCapture={revealDecisionControl}
            >
              <header>
                <div>
                  <p className="eyebrow">来源授权</p>
                  <h4>
                    {selectedResource.resource
                      .source_authorization_state === "authorized"
                      ? "从关系记忆中移除此来源。"
                      : selectedResource.resource
                            .source_authorization_state === "expired"
                        ? "续期此来源，使其重新成为可审阅依据。"
                        : "恢复此来源，使其重新成为可审阅依据。"}
                  </h4>
                </div>
                {selectedResource.resource
                  .source_authorization_state === "authorized" ? (
                  <Prohibit aria-hidden="true" size={19} />
                ) : (
                  <ShieldCheck aria-hidden="true" size={19} />
                )}
              </header>
              <p>
                {selectedResource.resource
                  .source_authorization_state === "authorized"
                  ? "撤销访问会隐藏依据、撤回依赖事实与待处理行动，并根据剩余已授权来源更新关系记录。来源不会被删除，因此之后可以恢复访问。"
                  : selectedResource.resource
                        .source_authorization_state === "expired"
                    ? "续期授权会重新显示受治理依据，但所有来源衍生声明都需重新由你审阅。此前事实、批准和行动保持撤回。"
                    : "恢复访问会重新显示受治理依据，但所有来源衍生声明都需重新由你审阅。此前事实、批准和行动保持撤回。"}
              </p>
              <label className="context-identity-correction__reason">
                <span>为何更改此授权？</span>
                <textarea
                  maxLength={500}
                  onChange={(event) => {
                    setSourceAuthorizationReason(
                      event.currentTarget.value,
                    );
                    sourceAuthorizationRequestRef.current = null;
                  }}
                  placeholder={
                    selectedResource.resource
                      .source_authorization_state === "authorized"
                      ? "例如：候选人撤回了使用此对话的许可。"
                      : "例如：你确认已就此用途续期许可。"
                  }
                  rows={3}
                  value={sourceAuthorizationReason}
                />
              </label>
              {selectedResource.resource
                .source_authorization_state !== "authorized" ? (
                <label className="context-identity-correction__reason">
                  <span>
                    新授权截止时间
                    {selectedResource.resource
                      .source_authorization_state === "expired"
                      ? "（建议）"
                      : "（可选）"}
                  </span>
                  <input
                    onChange={(event) => {
                      setSourceAuthorizationExpiresAt(
                        event.currentTarget.value,
                      );
                      sourceAuthorizationRequestRef.current = null;
                    }}
                    type="datetime-local"
                    value={sourceAuthorizationExpiresAt}
                  />
                  <small>
                    这决定来源能否继续作为依据，不会改变原始文件的保留时长。
                  </small>
                </label>
              ) : null}
              <footer>
                <button
                  className="context-secondary-button"
                  onClick={() => {
                    const trigger = sourceAuthorizationTriggerRef.current;
                    if (trigger?.isConnected) {
                      trigger.scrollIntoView({ block: "nearest", behavior: "instant" });
                      trigger.focus({ preventScroll: true });
                    }
                    setSourceAuthorizationOpen(false);
                    resetSourceAuthorizationDecision();
                  }}
                  type="button"
                >
                  取消
                </button>
                <button
                  className={
                    selectedResource.resource
                      .source_authorization_state === "authorized"
                      ? "context-danger-button"
                      : "context-primary-button context-primary-button--compact"
                  }
                  disabled={
                    busy || !sourceAuthorizationReason.trim()
                  }
                  onClick={() =>
                    void decideSelectedSourceAuthorization()
                  }
                  type="button"
                >
                  {busy ? (
                    <CircleNotch
                      aria-hidden="true"
                      className="spin"
                      size={16}
                    />
                  ) : null}
                  {selectedResource.resource
                    .source_authorization_state === "authorized"
                    ? "撤销并更新关系记录"
                    : selectedResource.resource
                          .source_authorization_state === "expired"
                      ? "续期并返回审阅"
                      : "恢复并返回审阅"}
                </button>
              </footer>
            </section>
          ) : null}
          {deleteResourceConfirm ? (
            <div
              className={`context-resource-review__delete ${styles.decision}`}
              onFocusCapture={revealDecisionControl}
            >
              <p>
                这会删除此来源及由它发现的资料，并撤回依赖它的关系记录与对话快照。此操作不能恢复。
              </p>
              <button
                className="context-secondary-button"
                onClick={() => {
                  const trigger = deleteResourceTriggerRef.current;
                  if (trigger?.isConnected) {
                    trigger.scrollIntoView({ block: "nearest", behavior: "instant" });
                    trigger.focus({ preventScroll: true });
                  }
                  setDeleteResourceConfirm(false);
                }}
                type="button"
              >
                保留来源
              </button>
              <button
                className="context-danger-button"
                disabled={busy}
                onClick={() => void deleteSelectedResource()}
                type="button"
              >
                {busyOperation === "正在删除来源…" ? busyOperation : "删除来源及相关内容"}
              </button>
            </div>
          ) : null}
          {identityCorrectionOpen ? (
            <section className="context-identity-correction">
              <header>
                <div>
                  <p className="eyebrow">身份更正</p>
                  <h4>将此受治理来源移到正确的人物。</h4>
                </div>
                <Warning aria-hidden="true" size={19} />
              </header>
              <p>
                此来源及由其发现的内容会一并移动。{scopeLabel} 下已确认事实将被撤回；新关系只会收到可审阅提议，绝不会自动成为事实。
              </p>
              <div
                aria-label="身份更正目标类型"
                className="context-identity-correction__mode"
                role="group"
              >
                <button
                  aria-pressed={identityTargetMode === "existing"}
                  disabled={identityPeople.length === 0}
                  onClick={() => {
                    setIdentityTargetMode("existing");
                    resetIdentityCorrectionRequest();
                  }}
                  type="button"
                >
                  现有人物
                </button>
                <button
                  aria-pressed={identityTargetMode === "new"}
                  onClick={() => {
                    setIdentityTargetMode("new");
                    resetIdentityCorrectionRequest();
                  }}
                  type="button"
                >
                  新人物
                </button>
              </div>
              {identityPeopleLoading ? (
                <p className="context-identity-correction__loading">
                  <CircleNotch
                    aria-hidden="true"
                    className="spin"
                    size={16}
                  />
                  正在加载受治理人才……
                </p>
              ) : identityTargetMode === "existing" ? (
                <div className="context-identity-correction__fields">
                  <label>
                    <span>正确人物</span>
                    <select
                      disabled={busy}
                      onChange={(event) => {
                        setIdentityTargetPersonId(event.target.value);
                        setIdentityTargetContextId("");
                        setIdentityNewContextLabel("");
                        resetIdentityCorrectionRequest();
                      }}
                      value={identityTargetPersonId}
                    >
                      <option disabled value="">
                        选择正确人物……
                      </option>
                      {identityPeople.map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.display_label} · {person.capture_count}{" "}
                          个来源
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>关系背景</span>
                    <select
                      disabled={busy}
                      onChange={(event) => {
                        setIdentityTargetContextId(event.target.value);
                        resetIdentityCorrectionRequest();
                      }}
                      value={identityTargetContextId}
                    >
                      <option disabled value="">
                        选择关系背景……
                      </option>
                      {identityTargetPerson?.contexts.map((context) => (
                        <option key={context.id} value={context.id}>
                          {context.display_label}
                        </option>
                      ))}
                      <option value="__new__">
                        创建独立背景……
                      </option>
                    </select>
                  </label>
                  {identityTargetContextId === "__new__" ? (
                    <label>
                      <span>新背景名称</span>
                      <input
                        disabled={busy}
                        maxLength={200}
                        onChange={(event) => {
                          setIdentityNewContextLabel(event.target.value);
                          resetIdentityCorrectionRequest();
                        }}
                        placeholder="例如：产品副总裁 · Northstar 寻访"
                        value={identityNewContextLabel}
                      />
                    </label>
                  ) : null}
                </div>
              ) : (
                <div className="context-identity-correction__fields">
                  <label>
                    <span>新人物姓名</span>
                    <input
                      disabled={busy}
                      maxLength={200}
                      onChange={(event) => {
                        setIdentityNewPersonLabel(event.target.value);
                        resetIdentityCorrectionRequest();
                      }}
                      placeholder="例如：Maya Chen"
                      value={identityNewPersonLabel}
                    />
                  </label>
                  <label>
                    <span>关系背景</span>
                    <input
                      disabled={busy}
                      maxLength={200}
                      onChange={(event) => {
                        setIdentityNewContextLabel(event.target.value);
                        resetIdentityCorrectionRequest();
                      }}
                      placeholder="例如：产品副总裁 · Northstar 寻访"
                      value={identityNewContextLabel}
                    />
                  </label>
                </div>
              )}
              <label className="context-identity-correction__reason">
                <span>为什么这是正确身份？</span>
                <textarea
                  disabled={busy}
                  maxLength={500}
                  onChange={(event) => {
                    setIdentityCorrectionReason(event.target.value);
                    resetIdentityCorrectionRequest();
                  }}
                  placeholder="例如：邮箱地址与任职经历和现有联系人匹配。"
                  rows={2}
                  value={identityCorrectionReason}
                />
              </label>
              <footer>
                <p>
                  待处理行动会被撤销；正在进行的效果必须先完成对账，才能继续移动。
                </p>
                <div>
                  <button
                    className="context-text-button"
                    disabled={busy}
                    onClick={() => setIdentityCorrectionOpen(false)}
                    type="button"
                  >
                    保留当前身份
                  </button>
                  <button
                    className="context-primary-button context-primary-button--compact"
                    disabled={
                      busy ||
                      !identityCorrectionReason.trim() ||
                      (identityTargetMode === "existing"
                        ? !identityTargetPerson ||
                          !identityTargetContextId ||
                          (identityTargetContextId === "__new__" &&
                            !identityNewContextLabel.trim())
                        : !identityNewPersonLabel.trim() ||
                          !identityNewContextLabel.trim())
                    }
                    onClick={() =>
                      void correctSelectedResourceIdentity()
                    }
                    type="button"
                  >
                    {busy ? (
                      <CircleNotch
                        aria-hidden="true"
                        className="spin"
                        size={16}
                      />
                    ) : (
                      <ArrowRight aria-hidden="true" size={16} />
                    )}
                    移动来源及相关资料
                  </button>
                </div>
              </footer>
            </section>
          ) : null}
          {selectedResource.resource.kind === "public_url" &&
          selectedResource.resource.input_channel !== "api_connector" &&
          selectedResource.resource.source_locator ? (
            <section className="context-research-approval">
              <div>
                <p className="eyebrow">公开研究</p>
                <h4>AI 读取种子之外内容前，请先选择边界。</h4>
                <p>
                  已批准域名：{" "}
                  <strong>
                    {
                      new URL(
                        selectedResource.resource.source_locator,
                      ).hostname
                    }
                  </strong>
                  。每个检索页面都会以拟议依据返回，并保留网址、检索时间与相关资料的删除范围。
                </p>
              </div>
              <div className="context-research-approval__scope">
                <label>
                  <span>最大页数</span>
                  <select
                    disabled={busy}
                    onChange={(event) =>
                      setResearchPageCount(Number(event.target.value))
                    }
                    value={researchPageCount}
                  >
                    <option value={1}>1 页</option>
                    <option value={3}>最多 3 页</option>
                    <option value={5}>最多 5 页</option>
                  </select>
                </label>
                <label>
                  <span>跟随链接</span>
                  <select
                    disabled={busy}
                    onChange={(event) =>
                      setResearchLinkDepth(Number(event.target.value))
                    }
                    value={researchLinkDepth}
                  >
                    <option value={0}>仅种子页面</option>
                    <option value={1}>同域一层</option>
                  </select>
                </label>
              </div>
              <label className="context-resource-checkbox">
                <input
                  checked={researchApproval}
                  disabled={busy}
                  onChange={(event) =>
                    setResearchApproval(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>
                  我批准这次有边界的公开研究
                  <small>
                    仅限 HTTPS；私有网络与跨域重定向会被阻止。
                  </small>
                </span>
              </label>
              {researchResult ? (
                <div
                  className={`context-research-status context-research-status--${researchResult.status}`}
                  role="status"
                >
                  <div className="context-research-status__summary">
                    {researchResult.status === "running" ? (
                      <CircleNotch
                        aria-hidden="true"
                        className="spin"
                        size={17}
                      />
                    ) : researchResult.status === "completed" ? (
                      <CheckCircle
                        aria-hidden="true"
                        size={17}
                        weight="fill"
                      />
                    ) : (
                      <Warning
                        aria-hidden="true"
                        size={17}
                        weight="fill"
                      />
                    )}
                    <span>
                      {researchResult.status === "running"
                        ? "研究仍在运行；刷新或中断后可以检查其持久任务。"
                        : `${researchResult.pages.length} 个公开页面已作为拟议依据返回 · ${
                            researchResult.status
                          }`}
                    </span>
                  </div>
                  {researchResult.warnings.length > 0 ? (
                    <div className="context-research-status__warnings">
                      <strong>
                        {researchResult.warnings.length} 条页面级警告
                      </strong>
                      <ul>
                        {researchResult.warnings
                          .slice(0, 5)
                          .map((warning, index) => (
                            <li key={`${researchResult.task_id}:${index}`}>
                              {warning}
                            </li>
                          ))}
                      </ul>
                      <small>
                        检索警告属于操作依据，不是关于此人的声明。
                      </small>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <footer>
                <p>
                  研究绝不会确认人物事实，也不会联系任何人。
                </p>
                <button
                  className="context-primary-button context-primary-button--compact"
                  disabled={
                    researchResult?.status === "running"
                      ? busy
                      : !researchApproval || busy
                  }
                  onClick={() =>
                    void (researchResult?.status === "running"
                      ? refreshResearchStatus().catch(() => undefined)
                      : researchSelectedResource())
                  }
                  type="button"
                >
                  {busy ? (
                    <CircleNotch
                      aria-hidden="true"
                      className="spin"
                      size={17}
                    />
                  ) : (
                    <Sparkle aria-hidden="true" size={17} />
                  )}
                  {busy
                    ? researchResult?.status === "running"
                      ? "正在检查持久任务"
                      : "正在研究公开页面"
                    : researchResult?.status === "running"
                      ? "检查研究状态"
                      : "运行公开研究"}
                </button>
              </footer>
            </section>
          ) : null}
          {selectedResource.resource.kind === "conversation_screenshot" &&
          selectedResource.resource.processing_state ===
            "needs_fact_review" ? (
            <section className="context-capture-review-bridge">
              <div>
                <span>
                  <FileImage aria-hidden="true" size={18} weight="duotone" />
                </span>
                <p>
                  <strong>截图事实仍需你判断</strong>
                  <small>
                    转写审阅与事实决定保持分离。打开原始采集审阅，逐项确认、驳回或保留为未解决。
                  </small>
                </p>
              </div>
              <button
                className="context-secondary-button"
                onClick={() =>
                  void onReviewCapture(
                    selectedResource.resource.capture_id,
                  )
                }
                type="button"
              >
                继续事实审阅
                <ArrowRight aria-hidden="true" size={15} />
              </button>
            </section>
          ) : null}
          {selectedResource.claim_proposals.length > 0 ? (
            <section className="context-claim-review">
              <header>
                <div>
                  <p className="eyebrow">拟议人物更新</p>
                  <h4>决定哪些内容成为这段关系的一部分。</h4>
                </div>
                <span>
                  {
                    selectedResource.claim_proposals.filter((claim) =>
                      ["pending", "unresolved"].includes(
                        claim.review_status,
                      ),
                    ).length
                  }{" "}
                  项待处理
                </span>
              </header>
              <p>
                每项更新都保留准确来源片段；在你选择当前值前，冲突声明保持分离。
              </p>
              <div className="context-claim-review__list">
                {selectedResource.claim_proposals.map((claim) => {
                  const open = ["pending", "unresolved"].includes(
                    claim.review_status,
                  );
                  const conflicting =
                    claim.proposal_status === "ambiguous" ||
                    claim.temporal_relation === "supersedes";
                  const dateRequired = claim.review_blockers?.includes("calendar_date_required");
                  const evidenceBlocked = claim.review_blockers?.some((item) => item !== "calendar_date_required");
                  const dateValue = claimEdits[claim.id]?.trim() ?? "";
                  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(dateValue) &&
                    Number.isFinite(Date.parse(`${dateValue}T00:00:00Z`)) &&
                    new Date(`${dateValue}T00:00:00Z`).toISOString().slice(0, 10) === dateValue;
                  return (
                    <article
                      data-conflict={conflicting}
                      data-state={claim.review_status}
                      key={claim.id}
                    >
                      <header>
                        <div>
                          <strong>{fieldLabel(claim.field)}</strong>
                          <span>
                            {claim.review_status === "confirmed"
                              ? "已为此关系确认"
                              : claim.review_status === "dismissed"
                                ? "你已驳回"
                                : claim.temporal_relation === "supersedes"
                                  ? "替换当前值前请审阅"
                                  : claim.temporal_relation === "reinforces"
                                    ? "强化当前值"
                                    : "新拟议事实"}
                          </span>
                        </div>
                        <i>{reviewLabel(claim.review_status)}</i>
                      </header>
                      {claim.prior_confirmed_value ? (
                        <div
                          aria-label="拟议事实变化"
                          className="context-claim-review__diff"
                        >
                          <span>
                            <small>之前</small>
                            <del>{claim.prior_confirmed_value}</del>
                          </span>
                          <ArrowRight aria-hidden="true" size={15} />
                          <span>
                            <small>拟议</small>
                            <ins>{claimEdits[claim.id] ?? ""}</ins>
                          </span>
                        </div>
                      ) : null}
                      <label>
                        <span>待确认值</span>
                        <input
                          disabled={!open || busy}
                          maxLength={2_000}
                          onChange={(event) =>
                            setClaimEdits((current) => ({
                              ...current,
                              [claim.id]: event.target.value,
                            }))
                          }
                          value={claimEdits[claim.id] ?? ""}
                        />
                      </label>
                      <blockquote>
                        <Quotes aria-hidden="true" size={15} />
                        <span>
                          {claim.evidence_quote ??
                            "没有可用的准确来源引文。"}
                        </span>
                      </blockquote>
                      {dateRequired ? <p>需要完整日期 YYYY-MM-DD。导入时间不能替代消息时间。</p> : null}
                      {evidenceBlocked ? <p role="status">来源或身份已变化，请重新审阅当前证据。</p> : null}
                      <p>
                        {claim.producer.name} {claim.producer.version} ·
                        来源片段 {claim.evidence_fragment_id.slice(0, 8)}
                      </p>
                      {open ? (
                        <footer>
                          <button
                            className="context-text-button"
                            disabled={busy}
                            onClick={() =>
                              void decideClaim(claim, "dismiss")
                            }
                            type="button"
                          >
                            驳回
                          </button>
                          <button
                            className="context-secondary-button"
                            disabled={busy}
                            onClick={() =>
                              void decideClaim(
                                claim,
                                "leave_unresolved",
                              )
                            }
                            type="button"
                          >
                            保持未解决
                          </button>
                          <button
                            className="context-primary-button"
                            disabled={
                              busy ||
                              evidenceBlocked || (dateRequired && !dateValid) ||
                              !(claimEdits[claim.id] ?? "").trim()
                            }
                            onClick={() =>
                              void decideClaim(claim, "confirm")
                            }
                            type="button"
                          >
                            <Check aria-hidden="true" size={16} />
                            为此关系确认
                          </button>
                        </footer>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}
          <div>
            {selectedResource.fragments.map((fragment) => (
              <article
                data-state={fragment.review_status}
                key={fragment.id}
              >
                <header>
                  <span>
                    {fragmentLocationLabel(fragment.locator.kind)} ·{" "}
                    {fragment.sequence + 1}
                  </span>
                  <i>{fragmentReviewLabel(fragment.review_status)}</i>
                </header>
                <pre>{fragment.text}</pre>
                <p>
                  {fragmentAttributionLabel(fragment.attribution.actor_kind, fragment.attribution.status)}
                </p>
                <details>
                  <summary>查看提取信息</summary>
                  <p>提取方式：{fragment.parser.name} · {fragment.parser.version}</p>
                </details>
                {fragment.review_status === "proposed" ? (
                  <footer>
                    <button
                      className="context-secondary-button"
                      disabled={busy}
                      onClick={() =>
                        void decideFragment(
                          fragment.id,
                          fragment.review_status,
                          "rejected",
                        )
                      }
                      type="button"
                    >
                      驳回提取结果
                    </button>
                    <button
                      className="context-primary-button"
                      disabled={busy}
                      onClick={() =>
                        void decideFragment(
                          fragment.id,
                          fragment.review_status,
                          "reviewed",
                        )
                      }
                      type="button"
                    >
                      <Check aria-hidden="true" size={16} />
                      提取结果与来源一致
                    </button>
                  </footer>
                ) : null}
              </article>
            ))}
          </div>
          <p>
            审阅只确认转写准确性，不会把文档中的声明变成关于此人的当前事实。
          </p>
        </div>
      ) : null}
    </section>
  );
}
