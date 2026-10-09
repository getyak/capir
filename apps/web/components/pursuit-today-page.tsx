"use client";

import {
  ArrowRight,
  CheckCircle,
  ShieldCheck,
  Sparkle,
  WarningCircle,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import {
  TODAY_FOCUSED_ITEM_LIMIT,
  type PursuitTodayItem,
  type PursuitTodayProjection,
} from "@/lib/pursuitToday";
import {
  appendWebTrace,
  beginWebTrace,
  completeWebTrace,
  traceSpanId,
  type WebTraceHandle,
} from "@/lib/telemetry";
import { useWorkspaceSessionRecovery } from "./use-workspace-session-recovery";
import {
  workspaceSessionExpired,
  workspaceSessionFetch,
} from "./workspace-session-request";
import { WorkspaceDisconnectedState } from "./workspace-disconnected-state";
import styles from "./pursuit-today-page.module.css";
import { PursuitDeadline } from "./pursuit-deadline";

type Props = {
  error: string | null;
  expanded: boolean;
  projection: PursuitTodayProjection | null;
  providerMode: "live_remote" | "safe_deterministic";
  sessionRecoveryHref: string | null;
};

type AgentResult = {
  status: string;
  proposalId: string | null;
  reason: string;
  externalEffectCount: number;
};

const evidenceCopy = {
  available: "证据可用",
  partial: "部分证据可用",
  unavailable: "证据不可用",
  not_required: "由你记录",
} as const;

function formatDate(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  const fields = new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(date);
  const pick = (type: string) => fields.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")} 年 ${pick("month")} 月 ${pick("day")} 日`;
}


function kindCopy(item: PursuitTodayItem): string {
  if (item.attentionKind === "review") {
    return item.proposalStatus === "needs_review"
      ? "可作决定"
      : "恢复审阅";
  }
  if (item.attentionKind === "action") return "已分配行动";
  return "待解决依赖项";
}

function pursuitHref(item: PursuitTodayItem): string {
  const room = `/workspace/pursuits/${item.pursuitId}`;
  return item.attentionKind === "review" &&
    item.proposalStatus === "needs_review"
    ? `${room}#proposal`
    : room;
}

const valueLabels: Record<string, string> = {
  accepted_offer: "接受录用意向",
  active: "进行中",
  evidence_review: "证据审阅",
  final_conversation: "最终沟通",
  interviewing: "面试中",
  mutual_final_decision: "双方最终决定",
  no_action: "无需行动",
  offer_review: "录用意向审阅",
  proposal_staged: "提案已暂存",
  shortlist_review: "候选名单审阅",
};

function humanize(value: string): string {
  return valueLabels[value] ?? value.replaceAll("_", " ");
}

function AgentComposer({
  item,
  providerMode,
  sessionRecoveryHref,
}: {
  item: PursuitTodayItem;
  providerMode: Props["providerMode"];
  sessionRecoveryHref: string | null;
}) {
  const router = useRouter();
  const defaultObjective = useMemo(
    () =>
      `只审阅“${item.title}”范围内已授权的证据。暂存一项最小且有证据支持的目标更新；如果没有安全、真实的变化，则记录无需行动。`,
    [item.title],
  );
  const [objective, setObjective] = useState(defaultObjective);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AgentResult | null>(null);

  async function runAgent() {
    if (
      !item.agentContext ||
      submitting ||
      sessionRecoveryHref ||
      !objective.trim()
    ) {
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    let trace: WebTraceHandle | null = null;
    const apiStartedAt = new Date().toISOString();
    try {
      trace = await beginWebTrace({
        name: "pursuit.agent.submit",
        route: "/workspace/today",
        text: objective.trim(),
        dataClassification:
          providerMode === "live_remote" ? "synthetic" : "private_relationship",
        authorizationScope: `pursuit:${item.pursuitId}`,
        attributes: {
          "ts.ui.event": "agent_submission_started",
          "ts.pursuit.id": item.pursuitId,
          "ts.evidence.reference_count": item.agentContext.evidenceRefs.length,
        },
      });
      const response = await workspaceSessionFetch("/api/pursuit-agent-runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pursuit_id: item.pursuitId,
          idempotency_key: crypto.randomUUID(),
          capture_id: item.agentContext.captureId,
          base_revision: item.revision,
          objective: objective.trim(),
          evidence_refs: item.agentContext.evidenceRefs,
          telemetry: {
            trace_id: trace.trace_id,
            parent_span_id: trace.root_span_id,
            interaction_id: trace.interaction_id,
          },
        }),
      });
      const payload = (await response.json()) as {
        run?: {
          status: string;
          terminal_receipt: {
            proposal_id: string | null;
            reason_code: string;
            external_effects: unknown[];
          } | null;
        };
        error?: { message?: string };
      };
      if (workspaceSessionExpired(response.status, payload)) return;
      if (!response.ok || !payload.run?.terminal_receipt) {
        throw new Error(
          payload.error?.message ??
            "无法核验智能助理结果，任何状态都没有改变。",
        );
      }
      setResult({
        status: payload.run.status,
        proposalId: payload.run.terminal_receipt.proposal_id,
        reason: payload.run.terminal_receipt.reason_code,
        externalEffectCount:
          payload.run.terminal_receipt.external_effects.length,
      });
      const endedAt = new Date().toISOString();
      await appendWebTrace(trace, {
        spans: [
          {
            span_id: traceSpanId(trace, "pursuit-agent-api"),
            parent_span_id: trace.root_span_id,
            name: "http POST /api/pursuit-agent-runs",
            kind: "client",
            status: "ok",
            started_at: apiStartedAt,
            ended_at: endedAt,
            attributes: {
              "http.response.status_code": response.status,
              "ts.agent.status": payload.run.status,
              "ts.agent.reason_code": payload.run.terminal_receipt.reason_code,
            },
            artifact_refs: trace.artifact_ids,
            agent_run_id: null,
            agent_event_sequence: null,
          },
        ],
        events: [
          {
            event_id: crypto.randomUUID(),
            span_id: trace.root_span_id,
            name: "agent_result_rendered",
            occurred_at: endedAt,
            attributes: { "ts.agent.status": payload.run.status },
            artifact_refs: trace.artifact_ids,
          },
        ],
      });
      await completeWebTrace(trace, {
        status: "ok",
        attributes: { "ts.agent.status": payload.run.status },
      });
      router.refresh();
    } catch (caught) {
      if (trace) {
        await appendWebTrace(trace, {
          spans: [
            {
              span_id: traceSpanId(trace, "pursuit-agent-api-error"),
              parent_span_id: trace.root_span_id,
              name: "http POST /api/pursuit-agent-runs",
              kind: "client",
              status: "error",
              started_at: apiStartedAt,
              ended_at: new Date().toISOString(),
              attributes: { "error.type": "pursuit_agent_failed" },
              artifact_refs: trace.artifact_ids,
              agent_run_id: null,
              agent_event_sequence: null,
            },
          ],
          events: [],
        }).catch(() => undefined);
        await completeWebTrace(trace, {
          status: "error",
          errorCode: "PURSUIT_AGENT_FAILED",
        }).catch(() => undefined);
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "智能助理未能完成，任何状态都没有改变。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const successfulResult =
    result?.status === "proposal_staged" || result?.status === "no_action";

  // The composer only exists for an eligible item with a reviewed, authorized
  // capture; anything else is explained by the ordinary no-evidence note.
  if (!item.agentContext) return null;

  return (
    <section className={styles.agent} aria-labelledby="agent-composer-title">
      <header>
        <span aria-hidden="true">
          <Sparkle size={18} weight="fill" />
        </span>
        <div>
          <h3 id="agent-composer-title">在本次目标范围内询问</h3>
          <p>
            {providerMode === "live_remote"
              ? "固定远程模型 · 仅处理合成内容 · 四项受治理工具"
              : "安全的确定性服务 · 不进行模型推断"}
          </p>
        </div>
        <ShieldCheck aria-label="仅供审阅；无外部效果" size={20} />
      </header>

      <label htmlFor={`objective-${item.pursuitId}`}>运行目标</label>
      <textarea
        id={`objective-${item.pursuitId}`}
        maxLength={1_000}
        onChange={(event) => setObjective(event.target.value)}
        rows={3}
        value={objective}
      />
      <div className={styles.agentActions}>
        <p>
          读取 {item.agentContext.evidenceRefs.length} 条准确证据片段。输出只会是提案或无需行动。
        </p>
        <button
          disabled={
            submitting || Boolean(sessionRecoveryHref) || !objective.trim()
          }
          onClick={runAgent}
          type="button"
        >
          {submitting ? "正在执行边界检查…" : "运行有边界的智能助理"}
          {!submitting && <ArrowRight aria-hidden="true" size={16} />}
        </button>
      </div>

      {error ? (
        <div className={styles.runError} role="alert">
          <WarningCircle aria-hidden="true" size={19} />
          <p>
            <strong>运行结果未核验</strong>
            <span>{error}</span>
          </p>
        </div>
      ) : null}

      {result ? (
        <div
          className={successfulResult ? styles.runResult : styles.runStopped}
          role="status"
          aria-live="polite"
        >
          {successfulResult ? (
            <CheckCircle aria-hidden="true" size={20} weight="fill" />
          ) : (
            <WarningCircle aria-hidden="true" size={20} weight="fill" />
          )}
          <div>
            <strong>
              {result.status === "proposal_staged"
                ? "提案已暂存，等待审阅"
                : result.status === "no_action"
                  ? "有证据支持的结果是无需行动"
                  : `智能助理已安全停止：${humanize(result.status)}`}
            </strong>
            <p>
              {humanize(result.reason)} · {result.externalEffectCount} 项外部效果
            </p>
          </div>
          {result.proposalId ? (
            <Link href={`/workspace/pursuits/${item.pursuitId}#proposal`}>
              审阅
              <ArrowRight aria-hidden="true" size={15} />
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function evidenceAuthorityNote(item: PursuitTodayItem): string {
  // The authority distinction stays exact: an unavailable source is a
  // permission problem, anything else simply lacks a reviewed, authorized
  // capture to quote.
  return item.evidenceState === "unavailable"
    ? "来源权限不可用，因此新的运行无法引用它。"
    : "该目标尚未关联经过审阅且获得授权的采集内容。";
}

function FocusItem({
  item,
  providerMode,
  sessionRecoveryHref,
}: {
  item: PursuitTodayItem;
  providerMode: Props["providerMode"];
  sessionRecoveryHref: string | null;
}) {
  const metaLine = [
    item.action ? `负责人：${item.action.owner}` : null,
    `目标 ${formatDate(item.targetDate)}`,
  ].filter((part): part is string => Boolean(part));
  const evidenceFlagged =
    item.evidenceState === "unavailable" || item.evidenceState === "partial";
  return (
    <article
      className={styles.focus}
      data-attention-kind={item.attentionKind}
      data-evidence-state={item.evidenceState}
    >
      <p className={styles.kicker}>
        <span>{kindCopy(item)}</span>
        {item.action ? (
          <span>
            <PursuitDeadline value={item.action.dueAt} compact /> 截止
          </span>
        ) : null}
      </p>
      <h2>{item.attentionTitle}</h2>
      <p className={styles.contextLine}>
        {item.personLabel ? `${item.personLabel} · ` : ""}
        {item.title}
      </p>
      {item.attentionKind === "review" ? (
        <p className={styles.focusDetail}>{item.attentionDetail}</p>
      ) : null}

      <dl className={styles.focusFacts}>
        <div>
          <dt>目标结果</dt>
          <dd>{humanize(item.targetOutcome)}</dd>
        </div>
        <div>
          <dt>当前里程碑</dt>
          <dd>{humanize(item.milestone)}</dd>
        </div>
      </dl>

      {item.gap || (item.action && item.attentionKind !== "action") ? (
        <div className={styles.supportingWork}>
          {item.gap ? (
            <div>
              <span>关闭条件</span>
              <p>{item.gap.closeCondition}</p>
            </div>
          ) : null}
          {item.action && item.attentionKind !== "action" ? (
            <div>
              <span>已分配行动</span>
              <p>{item.action.title}</p>
              <small>
                {item.action.owner} · <PursuitDeadline value={item.action.dueAt} />
              </small>
            </div>
          ) : null}
        </div>
      ) : null}

      <p className={styles.focusMeta}>
        <span>{metaLine.join(" · ")}</span>
        <span
          className={evidenceFlagged ? styles.evidenceFlag : styles.evidenceQuiet}
          data-evidence-state={item.evidenceState}
        >
          {evidenceFlagged ? <WarningCircle aria-hidden="true" size={15} /> : null}
          {evidenceCopy[item.evidenceState]}
        </span>
      </p>

      <details className={styles.focusDetails}>
        <summary>来源与记录</summary>
        <div>
          <p>
            证据来源：
            {item.agentContext
              ? `已审阅且获授权的采集内容 · ${item.agentContext.evidenceRefs.length} 条准确证据片段。`
              : "此视图没有可引用的已授权采集内容。"}
          </p>
          <p>修订版本 {item.revision}。打开此视图不会改变任何状态。</p>
        </div>
      </details>

      {item.attentionKind !== "review" && !item.agentContext ? (
        <p className={styles.evidenceNote}>{evidenceAuthorityNote(item)}</p>
      ) : null}

      <div className={styles.focusLink}>
        <Link href={pursuitHref(item)}>
          {item.attentionKind === "review" &&
          item.proposalStatus === "needs_review"
            ? "审阅提案"
            : "打开目标工作区"}
          <ArrowRight aria-hidden="true" size={17} />
        </Link>
      </div>

      {item.attentionKind !== "review" && item.agentContext ? (
        <AgentComposer
          item={item}
          providerMode={providerMode}
          sessionRecoveryHref={sessionRecoveryHref}
        />
      ) : null}
    </article>
  );
}

function Continuation({ item }: { item: PursuitTodayItem }) {
  return (
    <Link
      className={styles.continuation}
      href={pursuitHref(item)}
    >
      <div>
        <span>{kindCopy(item)}</span>
        <span>{evidenceCopy[item.evidenceState]}</span>
      </div>
      <h3>{item.attentionTitle}</h3>
      <p>
        {item.personLabel ? `${item.personLabel} · ` : ""}
        {item.title}
      </p>
      <footer>
        <span>{formatDate(item.targetDate)}</span>
        {item.action ? <span><PursuitDeadline value={item.action.dueAt} /></span> : null}
        <ArrowRight aria-hidden="true" size={16} />
      </footer>
    </Link>
  );
}

export function PursuitTodayPage({
  error,
  expanded,
  projection,
  providerMode,
  sessionRecoveryHref,
}: Props) {
  const { sessionRecoveryHref: activeSessionRecoveryHref } =
    useWorkspaceSessionRecovery(sessionRecoveryHref);
  const focus = projection?.items[0] ?? null;
  const continuations = projection?.items.slice(1) ?? [];
  const hiddenAttentionCount = Math.max(
    0,
    (projection?.attentionCount ?? 0) - (projection?.items.length ?? 0),
  );

  return (
    <div className={styles.pageShell}>
      <main className={styles.main} id="main-content" tabIndex={-1}>
        <header className={styles.hero}>
          <div>
            <h1>今日</h1>
            <p>把注意力留给现在值得推进的一步。</p>
          </div>
        </header>

        {activeSessionRecoveryHref && !error ? (
          <section
            className={`${styles.pageError} ${styles.sessionRecovery}`}
            role="alert"
          >
            <WarningCircle aria-hidden="true" size={23} />
            <div>
              <h2>登录后继续本次目标。</h2>
              <p>
                上一次核验的今日视图仍保持可见。在账号会话恢复前，新的智能助理与审阅写入都会暂停。
              </p>
              <Link href={activeSessionRecoveryHref}>重新登录</Link>
            </div>
          </section>
        ) : null}

        {error ? (
          <div className={styles.errorStack}>
            {activeSessionRecoveryHref ? (
              <section className={styles.pageError} role="alert">
                <WarningCircle aria-hidden="true" size={23} />
                <div>
                  <h2>重新登录后继续今日事项。</h2>
                  <p>账号会话已失效，已保存的内容不会丢失。</p>
                  <Link href={activeSessionRecoveryHref}>重新登录</Link>
                </div>
              </section>
            ) : (
              <WorkspaceDisconnectedState
                description="连接恢复后，即可继续查看需要关注的人物与事项。已保存的内容不会丢失。"
                hint="可以先返回对话，或稍后重新载入本页。"
                primaryHref="/workspace/today"
                primaryLabel="重新载入"
                secondaryHref="/workspace"
                secondaryLabel="返回对话"
                title="稍后继续今日事项。"
              />
            )}
            <details><summary>错误详情</summary><p>{error}</p></details>
          </div>
        ) : focus ? (
          <div className={styles.todayGrid}>
            <section aria-label="重点">
              <FocusItem
                item={focus}
                key={focus.pursuitId}
                providerMode={providerMode}
                sessionRecoveryHref={activeSessionRecoveryHref}
              />
            </section>
            <aside aria-labelledby="continue-heading">
              <h2 className={styles.railTitle} id="continue-heading">
                继续
              </h2>
              {continuations.length > 0 ? (
                <div className={styles.continuations}>
                  {continuations.map((item) => (
                    <Continuation item={item} key={item.pursuitId} />
                  ))}
                </div>
              ) : (
                <div className={styles.quietState}>
                  <p>暂时没有其他事项需要你决定。</p>
                  <span>有新的变化时，会在这里出现。</span>
                </div>
              )}
              {hiddenAttentionCount > 0 ? (
                <div className={styles.queueBoundary}>
                  <p>
                    <strong>
                      {hiddenAttentionCount} 项较低优先级内容保持安静。
                    </strong>
                    <span>
                      当你明确需要时可以打开完整队列；它不会默认进入聚焦视图。
                    </span>
                  </p>
                  <Link href="/workspace/today?view=all">
                    打开完整队列
                    <ArrowRight aria-hidden="true" size={15} />
                  </Link>
                </div>
              ) : expanded &&
                (projection?.attentionCount ?? 0) >
                  TODAY_FOCUSED_ITEM_LIMIT ? (
                <div className={styles.queueBoundary}>
                  <p>
                    <strong>完整注意事项队列已打开。</strong>
                    <span>日常工作可返回有边界的聚焦视图。</span>
                  </p>
                  <Link href="/workspace/today">返回重点</Link>
                </div>
              ) : null}
            </aside>
          </div>
        ) : (
          <section className={styles.empty}>
            <CheckCircle aria-hidden="true" size={30} weight="duotone" />
            <p className={styles.eyebrow}>没有有依据的关注事项</p>
            <h2>今天不需要凭空制造任务。</h2>
            <p>
              {projection?.totalPursuits
                ? `${projection.noActionCount} 项活跃目标没有待审阅内容、已分配行动或有证据支撑的缺口。`
                : "还没有活跃目标进入此工作台。"}
            </p>
            <Link href="/workspace">打开关系工作台</Link>
          </section>
        )}
      </main>
    </div>
  );
}
