"use client";

import { ChatCircleDots, Sparkle, Warning } from "@phosphor-icons/react";
import { useRef, useState } from "react";

import {
  CONVERSATION_SPEAKERS,
  parseConversationTranscript,
  type ConversationSpeaker,
  type ConversationTranscriptMessage,
} from "@/lib/conversation-transcript";

export function ConversationTranscriptComposer({
  title,
  value,
  messages,
  attributionReviewed,
  onTitleChange,
  onValueChange,
  onMessagesChange,
  onAttributionReviewedChange,
}: {
  title: string;
  value: string;
  messages: ConversationTranscriptMessage[];
  attributionReviewed: boolean;
  onTitleChange: (value: string) => void;
  onValueChange: (value: string) => void;
  onMessagesChange: (messages: ConversationTranscriptMessage[]) => void;
  onAttributionReviewedChange: (reviewed: boolean) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [unlabeledSpeaker, setUnlabeledSpeaker] =
    useState<ConversationSpeaker>("unknown");
  const [fileName, setFileName] = useState("");
  const [analysisError, setAnalysisError] = useState("");
  const [analysisSummary, setAnalysisSummary] = useState<{
    labeled: number;
    unknown: number;
  } | null>(null);

  function invalidateAnalysis() {
    onMessagesChange([]);
    onAttributionReviewedChange(false);
    setAnalysisSummary(null);
    setAnalysisError("");
  }

  function analyzeTranscript() {
    try {
      const analysis = parseConversationTranscript(value, unlabeledSpeaker);
      onMessagesChange(analysis.messages);
      onAttributionReviewedChange(false);
      setAnalysisSummary({
        labeled: analysis.explicitly_labeled_count,
        unknown: analysis.unknown_count,
      });
      setAnalysisError("");
    } catch (caught) {
      onMessagesChange([]);
      onAttributionReviewedChange(false);
      setAnalysisSummary(null);
      setAnalysisError(
        caught instanceof Error
          ? caught.message
          : "无法分析对话稿。",
      );
    }
  }

  async function readTextFile(nextFile: File | null) {
    if (!nextFile) {
      return;
    }
    if (nextFile.size <= 0 || nextFile.size > 256 * 1024) {
      setAnalysisError("请选择一个不超过 256 KB 的非空 TXT 或 Markdown 文件。");
      return;
    }
    try {
      const text = await nextFile.text();
      setFileName(nextFile.name);
      onTitleChange(title.trim() ? title : nextFile.name);
      onValueChange(text);
      onMessagesChange([]);
      onAttributionReviewedChange(false);
      setAnalysisSummary(null);
      setAnalysisError("");
    } catch {
      setAnalysisError("无法在浏览器中读取所选文本文件。");
    }
  }

  function updateSpeaker(sequence: number, speaker: ConversationSpeaker) {
    onMessagesChange(
      messages.map((message) =>
        message.sequence === sequence ? { ...message, speaker } : message,
      ),
    );
    onAttributionReviewedChange(false);
  }

  return (
    <div className="context-transcript-import">
      <div className="context-transcript-import__source">
        <label>
          <span>对话标签</span>
          <input
            maxLength={240}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="例如：8 月 9 日跟进对话稿"
            value={title}
          />
        </label>
        <input
          accept=".txt,.md,text/plain,text/markdown"
          className="sr-only"
          onChange={(event) => void readTextFile(event.target.files?.[0] ?? null)}
          ref={fileInputRef}
          type="file"
        />
        <button
          className="context-resource-file context-resource-file--transcript"
          onClick={() => fileInputRef.current?.click()}
          type="button"
        >
          <ChatCircleDots aria-hidden="true" size={20} />
          <span>
            <strong>{fileName || "选择 TXT 或 Markdown"}</strong>
            <small>在本地读取，再在下方审阅准确文本。</small>
          </span>
        </button>
        <label>
          <span>对话文本</span>
          <textarea
            maxLength={40_000}
            onChange={(event) => {
              onValueChange(event.target.value);
              invalidateAnalysis();
            }}
            placeholder={
              "对方：9 月 15 日有时间\n我：我会确认会面时间。"
            }
            rows={6}
            value={value}
          />
        </label>
      </div>

      <div className="context-transcript-import__analysis">
        <fieldset>
          <legend>未标记行属于</legend>
          <div>
            {CONVERSATION_SPEAKERS.map((speaker) => (
              <button
                aria-pressed={unlabeledSpeaker === speaker}
                key={speaker}
                onClick={() => {
                  setUnlabeledSpeaker(speaker);
                  invalidateAnalysis();
                }}
                type="button"
              >
                {speaker === "unknown"
                  ? "不确定"
                  : speaker === "candidate"
                    ? "对方"
                    : "你"}
              </button>
            ))}
          </div>
          <small>
            只有在文件仅包含对方发言时，才选择“对方”。capri 绝不会根据措辞或消息顺序猜测说话人。
          </small>
        </fieldset>
        <button
          className="context-secondary-button"
          disabled={!value.trim()}
          onClick={analyzeTranscript}
          type="button"
        >
          <Sparkle aria-hidden="true" size={17} weight="fill" />
          分析说话人标签
        </button>
      </div>

      {analysisError ? (
        <p className="context-resource-composer__error" role="alert">
          <Warning aria-hidden="true" size={16} />
          {analysisError}
        </p>
      ) : null}

      {messages.length > 0 ? (
        <section
          aria-labelledby="transcript-review-title"
          className="context-transcript-import__review"
        >
          <header>
            <div>
              <p className="eyebrow">说话人审阅</p>
              <h3 id="transcript-review-title">逐条审阅消息归属。</h3>
            </div>
            <span>
              {messages.length} 条消息 · {analysisSummary?.labeled ?? 0} 条已标记
              {analysisSummary?.unknown
                ? ` · ${analysisSummary.unknown} 条未知`
                : ""}
            </span>
          </header>
          <div className="context-transcript-import__messages">
            {messages.map((message) => (
              <div data-speaker={message.speaker} key={message.sequence}>
                <select
                  aria-label={`对话稿第 ${message.sequence + 1} 条消息的说话人`}
                  onChange={(event) =>
                    updateSpeaker(
                      message.sequence,
                      event.target.value as ConversationSpeaker,
                    )
                  }
                  value={message.speaker}
                >
                  <option value="candidate">对方</option>
                  <option value="recruiter">你</option>
                  <option value="unknown">不确定</option>
                </select>
                <p>{message.text}</p>
              </div>
            ))}
          </div>
          <label className="context-resource-checkbox context-transcript-import__confirm">
            <input
              checked={attributionReviewed}
              onChange={(event) =>
                onAttributionReviewedChange(event.target.checked)
              }
              type="checkbox"
            />
            <span>
              我已审阅上方的说话人标签
              <small>
                说话人未知的消息只作为背景，不能创建对方事实。每项事实仍需单独审阅。
              </small>
            </span>
          </label>
        </section>
      ) : null}
    </div>
  );
}
