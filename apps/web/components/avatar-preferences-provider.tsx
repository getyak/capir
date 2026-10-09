"use client";

import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createAvatarStore, emptyAvatarPreferences, type AvatarStore } from "@/lib/avatar-preferences";
import type { AvatarPreference, AvatarStyle } from "@/lib/avatar";

const Context = createContext<AvatarStore | null>(null);
export type AvatarEditorTarget = { id: string; label: string; url?: string | null; self?: boolean };
export type AvatarEditorRequest = AvatarEditorTarget & { trigger: HTMLButtonElement; expected: AvatarPreference | undefined };
const EditorContext = createContext<((target: AvatarEditorTarget, trigger: HTMLButtonElement) => void) | null>(null);
const AvatarEditorDialog = lazy(() => import("./avatar-editor-dialog"));
const noopSubscribe = () => () => {};
const serverSnapshot = () => emptyAvatarPreferences;

export function AvatarPreferencesProvider({ scope, children }: { scope: string | null; children: ReactNode }) {
  return scope ? <BoundAvatarPreferences key={scope} scope={scope}>{children}</BoundAvatarPreferences> : children;
}

function BoundAvatarPreferences({ scope, children }: { scope: string; children: ReactNode }) {
  const [store] = useState(() => createAvatarStore(scope, () => window.localStorage));
  const [editing, setEditing] = useState<AvatarEditorRequest | null>(null);
  const openEditor = useCallback((target: AvatarEditorTarget, trigger: HTMLButtonElement) => {
    store.refresh();
    setEditing({ ...target, trigger, expected: store.getSnapshot().people[target.self ? "self" : `person:${target.id}`] });
  }, [store]);
  useEffect(() => {
    // Install before opening any editor: Radix owns document-capture Escape.
    // IME cancellation must keep its native default and leave the draft open.
    const preserveComposition = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (event.isComposing || event.keyCode === 229)
        && event.target instanceof Element && event.target.closest("[data-avatar-editor][role=dialog]")) {
        event.stopImmediatePropagation();
      }
    };
    document.addEventListener("keydown", preserveComposition, true);
    return () => document.removeEventListener("keydown", preserveComposition, true);
  }, []);
  useEffect(() => {
    const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === store.key) store.refresh(); };
    const refresh = () => store.refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [store]);
  return <Context.Provider value={store}><EditorContext.Provider value={openEditor}>
    {children}
    {editing ? <Suspense fallback={<span role="status" className="sr-only">正在打开头像设置…</span>}>
      <AvatarEditorDialog key={`${editing.self ? "self" : editing.id}`} request={editing} onClose={() => setEditing(null)} />
    </Suspense> : null}
  </EditorContext.Provider></Context.Provider>;
}

export const useAvatarEditor = () => useContext(EditorContext);

/** A person's change must not rerender every other avatar in a large directory. */
export function useAvatarDisplay(entity: string) {
  const store = useContext(Context);
  const preference = useSyncExternalStore(store?.subscribe ?? noopSubscribe,
    () => store?.getSnapshot().people[entity], () => undefined);
  const defaultStyle = useSyncExternalStore<AvatarStyle>(store?.subscribe ?? noopSubscribe,
    () => preference && preference.style !== "auto" ? "initials" : store?.getSnapshot().defaultStyle ?? "initials", () => "initials");
  return { store, preference, defaultStyle };
}

export function useAvatarPreferences() {
  const store = useContext(Context);
  const snapshot = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getSnapshot ?? serverSnapshot, serverSnapshot);
  return { store, ...snapshot };
}
