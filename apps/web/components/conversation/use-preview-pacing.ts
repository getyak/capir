"use client";

import { useEffect, useRef, useState } from "react";

import type { ConversationQueuePreview } from "@talent-signal/contracts";
import {
  conversationPresentationDelay,
  conversationPresentationInitial,
  conversationPresentationStep,
  type ConversationPresentationState,
} from "@/lib/conversation-execution";

/**
 * Pace forming-text presentation for one live run.
 *
 * Fragments may arrive much faster than a reader can follow, so progress
 * paints are coalesced to the presentation interval while terminal states and
 * errors stay prompt: clearing the preview (terminal readback, stop, failure)
 * clears the presented text in the same commit. The preview stays ephemeral
 * and is never a source of persisted or authoritative content.
 */
export function usePreviewPacing(preview: ConversationQueuePreview | null): ConversationQueuePreview | null {
  const stateRef = useRef<ConversationPresentationState>(conversationPresentationInitial(0));
  const [paced, setPaced] = useState<ConversationQueuePreview | null>(null);
  useEffect(() => {
    if (!preview) {
      // Terminal states and errors commit at once, with no trailing paint.
      stateRef.current = conversationPresentationInitial(0);
      queueMicrotask(() => setPaced(null));
      return;
    }
    const update = {
      runId: preview.run_id,
      revision: preview.revision,
      text: preview.text,
      stage: preview.stage,
      nowMs: Date.now(),
    };
    const step = conversationPresentationStep(stateRef.current, update);
    stateRef.current = step.state;
    if (step.commit) {
      queueMicrotask(() => setPaced({ ...preview, text: step.state.text, stage: step.state.stage }));
      return;
    }
    const delay = conversationPresentationDelay(step.state, update.nowMs);
    const timer = setTimeout(() => {
      // Trailing edge: the newest observed value paints once the window opens.
      const trailing = conversationPresentationStep(stateRef.current, { ...update, nowMs: Date.now(), terminal: true });
      stateRef.current = trailing.state;
      if (trailing.commit) queueMicrotask(() => setPaced({ ...preview, text: trailing.state.text, stage: trailing.state.stage }));
    }, delay);
    return () => clearTimeout(timer);
  }, [preview]);
  return paced;
}
