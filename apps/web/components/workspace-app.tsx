"use client";

import { clearTimeWorkspaceStorage } from "@/lib/time-workspace-storage";
import {
  ArrowCounterClockwise,
  ArrowLeft,
  ArrowSquareOut,
  Check,
  CheckCircle,
  Clock,
  Database,
  FloppyDisk,
  LockKey,
  NotePencil,
  PencilSimple,
  Prohibit,
  Question,
  SignOut,
  Warning,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { signOutOfWorkspace } from "@/app/login/actions";
import { clearAllPendingMeetingDraftIntents } from "@/lib/meeting-draft-pending";
import { clearAllPendingSessionDrafts } from "./session-workbench/session-draft-pending";
import { clearAllSessionOrganization } from "@/lib/workspace-session-organization";
import {
  getCaseEvidence,
  getCaseIdentityLabel,
  getDispositionLabel,
  getFieldLabel,
  getActionOwnerLabel,
  getActionTypeLabel,
  getSpeakerLabel,
  localizeGeneratedCopy,
  type CandidateMomentumCase,
  type CandidateMomentumDataset,
  type WorkspaceDataSource,
} from "@/lib/candidateMomentum";
import {
  canApproveAction,
  createCaseReview,
  getCaseProgress,
  getReviewedContextLabel,
  getReviewedIdentityLabel,
  hasUnresolvedIdentity,
  hasUnresolvedTime,
  isFactReviewComplete,
  type CaseReview,
  type FactReviewStatus,
  type OutcomeStatus,
} from "@/lib/reviewState";
import { BrandMark } from "./brand-mark";
import { ThemeToggle } from "./theme-toggle";

function initialsForUser(name?: string | null, email?: string | null) {
  const source = name?.trim() || email?.split("@")[0] || "TS";
  return source
    .split(/[\s._-]+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getInitialReviews(dataset: CandidateMomentumDataset | null) {
  return Object.fromEntries(
    (dataset?.cases ?? []).map((fixtureCase) => [
      fixtureCase.id,
      createCaseReview(fixtureCase),
    ]),
  ) as Record<CandidateMomentumCase["id"], CaseReview>;
}

function readableCandidateOption(value: string) {
  return value.replace(" — ", ", ");
}

function getSourceState(source: WorkspaceDataSource) {
  if (source.kind === "synchronized-local") {
    return "已同步";
  }
  if (source.kind === "fixture-local") {
    return "本地测试数据";
  }
  return "不可用";
}

function getAttentionCopy(
  fixtureCase: CandidateMomentumCase,
  review: CaseReview,
) {
  if (hasUnresolvedIdentity(fixtureCase, review)) {
    return {
      label: "解决身份问题",
      title: "审阅任何事实前，请先选择项目背景。",
      detail:
        "来源提到的同名身份不足以绑定到任何一条记录。",
    };
  }
  if (hasUnresolvedTime(fixtureCase, review)) {
    return {
      label: "解决来源时间",
      title: "时区明确前，将相对日期保持为未解决。",
      detail:
        "采集时间晚于消息时间，且来源时区缺失。",
    };
  }
  if (fixtureCase.expected.disposition === "block") {
    return {
      label: "已应用边界",
      title: "不要把对话语气变成候选人评分。",
      detail:
        "请求的输出超出产品边界，因此不会创建声明或行动。",
    };
  }
  if (fixtureCase.expected.disposition === "no_action") {
    return {
      label: "无需行动是有效结果",
      title:
        fixtureCase.expected.assertions.length > 0
          ? "审阅第三方陈述，但不要制造跟进。"
          : "将对话保留为背景，不创建任务。",
      detail:
        fixtureCase.expected.assertions.length > 0
          ? "来源可以支持一项带归属的提议，但不支持候选人已同意的结论。"
          : "没有与决策相关的变化、承诺或依赖。",
    };
  }
  if (!isFactReviewComplete(fixtureCase, review)) {
    return {
      label: "审阅拟议状态",
      title: `${fixtureCase.expected.assertions.length} 项关联来源的事实需要逐项决定。`,
      detail:
        "逐项确认、编辑或驳回提议。事实审阅不会批准下一步行动。",
    };
  }
  return {
    label: "决定一项行动",
    title: "已审阅事实支持一个最小且稳妥的下一步。",
    detail:
      "单独做出批准决定前，请检查准确目标与本地效果。",
  };
}

function statusLabel(status: FactReviewStatus) {
  const labels: Record<FactReviewStatus, string> = {
    ambiguous: "有歧义",
    confirmed: "已确认",
    dismissed: "已驳回",
    edited: "已编辑",
    proposed: "拟议",
    superseded: "拟议替代",
  };
  return labels[status];
}

function OutcomeIcon({ status }: { status: OutcomeStatus }) {
  if (status === "verified") {
    return <CheckCircle aria-hidden="true" size={18} />;
  }
  if (status === "failed") {
    return <Warning aria-hidden="true" size={18} />;
  }
  if (status === "unknown") {
    return <Question aria-hidden="true" size={18} />;
  }
  return <Clock aria-hidden="true" size={18} />;
}

function outcomeCopy(status: OutcomeStatus) {
  const copy: Record<OutcomeStatus, { label: string; detail: string }> = {
    failed: {
      label: "失败",
      detail:
        "测试交接失败。已批准提议会保留，可重新尝试。",
    },
    pending: {
      label: "待处理",
      detail:
        "提议已在本地批准，但尚未收到目标端观察结果。",
    },
    unknown: {
      label: "未知",
      detail:
        "没有返回观察结果。在对账完成前，将效果视为未知。",
    },
    verified: {
      label: "已在测试中验证",
      detail:
        "已观察到本地测试交接。未更改消息、会议、联系人或 ATS 记录。",
    },
  };
  return copy[status];
}

function ReviewMain({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" className="review-main" tabIndex={-1}>
      {children}
    </main>
  );
}

function WorkspaceCorpusUnavailable({
  source,
  user,
}: {
  source: WorkspaceDataSource;
  user: { email?: string | null; name?: string | null };
}) {
  return (
    <div className="review-workspace">
      <aside className="review-sidebar">
        <div className="review-sidebar__brand">
          <BrandMark compact />
          <span>capri</span>
        </div>

        <div className="review-sidebar__scope">
          <p>依据审阅</p>
          <span>语料不可用</span>
        </div>

        <nav aria-label="候选人进展测试案例">
          <p className="review-sidebar__empty">当前没有可展示的案例。</p>
        </nav>

        <div className="review-sidebar__foot">
          <Link href="/workspace">
            <ArrowLeft aria-hidden="true" size={16} />
            规范流程
          </Link>
          <Link href="/">
            <ArrowSquareOut aria-hidden="true" size={16} />
            产品网站
          </Link>
          <form
            action={signOutOfWorkspace}
            onSubmit={() => {
              clearTimeWorkspaceStorage();
              clearAllPendingMeetingDraftIntents();
              clearAllPendingSessionDrafts();
            }}
          >
            <button type="submit">
              <SignOut aria-hidden="true" size={16} />
              退出登录
            </button>
          </form>
        </div>
      </aside>

      <div className="review-stage">
        <header className="review-topbar">
          <div className="review-topbar__source" data-source={source.kind}>
            <Database aria-hidden="true" size={16} />
            <span>
              <strong>{source.label}</strong>
              <small>{getSourceState(source)}</small>
            </span>
          </div>
          <div className="review-user">
            <ThemeToggle />
            <span>{initialsForUser(user.name, user.email)}</span>
            <div>
              <strong>{user.name ?? "招聘顾问"}</strong>
              <small>{user.email ?? "已登录"}</small>
            </div>
          </div>
        </header>

        <ReviewMain>
          <section
            className="review-source-note"
            aria-label="工作区数据来源"
          >
            <strong>{source.label}</strong>
            <p>此页面暂时没有可审阅的评测案例。</p>
            <button type="button" onClick={() => window.location.reload()}>
              <ArrowCounterClockwise aria-hidden="true" size={15} />
              刷新来源
            </button>
          </section>

          <section
            className="review-attention"
            aria-labelledby="corpus-unavailable-title"
            data-corpus-unavailable="true"
          >
            <p>评测语料不可用</p>
            <h2 id="corpus-unavailable-title">这里不会展示任何示例案例。</h2>
            <span>
              当前未提供评测案例。请返回主工作区继续使用正常业务流程。
            </span>
          </section>
        </ReviewMain>
      </div>
    </div>
  );
}

function CaseRailItem({
  fixtureCase,
  onSelect,
  review,
  selected,
}: {
  fixtureCase: CandidateMomentumCase;
  onSelect: () => void;
  review: CaseReview;
  selected: boolean;
}) {
  const progress = getCaseProgress(fixtureCase, review);
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "page" : undefined}
        onClick={onSelect}
      >
        <span className="review-case-rail__meta">
          <strong>{fixtureCase.id}</strong>
          <small>{getDispositionLabel(fixtureCase.expected.disposition)}</small>
        </span>
        <span className="review-case-rail__title">
          {getReviewedIdentityLabel(fixtureCase, review)}
        </span>
        <span className="review-case-rail__progress">
          {progress.total > 0
            ? `${progress.completed}/${progress.total} 项审阅决定`
            : "无需事实审阅"}
        </span>
      </button>
    </li>
  );
}

export function WorkspaceApp({
  dataset,
  source,
  user,
}: {
  dataset: CandidateMomentumDataset | null;
  source: WorkspaceDataSource;
  user: { email?: string | null; name?: string | null };
}) {
  const [selectedId, setSelectedId] = useState<CandidateMomentumCase["id"]>(
    dataset?.cases[0]?.id ?? "TS-CORE-01",
  );
  const [reviews, setReviews] = useState(() => getInitialReviews(dataset));
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [timeDraft, setTimeDraft] = useState({
    date: "",
    time: "15:00",
    timezone: "",
  });
  const [timeError, setTimeError] = useState("");
  const [outcomeDraft, setOutcomeDraft] =
    useState<OutcomeStatus>("pending");
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);

  function clearPendingLocalIntents() {
    clearTimeWorkspaceStorage();
    clearAllPendingMeetingDraftIntents();
    clearAllPendingSessionDrafts();
    clearAllSessionOrganization();
  }

  const fixtureCase =
    dataset?.cases.find((item) => item.id === selectedId) ?? dataset?.cases[0];

  const selectedIndex = fixtureCase && dataset
    ? dataset.cases.findIndex((item) => item.id === fixtureCase.id)
    : -1;

  if (!dataset || !fixtureCase) {
    return (
      <WorkspaceCorpusUnavailable
        source={source}
        user={user}
      />
    );
  }

  const review = reviews[fixtureCase.id] ?? createCaseReview(fixtureCase);
  const attention = getAttentionCopy(fixtureCase, review);
  const progress = getCaseProgress(fixtureCase, review);
  const activeCase: CandidateMomentumCase = fixtureCase;

  function updateReview(transform: (current: CaseReview) => CaseReview) {
    setReviews((current) => ({
      ...current,
      [activeCase.id]: transform(current[activeCase.id]),
    }));
  }

  function selectCase(nextId: CandidateMomentumCase["id"]) {
    setSelectedId(nextId);
    setEditingField(null);
    setTimeError("");
    setOutcomeDraft("pending");
    window.requestAnimationFrame(() => reviewHeadingRef.current?.focus());
  }

  function setFactStatus(field: string, status: FactReviewStatus) {
    updateReview((current) => ({
      ...current,
      factReviews: {
        ...current.factReviews,
        [field]: {
          ...current.factReviews[field],
          status,
        },
      },
    }));
    setEditingField(null);
  }

  function saveFactEdit(field: string) {
    const value = editDraft.trim();
    if (!value) {
      return;
    }
    updateReview((current) => ({
      ...current,
      factReviews: {
        ...current.factReviews,
        [field]: {
          ...current.factReviews[field],
          status: "edited",
          value,
        },
      },
    }));
    setEditingField(null);
  }

  function resolveTime() {
    if (!timeDraft.date || !timeDraft.time || !timeDraft.timezone) {
      setTimeError("请选择准确日期、当地时间和来源时区。")
      return;
    }
    updateReview((current) => ({
      ...current,
      timeResolution: timeDraft,
      factReviews: {
        ...current.factReviews,
        availability: {
          ...current.factReviews.availability,
          status: "edited",
          value: `${timeDraft.date} ${timeDraft.time}（${timeDraft.timezone}）`,
        },
      },
    }));
    setTimeError("");
  }

  function resetSelectedCase() {
    setReviews((current) => ({
      ...current,
      [activeCase.id]: createCaseReview(activeCase),
    }));
    setEditingField(null);
    setEditDraft("");
    setTimeDraft({ date: "", time: "15:00", timezone: "" });
    setTimeError("");
    setOutcomeDraft("pending");
  }

  const timeIsUnresolved = hasUnresolvedTime(fixtureCase, review);
  const identityIsUnresolved = hasUnresolvedIdentity(fixtureCase, review);
  const currentOutcome = outcomeCopy(review.outcome);

  return (
    <div className="review-workspace">
      <aside className="review-sidebar">
        <div className="review-sidebar__brand">
          <BrandMark compact />
          <span>capri</span>
        </div>

        <div className="review-sidebar__scope">
          <p>依据审阅</p>
          <span>{dataset.cases.length} 个合成案例</span>
        </div>

        <nav aria-label="候选人进展测试案例">
          <ol className="review-case-rail">
            {dataset.cases.map((item) => (
              <CaseRailItem
                fixtureCase={item}
                key={item.id}
                selected={item.id === fixtureCase.id}
                review={reviews[item.id]}
                onSelect={() => selectCase(item.id)}
              />
            ))}
          </ol>
        </nav>

        <div className="review-sidebar__foot">
          <Link href="/workspace">
            <ArrowLeft aria-hidden="true" size={16} />
            规范流程
          </Link>
          <Link href="/">
            <ArrowSquareOut aria-hidden="true" size={16} />
            产品网站
          </Link>
          <form action={signOutOfWorkspace} onSubmit={clearPendingLocalIntents}>
            <button type="submit">
              <SignOut aria-hidden="true" size={16} />
              退出登录
            </button>
          </form>
        </div>
      </aside>

      <div className="review-stage">
        <header className="review-topbar">
          <div className="review-topbar__source" data-source={source.kind}>
            <Database aria-hidden="true" size={16} />
            <span>
              <strong>{source.label}</strong>
              <small>{getSourceState(source)}</small>
            </span>
          </div>
          <div className="review-user">
            <ThemeToggle />
            <span>{initialsForUser(user.name, user.email)}</span>
            <div>
              <strong>{user.name ?? "招聘顾问"}</strong>
              <small>{user.email ?? "已登录"}</small>
            </div>
          </div>
        </header>

        <ReviewMain>
          <section
            className="review-source-note"
            aria-label="工作区数据来源"
          >
            <strong>{source.label}</strong>
            <p>{source.detail}</p>
            <button type="button" onClick={() => window.location.reload()}>
              <ArrowCounterClockwise aria-hidden="true" size={15} />
              刷新来源
            </button>
          </section>

          <div className="review-mobile-picker">
            <label htmlFor="fixture-case">审阅案例</label>
            <select
              id="fixture-case"
              value={fixtureCase.id}
              onChange={(event) =>
                selectCase(
                  event.target.value as CandidateMomentumCase["id"],
                )
              }
            >
              {dataset.cases.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.id}: {getCaseIdentityLabel(item)}
                </option>
              ))}
            </select>
          </div>

          <header className="review-case-header">
            <div>
              <p>
                <span>{fixtureCase.id}</span>
                <span>{getDispositionLabel(fixtureCase.expected.disposition)}</span>
              </p>
              <h1 ref={reviewHeadingRef} tabIndex={-1}>
                {getReviewedIdentityLabel(fixtureCase, review)}
              </h1>
              <span>
                {getReviewedContextLabel(fixtureCase, review)}
              </span>
            </div>
            <div className="review-case-header__position">
              <span>
                第 {selectedIndex + 1}/{dataset.cases.length} 个案例
              </span>
              <small>
                {progress.total > 0
                  ? `已完成 ${progress.completed}/${progress.total} 项决定`
                  : "无需事实决定"}
              </small>
              <button type="button" onClick={resetSelectedCase}>
                <ArrowCounterClockwise aria-hidden="true" size={15} />
                重置案例
              </button>
            </div>
          </header>

          <section
            className="review-attention"
            aria-labelledby="current-dependency"
          >
            <p>{attention.label}</p>
            <h2 id="current-dependency">{attention.title}</h2>
            <span>{attention.detail}</span>
          </section>

          <div className="review-columns">
            <div className="review-evidence-column">
              <section
                className="review-section review-source"
                aria-labelledby="source-evidence-title"
              >
                <header>
                  <div>
                    <p>观察到的依据</p>
                    <h2 id="source-evidence-title">准确来源</h2>
                  </div>
                  <span>
                    {new Intl.DateTimeFormat("zh-CN", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone:
                        fixtureCase.context.source_timezone ??
                        "Asia/Singapore",
                    }).format(
                      new Date(fixtureCase.context.captured_at),
                    )}
                  </span>
                </header>

                <div className="review-transcript">
                  {fixtureCase.messages.map((message) => (
                    <article key={message.id}>
                      <div>
                        <strong>{getSpeakerLabel(message.speaker)}</strong>
                        <small>{message.id}</small>
                      </div>
                      <blockquote>{message.text}</blockquote>
                    </article>
                  ))}
                </div>

                <dl className="review-source-metadata">
                  <div>
                    <dt>来源时区</dt>
                    <dd>
                      {fixtureCase.context.source_timezone ?? "未提供"}
                    </dd>
                  </div>
                  <div>
                    <dt>项目</dt>
                    <dd>
                      {fixtureCase.context.assignment ?? "尚未绑定"}
                    </dd>
                  </div>
                </dl>
              </section>

              {identityIsUnresolved && (
                <section
                  className="review-section ambiguity-panel"
                  aria-labelledby="identity-resolution-title"
                >
                  <header>
                    <div>
                      <p>身份歧义</p>
                      <h2 id="identity-resolution-title">
                        此来源属于哪位候选人？
                      </h2>
                    </div>
                    <LockKey aria-hidden="true" size={20} />
                  </header>
                  <p>
                    选择背景前，不能创建候选人事实或截止日期行动。此选择仅保留在测试会话中。
                  </p>
                  <fieldset>
                    <legend>候选人与项目</legend>
                    {fixtureCase.context.candidate_options?.map((option) => (
                      <label key={option}>
                        <input
                          type="radio"
                          name={`identity-${fixtureCase.id}`}
                          value={option}
                          checked={review.identityResolution === option}
                          onChange={() =>
                            updateReview((current) => ({
                              ...current,
                              identityResolution: option,
                            }))
                          }
                        />
                        <span>{readableCandidateOption(option)}</span>
                      </label>
                    ))}
                  </fieldset>
                </section>
              )}

              {!identityIsUnresolved &&
                fixtureCase.context.candidate_options?.length && (
                  <section className="resolution-note" aria-live="polite">
                    <CheckCircle aria-hidden="true" size={18} />
                    <div>
                      <strong>背景已选择</strong>
                      <p>
                        {readableCandidateOption(
                          review.identityResolution ?? "",
                        )}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateReview((current) => ({
                          ...current,
                          identityResolution: null,
                        }))
                      }
                    >
                      更改
                    </button>
                  </section>
                )}

              {timeIsUnresolved && (
                <section
                  className="review-section ambiguity-panel"
                  aria-labelledby="time-resolution-title"
                >
                  <header>
                    <div>
                      <p>时间歧义</p>
                      <h2 id="time-resolution-title">
                        解决来源日期与时区。
                      </h2>
                    </div>
                    <Clock aria-hidden="true" size={20} />
                  </header>
                  <p>{fixtureCase.context.notes}</p>
                  <div className="time-resolution-fields">
                    <label>
                      <span>准确日期</span>
                      <input
                        type="date"
                        value={timeDraft.date}
                        onChange={(event) =>
                          setTimeDraft((current) => ({
                            ...current,
                            date: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>当地时间</span>
                      <input
                        type="time"
                        value={timeDraft.time}
                        onChange={(event) =>
                          setTimeDraft((current) => ({
                            ...current,
                            time: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>来源时区</span>
                      <select
                        value={timeDraft.timezone}
                        onChange={(event) =>
                          setTimeDraft((current) => ({
                            ...current,
                            timezone: event.target.value,
                          }))
                        }
                      >
                        <option value="">选择时区</option>
                        <option value="Asia/Singapore">
                          Asia/Singapore
                        </option>
                        <option value="Europe/London">Europe/London</option>
                      </select>
                    </label>
                  </div>
                  {timeError && (
                    <p className="review-inline-error" role="alert">
                      {timeError}
                    </p>
                  )}
                  <button
                    className="review-primary-button"
                    type="button"
                    onClick={resolveTime}
                  >
                    <Check aria-hidden="true" size={16} />
                    使用此来源时间
                  </button>
                </section>
              )}

              {!timeIsUnresolved && review.timeResolution && (
                <section className="resolution-note" aria-live="polite">
                  <CheckCircle aria-hidden="true" size={18} />
                  <div>
                    <strong>来源时间已解决</strong>
                    <p>
                      {review.timeResolution.date}，{" "}
                      {review.timeResolution.time} (
                      {review.timeResolution.timezone})
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      updateReview((current) => ({
                        ...current,
                        timeResolution: null,
                        factReviews: {
                          ...current.factReviews,
                          availability: {
                            ...current.factReviews.availability,
                            status: "ambiguous",
                            value:
                              current.factReviews.availability.originalValue,
                          },
                        },
                      }))
                    }
                  >
                    更改
                  </button>
                </section>
              )}
            </div>

            <div className="review-decision-column">
              <section
                className="review-section review-facts"
                aria-labelledby="proposed-state-title"
              >
                <header>
                  <div>
                    <p>拟议理解</p>
                    <h2 id="proposed-state-title">逐项审阅事实</h2>
                  </div>
                  <span>
                    {fixtureCase.expected.assertions.length}{" "}
                    {fixtureCase.expected.assertions.length === 1
                      ? "项提议"
                      : "项提议"}
                  </span>
                </header>

                {fixtureCase.expected.assertions.length === 0 ? (
                  <div className="review-empty-state">
                    {fixtureCase.expected.disposition === "block" ? (
                      <Prohibit aria-hidden="true" size={23} />
                    ) : (
                      <NotePencil aria-hidden="true" size={23} />
                    )}
                    <h3>
                      {fixtureCase.expected.disposition === "block"
                        ? "不受支持的请求已阻止"
                        : "没有拟议事实变化"}
                    </h3>
                    <p>
                      {fixtureCase.expected.disposition === "block"
                        ? "不会使用语气、回复速度和共同兴趣来评价候选人的适配度或质量。"
                        : "对话仍可作为来源背景，但不足以支持新的候选人事实。"}
                    </p>
                  </div>
                ) : (
                  <div className="fact-review-list">
                    {fixtureCase.expected.assertions.map((assertion) => {
                      const factReview =
                        review.factReviews[assertion.field];
                      const evidence = getCaseEvidence(
                        fixtureCase,
                        assertion.evidence_message_id,
                      );
                      const editing = editingField === assertion.field;
                      const priorValue =
                        fixtureCase.context.prior_state?.[assertion.field];
                      const ambiguousFactLocked =
                        assertion.status === "ambiguous" &&
                        !review.timeResolution;

                      return (
                        <article
                          key={assertion.field}
                          className="fact-review"
                          data-state={factReview.status}
                        >
                          <div className="fact-review__heading">
                            <div>
                              <span>{getFieldLabel(assertion.field)}</span>
                              <small data-state={factReview.status}>
                                {statusLabel(factReview.status)}
                              </small>
                            </div>
                            {priorValue && (
                              <p>
                                <span>之前</span>
                                <del>{priorValue}</del>
                              </p>
                            )}
                          </div>

                          {editing ? (
                            <div className="fact-review__edit">
                              <label htmlFor={`edit-${assertion.field}`}>
                                编辑后的值
                              </label>
                              <textarea
                                id={`edit-${assertion.field}`}
                                rows={3}
                                value={editDraft}
                                onChange={(event) =>
                                  setEditDraft(event.target.value)
                                }
                              />
                              <div>
                                <button
                                  type="button"
                                  onClick={() => setEditingField(null)}
                                >
                                  取消
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    saveFactEdit(assertion.field)
                                  }
                                >
                                  <FloppyDisk
                                    aria-hidden="true"
                                    size={15}
                                  />
                                  保存编辑
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="fact-review__value">
                                {factReview.status === "edited" && (
                                  <p>
                                    <span>拟议</span>
                                    <del>{factReview.originalValue}</del>
                                  </p>
                                )}
                                <p>
                                  <span>
                                    {factReview.status === "edited"
                                      ? "之后"
                                      : "值"}
                                  </span>
                                  <strong>
                                    {localizeGeneratedCopy(factReview.value)}
                                  </strong>
                                </p>
                              </div>
                              <div className="fact-review__evidence">
                                <span>
                                  准确依据，
                                  {evidence
                                    ? getSpeakerLabel(evidence.speaker)
                                    : "未知说话人"}
                                </span>
                                <blockquote>
                                  “{assertion.evidence_quote}”
                                </blockquote>
                              </div>
                            </>
                          )}

                          {!editing &&
                            (factReview.status === "confirmed" ||
                            factReview.status === "dismissed" ||
                            factReview.status === "edited" ? (
                              <button
                                className="fact-review__restore"
                                type="button"
                                onClick={() =>
                                  setFactStatus(
                                    assertion.field,
                                    assertion.status,
                                  )
                                }
                              >
                                重新打开审阅
                              </button>
                            ) : (
                              <div className="fact-review__actions">
                                <button
                                  type="button"
                                  disabled={ambiguousFactLocked}
                                  onClick={() => {
                                    setEditDraft(factReview.value);
                                    setEditingField(assertion.field);
                                  }}
                                >
                                  <PencilSimple
                                    aria-hidden="true"
                                    size={15}
                                  />
                                  编辑
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setFactStatus(
                                      assertion.field,
                                      "dismissed",
                                    )
                                  }
                                >
                                  <X aria-hidden="true" size={15} />
                                  驳回
                                </button>
                                <button
                                  type="button"
                                  disabled={ambiguousFactLocked}
                                  onClick={() =>
                                    setFactStatus(
                                      assertion.field,
                                      "confirmed",
                                    )
                                  }
                                >
                                  <Check aria-hidden="true" size={15} />
                                  确认
                                </button>
                              </div>
                            ))}
                          {ambiguousFactLocked && (
                            <p className="fact-review__locked">
                              确认或编辑此值前，请先解决来源时间。
                            </p>
                          )}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              <section
                className="review-section review-action"
                aria-labelledby="action-review-title"
              >
                <header>
                  <div>
                    <p>独立决定</p>
                    <h2 id="action-review-title">一个下一步行动</h2>
                  </div>
                  {fixtureCase.expected.action && (
                    <span>单独批准</span>
                  )}
                </header>

                {!fixtureCase.expected.action ? (
                  <div className="review-empty-state review-empty-state--action">
                    {fixtureCase.expected.disposition === "clarify" ? (
                      <LockKey aria-hidden="true" size={23} />
                    ) : fixtureCase.expected.disposition === "block" ? (
                      <Prohibit aria-hidden="true" size={23} />
                    ) : (
                      <CheckCircle aria-hidden="true" size={23} />
                    )}
                    <h3>
                      {fixtureCase.expected.disposition === "clarify"
                        ? "仅需澄清"
                        : fixtureCase.expected.disposition === "block"
                          ? "不允许行动"
                          : "无需行动是审阅结果"}
                    </h3>
                    <p>
                      {fixtureCase.expected.disposition === "clarify"
                        ? "解决歧义，但不创建会议、截止日期行动或候选人事实。"
                        : fixtureCase.expected.disposition === "block"
                          ? "不受支持的评分请求不能创建候选人评估或跟进。"
                          : "此案例不会制造紧迫感、情绪、同意或跟进任务。"}
                    </p>
                  </div>
                ) : (
                  <div
                    className="action-proposal"
                    data-state={review.actionDecision}
                  >
                    <div className="action-proposal__title">
                      <span>
                        {getActionTypeLabel(fixtureCase.expected.action.type)}
                      </span>
                      <h3>
                        {localizeGeneratedCopy(
                          fixtureCase.expected.action.target,
                        )}
                      </h3>
                    </div>
                    <dl>
                      <div>
                        <dt>为何现在</dt>
                        <dd>
                          {localizeGeneratedCopy(
                            fixtureCase.expected.action.reason,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>负责人</dt>
                        <dd>
                          {getActionOwnerLabel(
                            fixtureCase.expected.action.owner,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>截止时间</dt>
                        <dd>
                          {localizeGeneratedCopy(
                            fixtureCase.expected.action.due,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>准确本地效果</dt>
                        <dd>
                          向此测试会话添加一个已批准问题；不会发送消息或安排日程。
                        </dd>
                      </div>
                    </dl>

                    <div className="action-proposal__evidence">
                      <span>支持来源</span>
                      {fixtureCase.expected.action.evidence_message_ids.map(
                        (messageId) => (
                          <blockquote key={messageId}>
                            “
                            {
                              getCaseEvidence(fixtureCase, messageId)?.text
                            }
                            ”
                          </blockquote>
                        ),
                      )}
                    </div>

                    {review.actionDecision === "pending" && (
                      <>
                        {!canApproveAction(fixtureCase, review) && (
                          <p className="action-proposal__locked">
                            <LockKey aria-hidden="true" size={15} />
                            先审阅所有拟议事实，才能进行这项独立决定。
                          </p>
                        )}
                        <div className="action-proposal__actions">
                          <button
                            type="button"
                            disabled={
                              !isFactReviewComplete(fixtureCase, review)
                            }
                            onClick={() =>
                              updateReview((current) => ({
                                ...current,
                                actionDecision: "declined",
                              }))
                            }
                          >
                            拒绝行动
                          </button>
                          <button
                            className="review-primary-button"
                            type="button"
                            disabled={
                              !canApproveAction(fixtureCase, review)
                            }
                            onClick={() =>
                              updateReview((current) => ({
                                ...current,
                                actionDecision: "approved",
                                outcome: "pending",
                              }))
                            }
                          >
                            <Check aria-hidden="true" size={16} />
                            批准本地交接
                          </button>
                        </div>
                      </>
                    )}

                    {review.actionDecision === "declined" && (
                      <div className="action-decision-note">
                        <Prohibit aria-hidden="true" size={18} />
                        <div>
                          <strong>行动已拒绝</strong>
                          <p>
                            依据与已审阅事实保持完整，未创建本地交接。
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            updateReview((current) => ({
                              ...current,
                              actionDecision: "pending",
                            }))
                          }
                        >
                          恢复提议
                        </button>
                      </div>
                    )}

                    {review.actionDecision === "approved" && (
                      <div className="fixture-outcome">
                        <div
                          className="fixture-outcome__state"
                          data-outcome={review.outcome}
                          aria-live="polite"
                        >
                          <OutcomeIcon status={review.outcome} />
                          <div>
                            <strong>{currentOutcome.label}</strong>
                            <p>{currentOutcome.detail}</p>
                          </div>
                        </div>
                        <div className="fixture-outcome__control">
                          <label htmlFor={`outcome-${fixtureCase.id}`}>
                            待检查的测试观察结果
                          </label>
                          <div>
                            <select
                              id={`outcome-${fixtureCase.id}`}
                              value={outcomeDraft}
                              onChange={(event) =>
                                setOutcomeDraft(
                                  event.target.value as OutcomeStatus,
                                )
                              }
                            >
                              <option value="pending">待处理</option>
                              <option value="verified">
                                已在测试中验证
                              </option>
                              <option value="failed">失败</option>
                              <option value="unknown">未知</option>
                            </select>
                            <button
                              type="button"
                              onClick={() =>
                                updateReview((current) => ({
                                  ...current,
                                  outcome: outcomeDraft,
                                }))
                              }
                            >
                              应用测试结果
                            </button>
                          </div>
                          <p>
                            此控件用于演示结果语义，不会联系或观察外部系统。
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </section>

              <details className="review-boundaries">
                <summary>案例边界已保留</summary>
                <ul>
                  {fixtureCase.expected.must_not.map((boundary) => (
                    <li key={boundary}>{localizeGeneratedCopy(boundary)}</li>
                  ))}
                </ul>
              </details>
            </div>
          </div>
        </ReviewMain>
      </div>
    </div>
  );
}
