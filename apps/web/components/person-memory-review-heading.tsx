"use client";

import { useLayoutEffect, useRef } from "react";
import { useT } from "./locale-provider";

/** Next's hash navigation scrolls, but does not focus the requested section. */
export function PersonMemoryReviewHeading({ personId, className }: {
  personId: string;
  className?: string;
}) {
  const t = useT();
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const node = heading.current;
    if (!node || window.location.pathname !== `/workspace/people/${encodeURIComponent(personId)}`
      || window.location.hash !== "#person-memory-pending") return;
    const active = document.activeElement;
    // A delayed route must respect a control the user chose while waiting.
    if (active && active !== document.body && active !== document.documentElement
      && active !== node) return;
    if (!node.isConnected || !node.getClientRects().length) return;
    node.focus({ preventScroll: true });
    node.scrollIntoView({ block: "start" });
  }, [personId]);
  return <h2 className={className} id="person-memory-pending" ref={heading}
    style={{ scrollMarginTop: "6rem" }} tabIndex={-1}>{t("待确认变化")}</h2>;
}
