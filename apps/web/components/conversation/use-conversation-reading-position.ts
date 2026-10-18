"use client";

import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { subscribeWorkspaceDirectoryInvalidation } from "@/lib/workspace-directory-cache";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "../workspace-session-request";
import { conversationNearBottom } from "../session-workbench/session-presentation";
import { isSessionId } from "../session-workbench/session-view";

type ReadingPosition = {
  scope: string;
  sessionId: string;
  binding: string;
  top: number;
  followsLatest: boolean;
  expiresAt: number;
};
type LiveReader = {
  scope: string;
  sessionId: string;
  binding: string;
  discard: () => void;
};

// Disposable presentation memory only: no titles, messages or browser storage.
// The server's account/user HMAC and exact Session ID own each position.
const positions = new Map<string, ReadingPosition>();
const readers = new Set<LiveReader>();
const MAX_POSITIONS = 80;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RESTORE_WINDOW_MS = 1500;
let observingIdentity = false;
const keyFor = (scope: string, sessionId: string) => `${scope}:${sessionId}`;

/** Confirmed deletion must also fence a mounted reader's eventual cleanup. */
export function forgetConversationReadingPosition(scope: string, sessionId: string) {
  positions.delete(keyFor(scope, sessionId));
  for (const reader of readers) {
    if (reader.scope === scope && reader.sessionId === sessionId) reader.discard();
  }
}

function observeIdentity() {
  if (observingIdentity || typeof window === "undefined") return;
  observingIdentity = true;
  // Remain subscribed while the user is on People/Time with no mounted Session.
  subscribeWorkspaceDirectoryInvalidation((bindings, mode) => {
    if (mode !== "discard") return;
    for (const position of positions.values()) {
      if (bindings === null || bindings.includes(position.binding)) {
        forgetConversationReadingPosition(position.scope, position.sessionId);
      }
    }
    for (const reader of readers) {
      if (bindings === null || bindings.includes(reader.binding)) reader.discard();
    }
  });
  window.addEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, () => {
    positions.clear();
    for (const reader of readers) reader.discard();
  });
}

function metrics(node: HTMLElement) {
  const { scrollTop, scrollHeight, clientHeight } = node;
  if (![scrollTop, scrollHeight, clientHeight].every(Number.isFinite) || clientHeight <= 0 || scrollHeight < 0) return null;
  const maximum = Math.max(0, scrollHeight - clientHeight);
  return { maximum, top: Math.max(0, Math.min(scrollTop, maximum)) };
}

type Options = {
  viewportRef: RefObject<HTMLElement | null>;
  contentRef?: RefObject<HTMLElement | null>;
  followsLatestRef: RefObject<boolean>;
  onAwayChange: (away: boolean) => void;
  scope: string;
  sessionId: string | null;
  binding: string;
  ready: boolean;
  unavailable: boolean;
  expiresAt?: string;
};

/** Restore reading intent without replacing either runtime's scroll rules. */
export function useConversationReadingPosition({ viewportRef, contentRef, followsLatestRef, onAwayChange, scope, sessionId, binding, ready, unavailable, expiresAt }: Options) {
  const restoring = useRef(false);
  const restored = useRef(false);
  const control = useRef<{ restore: () => void; cancel: () => void; remember: () => void } | null>(null);

  useLayoutEffect(() => {
    restored.current = false;
    restoring.current = false;
    if (!sessionId) return;
    if (unavailable) {
      forgetConversationReadingPosition(scope, sessionId);
      onAwayChange(false);
      return;
    }
    const node = viewportRef.current;
    if (!ready || !node) return;
    observeIdentity();
    const key = keyFor(scope, sessionId);
    const now = Date.now();
    const parsedExpiry = expiresAt ? Date.parse(expiresAt) : now + MAX_AGE_MS;
    const deadline = Math.min(parsedExpiry, now + MAX_AGE_MS);
    const canRemember = /^[0-9a-f]{64}$/u.test(scope) && isSessionId(sessionId) && Number.isFinite(deadline) && deadline > now;
    for (const [retainedKey, position] of positions) {
      if (position.expiresAt <= now) positions.delete(retainedKey);
    }
    let saved = canRemember ? positions.get(key) ?? null : null;
    if (!canRemember) positions.delete(key);
    let disposed = false;
    let revoked = false;
    let timer: number | undefined;
    let expiryTimer: number | undefined;
    let resize: ResizeObserver | undefined;

    function restore() {
      if (disposed || revoked || !saved || !restoring.current) return false;
      const measured = metrics(node!);
      if (!measured) return false;
      node!.scrollTop = saved.followsLatest ? measured.maximum : Math.min(saved.top, measured.maximum);
      followsLatestRef.current = saved.followsLatest;
      onAwayChange(!conversationNearBottom(node!));
      return true;
    }
    function cancel() {
      restoring.current = false;
      saved = null;
      if (timer !== undefined) window.clearTimeout(timer);
      resize?.disconnect();
    }
    function remember() {
      if (disposed || revoked || !canRemember || Date.now() >= deadline) return;
      const measured = metrics(node!);
      if (!measured) return;
      const position: ReadingPosition = {
        scope, sessionId: sessionId!, binding,
        top: saved && restoring.current ? saved.top : measured.top,
        followsLatest: saved && restoring.current ? saved.followsLatest : followsLatestRef.current,
        expiresAt: deadline,
      };
      positions.delete(key);
      positions.set(key, position);
      while (positions.size > MAX_POSITIONS) positions.delete(positions.keys().next().value!);
    }
    const reader: LiveReader = {
      scope, sessionId, binding,
      discard() {
        if (revoked) return;
        revoked = true;
        cancel();
        if (!disposed) onAwayChange(false);
      },
    };
    readers.add(reader);
    const current = { restore: () => { restore(); }, cancel, remember };
    control.current = current;
    if (saved) {
      restored.current = true;
      restoring.current = true;
      followsLatestRef.current = saved.followsLatest;
      restore();
      // Initial fonts, images and composer hydration may change dimensions.
      // Reapply only in this bounded window; any user scroll cancels it.
      if (typeof ResizeObserver !== "undefined") {
        resize = new ResizeObserver(() => { restore(); });
        resize.observe(node);
        const body = contentRef?.current ?? node.firstElementChild;
        if (body) resize.observe(body);
      }
      timer = window.setTimeout(() => {
        const measured = restore();
        cancel();
        if (measured) {
          // Clamping a shorter transcript must not invent a new follow intent.
          onAwayChange(!conversationNearBottom(node));
          remember();
        }
      }, RESTORE_WINDOW_MS);
    } else {
      followsLatestRef.current = true;
      onAwayChange(false);
    }
    if (canRemember) expiryTimer = window.setTimeout(() => forgetConversationReadingPosition(scope, sessionId), deadline - now);
    const onScroll = () => { if (!restoring.current) remember(); };
    node.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", remember);
    return () => {
      // Layout cleanup runs before Activity hides the viewport or removes DOM.
      remember();
      disposed = true;
      cancel();
      if (expiryTimer !== undefined) window.clearTimeout(expiryTimer);
      readers.delete(reader);
      node.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", remember);
      if (control.current === current) control.current = null;
    };
  }, [viewportRef, contentRef, followsLatestRef, onAwayChange, scope, sessionId, binding, ready, unavailable, expiresAt]);

  return useMemo(() => ({
    restoring, restored,
    restore: () => control.current?.restore(),
    cancelRestore: () => control.current?.cancel(),
    remember: () => control.current?.remember(),
    forget: () => { if (sessionId) forgetConversationReadingPosition(scope, sessionId); },
  }), [scope, sessionId]);
}
