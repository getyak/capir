import type {
  IdentityResolutionCase,
  KnowledgeSnapshot,
  RelationshipScope,
  ResourceCaptureResponse,
} from "@talent-signal/contracts";
import {
  ArrowUp,
  ChatCircleDots,
  FileImage,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

import { AgentCreatePersonCard } from "./agent-create-person-card";
import { AgentIdentityReviewCard } from "./agent-identity-review-card";
import { AgentTurnThread } from "./agent-turn-thread";
import type { AgentContactDraft } from "@/lib/agent-contact-intake";
import type { WorkspaceChatTurn } from "./use-workspace-chat";
import { AgentVoiceInput } from "./agent-voice-input";

export function RelationshipAgentStartPanel({
  busy = false,
  turns = [],
  createOpen,
  contactDraft,
  identityResolutionCase,
  objective,
  onAsk,
  onCancelCreate,
  onCaseUpdated,
  onCommitted,
  onDeferred,
  onResolved,
  onScreenshot,
  onObjectiveChange,
}: {
  busy?: boolean;
  turns?: WorkspaceChatTurn[];
  createOpen: boolean;
  contactDraft: AgentContactDraft | null;
  identityResolutionCase: IdentityResolutionCase | null;
  objective: string;
  onAsk: () => void;
  onCancelCreate: () => void;
  onCaseUpdated: (nextCase: IdentityResolutionCase) => void;
  onCommitted: (
    scope: RelationshipScope,
    receipts: ResourceCaptureResponse[],
    outcome:
      | "created_person"
      | "created_relationship_context"
      | "reused_relationship",
  ) => void;
  onDeferred: (caseId: string) => void;
  onResolved: (
    scope: RelationshipScope,
    compilation: KnowledgeSnapshot | null,
    compilationError: string | null,
  ) => void;
  onScreenshot: () => void;
  onObjectiveChange: (value: string) => void;
}) {
  const [isComposing, setIsComposing] = useState(false);
  const [compositionDraft, setCompositionDraft] = useState<string | null>(null);
  const startContent = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!createOpen || identityResolutionCase) return;
    const frame = window.requestAnimationFrame(() => {
      const content = startContent.current;
      content?.scrollIntoView({ block: "center" });
      const input = content?.querySelector<HTMLInputElement>("input:not(:disabled)");
      const target = input?.getClientRects().length ? input : content;
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [createOpen, identityResolutionCase]);

  return (
    <aside
      aria-labelledby="relationship-chat-title"
      className="context-chat context-chat--standalone"
      id="relationship-chat"
      data-has-conversation={turns.length > 0 || createOpen || Boolean(identityResolutionCase)}
      data-creating={createOpen || undefined}
    >
      <div className="context-agent-heading">
        <span>
          <ChatCircleDots aria-hidden="true" size={18} weight="duotone" />
        </span>
        <div>
          <p>{createOpen ? "人物与关系" : "关系智能助理"}</p>
          {createOpen ? (
            <h1 id="relationship-chat-title">新建联系人</h1>
          ) : (
            <strong id="relationship-chat-title">从一条消息开始。</strong>
          )}
        </div>
      </div>
      <div className="context-agent-thread" ref={startContent} tabIndex={-1}>
        {identityResolutionCase ? (
          <AgentIdentityReviewCard
            identityCase={identityResolutionCase}
            onCaseUpdated={onCaseUpdated}
            onResolved={onResolved}
          />
        ) : createOpen ? (
          <AgentCreatePersonCard
            initialDraft={contactDraft}
            key={contactDraft?.sourceNote ?? "manual-contact-draft"}
            onCancel={onCancelCreate}
            onCommitted={onCommitted}
            onDeferred={onDeferred}
          />
        ) : turns.length ? (
          <AgentTurnThread turns={turns} />
        ) : (
          <div className="context-agent-welcome">
            <span><ChatCircleDots aria-hidden="true" size={16} /></span>
            <div>
              <strong>聊聊近况，或一起想清楚下一步。</strong>
              <p>
                可以直接聊天、回顾之前的约定，或准备日历草稿。资料和日程会留给你核对。
              </p>
            </div>
          </div>
        )}
      </div>
      {busy ? <p role="status">正在准备回复…</p> : null}
      {!createOpen ? <form
        className="context-chat__composer context-chat__composer--start"
        onSubmit={(event) => {
          event.preventDefault();
          if (isComposing || busy) return;
          onAsk();
        }}
      >
        <div className="context-chat__composer-row">
          <button
            aria-label="导入对话截图"
            className="context-chat__media-picker"
            onClick={onScreenshot}
            type="button"
          >
            <FileImage aria-hidden="true" size={19} weight="duotone" />
          </button>
          <label className="context-chat__objective">
            <span className="sr-only">给关系智能助理发消息</span>
            <textarea
              disabled={busy}
              autoFocus={!createOpen && !identityResolutionCase}
              id="relationship-agent-composer"
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
              placeholder="输入消息、粘贴内容或添加任何资料…"
              rows={2}
              value={compositionDraft ?? objective}
            />
          </label>
          {objective.trim() || isComposing ? (
            <button
              aria-label="发送给智能助理"
              className="context-primary-button"
              disabled={busy || isComposing || !objective.trim()}
              type="submit"
            >
              <ArrowUp aria-hidden="true" size={18} weight="bold" />
            </button>
          ) : (
            <AgentVoiceInput
              onTranscript={(transcript) =>
                onObjectiveChange(transcript.slice(0, 1_000))
              }
            />
          )}
        </div>
      </form> : null}
    </aside>
  );
}
