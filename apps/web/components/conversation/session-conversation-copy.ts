import type { SessionDetail } from "../session-workbench/session-detail-state";
import { sessionMessages } from "./session-message-parts";
import { extractSessionMessageCopy } from "./session-message-actions";

/** Reuse the transcript's eligibility rules rather than serializing private DTOs. */
export function conversationCopyText(turns: SessionDetail["turns"], labels: { user: string; assistant: string }): string {
  return sessionMessages({ turns, active: null, preview: null }).flatMap(message => {
    const payload = extractSessionMessageCopy(message);
    return payload ? [`${message.role === "user" ? labels.user : labels.assistant}\n\n${payload.text}`] : [];
  }).join("\n\n");
}
