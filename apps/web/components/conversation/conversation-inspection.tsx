"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { conversationNearBottom } from "../session-workbench/session-presentation";

type InspectionLease = {
  reveal: (preview: HTMLElement) => void;
  restore: () => void;
  dispose: () => void;
};
type InspectionController = { begin: (source: HTMLElement) => InspectionLease | null };
type ReadingControl = { cancelRestore: () => void; remember: () => void };
type Inspection = { viewport: HTMLElement; source: HTMLElement; offset: number };

export const ConversationInspectionContext = createContext<InspectionController | null>(null);
export const useConversationInspection = () => useContext(ConversationInspectionContext);

/** One presentation owner for deliberate source reading, never task authority. */
export function useConversationInspectionOwner({
  owner, viewportRef, followsLatestRef, userScrollRef, reading, onAwayChange,
}: {
  owner: symbol;
  viewportRef: RefObject<HTMLElement | null>;
  followsLatestRef: RefObject<boolean>;
  userScrollRef: RefObject<boolean>;
  reading: ReadingControl;
  onAwayChange: (away: boolean) => void;
}) {
  const identity = useRef<symbol | null>(owner);
  const current = useRef<Inspection | null>(null);
  const intentVersion = useRef(0);
  useLayoutEffect(() => {
    identity.current = owner;
    current.current = null;
    intentVersion.current += 1;
    return () => { identity.current = null; current.current = null; intentVersion.current += 1; };
  }, [owner]);

  return useMemo(() => {
    const active = () => identity.current === owner && current.current !== null;
    const noteReadingIntent = () => { if (identity.current === owner) intentVersion.current += 1; };
    const captureIntent = () => {
      const version = intentVersion.current;
      return () => identity.current === owner && intentVersion.current === version;
    };
    const release = () => { if (identity.current === owner) { noteReadingIntent(); current.current = null; } };
    const controller: InspectionController = {
      begin(source) {
        const viewport = viewportRef.current;
        if (identity.current !== owner || !viewport || !viewport.contains(source)) return null;
        noteReadingIntent();
        reading.cancelRestore();
        // This intent must win before the newly opened viewer resizes content.
        followsLatestRef.current = false;
        userScrollRef.current = false;
        const inspection: Inspection = {
          viewport, source,
          offset: source.getBoundingClientRect().top - viewport.getBoundingClientRect().top - viewport.clientTop,
        };
        current.current = inspection;
        reading.remember();
        onAwayChange(!conversationNearBottom(viewport));
        const owns = () => identity.current === owner && current.current === inspection
          && viewportRef.current === viewport && source.isConnected && viewport.contains(source);
        const remember = () => { reading.remember(); onAwayChange(!conversationNearBottom(viewport)); };
        return {
          reveal(preview) {
            if (!owns() || !source.contains(preview) || viewport.clientHeight <= 0) return;
            const bounds = viewport.getBoundingClientRect();
            const target = preview.getBoundingClientRect();
            const top = bounds.top + viewport.clientTop + 8;
            const bottom = bounds.top + viewport.clientTop + viewport.clientHeight - 8;
            if (target.height > bottom - top || target.top < top) viewport.scrollTop += target.top - top;
            else if (target.bottom > bottom) viewport.scrollTop += target.bottom - bottom;
            remember();
          },
          restore() {
            noteReadingIntent();
            if (!owns()) return;
            current.current = null;
            // Closing returns to this source, not to output that arrived while
            // it was inspected. Latest/Send or a later user scroll can resume.
            followsLatestRef.current = false;
            userScrollRef.current = false;
            const offset = source.getBoundingClientRect().top - viewport.getBoundingClientRect().top - viewport.clientTop;
            viewport.scrollTop += offset - inspection.offset;
            remember();
          },
          dispose() { if (current.current === inspection) { noteReadingIntent(); current.current = null; } },
        };
      },
    };
    return { controller, active, release, noteReadingIntent, captureIntent };
  }, [owner, viewportRef, followsLatestRef, userScrollRef, reading, onAwayChange]);
}
