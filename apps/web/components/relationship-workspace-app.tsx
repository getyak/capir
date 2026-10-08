"use client";

import {
  CONTRACT_VERSION,
  type IdentityResolutionCase,
  type KnowledgeSnapshot,
  type PersonMergeReversalPreview,
  type RelationshipAgentHistory,
  type RelationshipScope,
  type ResourceCaptureResponse,
  type WorkspaceReviewResponse,
} from "@talent-signal/contracts";
import { CaretRight, Plus, ShieldCheck, UserPlus } from "@phosphor-icons/react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import {
  GovernedCaptureDeletion,
  type GovernedCaptureDeletionReceipt,
} from "./relationship-workspace/governed-capture-deletion";
import {
  RelationshipExternalEffectReview,
} from "./relationship-workspace/relationship-history";
import { RelationshipAgentPanel } from "./relationship-workspace/relationship-agent-panel";
import { RelationshipAgentStartPanel } from "./relationship-workspace/relationship-agent-start-panel";
import { RelationshipContactHeader } from "./relationship-workspace/relationship-contact-header";
import { RelationshipEvidenceProjection } from "./relationship-workspace/relationship-evidence-projection";
import { RelationshipFactReview } from "./relationship-workspace/relationship-fact-review";
import { RelationshipNextMove } from "./relationship-workspace/relationship-next-move";
import { RelationshipOnboarding } from "./relationship-workspace/relationship-onboarding";
import { RelationshipOutcomeTimeline } from "./relationship-workspace/relationship-outcome-timeline";
import { RelationshipResourceSection } from "./relationship-workspace/relationship-resource-section";
import { RelationshipSourceLineage } from "./relationship-workspace/relationship-source-lineage";
import {
  relationshipWorkspaceReadbackBoundaryError,
  requestRelationshipWorkspaceMutation,
} from "./relationship-workspace/relationship-workspace-command";
import {
  PersonMergeReview,
  type PersonMergeWorkflowResponse,
} from "./relationship-workspace/person-merge-review";
import { RelationshipWikiPanel, relationshipWikiView } from "./relationship-workspace/relationship-wiki-panel";
import { RelationshipWorkspaceStatus } from "./relationship-workspace/relationship-workspace-status";
import deskStyles from "./relationship-workspace/relationship-desk.module.css";
import { useRelationshipAgentController } from "./relationship-workspace/use-relationship-agent-controller";
import {
  relationshipReadbackSessionExpired,
  useRelationshipWorkspaceReadback,
} from "./relationship-workspace/use-relationship-workspace-readback";
import { useWorkspaceSessionRecovery } from "./use-workspace-session-recovery";
import { workspaceSessionFetch } from "./workspace-session-request";
import {
  sessionReturnHref,
  withReturnSession,
} from "./session-return-navigation";

// The capture editor and image-processing code load only when capture opens.
// https://nextjs.org/docs/app/guides/lazy-loading#nextdynamic
const CapturePanel = dynamic(() =>
  import("./relationship-workspace/screenshot-capture-panel").then((module) => module.CapturePanel),
  { loading: () => <p role="status">正在打开截图导入…</p> },
);

type Props = {
  initialAccountId: string | null;
  initialSessionVersion?: string | null;
  initialAgentHistory: RelationshipAgentHistory | null;
  initialIdentityResolutionCase: IdentityResolutionCase | null;
  initialKnowledgeSnapshot: KnowledgeSnapshot | null;
  initialWorkspace: WorkspaceReviewResponse | null;
  initialRelationshipScope: RelationshipScope | null;
  initialReturnSessionId: string | null;
  initialError: string | null;
  initialSessionRecoveryHref: string | null;
  initialCaptureOpen?: boolean;
  initialCreateOpen?: boolean;
};

function scrollWorkspaceTo(id: string) {
  document.getElementById(id)?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

const createContactDraftScope = {
  person: {
    id: "new-contact-draft",
    display_label: "新联系人",
  },
  relationship_context: {
    id: "identity-check",
    display_label: "先完成身份检查",
  },
};

export function RelationshipWorkspaceApp({
  initialAccountId,
  initialSessionVersion = null,
  initialAgentHistory,
  initialIdentityResolutionCase,
  initialKnowledgeSnapshot,
  initialWorkspace,
  initialRelationshipScope,
  initialReturnSessionId,
  initialError,
  initialSessionRecoveryHref,
  initialCaptureOpen = false,
  initialCreateOpen = false,
}: Props) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [relationshipScope, setRelationshipScope] = useState(
    initialRelationshipScope,
  );
  const [identityResolutionCase, setIdentityResolutionCase] = useState(
    initialIdentityResolutionCase,
  );
  const [knowledgeSnapshot, setKnowledgeSnapshot] = useState(
    initialKnowledgeSnapshot,
  );
  const accountId =
    initialAccountId ??
    initialWorkspace?.account_id ?? initialKnowledgeSnapshot?.account_id ?? null;
  const [error, setError] = useState(initialError ?? "");
  const [busy, setBusy] = useState("");
  const [captureOpen, setCaptureOpen] = useState(initialCaptureOpen);
  const [personMergeRequested, setPersonMergeRequested] = useState(false);
  const [personMergeReversalPreview, setPersonMergeReversalPreview] =
    useState<PersonMergeReversalPreview | null>(null);
  const [resourceComposerOpen, setResourceComposerOpen] = useState(false);
  const [deletionSummary, setDeletionSummary] =
    useState<GovernedCaptureDeletionReceipt | null>(null);
  const [announcement, setAnnouncement] = useState(
    initialIdentityResolutionCase
      ? "身份审阅已恢复。"
      : initialWorkspace || initialRelationshipScope
      ? "联系人背景已加载。"
      : "当前没有打开联系人背景。",
  );
  const activeScope = workspace
    ? {
        person: {
          id: workspace.subject.id,
          display_label: workspace.subject.display_label,
          ...(relationshipScope?.person.id === workspace.subject.id
            ? {
                profile: relationshipScope.person.profile,
                contact_points: relationshipScope.person.contact_points,
              }
            : {}),
        },
        relationship_context: {
          id: workspace.assignment.id,
          display_label: workspace.assignment.display_label,
        },
      }
    : relationshipScope;
  const activeCaptureId = workspace?.capture.id ?? null;
  const canonicalSessionReturnHref = sessionReturnHref(initialReturnSessionId);
  const preserveSessionReturn = (href: string) =>
    withReturnSession(href, initialReturnSessionId);
  const { beginSessionRecovery, sessionRecoveryHref } =
    useWorkspaceSessionRecovery(initialSessionRecoveryHref);
  const {
    acceptWorkspaceReadback,
    agentHistory,
    clearAgentHistory,
    openWorkspaceReview,
    refreshAgentHistory,
    refreshWorkspaceReview,
  } = useRelationshipWorkspaceReadback({
    accountId,
    activeCaptureId,
    activeScope,
    initialHistory: initialAgentHistory,
    onSessionExpired: beginSessionRecovery,
    onWorkspaceReadback: setWorkspace,
  });

  useEffect(() => {
    function focusAgent() {
      window.requestAnimationFrame(() => {
        const composer = document.getElementById(
          "relationship-agent-composer",
        );
        composer?.scrollIntoView({ block: "center" });
        composer?.focus({ preventScroll: true });

        const location = new URL(window.location.href);
        if (location.searchParams.get("intent") !== "compose") {
          return;
        }
        location.searchParams.delete("intent");
        window.history.replaceState(
          null,
          "",
          `${location.pathname}${location.search}${location.hash}`,
        );
      });
    }

    window.addEventListener("talent-signal:focus-agent", focusAgent);
    if (
      new URL(window.location.href).searchParams.get("intent") ===
      "compose"
    ) {
      focusAgent();
    }
    return () =>
      window.removeEventListener("talent-signal:focus-agent", focusAgent);
  }, []);

  useEffect(() => {
    if (
      !activeCaptureId ||
      typeof window === "undefined" ||
      window.location.hash !== "#proposed-changes"
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById("proposed-changes");
      target?.scrollIntoView({ block: "start" });
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeCaptureId]);

  const assertions = workspace?.analysis.assertions ?? [];
  const pendingCount = assertions.filter(
    (assertion) => assertion.review_status === "pending",
  ).length;

  const relationshipAgent = useRelationshipAgentController({
    accountId,
    browserSessionVersion: initialSessionVersion,
    initialCreateOpen,
    onAnnouncement: setAnnouncement,
    onBusyChange: setBusy,
    onError: setError,
    onKnowledgeCompiled: setKnowledgeSnapshot,
    onOpenMergeReview: () => {
      setPersonMergeRequested(true);
      window.setTimeout(
        () => scrollWorkspaceTo("person-merge-review"),
        0,
      );
    },
    onOpenResourceComposer: openResourceComposer,
    onRefreshHistory: (personId, relationshipContextId) => {
      void refreshAgentHistory(personId, relationshipContextId);
    },
    pendingCount,
    scope: activeScope,
  });
  const creatingContact =
    initialCreateOpen && relationshipAgent.createOpen;

  async function mutate(
    path: string,
    options: RequestInit,
    label: string,
  ) {
    const expectedCaptureId = activeCaptureId;
    setBusy(label);
    setError("");
    setAnnouncement(`${label}.`);
    try {
      if (!expectedCaptureId) {
        throw new Error("没有可供更新的活跃证据审阅。");
      }
      const result = await requestRelationshipWorkspaceMutation(
        path,
        options,
        fetch,
        {
          expectedAccountId: accountId,
          expectedCaptureId,
        },
      );
      if (!result.ok) {
        if (result.code === "backend_session_expired") {
          beginSessionRecovery();
          setAnnouncement(
            "账号会话已过期。先前已核验状态保持可见。",
          );
          return null;
        }
        throw new Error(result.message);
      }
      const next = result.workspace;
      const accepted = acceptWorkspaceReadback(next, expectedCaptureId);
      if (!accepted.ok) {
        throw new Error(accepted.message);
      }
      relationshipAgent.clearGeneratedArtifacts();
      setKnowledgeSnapshot(null);
      setAnnouncement("联系人背景已更新。");
      return next;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "无法更新规范状态。",
      );
      setAnnouncement("更新失败，先前状态保持可见。");
      return null;
    } finally {
      setBusy("");
    }
  }

  function handleCaptureDeleted(receipt: GovernedCaptureDeletionReceipt) {
    setDeletionSummary(receipt);
    setWorkspace(null);
    relationshipAgent.clearGeneratedArtifacts();
    setKnowledgeSnapshot(null);
    clearAgentHistory();
    setAnnouncement("来源及已登记的衍生数据已删除。");
    window.history.replaceState(
      null,
      "",
      preserveSessionReturn("/workspace?surface=desk"),
    );
  }

  function handleCommitted(next: WorkspaceReviewResponse) {
    const boundaryError = relationshipWorkspaceReadbackBoundaryError(next, {
      expectedAccountId: accountId,
    });
    if (boundaryError) {
      setCaptureOpen(false);
      setError(boundaryError);
      setAnnouncement(
        "来源已保存，但没有打开跨账号读取结果。",
      );
      return;
    }
    setWorkspace(next);
    setRelationshipScope(null);
    relationshipAgent.clearGeneratedArtifacts();
    setKnowledgeSnapshot(null);
    setDeletionSummary(null);
    setCaptureOpen(false);
    setError("");
    setAnnouncement("新证据已可供事实审阅。");
    window.history.replaceState(
      null,
      "",
      preserveSessionReturn(
        `/workspace?capture=${encodeURIComponent(next.capture.id)}#proposed-changes`,
      ),
    );
    void refreshAgentHistory(
      next.subject.id,
      next.assignment.id,
    );
  }

  function closeCapture() {
    setCaptureOpen(false);
    if (typeof window === "undefined") {
      return;
    }
    const location = new URL(window.location.href);
    if (location.searchParams.get("intent") !== "capture") {
      return;
    }
    location.searchParams.delete("intent");
    window.history.replaceState(
      null,
      "",
      `${location.pathname}${location.search}${location.hash}`,
    );
  }

  function clearOpenRelationship(announcement: string) {
    setWorkspace(null);
    setRelationshipScope(null);
    setIdentityResolutionCase(null);
    clearAgentHistory();
    relationshipAgent.clearGeneratedArtifacts();
    setKnowledgeSnapshot(null);
    setResourceComposerOpen(false);
    setError("");
    setAnnouncement(announcement);
    window.history.replaceState(
      null,
      "",
      preserveSessionReturn("/workspace?surface=desk"),
    );
  }

  function handleInitialResourcesCommitted(
    scope: RelationshipScope,
    receipts: ResourceCaptureResponse[],
    outcome:
      | "created_person"
      | "created_relationship_context"
      | "reused_relationship",
  ) {
    const identityClueSaved = receipts.some(
      (receipt) => receipt.resource.kind === "contact_record",
    );
    const identityClueDetail = identityClueSaved
      ? " 一条已确认身份线索已作为关联来源的掩码联系方式保存。"
      : "";
    setRelationshipScope(scope);
    setWorkspace(null);
    clearAgentHistory();
    relationshipAgent.setCreateOpen(false);
    setResourceComposerOpen(false);
    handleResourcesCommitted(receipts);
    relationshipAgent.setOperation(
      {
        detail:
          outcome === "created_person"
            ? `明确身份、关系情境与第一份受治理来源现在共享同一张持续更新页面。${identityClueDetail}`
            : outcome === "created_relationship_context"
              ? `现有联系人已保留，该来源新建了一项独立关系情境。${identityClueDetail}`
              : `来源已关联到所选现有联系人与关系，没有创建重复身份或情境。${identityClueDetail}`,
        status: "completed",
        title:
          outcome === "created_person"
            ? "持续更新的人物页面已创建"
            : outcome === "created_relationship_context"
              ? "关系情境已添加"
              : "来源已关联到现有关系",
      },
      { accountId, scope },
    );
    setAnnouncement(
      outcome === "created_person"
        ? "已根据第一份受治理来源创建持续更新的人物页面。"
        : outcome === "created_relationship_context"
          ? "已向现有联系人添加一项新关系情境。"
          : "来源已关联到现有关系。",
    );
    window.history.replaceState(
      null,
      "",
      preserveSessionReturn(
        `/workspace?person=${encodeURIComponent(
          scope.person.id,
        )}&context=${encodeURIComponent(scope.relationship_context.id)}`,
      ),
    );
    void refreshAgentHistory(
      scope.person.id,
      scope.relationship_context.id,
    );
  }

  function replaceIdentityReviewUrl(
    caseId: string | null,
    scope: RelationshipScope | null = activeScope
      ? {
          contract_version: CONTRACT_VERSION,
          person: activeScope.person,
          relationship_context: activeScope.relationship_context,
        }
      : null,
  ) {
    const parameters = new URLSearchParams();
    if (scope) {
      parameters.set("person", scope.person.id);
      parameters.set("context", scope.relationship_context.id);
    }
    if (caseId) {
      parameters.set("identity_case", caseId);
    }
    window.history.replaceState(
      null,
      "",
      preserveSessionReturn(
        parameters.size > 0
          ? `/workspace?${parameters.toString()}`
          : "/workspace?surface=desk",
      ),
    );
  }

  async function handleIdentityReviewCreated(caseId: string) {
    setBusy("正在打开身份审阅");
    setError("");
    try {
      const response = await workspaceSessionFetch(
        `/api/local-integration/identity-resolution-cases/${caseId}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as
        | IdentityResolutionCase
        | { code?: string; message?: string };
      if (relationshipReadbackSessionExpired(response.status, payload)) {
        return;
      }
      if (!response.ok || !("candidates" in payload)) {
        throw new Error(
          "message" in payload && payload.message
            ? payload.message
            : "无法打开已保存的身份审阅。",
        );
      }
      setIdentityResolutionCase(payload);
      relationshipAgent.setCreateOpen(false);
      relationshipAgent.setOperation({
        title: "身份审阅已保存",
        detail:
          "在你解决身份前，受治理来源会保持在所有人物 Wiki 之外。",
        status: "staged",
      });
      setAnnouncement(
        "身份审阅已保存，没有改变任何人物或关系。",
      );
      replaceIdentityReviewUrl(caseId);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "无法打开已保存的身份审阅。",
      );
    } finally {
      setBusy("");
    }
  }

  function handleIdentityCaseUpdated(nextCase: IdentityResolutionCase) {
    setIdentityResolutionCase(nextCase);
    relationshipAgent.setOperation({
      title: "身份保持未解决",
      detail:
        "来源与决定笔记已保存，候选人页面和 Wiki 均未改变。",
      status: "staged",
    });
    setAnnouncement(
      "身份保持未解决，之后可以继续处理。",
    );
    replaceIdentityReviewUrl(nextCase.id);
  }

  function handleIdentityCaseResolved(
    scope: RelationshipScope,
    compilation: KnowledgeSnapshot | null,
    compilationError: string | null,
  ) {
    setIdentityResolutionCase(null);
    setRelationshipScope(scope);
    setWorkspace(null);
    clearAgentHistory();
    relationshipAgent.setCreateOpen(false);
    relationshipAgent.clearGeneratedArtifacts();
    const verifiedCompilation =
      compilation && accountId && compilation.account_id !== accountId
        ? null
        : compilation;
    const verifiedCompilationError =
      compilation && !verifiedCompilation
        ? "Wiki 编译结果来自其他账号，因此没有显示。请重新加载此关系后重试。"
        : compilationError;
    setKnowledgeSnapshot(verifiedCompilation);
    if (compilation && !verifiedCompilation) {
      setError(verifiedCompilationError ?? "Wiki 读取结果被拒绝。");
    }
    relationshipAgent.setOperation(
      {
        title: verifiedCompilation
          ? "身份已解决，Wiki 已重新编译"
          : "身份已解决，Wiki 需要重试",
        detail: verifiedCompilation
          ? `受治理来源现在已在 ${scope.relationship_context.display_label} 中关联到 ${scope.person.display_label}。一份新的来源关联 Wiki 快照已发布。`
          : verifiedCompilationError ??
            "来源已关联，但衍生 Wiki 尚未重新编译。",
        status: verifiedCompilation ? "completed" : "staged",
      },
      { accountId, scope },
    );
    setAnnouncement(
      verifiedCompilation
        ? "身份已解决，并发布了新的 Wiki 快照。"
        : "身份已解决，Wiki 编译需要重试。",
    );
    replaceIdentityReviewUrl(null, scope);
    void refreshAgentHistory(
      scope.person.id,
      scope.relationship_context.id,
    );
  }

  function cancelAgentCreate() {
    relationshipAgent.setCreateOpen(false);
    relationshipAgent.setOperation({
      detail: "没有创建人物、关系情境或来源。",
      status: "no_change",
      title: "联系人草稿已取消",
    });
    setAnnouncement("联系人草稿已取消，没有创建任何内容。");
  }

  function handleResourcesCommitted(
    receipts: ResourceCaptureResponse[],
  ) {
    relationshipAgent.clearGeneratedArtifacts();
    setKnowledgeSnapshot(null);
    setError("");
    setAnnouncement(
      `已添加 ${receipts.length} 份资料。选择“整理简报”可将新资料纳入沟通要点。`,
    );
    const firstReceipt = receipts[0];
    if (
      firstReceipt?.identity.person_id &&
      firstReceipt.identity.relationship_context_id
    ) {
      void refreshAgentHistory(
        firstReceipt.identity.person_id,
        firstReceipt.identity.relationship_context_id,
      );
    }
  }

  function handlePersonMergeMutation(
    response: PersonMergeWorkflowResponse,
    sourceLabel: string,
  ) {
    const failedCompilations = response.compilations.filter(
      (compilation) => compilation.status === "failed",
    ).length;
    relationshipAgent.clearGeneratedArtifacts();
    setKnowledgeSnapshot(null);
    setPersonMergeReversalPreview(null);
    setError("");
    const mergeOperation = {
      title:
        response.status === "applied"
          ? "重复人物页面已合并"
          : "独立人物页面已恢复",
      detail:
        response.status === "applied"
          ? `${sourceLabel} 现在解析到这张稳定人物页面。${response.affected_relationship_context_ids.length} 项关系情境与 ${response.captures_rebound} 份受治理来源已在保留来源链路的情况下移动。${
              failedCompilations > 0
                ? `${failedCompilations} 项 Wiki 编译需要重试。`
                : "所有受影响关系 Wiki 均已重新编译。"
            }`
          : `${sourceLabel} 及其先前关系情境已恢复为独立人物。${
              failedCompilations > 0
                ? `${failedCompilations} 项 Wiki 编译需要重试。`
                : "所有受影响关系 Wiki 均已重新编译。"
            }`,
      status: failedCompilations > 0 ? ("staged" as const) : ("completed" as const),
    };
    relationshipAgent.setOperation(mergeOperation);
    setAnnouncement(
      response.status === "applied"
        ? "人物合并已应用，并生成可逆回执。"
        : "人物合并已撤销，独立关系记忆已恢复。",
    );
    if (!activeScope) {
      return;
    }
    const currentContextRestoredToSource =
      response.status === "reversed" &&
      response.affected_relationship_context_ids.includes(
        activeScope.relationship_context.id,
      );
    if (currentContextRestoredToSource) {
      const restoredScope: RelationshipScope = {
        contract_version: CONTRACT_VERSION,
        person: {
          id: response.source_person_id,
          display_label: sourceLabel,
        },
        relationship_context: activeScope.relationship_context,
      };
      setRelationshipScope(restoredScope);
      setWorkspace(null);
      clearAgentHistory();
      relationshipAgent.setOperation(mergeOperation, {
        accountId,
        scope: restoredScope,
      });
      window.history.replaceState(
        null,
        "",
        preserveSessionReturn(
          `/workspace?person=${encodeURIComponent(
            restoredScope.person.id,
          )}&context=${encodeURIComponent(
            restoredScope.relationship_context.id,
          )}#contact-overview`,
        ),
      );
      void refreshAgentHistory(
        restoredScope.person.id,
        restoredScope.relationship_context.id,
      );
      return;
    }
    void refreshAgentHistory(
      activeScope.person.id,
      activeScope.relationship_context.id,
    );
  }

  async function handleReviewPersonMergeReversal(
    operationId: string,
  ) {
    setBusy("正在审阅合并历史");
    setError("");
    try {
      const response = await workspaceSessionFetch(
        `/api/local-integration/person-merges/${encodeURIComponent(
          operationId,
        )}/reversal`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as
        | PersonMergeReversalPreview
        | { code?: string; message?: string };
      if (relationshipReadbackSessionExpired(response.status, payload)) {
        return;
      }
      if (!response.ok || !("operation_id" in payload)) {
        throw new Error(
          "message" in payload && payload.message
            ? payload.message
            : "无法重新打开先前合并以供审阅。",
        );
      }
      setPersonMergeReversalPreview(payload);
      setPersonMergeRequested(true);
      relationshipAgent.setOperation({
        title: payload.reversal_available
          ? "合并撤销审阅已打开"
          : "合并撤销需要处理",
        detail:
          payload.blockers.length > 0
            ? payload.blockers.map((blocker) => blocker.message).join(" ")
            : `The current ownership of ${payload.contexts_to_restore.length} relationship ${
                payload.contexts_to_restore.length === 1
                  ? "项关系情境"
                  : "项关系情境"
              } 的当前归属已可供明确的撤销决定。`,
        status: "staged",
      });
      setAnnouncement(
        payload.reversal_available
          ? "新的合并撤销审阅已就绪。"
          : "先前合并保持可见，但自动撤销已暂停。",
      );
      window.setTimeout(
        () => scrollWorkspaceTo("person-merge-review"),
        0,
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "无法重新打开先前合并以供审阅。",
      );
    } finally {
      setBusy("");
    }
  }

  function openResourceComposer() {
    setResourceComposerOpen(true);
    window.setTimeout(() => scrollWorkspaceTo("relationship-resources"), 0);
  }

  async function handleOpenCaptureReview(captureId: string) {
    setBusy("正在打开所选采集内容审阅");
    setError("");
    const result = await openWorkspaceReview(captureId);
    setBusy("");
    if (!result.ok) {
      if (!result.sessionExpired) {
        setError(
          result.message ?? "无法打开请求的采集内容审阅。",
        );
      }
      return;
    }

    relationshipAgent.clearGeneratedArtifacts();
    setKnowledgeSnapshot(null);
    setResourceComposerOpen(false);
    window.history.replaceState(
      null,
      "",
      preserveSessionReturn(
        `/workspace?person=${encodeURIComponent(
          result.workspace.subject.id,
        )}&context=${encodeURIComponent(
          result.workspace.assignment.id,
        )}&capture=${encodeURIComponent(captureId)}#proposed-changes`,
      ),
    );
    setAnnouncement(
      "所选采集内容审阅已打开，无需重新加载关系工作台。",
    );
    window.requestAnimationFrame(() =>
      scrollWorkspaceTo("proposed-changes"),
    );
  }

  async function handleIdentityCorrected(input: {
    captureId: string;
    captureIdsRebound: number;
    personId: string;
    relationshipContextId: string;
  }) {
    setBusy("正在打开修正后的关系");
    setError("");
    const result = await openWorkspaceReview(input.captureId, {
      personId: input.personId,
      relationshipContextId: input.relationshipContextId,
    });
    setBusy("");
    if (!result.ok) {
      return result.sessionExpired ? "session_expired" : "unavailable";
    }

    const correctedScope: RelationshipScope = {
      contract_version: CONTRACT_VERSION,
      person: {
        id: result.workspace.subject.id,
        display_label: result.workspace.subject.display_label,
      },
      relationship_context: {
        id: result.workspace.assignment.id,
        display_label: result.workspace.assignment.display_label,
      },
    };
    setRelationshipScope(correctedScope);
    relationshipAgent.clearGeneratedArtifacts();
    setKnowledgeSnapshot(null);
    clearAgentHistory();
    setResourceComposerOpen(false);
    window.history.replaceState(
      null,
      "",
      preserveSessionReturn(
        `/workspace?person=${encodeURIComponent(
          input.personId,
        )}&context=${encodeURIComponent(
          input.relationshipContextId,
        )}&capture=${encodeURIComponent(
          input.captureId,
        )}&identity_corrected=${encodeURIComponent(
          String(input.captureIdsRebound),
        )}#proposed-changes`,
      ),
    );
    setAnnouncement(
      "来源身份已修正，已核验的目标关系现在无需重新加载即可打开。",
    );
    void refreshAgentHistory(input.personId, input.relationshipContextId);
    return "opened";
  }


  return (
    <>
      <a className="skip-link" href="#main-content">
        跳到联系人背景
      </a>
      <div
        className={`context-workspace context-workspace--embedded relationship-desk ${deskStyles.desk}`}
        data-has-scope={Boolean(activeScope)}
      >
        <p className="sr-only" aria-live="polite" role="status">
          {announcement}
        </p>


        <main className="context-main" id="main-content" tabIndex={-1}>
          <header className="context-topbar">
            <div>
              <nav aria-label="人物面包屑" className="context-topbar__crumb">
                <Link href="/workspace/people">人物</Link>
                <CaretRight aria-hidden="true" size={12} />
                <span>
                  {activeScope ? activeScope.person.display_label : "新建联系人"}
                </span>
              </nav>
              <span className="context-secure-state">
                <ShieldCheck aria-hidden="true" size={15} weight="duotone" />
                {activeScope
                  ? workspace?.data_classification === "synthetic_fixture_only"
                    ? "合成审阅"
                    : "私密关系记录"
                  : "私密工作台"}
              </span>
            </div>
            <div>
              {canonicalSessionReturnHref ? (
                <Link href={canonicalSessionReturnHref}>返回原对话</Link>
              ) : null}
              {activeScope && relationshipAgent.workspaceChat.turns.length > 0 ? (
                <button
                  className="context-secondary-button"
                  onClick={() => clearOpenRelationship("已返回刚才的对话。")}
                  type="button"
                >
                  返回刚才的对话
                </button>
              ) : null}
              <details className="context-page-tools">
                <summary aria-label="人物页面选项">•••</summary>
                <div>
              <Link href="/workspace/boundaries">边界案例</Link>
              <Link href="/workspace/preferences">回复偏好</Link>
              <button
                className="context-primary-button context-primary-button--compact"
                onClick={() => setCaptureOpen(true)}
                type="button"
              >
                <Plus aria-hidden="true" size={17} />
                导入截图
              </button>
                </div>
              </details>
            </div>
          </header>

          <RelationshipWorkspaceStatus
            busy={busy}
            error={error}
            hasVerifiedState={Boolean(workspace || relationshipScope)}
            onDismissError={() => setError("")}
            sessionRecoveryHref={sessionRecoveryHref}
          />

          {!activeScope ? (
            <RelationshipAgentStartPanel
              busy={relationshipAgent.workspaceChat.busy}
              turns={relationshipAgent.workspaceChat.turns}
              contactDraft={relationshipAgent.contactDraft}
              createOpen={relationshipAgent.createOpen}
              identityResolutionCase={identityResolutionCase}
              objective={relationshipAgent.objective}
              onAsk={() => void relationshipAgent.ask()}
              onCancelCreate={cancelAgentCreate}
              onCaseUpdated={handleIdentityCaseUpdated}
              onCommitted={handleInitialResourcesCommitted}
              onDeferred={(caseId) => void handleIdentityReviewCreated(caseId)}
              onObjectiveChange={relationshipAgent.setObjective}
              onResolved={handleIdentityCaseResolved}
              onScreenshot={() => setCaptureOpen(true)}
            />
          ) : null}

          {!workspace && !relationshipScope ? (
            relationshipAgent.createOpen ? null : (
            <RelationshipOnboarding
              deletionSummary={deletionSummary}
              onCommitted={handleInitialResourcesCommitted}
              onScreenshot={() => setCaptureOpen(true)}
            />
            )
          ) : !workspace && relationshipScope ? (
            <div
              className="context-page context-page--resource-only"
              data-contact-create={creatingContact || undefined}
            >
              <RelationshipAgentPanel
                busyLabel={busy}
                createOpen={relationshipAgent.createOpen}
                history={creatingContact ? null : agentHistory}
                identityResolutionCase={identityResolutionCase}
                mode="relationship"
                objective={relationshipAgent.objective}
                onAsk={() => void relationshipAgent.ask()}
                onCancelCreate={cancelAgentCreate}
                onIdentityCaseUpdated={handleIdentityCaseUpdated}
                onIdentityDeferred={(caseId) =>
                  void handleIdentityReviewCreated(caseId)
                }
                onIdentityResolved={handleIdentityCaseResolved}
                onInitialResourcesCommitted={handleInitialResourcesCommitted}
                onObjectiveChange={relationshipAgent.setObjective}
                onReviewMerge={(operationId) =>
                  void handleReviewPersonMergeReversal(operationId)
                }
                onReviewSources={openResourceComposer}
                onRunCommand={relationshipAgent.runUiCommand}
                operation={
                  creatingContact ? null : relationshipAgent.operation
                }
                pendingCount={0}
                response={
                  creatingContact ? null : relationshipAgent.response
                }
                scope={
                  creatingContact
                    ? createContactDraftScope
                    : relationshipScope
                }
                submittedObjective={relationshipAgent.submittedObjective}
              />
              <div className="context-notebook">
              {creatingContact ? (
                <section className="context-contact-create-stage">
                  <UserPlus aria-hidden="true" size={28} weight="duotone" />
                  <p className="eyebrow">Agent Tool · 新建联系人</p>
                  <h1>先查身份，再建立关系。</h1>
                  <p>
                    当前没有选中任何既有联系人。只有在账号范围内完成查重并由你确认后，
                    才会保存人物、关系背景和首个来源。
                  </p>
                </section>
              ) : null}

              <RelationshipContactHeader
                onAskAgent={() =>
                  window.dispatchEvent(
                    new Event("talent-signal:focus-agent"),
                  )
                }
                onReviewSources={openResourceComposer}
                scope={relationshipScope}
                hasCompiledBrief={Boolean(relationshipWikiView(relationshipAgent.response, knowledgeSnapshot)?.blocks.some((block) => block.kind === "person_brief"))}
              />

              <RelationshipWikiPanel
                personLabel={relationshipScope.person.display_label}
                busy={busy === "正在编译关联来源的简报"}
                onCompile={() => void relationshipAgent.compileWiki()}
                onReviewSources={openResourceComposer}
                response={relationshipAgent.response}
                snapshot={knowledgeSnapshot}
              />

              <PersonMergeReview
                currentPerson={relationshipScope.person}
                forceOpen={personMergeRequested}
                onCloseRequest={() => {
                  setPersonMergeRequested(false);
                  setPersonMergeReversalPreview(null);
                }}
                onMutation={handlePersonMergeMutation}
                reversalPreview={personMergeReversalPreview}
              />

              <RelationshipExternalEffectReview history={agentHistory} />

              <RelationshipResourceSection
                onCommitted={handleResourcesCommitted}
                onEvidenceChanged={(announcement, relationshipRemoved) => {
                  if (relationshipRemoved) {
                    clearOpenRelationship(
                      announcement ??
                        "来源链路已删除，没有活跃关系保留。",
                    );
                    return;
                  }
                  relationshipAgent.clearGeneratedArtifacts();
                  setKnowledgeSnapshot(null);
                  setAnnouncement(
                    announcement ??
                      "审阅已保存。选择“整理简报”可更新沟通要点。",
                  );
                  void refreshAgentHistory(
                    relationshipScope.person.id,
                    relationshipScope.relationship_context.id,
                  );
                }}
                onIdentityCorrected={handleIdentityCorrected}
                onReviewCapture={handleOpenCaptureReview}
                onScreenshot={() => setCaptureOpen(true)}
                open={resourceComposerOpen}
                personId={relationshipScope.person.id}
                relationshipContextId={
                  relationshipScope.relationship_context.id
                }
                scopeLabel={`${relationshipScope.person.display_label} · ${relationshipScope.relationship_context.display_label}`}
              />
              </div>
            </div>
          ) : workspace ? (
            <div
              className="context-page"
              data-contact-create={creatingContact || undefined}
            >
              <RelationshipAgentPanel
                busyLabel={busy}
                createOpen={relationshipAgent.createOpen}
                history={creatingContact ? null : agentHistory}
                identityResolutionCase={identityResolutionCase}
                mode={creatingContact ? "relationship" : "review"}
                objective={relationshipAgent.objective}
                onAsk={() => void relationshipAgent.ask()}
                onCancelCreate={cancelAgentCreate}
                onIdentityCaseUpdated={handleIdentityCaseUpdated}
                onIdentityDeferred={(caseId) =>
                  void handleIdentityReviewCreated(caseId)
                }
                onIdentityResolved={handleIdentityCaseResolved}
                onInitialResourcesCommitted={handleInitialResourcesCommitted}
                onObjectiveChange={relationshipAgent.setObjective}
                onReviewMerge={(operationId) =>
                  void handleReviewPersonMergeReversal(operationId)
                }
                onReviewSources={openResourceComposer}
                onRunCommand={relationshipAgent.runUiCommand}
                operation={
                  creatingContact ? null : relationshipAgent.operation
                }
                pendingCount={creatingContact ? 0 : pendingCount}
                response={
                  creatingContact ? null : relationshipAgent.response
                }
                scope={
                  creatingContact
                    ? createContactDraftScope
                    : {
                        person: workspace.subject,
                        relationship_context: workspace.assignment,
                      }
                }
                submittedObjective={relationshipAgent.submittedObjective}
              />
              <div className="context-notebook">
              {creatingContact ? (
                <section className="context-contact-create-stage">
                  <UserPlus aria-hidden="true" size={28} weight="duotone" />
                  <p className="eyebrow">Agent Tool · 新建联系人</p>
                  <h1>先查身份，再建立关系。</h1>
                  <p>
                    当前没有选中任何既有联系人。只有在账号范围内完成查重并由你确认后，
                    才会保存人物、关系背景和首个来源。
                  </p>
                </section>
              ) : null}
              <RelationshipContactHeader
                onAskAgent={() =>
                  window.dispatchEvent(
                    new Event("talent-signal:focus-agent"),
                  )
                }
                onReviewSources={openResourceComposer}
                scope={
                  activeScope ?? {
                    person: workspace.subject,
                    relationship_context: workspace.assignment,
                  }
                }
                workspace={workspace}
              />

              <RelationshipWikiPanel
                busy={busy === "正在编译关联来源的简报"}
                onCompile={() => void relationshipAgent.compileWiki()}
                onReviewSources={openResourceComposer}
                response={relationshipAgent.response}
                snapshot={knowledgeSnapshot}
              />

              <PersonMergeReview
                currentPerson={{
                  id: workspace.subject.id,
                  display_label: workspace.subject.display_label,
                }}
                forceOpen={personMergeRequested}
                onCloseRequest={() => {
                  setPersonMergeRequested(false);
                  setPersonMergeReversalPreview(null);
                }}
                onMutation={handlePersonMergeMutation}
                reversalPreview={personMergeReversalPreview}
              />

              <RelationshipExternalEffectReview history={agentHistory} />

              <RelationshipResourceSection
                onCommitted={handleResourcesCommitted}
                onEvidenceChanged={async (
                  announcement,
                  relationshipRemoved,
                ) => {
                  if (relationshipRemoved) {
                    clearOpenRelationship(
                      announcement ??
                        "来源链路已删除，没有活跃关系保留。",
                    );
                    return;
                  }
                  relationshipAgent.clearGeneratedArtifacts();
                  setKnowledgeSnapshot(null);
                  const refreshed = await refreshWorkspaceReview(
                    workspace.capture.id,
                  );
                  setAnnouncement(
                    refreshed
                      ? announcement ??
                          "审阅已保存。选择“整理简报”可更新沟通要点。"
                      : `${
                          announcement ?? "证据审阅已保存。"
                        } 当前审阅无法刷新；请重新加载后再作下一项决定。`,
                  );
                  void refreshAgentHistory(
                    workspace.subject.id,
                    workspace.assignment.id,
                  );
                }}
                onIdentityCorrected={handleIdentityCorrected}
                onReviewCapture={handleOpenCaptureReview}
                onScreenshot={() => setCaptureOpen(true)}
                open={resourceComposerOpen}
                personId={workspace.subject.id}
                relationshipContextId={workspace.assignment.id}
                scopeLabel={`${workspace.subject.display_label} · ${workspace.assignment.display_label}`}
              />

              <RelationshipSourceLineage workspace={workspace} />

              <div className="context-page-grid">
                <div className="context-page-primary">
                  <RelationshipFactReview
                    busy={Boolean(busy)}
                    mutate={mutate}
                    workspace={workspace}
                  />

                  <RelationshipEvidenceProjection workspace={workspace} />
                </div>

                <aside
                  aria-label="下一步与关系历史"
                  className="context-page-aside"
                >
                  <RelationshipNextMove
                    busy={Boolean(busy)}
                    mutate={mutate}
                    onAnnouncement={setAnnouncement}
                    onBusyChange={setBusy}
                    onError={setError}
                    workspace={workspace}
                  />

                  <RelationshipOutcomeTimeline workspace={workspace} />
                  <GovernedCaptureDeletion
                    busy={Boolean(busy)}
                    captureId={workspace.capture.id}
                    onBusyChange={setBusy}
                    onDeleted={handleCaptureDeleted}
                    onError={setError}
                  />
                </aside>
              </div>
              </div>
            </div>
          ) : null}
        </main>
      </div>

      {captureOpen ? (
        <CapturePanel
          onClose={closeCapture}
          onCommitted={handleCommitted}
        />
      ) : null}
    </>
  );
}
