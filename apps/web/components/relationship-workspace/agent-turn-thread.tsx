import { MeetingDraftHandoff } from "@/components/meeting-draft-handoff";
import { ConversationResponse } from "@/components/conversation-response";

import type { WorkspaceChatTurn } from "./use-workspace-chat";

/**
 * Canonical rendering for unscoped conversation turns.
 *
 * One component renders a Session's turns for both the scoped relationship
 * desk and the default conversation canvas, so a reply cannot look different
 * depending on where it was submitted. Calendar drafts keep their governed
 * handoff; nothing here invents blocks the response did not contain.
 */
export function AgentTurnThread({
  turns,
  className = "context-chat__response",
  userMessageClassName = "context-agent-user-message",
}: {
  turns: WorkspaceChatTurn[];
  className?: string;
  userMessageClassName?: string;
}) {
  return (
    <div aria-live="polite" className={className}>
      {turns.map((turn) => (
        <article key={turn.response.task_id}>
          <p className={userMessageClassName}>{turn.objective}</p>
          {turn.response.blocks.map((block) => (
            <div key={block.id}>
              <ConversationResponse foldable={block.kind === "answer" && !block.requires_user_decision}>{block.body}</ConversationResponse>
              {block.calendar_draft?.source_request_id ===
              turn.response.task_id ? (
                <MeetingDraftHandoff
                  draft={block.calendar_draft}
                  persistence="persisted"
                />
              ) : null}
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}
