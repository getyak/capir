/**
 * Session titles are concise human retrieval labels. A person should recognize
 * the concrete topic or task weeks later from the title alone.
 *
 * This module is the single canonicalizer for both provider-proposed titles and
 * locally derived fallbacks. It never performs a remote model request; callers
 * pass the title already produced by the current answer model call.
 */

import { resolveFirstReplyTitle } from "@talent-signal/contracts";

/** Maximum user-perceived characters allowed in a stored Session title. */
export const SESSION_TITLE_MAX_CHARACTERS = 32;
/** Secondary transport guard; never split a grapheme to reach it. */
export const SESSION_TITLE_MAX_CODE_POINTS = 256;

/**
 * Labels that carry no retrieval value on their own. Compared after
 * lowercasing, trimming, and removing surrounding punctuation/whitespace so
 * that "Reply:" or "回答。" is still rejected.
 */
const GENERIC_SESSION_TITLES = new Set([
  "reply",
  "answer",
  "hello",
  "hi",
  "chat",
  "conversation",
  "response",
  "greeting",
  "回复",
  "回答",
  "你好",
  "您好",
  "嗨",
  "工作台对话",
  "对话",
  "聊天",
  "会话",
]);

/** Control characters must never reach a persisted one-line label. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/gu;

function boundedGraphemeTitle(value: string): string {
  let segments: string[];
  try {
    segments = Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
      (part) => part.segment,
    );
  } catch {
    segments = Array.from(value);
  }
  let codePoints = 0;
  const accepted: string[] = [];
  for (const segment of segments) {
    const segmentCodePoints = Array.from(segment).length;
    if (
      accepted.length >= SESSION_TITLE_MAX_CHARACTERS
      || codePoints + segmentCodePoints > SESSION_TITLE_MAX_CODE_POINTS
    ) break;
    accepted.push(segment);
    codePoints += segmentCodePoints;
  }
  return accepted.join("").trim();
}

/** One line, collapsed internal whitespace, no surrounding whitespace. */
export function canonicalizeToOneLine(value: string): string {
  return value
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function isGenericLabel(value: string): boolean {
  const normalized = value
    .toLowerCase()
    .replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, "")
    .trim();
  return normalized.length === 0 || GENERIC_SESSION_TITLES.has(normalized);
}

/**
 * Canonicalizes a model-proposed Session title. Returns null when the proposal
 * is empty, generic, or cannot be bounded, so callers can apply a safe fallback.
 */
export function canonicalizeSessionTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const oneLine = canonicalizeToOneLine(value);
  if (!oneLine || isGenericLabel(oneLine)) return null;
  const bounded = boundedGraphemeTitle(oneLine);
  if (!bounded || isGenericLabel(bounded)) return null;
  return bounded;
}

/**
 * Bounded fallback derived from the user's objective. Never generic: the first
 * line of the objective is truncated to the title budget. Returns an empty
 * string only when the objective has no usable characters.
 */
export function boundedObjectiveTitle(objective: string): string {
  const oneLine = canonicalizeToOneLine(objective);
  if (!oneLine) return "";
  const bounded = boundedGraphemeTitle(oneLine);
  return bounded;
}

/**
 * Canonical title for a first-turn result: prefer a validated model proposal,
 * otherwise derive a bounded label from the objective. Returns null when
 * neither yields a usable title.
 */
export function firstTurnSessionTitle(objective: string, proposed?: unknown): string | null {
  const canonical = canonicalizeSessionTitle(proposed);
  if (canonical) return canonical;
  const fallback = boundedObjectiveTitle(objective);
  if (!fallback) return null;
  if (!isGenericLabel(fallback)) return fallback;
  return /\p{Script=Han}/u.test(objective) ? "简单聊两句" : "Quick hello";
}

/** A first model reply may name an empty Session, never replace a chosen name. */
export function titleAfterFirstReply(current: string, suggested: string, objective = ""): string {
  return resolveFirstReplyTitle(current, suggested, objective.trim() ? firstTurnSessionTitle(objective) ?? "" : "图片");
}
