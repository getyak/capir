import { AvatarEditor } from "../avatar-editor";
import type {
  RelationshipScope,
  WorkspaceReviewResponse,
} from "@talent-signal/contracts";
import {
  AddressBook,
  ArrowRight,
  ChatCircleDots,
  Clock,
  EnvelopeSimple,
  FileImage,
  LinkedinLogo,
  LinkSimple,
  Phone,
  FolderOpen,
  WechatLogo,
} from "@phosphor-icons/react";

import { formatDate, sourceKindLabel } from "./relationship-display";

type Scope = Pick<RelationshipScope, "person" | "relationship_context">;
type ContactPoint = NonNullable<
  RelationshipScope["person"]["contact_points"]
>[number];

export function relationshipCurrentDependency(
  workspace: WorkspaceReviewResponse,
) {
  if (workspace.source_authorization.state !== "authorized") {
    return `来源访问状态：${workspace.source_authorization.state}`;
  }
  if (workspace.latest_effect?.outcome?.status === "verified") {
    return "下一步已记录";
  }
  if (
    workspace.analysis.assertions.some(
      (assertion) => assertion.review_status === "pending",
    )
  ) {
    return "证据需要审阅";
  }
  if (
    workspace.analysis.assertions.some(
      (assertion) => assertion.review_status === "confirmed",
    )
  ) {
    return "关系背景为最新状态";
  }
  return "没有已确认变化";
}

export function contactPointLabel(type: ContactPoint["type"]) {
  switch (type) {
    case "email":
      return "邮箱";
    case "phone":
      return "电话";
    case "wechat":
      return "微信";
    case "linkedin_url":
      return "LinkedIn";
    case "public_profile_url":
      return "公开主页";
    case "source_native_id":
      return "来源账号";
  }
}

function ContactPointIcon({ type }: { type: ContactPoint["type"] }) {
  switch (type) {
    case "email":
      return <EnvelopeSimple aria-hidden="true" size={18} />;
    case "phone":
      return <Phone aria-hidden="true" size={18} />;
    case "wechat":
      return <WechatLogo aria-hidden="true" size={18} />;
    case "linkedin_url":
      return <LinkedinLogo aria-hidden="true" size={18} />;
    default:
      return <LinkSimple aria-hidden="true" size={18} />;
  }
}

function reviewDate(value: string | null) {
  if (!value) return "未设置复核期限";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "复核期限不可用";
  return `需在 ${new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date)} 前复核`;
}

export function RelationshipContactHeader({
  onAskAgent,
  onReviewSources,
  scope,
  workspace = null,
  hasCompiledBrief = false,
}: {
  onAskAgent?: () => void;
  onReviewSources?: () => void;
  scope: Scope;
  workspace?: WorkspaceReviewResponse | null;
  hasCompiledBrief?: boolean;
}) {
  const dependency = workspace
    ? relationshipCurrentDependency(workspace)
    : hasCompiledBrief ? "沟通记录已整理" : "等待整理沟通记录";
  const profile = scope.person.profile ?? null;
  const contactPoints = scope.person.contact_points ?? [];
  const showsRecordDetails = Boolean(profile || contactPoints.length > 0);

  return (
    <section className="context-contact-overview" id="contact-overview">
      <div className="context-contact-header">
        <div className="context-contact-header__portrait">
          <AvatarEditor id={scope.person.id} label={scope.person.display_label} size={64} />
        </div>
        <div className="context-contact-header__identity">
          <p className="eyebrow">持续更新的联系人页面</p>
          <h1 data-long={scope.person.display_label.length > 22}>
            {scope.person.display_label}
          </h1>
          {profile ? <p>{profile.headline}</p> : null}
          <div>
            <span>
              <AddressBook aria-hidden="true" size={14} />
              {scope.relationship_context.display_label}
            </span>
            {workspace ? (
              <>
                <span>
                  <FileImage aria-hidden="true" size={14} />
                  {sourceKindLabel(workspace.capture.source.kind)}
                </span>
                <span>
                  <Clock aria-hidden="true" size={14} />
                  更新于 {formatDate(workspace.analysis.created_at)}
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div className="context-contact-header__actions">
          {onAskAgent ? (
            <button onClick={onAskAgent} type="button">
              <ChatCircleDots aria-hidden="true" size={17} />
              询问 Agent
            </button>
          ) : null}
          {onReviewSources ? (
            <button onClick={onReviewSources} type="button">
              <FolderOpen aria-hidden="true" size={17} />
              资料与来源
            </button>
          ) : null}
        </div>
        <div
          className="context-contact-header__signal"
          data-state={workspace ? "governed" : "uncompiled"}
        >
          <span>{"当前关注"}</span>
          <strong>{dependency}</strong>
          <small>
            {workspace
              ? "从审阅状态得出，绝不用于评价此人。"
              : hasCompiledBrief ? "查看下方简报与来源；未审阅内容仍待确认。" : "尚未形成已确认事实或行动。"}
          </small>
        </div>
      </div>

      {showsRecordDetails ? (
        <details className="context-contact-details">
          <summary>
            资料与联系方式
            <span>
              {[profile ? "人物介绍" : null, contactPoints.length > 0 ? "结构化联系方式" : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </summary>
          <div className="context-contact-record">
          {profile ? (
            <article className="context-contact-record__profile">
              <header>
                <div>
                  <span>人物介绍</span>
                  <strong>由用户撰写</strong>
                </div>
                <small>不作为证据</small>
              </header>
              <p>{profile.summary}</p>
              <footer>
                版本 {profile.revision} · 更新于 {formatDate(profile.updated_at)}
              </footer>
            </article>
          ) : null}

          {contactPoints.length > 0 ? (
            <section
              aria-labelledby="contact-points-title"
              className="context-contact-record__points"
            >
              <header>
                <div>
                  <span>结构化联系方式</span>
                  <h2 id="contact-points-title">当前已确认</h2>
                </div>
                {onReviewSources ? (
                  <button onClick={onReviewSources} type="button">
                    查看来源
                    <ArrowRight aria-hidden="true" size={14} />
                  </button>
                ) : null}
              </header>
              <dl>
                {contactPoints.map((point) => (
                  <div key={point.id}>
                    <dt>
                      <ContactPointIcon type={point.type} />
                      <span>{contactPointLabel(point.type)}</span>
                    </dt>
                    <dd>
                      <strong>{point.display_hint}</strong>
                      <span>
                        {point.source_display_name ?? "由你确认"} ·{" "}
                        {reviewDate(point.valid_until)}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}
