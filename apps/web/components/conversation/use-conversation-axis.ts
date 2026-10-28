"use client";

import { useLayoutEffect, type RefObject } from "react";

/** Share the actual scroll viewport's gutter and inspection height. */
export function useConversationAxis(viewport: RefObject<HTMLElement | null>, surfaceKey?: string) {
  useLayoutEffect(() => {
    const node = viewport.current;
    const canvas = node?.closest<HTMLElement>("[data-conversation-canvas]");
    if (!node || !canvas || typeof ResizeObserver === "undefined") return;
    const update = () => {
      const style = getComputedStyle(node);
      const borders = (parseFloat(style.borderLeftWidth) || 0) + (parseFloat(style.borderRightWidth) || 0);
      const inset = Math.max(0, node.offsetWidth - node.clientWidth - borders);
      canvas.style.setProperty("--conversation-scrollbar-inset", `${inset}px`);
      if (node.clientHeight > 0) canvas.style.setProperty("--conversation-viewport-height", `${node.clientHeight}px`);
      else canvas.style.removeProperty("--conversation-viewport-height");
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      observer.disconnect();
      canvas.style.removeProperty("--conversation-scrollbar-inset");
      canvas.style.removeProperty("--conversation-viewport-height");
    };
  }, [viewport, surfaceKey]);
}
