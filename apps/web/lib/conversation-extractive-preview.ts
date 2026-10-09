/**
 * Extractive reading preview for one completed answer body.
 *
 * The preview is extraction only: it quotes the answer's own leading text and
 * never invents, summarizes with a model, or rewrites anything. The exact full
 * text stays owned by the caller and is restored verbatim on unfold.
 */

/** Answer bodies at or above this length earn the reading fold. */
export const LONG_ANSWER_MIN_CHARS = 320;

/** Character budget of the extracted leading preview. */
export const PREVIEW_CHAR_BUDGET = 220;

const BLOCK_SEPARATOR = /\n{2,}/u;
const SENTENCE_END = /(?<=[。！？!?；;])\s*/u;

function isFence(line: string): boolean {
  return /^\s*(```|~~~)/u.test(line);
}

function isTableLine(line: string): boolean {
  return /^\s*\|.*\|\s*$/u.test(line);
}

function isStructuredBlock(block: string): boolean {
  const lines = block.split("\n");
  return lines.some(isFence) || (lines.length > 0 && lines.every(isTableLine));
}

/** Trim markdown decoration down to readable prose for preview purposes. */
function plainProse(block: string): string {
  return block
    .replace(/^\s{0,3}#{1,6}\s+/mu, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/^\s{0,3}>\s?/mu, "")
    .replace(/[*_`~]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Leading sentences of the answer's own prose, capped at `budget` characters,
 * cut at a sentence or word boundary. Headings count toward the budget; code
 * blocks and tables are skipped so structured content is never sliced. Returns
 * "" when the answer has no prose worth previewing.
 */
export function extractiveReadingPreview(
  markdown: string,
  budget = PREVIEW_CHAR_BUDGET,
): string {
  // Remove whole fenced regions before paragraph splitting, including blank
  // lines within a fence. Code fragments must never become preview prose.
  let fence: string | null = null;
  const proseLines: string[] = [];
  for (const line of markdown.split("\n")) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/u)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      proseLines.push("");
    } else if (!fence) proseLines.push(line);
  }
  const blocks = proseLines.join("\n").split(BLOCK_SEPARATOR);
  let out = "";
  for (const block of blocks) {
    if (isStructuredBlock(block)) continue;
    const prose = plainProse(block);
    if (!prose) continue;
    const candidate = out ? `${out} ${prose}` : prose;
    if (candidate.length <= budget) {
      out = candidate;
      continue;
    }
    const room = budget - (out ? out.length + 1 : 0);
    if (room <= 0) break;
    const slice = prose.slice(0, room + 1);
    let cut = -1;
    for (const match of slice.matchAll(new RegExp(SENTENCE_END.source, "gu"))) {
      if (match.index !== undefined && match.index > 0) {
        cut = Math.max(cut, match.index + match[0].length);
      }
    }
    if (cut <= 0 || cut > room) {
      const space = slice.lastIndexOf(" ");
      cut = space > room * 0.5 ? Math.min(space, room) : room;
    }
    out = out ? `${out} ${slice.slice(0, cut).trimEnd()}` : slice.slice(0, cut).trimEnd();
    break;
  }
  return out;
}

/** Whether a body is long enough to earn the fold surface. */
export function isLongAnswer(
  markdown: string,
  minChars = LONG_ANSWER_MIN_CHARS,
): boolean {
  return markdown.trim().length >= minChars;
}
