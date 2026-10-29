/** Match the canonical Session title's display budget without silent truncation. */
export function normalizeSessionTitle(value: string): string | null {
  const title = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ").replace(/\s+/gu, " ").trim();
  if (!title || Array.from(title).length > 256) return null;
  return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(title)].length <= 32 ? title : null;
}
