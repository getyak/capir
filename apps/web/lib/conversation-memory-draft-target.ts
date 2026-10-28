import type { ConversationMemoryDraftTarget } from "@talent-signal/contracts";
import { reconcileComposerSpans } from "./composer-mentions";

/** Display label and exact reference span are local presentation, never wire authority. */
export type ComposerMemoryDraftTarget = { person_id: string; label: string; start: number; end: number; text: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function isConversationMemoryDraftTarget(value: unknown): value is ConversationMemoryDraftTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).length === 1 && typeof row.person_id === "string" && uuid.test(row.person_id);
}
export function sameConversationMemoryDraftTarget(a: ConversationMemoryDraftTarget | undefined, b: ConversationMemoryDraftTarget | undefined) {
  return a?.person_id === b?.person_id;
}
export function reconcileMemoryDraftTarget(previous: string, next: string, target: ComposerMemoryDraftTarget | null) {
  return target ? reconcileComposerSpans(previous, next, [target])[0] ?? null : null;
}
export function memoryDraftHasAuthoredText(value: string, target: ComposerMemoryDraftTarget) {
  return value.slice(target.start, target.end) === target.text && Boolean((value.slice(0, target.start) + value.slice(target.end)).trim());
}

export function memoryDraftFailureKey(code: string | null | undefined): string | null {
  if (!code?.startsWith("MEMORY_DRAFT_TARGET_")) return null;
  if (code === "MEMORY_DRAFT_TARGET_UNSUPPORTED") return "composer.memoryDraft.serviceUnavailable";
  if (code === "MEMORY_DRAFT_TARGET_TEXT_ONLY") return "composer.memoryDraft.textOnly";
  if (code === "MEMORY_DRAFT_TARGET_TEXT_REQUIRED") return "composer.memoryDraft.textRequired";
  return code === "MEMORY_DRAFT_TARGET_NOT_STAGED" ? "composer.memoryDraft.notStaged" : "composer.memoryDraft.unavailable";
}
