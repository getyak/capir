"use client";

import { useRef, type ComponentProps } from "react";
import { useSessionSourceFocus } from "./workspace-navigation-continuity";

export function SessionSourceHeading({ binding, sessionId, ready = true, ...props }: ComponentProps<"h1"> & { binding: string | null; sessionId: string; ready?: boolean }) {
  const target = useRef<HTMLHeadingElement>(null);
  useSessionSourceFocus(target, binding, sessionId, ready);
  return <h1 {...props} ref={target} tabIndex={-1} />;
}
