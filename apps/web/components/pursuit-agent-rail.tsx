"use client";

import type { AgentTaskProjection } from "@talent-signal/contracts";
import {
  ArrowRight,
  CheckCircle,
  ClockCounterClockwise,
  FileText,
  Pause,
  ShieldCheck,
  Sparkle,
  WarningCircle,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  initialAgentTaskStreamState,
  reduceAgentTaskStream,
  type AgentTaskStreamFrame,
} from "@/lib/agentTaskStream";
import {
  workspaceSessionExpired,
  workspaceSessionFetch,
} from "./workspace-session-request";
import styles from "./pursuit-agent-rail.module.css";

type Props = {
  pursuit: {
    id: string;
    title: string;
    revision: number;
    milestone: string;
  };
  agentContext: {
    captureId: string;
    evidenceRefs: string[];
  } | null;
  initialTask: AgentTaskProjection | null;
  evidenceHref: string | null;
  eventStreamHref?: string;
};

const runningStatuses = new Set<AgentTaskProjection["status"]>(["active"]);

const statusCopy: Record<AgentTaskProjection["status"], string> = {
  active: "正在核对相关资料",
  waiting_for_clarification: "等待一项澄清",
  waiting_for_domain_decision: "等待你的决定",
  waiting_for_external: "等待外部结果核验",
  needs_rebase: "目标已更新，需要重新核对",
  completed: "简报已完成",
  no_action: "当前无需新增行动",
  abstained: "已安全停止，可由你决定是否继续",
  failed: "运行未完成，没有规范状态被改变",
  cancelled: "任务已取消",
  expired: "任务已过期",
};

function formatObservedAt(value: string | null): string {
  if (!value) return "未记录观察时间";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        timeZone: "UTC",
      }).format(parsed);
}

export function PursuitAgentRail({
  pursuit,
  agentContext,
  initialTask,
  evidenceHref,
  eventStreamHref,
}: Props) {
  const [task, setTask] = useState(initialTask);
  const [streamState, setStreamState] = useState(() =>
    initialAgentTaskStreamState(initialTask),
  );
  const [busy, setBusy] = useState<"create" | "cancel" | "">("");
  const [error, setError] = useState<string | null>(null);
  const objective = useMemo(
    () =>
      `为“${pursuit.title}”准备通话前简报：只使用已审阅且仍获授权的证据，说明发生了什么、当前依赖，以及一个最小安全下一步；证据不足时明确记录无需行动。`,
    [pursuit.title],
  );
  const taskId = task?.id ?? null;

  useEffect(() => {
    if (!taskId) return;
    const source = new EventSource(
      eventStreamHref ?? `/api/pursuit-agent-tasks/${taskId}/stream?after=0`,
    );
    const consume = (event: MessageEvent<string>) => {
      try {
        const frame = JSON.parse(event.data) as AgentTaskStreamFrame;
        setStreamState((current) => {
          try {
            return reduceAgentTaskStream(current, frame);
          } catch {
            return {
              ...current,
              connected: false,
              transportError: "收到无法识别的任务事件；正在以规范读回恢复。",
            };
          }
        });
        if (frame.type === "snapshot") {
          setTask(frame.task);
          if (!runningStatuses.has(frame.task.status)) {
            source.close();
          }
        }
      } catch {
        setStreamState((current) => ({
          ...current,
          transportError: "收到无法识别的任务事件；正在以规范读回恢复。",
        }));
      }
    };
    source.addEventListener("stream-open", consume as EventListener);
    source.addEventListener("task-event", consume as EventListener);
    source.addEventListener("task-snapshot", consume as EventListener);
    source.addEventListener("content-block", consume as EventListener);
    source.addEventListener("stream-error", consume as EventListener);
    source.onopen = () => {
      setStreamState((current) =>
        reduceAgentTaskStream(current, {
          taskId,
          type: "stream_open",
        }),
      );
    };
    source.onerror = () => {
      setStreamState((current) => ({ ...current, connected: false }));
    };
    return () => source.close();
  }, [eventStreamHref, taskId]);

  async function createTask() {
    if (!agentContext || busy) return;
    setBusy("create");
    setError(null);
    try {
      const response = await workspaceSessionFetch("/api/pursuit-agent-tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pursuit_id: pursuit.id,
          idempotency_key: crypto.randomUUID(),
          client_event_id: crypto.randomUUID(),
          expected_revision: pursuit.revision,
          task_kind: "pre_call_briefing",
          capture_id: agentContext.captureId,
          objective,
          evidence_refs: agentContext.evidenceRefs,
        }),
      });
      const payload = (await response.json()) as {
        task?: AgentTaskProjection;
        error?: { message?: string; details?: { task_id?: string } };
      };
      if (workspaceSessionExpired(response.status, payload)) return;
      if (response.status === 409 && payload.error?.details?.task_id) {
        const existing = await workspaceSessionFetch(
          `/api/pursuit-agent-tasks/${payload.error.details.task_id}`,
        );
        const existingPayload = (await existing.json()) as {
          task?: AgentTaskProjection;
        };
        if (existing.ok && existingPayload.task) {
          setTask(existingPayload.task);
          return;
        }
      }
      if (!response.ok || !payload.task) {
        throw new Error(
          payload.error?.message ??
            "任务未被可靠接受；没有规范状态被改变。",
        );
      }
      setTask(payload.task);
      setStreamState(initialAgentTaskStreamState(payload.task));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "任务未被可靠接受；没有规范状态被改变。",
      );
    } finally {
      setBusy("");
    }
  }

  async function cancelTask() {
    if (!task || task.status !== "active" || busy) return;
    setBusy("cancel");
    setError(null);
    try {
      const response = await workspaceSessionFetch(
        `/api/pursuit-agent-tasks/${task.id}/cancel`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            idempotency_key: crypto.randomUUID(),
            expected_revision: task.task_revision,
            reason: "Recruiter cancelled the pre-call briefing.",
          }),
        },
      );
      const payload = (await response.json()) as {
        task?: AgentTaskProjection;
        error?: { message?: string };
      };
      if (workspaceSessionExpired(response.status, payload)) return;
      if (!response.ok || !payload.task) {
        throw new Error(payload.error?.message ?? "无法核验取消结果。");
      }
      setTask(payload.task);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法核验取消结果。");
    } finally {
      setBusy("");
    }
  }

  const artifact = task?.artifact ?? null;
  const isStale = artifact?.status === "stale";
  const proposalID = task?.decision_bundle?.proposal_id ??
    task?.latest_run?.proposal_id ?? null;

  return (
    <aside className={styles.rail} aria-labelledby="pursuit-agent-title">
      <header className={styles.header}>
        <div className={styles.mark} aria-hidden="true">
          <Sparkle size={17} weight="fill" />
        </div>
        <div>
          <p>当前简报</p>
          <h2 id="pursuit-agent-title">现在最重要的是什么</h2>
        </div>
        <ShieldCheck aria-label="仅限审阅；没有外部效果" size={21} />
      </header>

      {!task ? (
        <div className={styles.start}>
          <p>
            先给出变化、当前依赖和一项最小下一步。简报不会确认事实、评价候选人或执行外部动作。
          </p>
          {agentContext ? (
            <>
              <span>
                将读取 {agentContext.evidenceRefs.length} 条已审阅证据 · 修订版本 {pursuit.revision}
              </span>
              <button disabled={busy === "create"} onClick={() => void createTask()}>
                {busy === "create" ? "正在接受任务…" : "准备通话前简报"}
                <ArrowRight aria-hidden="true" size={16} />
              </button>
            </>
          ) : (
            <div className={styles.boundary}>
              <WarningCircle aria-hidden="true" size={18} />
              <p>
                <strong>还不能形成有根据的简报。</strong>
                <span>先关联并审阅资料，再生成有依据的简报。</span>
              </p>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className={styles.status} data-status={task.status}>
            {task.status === "active" ? (
              <ClockCounterClockwise aria-hidden="true" size={18} />
            ) : task.status === "failed" || task.status === "needs_rebase" ? (
              <WarningCircle aria-hidden="true" size={18} />
            ) : (
              <CheckCircle aria-hidden="true" size={18} />
            )}
            <p>
              <strong>{statusCopy[task.status]}</strong>
              <span>
                任务修订 {task.task_revision} · 事件 {Math.max(task.latest_sequence, streamState.latestSequence)} · 外部效果 0
              </span>
            </p>
            {task.status === "active" ? (
              <button disabled={busy === "cancel"} onClick={() => void cancelTask()}>
                <Pause aria-hidden="true" size={14} />
                取消
              </button>
            ) : null}
          </div>

          {streamState.steps.length > 0 ? (
            <>
              <p className={styles.srOnly} aria-live="polite" role="status">
                {streamState.steps.at(-1)?.label}
              </p>
              <ol className={styles.progress} aria-label="任务处理过程">
                {streamState.steps.slice(-6).map((step) => (
                  <li
                    data-status={
                      step.status === "current" &&
                      step.sequence < streamState.latestSequence
                        ? "complete"
                        : step.status
                    }
                    key={step.eventId}
                  >
                    <span aria-hidden="true" />
                    <p>
                      <strong>{step.label}</strong>
                      <small>{step.detail}</small>
                    </p>
                  </li>
                ))}
                {task.status === "active" ? (
                  <li data-status="current">
                    <span aria-hidden="true" />
                    <p>
                      <strong>正在形成当前简报</strong>
                      <small>
                        {streamState.connected
                          ? "事件流已连接；只展示可核验阶段，不展示模型私有推理。"
                          : "正在重连；任务继续由后端持有，刷新不会重复执行。"}
                      </small>
                    </p>
                  </li>
                ) : null}
              </ol>
            </>
          ) : null}

          {task.status === "waiting_for_clarification" && task.clarification ? (
            <section className={styles.handoff} data-kind="clarification">
              <p className={styles.label}>需要准确澄清</p>
              <h3>{task.clarification.question}</h3>
              <p>{task.clarification.reason}</p>
              <span>
                这里不会自动执行动作。先确认回答与任务范围，再决定下一步。
              </span>
            </section>
          ) : null}

          {task.status === "waiting_for_domain_decision" && task.decision_bundle ? (
            <section className={styles.handoff} data-kind="decision">
              <p className={styles.label}>等待你的决定</p>
              <h3>{task.decision_bundle.dependency}</h3>
              <p>
                {task.decision_bundle.items.filter((item) => item.status === "open").length} 项提案仍未决定。事实确认与行动批准保持分离。
              </p>
              <Link href={`/workspace/pursuits/${pursuit.id}#proposal`}>
                在受影响对象上审阅
                <ArrowRight aria-hidden="true" size={15} />
              </Link>
            </section>
          ) : null}

          {!artifact && streamState.blocks.length > 0 ? (
            <div className={styles.streamBriefing}>
              {streamState.blocks.map((block) => (
                <section data-kind={block.kind} data-status={block.status} key={block.id}>
                  <p className={styles.label}>{block.title}</p>
                  <p>{block.text || "正在形成…"}</p>
                  {block.citationIds.length > 0 ? (
                    evidenceHref ? (
                      <Link href={evidenceHref}>
                        {block.citationIds.length} 条来源可核对
                      </Link>
                    ) : (
                      <span>{block.citationIds.length} 条来源可核对</span>
                    )
                  ) : null}
                </section>
              ))}
            </div>
          ) : artifact ? (
            <div className={styles.briefing} data-stale={isStale || undefined}>
              <section>
                <p className={styles.label}>发生了什么</p>
                {isStale ? (
                  <div className={styles.stale}>
                    来源权限、内容或有效期已经变化。以下内容只保留为历史，不再作为当前证据。
                  </div>
                ) : null}
                {artifact.what_changed.length ? (
                  <ol className={styles.claims}>
                    {artifact.what_changed.map((claim) => (
                      <li key={claim.id}>
                        <FileText aria-hidden="true" size={16} />
                        <div>
                          <p>{claim.statement}</p>
                          <span>
                            {claim.epistemic_status === "observed_evidence"
                              ? "已审阅的来源内容"
                              : claim.epistemic_status}
                            {" · "}
                            {formatObservedAt(claim.observed_at)}
                          </span>
                        </div>
                        {evidenceHref ? <Link href={evidenceHref}>证据</Link> : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className={styles.quiet}>没有足够的新证据可列为变化。</p>
                )}
              </section>

              <section className={styles.dependency}>
                <p className={styles.label}>当前依赖</p>
                <h3>{artifact.what_matters_now.dependency}</h3>
                <p>{artifact.what_matters_now.reason}</p>
              </section>

              <section className={styles.nextMove}>
                <p className={styles.label}>我能做什么</p>
                <strong>{artifact.next_move.label}</strong>
                <span>{artifact.next_move.reason}</span>
                {proposalID ? (
                  <Link href={`/workspace/pursuits/${pursuit.id}#proposal`}>
                    审阅准确提案
                    <ArrowRight aria-hidden="true" size={15} />
                  </Link>
                ) : null}
              </section>

              <details className={styles.details}>
                <summary>范围与限制</summary>
                <ul>
                  {artifact.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
                <p>
                  快照修订 {task.semantic_snapshot.pursuit_revision} · 观察于 {formatObservedAt(artifact.observed_at)}
                </p>
              </details>
            </div>
          ) : task.status === "active" ? (
            <div className={styles.working} role="status" aria-live="polite">
              <span aria-hidden="true" />
              <p>
                <strong>正在重建公开任务状态并核对最小证据清单。</strong>
                <span>离开页面不会丢失任务；返回时以规范快照为准。</span>
              </p>
            </div>
          ) : null}

          {streamState.transportError ? (
            <p className={styles.transportNote} role="status">
              {streamState.transportError}
            </p>
          ) : null}
        </>
      )}

      {error ? (
        <div className={styles.error} role="alert">
          <WarningCircle aria-hidden="true" size={18} />
          <p>{error}</p>
        </div>
      ) : null}
    </aside>
  );
}
