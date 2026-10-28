import type { SidebarPerson } from "./workspace-sidebar";

/** Disposable presentation spans created only by an explicit directory choice. */
export type ComposerMention = { start: number; end: number; text: string; person: SidebarPerson };

export function reconcileComposerSpans<T extends { start: number; end: number; text: string }>(previous: string, next: string, mentions: readonly T[]): T[] {
  if (!next) return [];
  if (previous === next) return [...mentions];
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  let oldEnd = previous.length, newEnd = next.length;
  while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === next[newEnd - 1]) { oldEnd--; newEnd--; }
  const delta = newEnd - oldEnd;
  const occurrences = (value: string, text: string) => value.split(text).length - 1;
  return mentions.flatMap(mention => {
    // A plain-text edit cannot identify which identical label was removed.
    // Drop all affected identical references rather than attach the wrong id.
    if (occurrences(previous, mention.text) > 1 && occurrences(previous, mention.text) !== occurrences(next, mention.text)) return [];
    if (mention.end > start && mention.start < oldEnd) return [];
    if (start === oldEnd && mention.start < start && start < mention.end) return [];
    const shifted = mention.start >= oldEnd ? { ...mention, start: mention.start + delta, end: mention.end + delta } : mention;
    return next.slice(shifted.start, shifted.end) === shifted.text ? [shifted] : [];
  });
}

export function reconcileComposerMentions(previous: string, next: string, mentions: readonly ComposerMention[]): ComposerMention[] {
  return reconcileComposerSpans(previous, next, mentions);
}
