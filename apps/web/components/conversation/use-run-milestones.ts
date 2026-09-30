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
const NO_MILESTONES: readonly ConversationExecutionMilestone[] = [];

export function useRunMilestones(
  runId: string | null,
  stage: string | null | undefined,
): readonly ConversationExecutionMilestone[] {
  const runRef = useRef<string | null>(null);
  const listRef = useRef<ConversationExecutionMilestone[]>([]);
  const publishedRef = useRef<ConversationExecutionMilestone[] | null>(null);
  const [record, setRecord] = useState<{ runId: string | null; milestones: ConversationExecutionMilestone[] }>({ runId: null, milestones: [] });
  useEffect(() => {
    if (runRef.current !== runId) {
      runRef.current = runId;
      listRef.current = [];
      publishedRef.current = null;
    }
    const next = runId
      ? conversationObservedMilestone(listRef.current, stage ?? null, new Date().toISOString())
      : [];
    listRef.current = next;
    if (next === publishedRef.current) return;
    publishedRef.current = next;
    let current = true;
    queueMicrotask(() => { if (current) setRecord({ runId, milestones: next }); });
    return () => { current = false; };
  }, [runId, stage]);
  return record.runId === runId ? record.milestones : NO_MILESTONES;
}
