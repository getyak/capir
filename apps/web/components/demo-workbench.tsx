"use client";

import {
  ArrowCounterClockwise,
  CalendarBlank,
  Check,
  CheckCircle,
  Cpu,
  NotePencil,
  PencilSimple,
  ShieldCheck,
  UserCirclePlus,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  analyzeConversation,
  sampleConversation,
  type AnalysisResult,
  type Evidence,
  type ProposedAction,
} from "@/lib/signals";
import { useReducedMotionPreference } from "@/lib/use-reduced-motion";

type Phase = "error" | "idle" | "loading" | "ready";
type ActionStatus = "confirmed" | "dismissed" | "pending";
type AnalysisMode = "ai" | "local";

type AiResponse = {
  result: AnalysisResult;
  meta: {
    mode: "ai";
    model: string;
    provider: string;
  };
};

const candidateContext = "Leila Hartmann，产品副总裁候选人";

const actionStatusLabels: Record<ActionStatus, string> = {
  confirmed: "已确认",
  dismissed: "已驳回",
  pending: "待审阅",
};

const verdictLabels: Record<AnalysisResult["insight"]["verdict"], string> = {
  Advance: "推进",
  "At risk": "存在风险",
  "Resolve blocker": "解决阻碍",
  Wait: "等待",
};

function ActionIcon({ type }: Pick<ProposedAction, "type">) {
  if (type === "create-meeting") {
    return <CalendarBlank aria-hidden="true" size={21} />;
  }
  return <UserCirclePlus aria-hidden="true" size={21} />;
}

function WorkbenchSkeleton() {
  return (
    <div className="workbench-skeleton" aria-label="正在分析对话">
      <div className="skeleton-line skeleton-line--short" />
      <div className="skeleton-line" />
      <div className="skeleton-panel">
        <div className="skeleton-line skeleton-line--medium" />
        <div className="skeleton-line" />
      </div>
      <span className="sr-only">正在分析对话</span>
    </div>
  );
}

function EmptyAnalysis({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length > 0) {
    return (
      <div className="empty-analysis">
        <WarningCircle aria-hidden="true" size={28} />
        <div>
          <h3>证据需要澄清</h3>
          <p>
            笔记中可能存在一条信号，但说话人或含义并不明确，因此没有提出任何操作性变更。
          </p>
          <div className="ambiguous-evidence">
            {evidence.map((item) => (
              <div key={item.id}>
                <strong>{item.label}</strong>
                <q>{item.excerpt}</q>
                {item.ambiguities.map((ambiguity) => (
                  <span key={ambiguity}>{ambiguity}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="empty-analysis">
      <NotePencil aria-hidden="true" size={28} />
      <div>
        <h3>暂时没有操作性更新</h3>
        <p>
          这条笔记包含背景信息，但没有明确的期限、限制、录用意向或日程承诺。
        </p>
      </div>
    </div>
  );
}

function ClarificationReview({ evidence }: { evidence: Evidence[] }) {
  return (
    <section
      className="clarification-review"
      aria-labelledby="clarification-review-title"
    >
      <WarningCircle aria-hidden="true" size={24} />
      <div>
        <p className="metadata">未解决的证据</p>
        <h3 id="clarification-review-title">先澄清，再确认。</h3>
        <p>
          在来源时间明确前，相对日期和会面时间窗口不会进入行动清单。
        </p>
        <div className="ambiguous-evidence">
          {evidence.map((item) => (
            <div key={item.id}>
              <strong>{item.label}</strong>
              <q>{item.excerpt}</q>
              {item.ambiguities.map((ambiguity) => (
                <span key={ambiguity}>{ambiguity}</span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ReviewResolution({
  confirmedCount,
  hasAmbiguousEvidence,
  nextAction,
}: {
  confirmedCount: number;
  hasAmbiguousEvidence: boolean;
  nextAction: string;
}) {
  const noReviewedChange = !hasAmbiguousEvidence && confirmedCount === 0;
  return (
    <section
      className="demo-resolution"
      data-state={hasAmbiguousEvidence || noReviewedChange ? "hold" : "ready"}
      aria-labelledby="demo-resolution-title"
    >
      <p className="metadata">
        {hasAmbiguousEvidence
          ? "待澄清后再推进"
          : "已完成本轮审阅"}
      </p>
      <h3 id="demo-resolution-title">
        {hasAmbiguousEvidence || noReviewedChange
          ? "当前不进入行动清单"
          : "带走这一项最小下一步"}
      </h3>
      <p>
        {hasAmbiguousEvidence
          ? "在来源时间澄清前，不会生成会议、提醒或其他外部动作；当前页面只保留可审阅的拟议状态。"
          : noReviewedChange
            ? "本轮没有确认任何拟议状态，因此不会创建后续行动。"
            : nextAction}
      </p>
    </section>
  );
}

export function DemoWorkbench({
  aiEnabled,
  aiProvider,
}: {
  aiEnabled: boolean;
  aiProvider: string;
}) {
  const [input, setInput] = useState(sampleConversation);
  const [mode, setMode] = useState<AnalysisMode>("local");
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [statuses, setStatuses] = useState<Record<string, ActionStatus>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [errorMessage, setErrorMessage] = useState("");
  const [analysisMeta, setAnalysisMeta] = useState<AiResponse["meta"] | null>(
    null,
  );
  const [announcement, setAnnouncement] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const editingInputRef = useRef<HTMLInputElement | null>(null);
  const reduceMotion = useReducedMotionPreference();

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      requestRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!editingId) {
      return;
    }

    editingInputRef.current?.focus();
    editingInputRef.current?.select();
  }, [editingId]);

  function applyResult(nextResult: AnalysisResult) {
    setResult(nextResult);
    setEdits(
      Object.fromEntries(
        nextResult.actions.map((action) => [action.id, action.detail]),
      ),
    );
    setPhase("ready");
    const unresolvedCount = nextResult.evidence.filter(
      (item) => item.ambiguities.length > 0,
    ).length;
    if (nextResult.actions.length > 0) {
      setAnnouncement(
        `分析完成。${nextResult.actions.length} 项拟议状态可供审阅。${
          unresolvedCount > 0
            ? `${unresolvedCount} 项未解决证据需要澄清。`
            : ""
        }`,
      );
    } else if (nextResult.evidence.length > 0) {
      setAnnouncement(
        "分析完成。证据需要澄清，没有提出操作性变更。",
      );
    } else {
      setAnnouncement(
        "分析完成，没有提出操作性更新。",
      );
    }
  }

  async function runAnalysis() {
    if (!input.trim()) {
      const message = "请先添加对话笔记，再分析证据。";
      setErrorMessage(message);
      setAnnouncement(message);
      setPhase("error");
      setResult(null);
      return;
    }

    setPhase("loading");
    setAnnouncement("正在分析对话证据。");
    setErrorMessage("");
    setStatuses({});
    setEditingId(null);
    setAnalysisMeta(null);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    requestRef.current?.abort();

    if (mode === "local") {
      timerRef.current = setTimeout(() => {
        applyResult(analyzeConversation(input));
      }, reduceMotion ? 100 : 720);
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          candidateContext,
          conversation: input,
          sourceSpeaker: "candidate",
        }),
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = (await response.json()) as
        | AiResponse
        | { error?: string };
      if (!response.ok || !("result" in payload)) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : "私密 AI 分析暂时不可用。",
        );
      }

      setAnalysisMeta(payload.meta);
      applyResult(payload.result);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      setResult(null);
      const message =
        error instanceof Error
          ? error.message
          : "私密 AI 分析暂时不可用。";
      setErrorMessage(message);
      setAnnouncement(message);
      setPhase("error");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
      }
    }
  }

  function updateStatus(id: string, status: ActionStatus) {
    const nextStatuses = { ...statuses, [id]: status };
    setStatuses(nextStatuses);
    setEditingId(null);
    const action = result?.actions.find((item) => item.id === id);
    const confirmedCount = Object.values(nextStatuses).filter(
      (nextStatus) => nextStatus === "confirmed",
    ).length;
    if (action && result) {
      setAnnouncement(
        `${action.title} ${
          status === "confirmed"
            ? "已确认"
            : status === "dismissed"
              ? "已驳回"
              : "已返回审阅"
        }。已审阅 ${Object.values(nextStatuses).filter((nextStatus) => nextStatus !== "pending").length}/${result.actions.length} 项拟议状态，其中已确认 ${confirmedCount} 项。`,
      );
    }
  }

  function toggleEdit(action: ProposedAction) {
    if (editingId === action.id) {
      setEditingId(null);
      setAnnouncement(
        `${action.title}的编辑已保存在本地，请在确认前审阅。`,
      );
      return;
    }

    setEditingId(action.id);
    setAnnouncement(`${action.title}的编辑字段已就绪。`);
  }

  function resetDemo() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    requestRef.current?.abort();
    setInput(sampleConversation);
    setMode("local");
    setPhase("idle");
    setResult(null);
    setStatuses({});
    setEditingId(null);
    setEdits({});
    setErrorMessage("");
    setAnalysisMeta(null);
    setAnnouncement("演示已重置，并恢复示例对话。");
  }

  function selectMode(nextMode: AnalysisMode) {
    if (nextMode === "ai" && !aiEnabled) {
      return;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    requestRef.current?.abort();
    setMode(nextMode);
    setPhase("idle");
    setResult(null);
    setStatuses({});
    setEditingId(null);
    setEdits({});
    setErrorMessage("");
    setAnalysisMeta(null);
    setAnnouncement(
      nextMode === "local"
        ? "已选择仅在浏览器中运行的本地分析，并清除之前的结果。"
        : "已选择私密 AI 分析，并清除之前的结果。",
    );
  }

  const actionSummary = result
    ? Object.values(statuses).filter((status) => status === "confirmed").length
    : 0;
  const ambiguousEvidence =
    result?.evidence.filter((item) => item.ambiguities.length > 0) ?? [];
  const reviewedActionCount = result
    ? Object.values(statuses).filter((status) => status !== "pending").length
    : 0;
  const allActionsReviewed = Boolean(
    result &&
      result.actions.length > 0 &&
      result.actions.every(
        (action) => (statuses[action.id] ?? "pending") !== "pending",
      ),
  );

  return (
    <div className="demo-workbench">
      <section className="demo-input" aria-labelledby="demo-input-title">
        <div className="demo-input__heading">
          <div>
            <p className="metadata">招聘顾问主动导入</p>
            <h1 id="demo-input-title">试试一段对话。</h1>
          </div>
          <button className="text-button" type="button" onClick={resetDemo}>
            <ArrowCounterClockwise aria-hidden="true" size={16} />
            重置演示
          </button>
        </div>

        <div className="field">
          <label htmlFor="candidate-context">候选人背景</label>
          <input
            id="candidate-context"
            value={candidateContext}
            readOnly
            aria-describedby="candidate-context-help"
          />
          <p id="candidate-context-help" className="field-helper">
            本产品演示会在本地预置候选人身份与来源说话人。
          </p>
        </div>

        <div className="field">
          <label htmlFor="conversation-evidence">对话证据</label>
          <textarea
            id="conversation-evidence"
            value={input}
            rows={7}
            onChange={(event) => {
              setInput(event.target.value);
              if (phase === "error") {
                setPhase("idle");
              }
            }}
            aria-invalid={phase === "error"}
            aria-describedby="conversation-evidence-help conversation-evidence-error"
          />
          <p id="conversation-evidence-help" className="field-helper">
            {mode === "local"
              ? "本地规则仅在浏览器中运行，文本不会被传输或保存。"
              : `该笔记会发送给 ${aiProvider} 进行临时分析，capri 不会将其持久化。`}
          </p>
          {phase === "error" && (
            <p id="conversation-evidence-error" className="field-error">
              {errorMessage}
            </p>
          )}
        </div>

        <fieldset className="analysis-mode">
          <legend>分析路径</legend>
          <button
            type="button"
            data-active={mode === "local"}
            aria-pressed={mode === "local"}
            onClick={() => selectMode("local")}
          >
            <Cpu aria-hidden="true" size={17} />
            <span>
              <strong>本地规则</strong>
              <small>仅在浏览器中</small>
            </span>
          </button>
          <button
            type="button"
            data-active={mode === "ai"}
            aria-pressed={mode === "ai"}
            disabled={!aiEnabled}
            onClick={() => selectMode("ai")}
          >
            <ShieldCheck aria-hidden="true" size={17} />
            <span>
              <strong>私密 AI</strong>
              <small>{aiEnabled ? "明确上传" : "尚未配置"}</small>
            </span>
          </button>
        </fieldset>

        <button
          className="button analyze-button"
          type="button"
          onClick={() => void runAnalysis()}
          disabled={phase === "loading"}
        >
          {phase === "loading"
            ? "正在分析证据"
            : mode === "ai"
              ? "使用私密 AI 分析"
              : "在本地分析"}
        </button>
        <p
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {announcement}
        </p>
      </section>

      <section
        className="demo-output"
        aria-labelledby="demo-output-title"
      >
        <div className="demo-output__heading">
          <div>
            <p className="metadata">拟议状态</p>
            <h2 id="demo-output-title">逐项审阅</h2>
          </div>
          {phase === "ready" && result && result.actions.length > 0 && (
            <div className="analysis-summary">
              <p className="confirmation-count">
                已审阅 {reviewedActionCount}/{result.actions.length} 项拟议状态，其中已确认{" "}
                {actionSummary} 项
              </p>
              {analysisMeta && (
                <p className="analysis-origin">
                  {analysisMeta.provider} · {analysisMeta.model}
                </p>
              )}
            </div>
          )}
        </div>

        <AnimatePresence mode="wait">
          {phase === "loading" && (
            <motion.div
              key="loading"
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <WorkbenchSkeleton />
            </motion.div>
          )}

          {(phase === "idle" || phase === "error") && (
            <motion.div
              key="idle"
              className="demo-idle"
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <p>
                分析笔记后，逐项审阅拟议变更；每项变更都会继续关联其来源。
              </p>
            </motion.div>
          )}

          {phase === "ready" && result && result.actions.length === 0 && (
            <motion.div
              key="empty"
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <EmptyAnalysis evidence={result.evidence} />
            </motion.div>
          )}

          {phase === "ready" && result && result.actions.length > 0 && (
            <motion.div
              key="result"
              className="analysis-result"
              initial={reduceMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="demo-insight">
                <div className="insight-heading">
                  <p>关系进展洞察</p>
                  <span className="verdict">{verdictLabels[result.insight.verdict]}</span>
                </div>
                <p>{result.insight.rationale}</p>
                <p className="next-action">
                  <span>下一步</span>
                  {result.insight.nextAction}
                </p>
              </div>

              {ambiguousEvidence.length > 0 ? (
                <ClarificationReview evidence={ambiguousEvidence} />
              ) : null}

              <div className="action-list">
                {result.actions.map((action) => {
                  const status = statuses[action.id] ?? "pending";
                  const editing = editingId === action.id;
                  return (
                    <article
                      key={action.id}
                      className="action-card"
                      data-status={status}
                    >
                      <div className="action-card__icon">
                        <ActionIcon type={action.type} />
                      </div>
                      <div className="action-card__content">
                        <div className="action-card__heading">
                          <h3>{action.title}</h3>
                          {status !== "pending" && (
                            <span className="action-status">
                              {status === "confirmed" ? (
                                <CheckCircle aria-hidden="true" size={15} />
                              ) : (
                                <X aria-hidden="true" size={15} />
                              )}
                              {actionStatusLabels[status]}
                            </span>
                          )}
                        </div>

                        {editing ? (
                          <div className="inline-edit">
                            <label htmlFor={`edit-${action.id}`}>
                              拟议更新
                            </label>
                            <input
                              id={`edit-${action.id}`}
                              ref={editingInputRef}
                              value={edits[action.id] ?? action.detail}
                              onChange={(event) =>
                                setEdits((current) => ({
                                  ...current,
                                  [action.id]: event.target.value,
                                }))
                              }
                            />
                          </div>
                        ) : (
                          <p>{edits[action.id] ?? action.detail}</p>
                        )}

                        <p className="evidence-reference">
                          来源 ·{" "}
                          {result.evidence.find(
                            (item) => item.id === action.evidenceId,
                          )?.label}
                        </p>
                        <q className="evidence-quote">
                          {
                            result.evidence.find(
                              (item) => item.id === action.evidenceId,
                            )?.excerpt
                          }
                        </q>

                        {status === "pending" ? (
                          <div className="action-card__actions">
                            <button
                              type="button"
                              onClick={() => toggleEdit(action)}
                            >
                              <PencilSimple aria-hidden="true" size={15} />
                              {editing ? "保存编辑" : "编辑"}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateStatus(action.id, "dismissed")
                              }
                            >
                              <X aria-hidden="true" size={15} />
                              驳回
                            </button>
                            <button
                              className="confirm-action"
                              type="button"
                              onClick={() =>
                                updateStatus(action.id, "confirmed")
                              }
                            >
                              <Check aria-hidden="true" size={15} />
                              确认
                            </button>
                          </div>
                        ) : (
                          <button
                            className="restore-action"
                            type="button"
                            onClick={() =>
                              updateStatus(action.id, "pending")
                            }
                          >
                            恢复审阅
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>

              {(ambiguousEvidence.length > 0 || allActionsReviewed) && (
                <ReviewResolution
                  confirmedCount={actionSummary}
                  hasAmbiguousEvidence={ambiguousEvidence.length > 0}
                  nextAction={result.insight.nextAction}
                />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}
