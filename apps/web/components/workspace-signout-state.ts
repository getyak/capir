"use client";

import { invalidateWorkspaceDirectory } from "@/lib/workspace-directory-cache";
import { confirmedWorkspaceSignOut, type WorkspaceSignOutResult } from "@/lib/workspace-signout";

type Completion = Extract<WorkspaceSignOutResult, { status: "signed_out" }>;
type Attempt = { binding: string; generation: number };
let activeBinding: string | null = null;
let generation = 0;
let pending: Attempt | null = null;
let completion: Completion | null = null;
const listeners = new Set<() => void>();
const publish = () => { for (const listener of listeners) listener(); };

/** A render fence only, never authentication. Null/unmount may be the cookie
 * revalidation caused by this action, so only a newer verified binding retires
 * an in-flight completion. A -> B -> A also retires A's earlier attempt. */
export function observeWorkspaceSignOutBinding(binding: string | null | undefined): void {
  if (!binding || activeBinding === binding) return;
  activeBinding = binding;
  generation += 1;
  pending = null;
  completion = null;
  publish();
}

export function beginWorkspaceSignOut(binding: string): Attempt | null {
  if (binding !== activeBinding || pending || completion) return null;
  pending = { binding, generation };
  return pending;
}
export function workspaceSignOutAttemptIsCurrent(attempt: Attempt): boolean {
  return activeBinding === attempt.binding && generation === attempt.generation;
}
export function releaseWorkspaceSignOut(attempt: Attempt): void {
  if (pending === attempt) pending = null;
}

/** Only the real matching completion may remove private chrome. Memory-only
 * state survives the submitting form's cookie-driven unmount, not a reload. */
export function completeWorkspaceSignOut(value: unknown, attempt: Attempt, hosted: boolean): boolean {
  if (!workspaceSignOutAttemptIsCurrent(attempt) || !confirmedWorkspaceSignOut(value, attempt.binding, hosted)) return false;
  completion = value;
  releaseWorkspaceSignOut(attempt);
  invalidateWorkspaceDirectory(attempt.binding, "discard");
  publish();
  return true;
}
export function subscribeWorkspaceSignOut(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const workspaceSignOutSnapshot = () => completion;
export const serverWorkspaceSignOutSnapshot = (): Completion | null => null;
