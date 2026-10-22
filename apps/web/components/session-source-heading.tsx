"use client";

import { useRef, type ComponentProps } from "react";
import { workspaceSearchFocusTargetProps } from "@/lib/workspace-search-focus";
import { useSessionSourceFocus } from "./workspace-navigation-continuity";

export function SessionSourceHeading({ binding, sessionId, ready = true, ...props }: ComponentProps<"h1"> & { binding: string | null; sessionId: string; ready?: boolean }) {
  const target = useRef<HTMLHeadingElement>(null);
  useSessionSourceFocus(target, binding, sessionId, ready);
  // The settled heading doubles as the global search handoff target. A
  // not-yet-ready (loading) heading carries no marker so it can never consume
  // a pending intent; the existing Time source focus keeps its own semantics.
  const focusTarget = sessionId && ready
    ? workspaceSearchFocusTargetProps(`/workspace/sessions/${encodeURIComponent(sessionId)}`)
    : null;
  return <h1 {...props} {...focusTarget} ref={target} tabIndex={-1} />;
}
