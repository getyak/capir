import type { WorkspaceReviewResponse } from "@talent-signal/contracts";
import { LinkSimple } from "@phosphor-icons/react";

import { fieldLabel, formatDate } from "./relationship-display";

export function relationshipEvidenceProjectionState(
  workspace: WorkspaceReviewResponse,
) {
  return {
    active: workspace.confirmed_state.assertions.filter(
      (state) => state.state_status === "active",
    ),
    historical: workspace.confirmed_state.assertions.filter(
      (state) => state.state_status !== "active",
    ),
    sourceAuthorizationAvailable:
      workspace.source_authorization.state === "authorized",
  };
}

export function RelationshipEvidenceProjection({
  workspace,
}: {
  workspace: WorkspaceReviewResponse;
}) {
  const { active, historical, sourceAuthorizationAvailable } =
    relationshipEvidenceProjectionState(workspace);

  return (
    <>
      <section aria-labelledby="confirmed-title" className="context-section">
        <div className="context-section__heading">
          <div>
            <p className="eyebrow">已知背景</p>
            <h2 id="confirmed-title">在此关系中已确认</h2>
          </div>
          <span>{active.length} 项当前有效</span>
        </div>
        {active.length > 0 ? (
          <dl className="context-known">
            {active.map((state) => (
              <div key={state.id}>
                <dt>{fieldLabel(state.field)}</dt>
                <dd>{state.value}</dd>
                <a href={`#source-${state.evidence_id}`}>
                  <LinkSimple aria-hidden="true" size={15} />
                  来源
                </a>
              </div>
            ))}
          </dl>
        ) : (
          <p className="context-section__empty">
            确认一项拟议事实后，它才会出现在这里。模型输出本身绝不会变成已记住的背景。
          </p>
        )}
        {historical.length > 0 ? (
          <details className="context-retention context-known-history">
            <summary>先前事实版本（{historical.length}）</summary>
            <dl>
              {historical.map((state) => (
                <div key={state.id}>
                  <dt>{fieldLabel(state.field)}</dt>
                  <dd>
                    {state.value} · {state.state_status}
                  </dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}
      </section>

      <section
        aria-labelledby="source-title"
        className="context-section"
        id="source-evidence"
      >
        <div className="context-section__heading">
          <div>
            <p className="eyebrow">来源</p>
            <h2 id="source-title">已审阅的提取文本</h2>
          </div>
          <span>{workspace.source_authorization.state}</span>
        </div>
        <div className="context-source-list">
          {workspace.capture.messages.map((message) => (
            <figure id={`source-${message.id}`} key={message.id} tabIndex={-1}>
              <figcaption>
                <span>{message.speaker}</span>
                <small>{message.source_message_id}</small>
              </figcaption>
              <blockquote>
                {message.text ??
                  (sourceAuthorizationAvailable
                    ? "来源文本已不再保留。"
                    : `来源授权状态为 ${workspace.source_authorization.state}。请先从来源中恢复或续期，再审阅证据。`)}
              </blockquote>
            </figure>
          ))}
        </div>
        <details className="context-retention">
          <summary>留存与来源</summary>
          <dl>
            <div>
              <dt>已存来源</dt>
              <dd>{workspace.capture.source.retention.source_scope}</dd>
            </div>
            <div>
              <dt>原始截图</dt>
              <dd>capri 不会保存</dd>
            </div>
            <div>
              <dt>留存至</dt>
              <dd>
                {workspace.capture.source.retention.retention_until
                  ? formatDate(
                      workspace.capture.source.retention.retention_until,
                    )
                  : "审阅完成"}
              </dd>
            </div>
            <div>
              <dt>生成方</dt>
              <dd>{workspace.analysis.producer.name}</dd>
            </div>
          </dl>
        </details>
      </section>
    </>
  );
}
