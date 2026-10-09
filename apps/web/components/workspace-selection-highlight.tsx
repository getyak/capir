"use client";

import { LayoutGroup, motion, type Transition } from "motion/react";
import { useId, type ReactNode } from "react";

import { useReducedMotionPreference } from "@/lib/use-reduced-motion";
import styles from "./workspace-shell.module.css";

/**
 * One shared sliding selected highlight per list.
 *
 * Every row renders the same `layoutId` element when selected; Motion moves
 * that single element between rows with a real interruptible spring, so fast
 * retargeting stays continuous. Rows never carry their own static current
 * background on top of the highlight. `LayoutGroup` is scoped per list with
 * `useId`, so the navigation rail and the recent Session list never trade
 * highlights across lists.
 */
export const WORKSPACE_SELECTION_SPRING: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 36,
  mass: 0.9,
};

export function WorkspaceSelectionScope({ children }: { children: ReactNode }) {
  const scopeId = useId();
  return <LayoutGroup id={scopeId}>{children}</LayoutGroup>;
}

export function WorkspaceSelectionHighlight({
  selected,
}: {
  selected: boolean;
}) {
  const reduceMotion = useReducedMotionPreference();
  if (!selected) return null;
  return (
    <motion.span
      aria-hidden="true"
      className={styles.selectionHighlight}
      data-selection="true"
      layoutId="workspace-selected-row"
      transition={reduceMotion ? { duration: 0 } : WORKSPACE_SELECTION_SPRING}
    />
  );
}
