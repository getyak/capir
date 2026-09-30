"use client";

import { useEffect, useRef, useState } from "react";

import {
  conversationObservedMilestone,
  type ConversationExecutionMilestone,
} from "@/lib/conversation-execution";

/**
 * Observed run milestones for one live run.
 *
 * A milestone is appended only when a real stage transition arrives over the
 * queue stream, and the record resets with the run identity. The list is an
 * observation log: it never implies that an unobserved stage succeeded.
 */
export function useRunMilestones(
  runId: string | null,
  stage: string | null | undefined,
): readonly ConversationExecutionMilestone[] {
  const runRef = useRef<string | null>(null);
  const listRef = useRef<ConversationExecutionMilestone[]>([]);
  const publishedRef = useRef(-1);
  const [milestones, setMilestones] = useState<ConversationExecutionMilestone[]>([]);
  useEffect(() => {
    if (runRef.current !== runId) {
      runRef.current = runId;
      listRef.current = [];
      publishedRef.current = -1;
    }
    const next = runId
      ? conversationObservedMilestone(listRef.current, stage ?? null, new Date().toISOString())
      : [];
    listRef.current = next;
    if (next.length === publishedRef.current) return;
    publishedRef.current = next.length;
    queueMicrotask(() => setMilestones(next));
  }, [runId, stage]);
  return milestones;
}
