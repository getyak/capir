"use client";
import {RunArtifacts} from "@/components/run-artifacts";

import { MeetingDraftHandoff } from "@/components/meeting-draft-handoff";

import type {
  ChatTaskResponse,
  IdentityResolutionCase,
  KnowledgeSnapshot,
  RelationshipAgentHistory,
  RelationshipScope,
  ResourceCaptureResponse,
} from "@talent-signal/contracts";
import {
  AddressBook,
  ArrowRight,
  CaretLeft,
  CaretRight,
  CheckCircle,
  CircleNotch,
  Clock,
  LinkSimple,
  Plus,
  ShieldCheck,
  Sparkle,
  UserPlus,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/locale-provider";

import { ProductFeedback } from "@/components/product-feedback";
import { AgentCreatePersonCard } from "./agent-create-person-card";
import { AgentIdentityReviewCard } from "./agent-identity-review-card";
import { initials } from "./relationship-display";
import {
  relationshipBriefContinuityReceipt,
  RelationshipHistoryTimeline,
} from "./relationship-history";
import type { RelationshipAgentOperation } from "./use-relationship-agent-controller";

type Props = {
  busyLabel: string;
  createOpen: boolean;
  history: RelationshipAgentHistory | null;
  identityResolutionCase: IdentityResolutionCase | null;
  mode: "relationship" | "review";
  objective: string;
  onAsk: () => void;
  onCancelCreate: () => void;
  onIdentityCaseUpdated: (nextCase: IdentityResolutionCase) => void;
  onIdentityDeferred: (caseId: string) => void;
  onIdentityResolved: (
    scope: RelationshipScope,
    compilation: KnowledgeSnapshot | null,
    compilationError: string | null,
  ) => void;
  onInitialResourcesCommitted: (
    scope: RelationshipScope,
    receipts: ResourceCaptureResponse[],
    outcome:
      | "created_person"
      | "created_relationship_context"
      | "reused_relationship",
  ) => void;
  onObjectiveChange: (value: string) => void;
  onReviewMerge: (operationId: string) => void;
  onReviewSources: () => void;
  onRunCommand: (objective: string) => boolean;
  operation: RelationshipAgentOperation | null;
  pendingCount: number;
  response: ChatTaskResponse | null;
  scope: Pick<RelationshipScope, "person" | "relationship_context">;
  submittedObjective: string;
};

export function RelationshipAgentPanel({
  busyLabel,
  createOpen,
  history,
  identityResolutionCase,
  mode,
  objective,
  onAsk,
  onCancelCreate,
  onIdentityCaseUpdated,
  onIdentityDeferred,
  onIdentityResolved,
  onInitialResourcesCommitted,
  onObjectiveChange,
  onReviewMerge,
  onReviewSources,
  onRunCommand,
  operation,
  pendingCount,
  response,
  scope,
  submittedObjective,
}: Props) {
  const t = useT();
  const reviewMode = mode === "review";
  const [collapsed, setCollapsed] = useState(!createOpen);
  const [isComposing, setIsComposing] = useState(false);
  const [compositionDraft, setCompositionDraft] = useState<string | null>(null);
  const priorBrief =
    !response && !operation
      ? relationshipBriefContinuityReceipt(history)
      : null;

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 840px)");
    const syncMobileState = () => {
      setCollapsed(!createOpen);
    };

    syncMobileState();
    mobile.addEventListener("change", syncMobileState);
    return () => mobile.removeEventListener("change", syncMobileState);
  }, [createOpen]);

  useEffect(() => {
    function expandForAgentTask() {
      setCollapsed(false);
      window.requestAnimationFrame(() => {
        const panel = document.getElementById("relationship-chat");
        panel?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        panel?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
      });
    }

    window.addEventListener("talent-signal:focus-agent", expandForAgentTask);
    return () =>
      window.removeEventListener(
        "talent-signal:focus-agent",
        expandForAgentTask,
      );
  }, []);

  return (
    <section
      aria-label={collapsed ? "关系智能助理（已收起）" : undefined}
      aria-labelledby={collapsed ? undefined : "relationship-chat-title"}
      className="context-chat"
      data-collapsed={collapsed || undefined}
      id="relationship-chat"
    >
      <div className="context-chat__scope">
        <span>{initials(scope.person.display_label)}</span>
        <p>
          <strong>{scope.person.display_label}</strong>
          <small>{scope.relationship_context.display_label}</small>
        </p>
        <i>
          <ShieldCheck aria-hidden="true" size={15} weight="duotone" />
          已限定范围
        </i>
        <button
          aria-expanded={!collapsed}
          aria-label={collapsed ? "展开关系智能助理" : "收起关系智能助理"}
          className="context-chat__toggle"
          onClick={() => setCollapsed((current) => !current)}
          type="button"
        >
          {collapsed ? (
            <CaretRight aria-hidden="true" size={16} />
          ) : (
            <CaretLeft aria-hidden="true" size={16} />
          )}
        </button>
      </div>
      <div className="context-chat__intro">
        <p className="eyebrow">关系智能助理</p>
        <h2 id="relationship-chat-title">围绕此人对话</h2>
        <p>
          {reviewMode
            ? "我的范围仅限此人与此段关系。每个回答和拟议变化都会保留其来源边界。"
            : "我的范围仅限此人与此段关系。页面变化会保持暂存，直到你完成审阅。"}
        </p>
      </div>
      <div className="context-agent-actions">
        {reviewMode ? (
          <button
            disabled={pendingCount === 0}
            onClick={() => onRunCommand("审阅待确认的变化")}
            type="button"
          >
            <CheckCircle aria-hidden="true" size={15} />
            {pendingCount > 0
              ? `Review ${pendingCount} ${
                  pendingCount === 1 ? "项变化" : "项变化"
                }`
              : "没有待审阅变化"}
          </button>
        ) : null}
        <button onClick={() => onRunCommand("添加来源")} type="button">
          <Plus aria-hidden="true" size={15} />
          添加来源
        </button>
        {reviewMode ? (
          <button
            onClick={() => onRunCommand("查看下一步")}
            type="button"
          >
            <ArrowRight aria-hidden="true" size={15} />
            下一步
          </button>
        ) : null}
        <button
          data-active={createOpen}
          onClick={() => onRunCommand("创建联系人")}
          type="button"
        >
          <UserPlus aria-hidden="true" size={15} />
          创建联系人
        </button>
        <button
          onClick={() => onRunCommand("审阅可能的重复联系人")}
          type="button"
        >
          <AddressBook aria-hidden="true" size={15} />
          审阅重复联系人
        </button>
      </div>

      {identityResolutionCase ? (
        <AgentIdentityReviewCard
          identityCase={identityResolutionCase}
          onCaseUpdated={onIdentityCaseUpdated}
          onResolved={onIdentityResolved}
        />
      ) : createOpen ? (
        <AgentCreatePersonCard
          onCancel={onCancelCreate}
          onCommitted={onInitialResourcesCommitted}
          onDeferred={onIdentityDeferred}
        />
      ) : operation ? (
        <div
          className="context-agent-operation"
          data-status={operation.status}
        >
          <p className="context-agent-user-message">{submittedObjective}</p>
          <article>
            <header>
              <span>
                {operation.status === "staged"
                  ? "已暂存"
                  : operation.status === "no_change"
                    ? "无变化"
                    : "已完成"}
              </span>
              <i>页面操作</i>
            </header>
            <strong>{operation.title}</strong>
            <p>{operation.detail}</p>
          </article>
        </div>
      ) : reviewMode && pendingCount > 0 ? (
        <div className="context-agent-page-update">
          <header>
            <span>
              <Sparkle aria-hidden="true" size={15} weight="fill" />
            </span>
            <div>
              <strong>页面变化等待审阅</strong>
              <p>
                {pendingCount} 项关联来源的事实已暂存在持续更新页面上。
              </p>
            </div>
            <i>尚未应用</i>
          </header>
          <button
            className="context-primary-button context-primary-button--compact"
            onClick={() => onRunCommand("审阅待确认的变化")}
            type="button"
          >
            在页面上审阅
            <ArrowRight aria-hidden="true" size={15} />
          </button>
        </div>
      ) : null}

      <RelationshipHistoryTimeline
        history={history}
        onReviewMerge={onReviewMerge}
      />

      {priorBrief ? (
        <div className="context-agent-page-update" data-kind="continuity">
          <header>
            <span>
              <Clock aria-hidden="true" size={15} weight="duotone" />
            </span>
            <div>
              <strong>
                {priorBrief.stale
                  ? "较早的简报已不再是当前版本"
                  : "已有一份较早简报记录"}
              </strong>
              <p>
                {priorBrief.detail} 审计历史只保留这份限定范围的回执，不保留回答正文。请再次询问，以当前获得授权的证据重新编译。
              </p>
            </div>
            <i>仅保留回执</i>
          </header>
        </div>
      ) : null}

      <form
        className="context-chat__composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (isComposing) return;
          onAsk();
        }}
      >
        <label>
          <span className="sr-only">询问这段关系</span>
          <textarea
            maxLength={1_000}
            onChange={(event) => {
              if (isComposing) {
                setCompositionDraft(event.target.value);
              } else {
                onObjectiveChange(event.target.value);
              }
            }}
            onCompositionEnd={(event) => {
              const committed = event.currentTarget.value;
              setIsComposing(false);
              setCompositionDraft(null);
              onObjectiveChange(committed);
            }}
            onCompositionStart={(event) => {
              setIsComposing(true);
              setCompositionDraft(event.currentTarget.value);
            }}
            rows={2}
            value={compositionDraft ?? objective}
          />
        </label>
        <button
          className="context-primary-button"
          disabled={isComposing || !objective.trim() || Boolean(busyLabel)}
          type="submit"
        >
          {busyLabel === "正在编译关联来源的简报" ? (
            <CircleNotch aria-hidden="true" className="spin" size={18} />
          ) : (
            <Sparkle aria-hidden="true" size={18} weight="fill" />
          )}
          询问智能助理
        </button>
      </form>

      {response ? (
        <div className="context-chat__response">
          <p className="context-agent-user-message">{submittedObjective}</p>
          <div className="context-chat__response-meta">
            <span>快照 {response.knowledge_snapshot_id.slice(0, 8)}</span>
            <span>清单 {response.context_manifest_id.slice(0, 8)}</span>
            <span>{response.disposition.replaceAll("_", " ")}</span>
          </div>
          {response.blocks.map((block) => (
            <article data-kind={block.kind} key={block.id}>
              <header>
                <span>{block.kind.replaceAll("_", " ")}</span>
                <i>{block.status.replaceAll("_", " ")}</i>
              </header>
              <h2>{block.title}</h2>
              <p>{block.body}</p>
              {block.calendar_draft && block.calendar_draft.source_request_id === response.task_id ? <MeetingDraftHandoff draft={block.calendar_draft} persistence="unbound" /> : null}
              <footer>
                <span>
                  <LinkSimple aria-hidden="true" size={14} />
                  {block.citation_dependency_ids.length} 条受治理引用
                </span>
                {block.requires_user_decision && !block.calendar_draft ? (
                  reviewMode ? (
                    <a href="#next-move">
                      行动前审阅
                      <ArrowRight aria-hidden="true" size={14} />
                    </a>
                  ) : (
                    <a
                      href="#relationship-resources"
                      onClick={(event) => {
                        event.preventDefault();
                        onReviewSources();
                      }}
                    >
                      审阅来源
                      <ArrowRight aria-hidden="true" size={14} />
                    </a>
                  )
                ) : null}
              </footer>
            </article>
          ))}
          {response.memory_proposal ? (
            <div>
              <Button asChild variant="outline">
                <Link href={`/workspace/people/${encodeURIComponent(scope.person.id)}#person-memory-pending`}>
                  {t("审阅记忆建议")} <ArrowRight aria-hidden="true" size={14} />
                </Link>
              </Button>
              <p>{t("核对后由你决定是否保存。")}</p>
            </div>
          ) : null}
          <RunArtifacts taskID={response.task_id} />
          <ProductFeedback key={response.task_id} taskID={response.task_id} onCorrect={text => onObjectiveChange(`请修改上一条回答：${text}`)} />
        </div>
      ) : (
        <p className="context-chat__empty">
          {reviewMode
            ? "在你询问前不会生成任何综合内容。拟议事实会作为审阅项保持可见；生成的行动绝不会从聊天中执行。"
            : "需要简报时再询问。来源账本始终是稳定对象，聊天只是它上面的任务专属视图。"}
        </p>
      )}
    </section>
  );
}
