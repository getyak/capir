"use client";

import type { RelationshipAgentHistory } from "@talent-signal/contracts";
import {
  ArrowRight,
  CheckCircle,
  Clock,
  ShieldCheck,
  Warning,
} from "@phosphor-icons/react";

export function relationshipBriefContinuityReceipt(
  history: RelationshipAgentHistory | null,
) {
  const operation = history?.operations.find(
    (candidate) => candidate.kind === "chat_brief",
  );
  if (!operation) {
    return null;
  }
  return {
    detail: operation.detail,
    occurredAt: operation.occurred_at,
    snapshotId: operation.references.knowledge_snapshot_id,
    stale: operation.status !== "completed",
  };
}

function formatRelationshipHistoryDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

export function RelationshipExternalEffectReview({
  history,
}: {
  history: RelationshipAgentHistory | null;
}) {
  const followUps = history?.external_effect_follow_ups ?? [];
  if (followUps.length === 0) {
    return null;
  }
  const unresolvedCount = followUps.filter(
    (followUp) =>
      followUp.action_status === "unknown" ||
      followUp.action_status === "executing",
  ).length;
  return (
    <section
      aria-labelledby="external-effect-review-title"
      className="context-effect-review"
      id="external-effect-review"
    >
      <header className="context-effect-review__heading">
        <div>
          <p className="eyebrow">外部效果审阅</p>
          <h2 id="external-effect-review-title">
            检查 capri 之外真实发生了什么。
          </h2>
          <p>
            这些效果尝试后，来源授权已结束。记录仍保持可见，因为失去授权无法撤销可能已经存在于其他位置的内容。
          </p>
        </div>
        <span data-has-unresolved={unresolvedCount > 0}>
          <Warning aria-hidden="true" size={16} />
          {unresolvedCount > 0
            ? `${unresolvedCount} 项结果未解决`
            : "审阅完成"}
        </span>
      </header>
      <div className="context-effect-review__list">
        {followUps.map((followUp) => {
          const unresolved =
            followUp.action_status === "unknown" ||
            followUp.action_status === "executing";
          const resultLabel = unresolved
            ? followUp.action_status === "unknown"
              ? "结果未知"
              : "仍在执行"
            : followUp.outcome?.status === "verified"
              ? "已完成 · 已核验"
              : "已完成 · 结果已记录";
          const latestEvidence = followUp.outcome
            ? followUp.outcome.summary
            : followUp.observation
              ? `目标位置观察状态为 ${followUp.observation.match_status}。`
              : followUp.attempt
                ? `最近一次尝试仍为 ${followUp.attempt.status}。`
                : "没有记录外部观察。";
          return (
            <article
              data-state={unresolved ? "unresolved" : "completed"}
              key={followUp.action_id}
            >
              <header>
                <span>{resultLabel}</span>
                <time dateTime={followUp.authorization.changed_at}>
                  授权状态 {followUp.authorization.state} ·{" "}
                  {formatRelationshipHistoryDate(
                    followUp.authorization.changed_at,
                  )}
                </time>
              </header>
              <h3>
                {followUp.target ?? followUp.action_type.replaceAll("_", " ")}
              </h3>
              {followUp.reason ? <p>{followUp.reason}</p> : null}
              <div className="context-effect-review__decision">
                {unresolved ? (
                  <Warning aria-hidden="true" size={17} />
                ) : (
                  <CheckCircle aria-hidden="true" size={17} />
                )}
                <p>
                  <strong>
                    {unresolved
                      ? "重试前先核对。"
                      : "已记录，不会表示为已撤销。"}
                  </strong>
                  <span>
                    {unresolved
                      ? "请先检查真实目标位置。没有观察结果时，系统不能安全地声称失败或完成。"
                      : "即使来源已无法授权后续工作，外部结果仍会作为历史的一部分保留。"}
                  </span>
                </p>
              </div>
              <dl>
                <div>
                  <dt>目标位置</dt>
                  <dd>{followUp.destination_key ?? "没有目标位置记录"}</dd>
                </div>
                <div>
                  <dt>最新证据</dt>
                  <dd>{latestEvidence}</dd>
                </div>
                <div>
                  <dt>尝试</dt>
                  <dd>
                    {followUp.attempt
                      ? `${followUp.attempt.status} · ${formatRelationshipHistoryDate(
                          followUp.attempt.started_at,
                        )}`
                      : "没有尝试记录"}
                  </dd>
                </div>
              </dl>
              <footer>
                <ShieldCheck aria-hidden="true" size={14} />
                未经你另行确认，系统不会联系此人或改变目标位置。
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function RelationshipHistoryTimeline({
  history,
  onReviewMerge,
}: {
  history: RelationshipAgentHistory | null;
  onReviewMerge: (operationId: string) => void;
}) {
  const followUps = history?.external_effect_follow_ups ?? [];
  if (
    !history ||
    (history.operations.length === 0 && followUps.length === 0)
  ) {
    return null;
  }
  const latest = history.operations[0];
  return (
    <details className="context-agent-history">
      <summary>
        {followUps.length > 0 ? (
          <Warning aria-hidden="true" size={15} />
        ) : (
          <Clock aria-hidden="true" size={15} />
        )}
        <span>
          <strong>关系历史</strong>
          <small>
            {followUps.length > 0
              ? `${followUps.length} 项保留的外部效果需要你审阅`
              : latest
                ? `${latest.title} · ${formatRelationshipHistoryDate(latest.occurred_at)}`
                : "受治理操作"}
          </small>
        </span>
        <i>{history.operations.length + followUps.length}</i>
      </summary>
      {followUps.length > 0 ? (
        <a
          className="context-agent-follow-up-link"
          href="#external-effect-review"
        >
          <span>
            <Warning aria-hidden="true" size={15} />
          </span>
          <p>
            <strong>审阅保留的外部效果</strong>
            <small>在持续更新的人物页面上比较目标位置证据。</small>
          </p>
          <ArrowRight aria-hidden="true" size={15} />
        </a>
      ) : null}
      <ol>
        {history.operations.slice(0, 12).map((operation) => (
          <li data-status={operation.status} key={operation.id}>
            <span aria-hidden="true" />
            <article>
              <header>
                <strong>{operation.title}</strong>
                <time dateTime={operation.occurred_at}>
                  {formatRelationshipHistoryDate(operation.occurred_at)}
                </time>
              </header>
              <p>{operation.detail}</p>
              <footer>
                <span>{operation.status.replaceAll("_", " ")}</span>
                <span>
                  {operation.actor_kind === "recruiter"
                    ? "你的决定"
                    : "系统投影"}
                </span>
                {operation.references.knowledge_snapshot_id ? (
                  <span>
                    快照 {operation.references.knowledge_snapshot_id.slice(0, 8)}
                  </span>
                ) : null}
                {operation.kind === "identity_merge" &&
                operation.status === "completed" &&
                operation.provenance.event_type === "identity.people_merged" &&
                operation.references.person_merge_operation_id ? (
                  <button
                    onClick={() =>
                      onReviewMerge(
                        operation.references.person_merge_operation_id as string,
                      )
                    }
                    type="button"
                  >
                    审阅撤销
                    <ArrowRight aria-hidden="true" size={13} />
                  </button>
                ) : null}
              </footer>
            </article>
          </li>
        ))}
      </ol>
      {history.operations.length > 12 ? (
        <p>
          显示 {history.operations.length} 项受治理操作中的最近 12 项。
        </p>
      ) : null}
    </details>
  );
}
