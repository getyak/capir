"use client";

import { motion, type Transition } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";

import { useReducedMotionPreference } from "@/lib/use-reduced-motion";

/**
 * Shared list motion for Session rows.
 *
 * A new session row entering the top of a list animates in once (initial
 * opacity/y) while its siblings move down with Motion layout positions. The
 * initial/hydrated list and paginated history never animate: `useArrivalRegistry`
 * seeds from the first rendered IDs and `markHistory` excludes fetched pages.
 * Reduced motion renders every row in place.
 */
export const LIST_ROW_SPRING: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 36,
  mass: 0.9,
};

export type ArrivalRegistry = {
  /** True only for rows absent from the first rendered list and not history. */
  isArrival(id: string): boolean;
  /** Exclude fetched history pages from arrival animation. */
  markHistory(ids: Iterable<string>): void;
};

function createArrivalRegistry() {
  const seen = new Set<string>();
  let seeded = false;
  function record(ids: Iterable<string>) {
    for (const id of ids) seen.add(id);
    while (seen.size > 1000) seen.delete(seen.values().next().value!);
    seeded = true;
  }
  return { isArrival: (id: string) => seeded && !seen.has(id), markHistory: record, record };
}

export function useArrivalRegistry(ids: readonly string[], ready = true): ArrivalRegistry {
  const [registry] = useState(createArrivalRegistry);
  // Record only committed, successful projections. Initial asynchronous
  // history is static; after a committed arrival, restoring it cannot replay.
  useEffect(() => { if (ready) registry.record(ids); }, [ids, ready, registry]);
  return registry;
}

export function WorkspaceListRow({
  arrival,
  children,
  className,
}: {
  /** Mount-time decision: was this row absent from the hydrated list? */
  arrival: boolean;
  children: ReactNode;
  className?: string;
}) {
  const reduceMotion = useReducedMotionPreference();
  return (
    <motion.li
      animate={{ opacity: 1, y: 0 }}
      className={className}
      data-arrival={arrival ? "true" : "false"}
      initial={arrival && !reduceMotion ? { opacity: 0, y: -10 } : false}
      layout={reduceMotion ? false : "position"}
      transition={reduceMotion ? { duration: 0 } : LIST_ROW_SPRING}
    >
      {children}
    </motion.li>
  );
}
