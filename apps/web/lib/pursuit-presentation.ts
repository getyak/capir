/** Present an absolute deadline without changing its instant or hiding its zone. */
export function formatPursuitDeadline(value: string | null, timeZone: string): string {
  if (!value) return "未设置截止时间";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "截止时间待核对";

  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: zone }).format(date);
  } catch {
    zone = "UTC";
  }
  const day = new Intl.DateTimeFormat("zh-CN", {
    timeZone: zone, year: "numeric", month: "long", day: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("zh-CN", {
    timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
  return `${day} ${time} · ${zone}`;
}

/**
 * Glance label for hero meta lines: the same instant rendered in the reader's
 * zone, with the year folded away while it matches the current year there.
 * Callers keep the full zone-aware label on the element (title/aria), so the
 * compact form never hides the zone or the instant.
 */
export function formatPursuitDeadlineCompact(
  value: string | null,
  timeZone: string,
  now: Date = new Date(),
): string {
  if (!value) return "未设置截止时间";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "截止时间待核对";

  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: zone }).format(date);
  } catch {
    zone = "UTC";
  }
  const parts = (instant: Date) => {
    const fields = new Intl.DateTimeFormat("zh-CN", {
      timeZone: zone, year: "numeric", month: "numeric", day: "numeric",
    }).formatToParts(instant);
    const pick = (type: string) => fields.find((part) => part.type === type)?.value ?? "";
    return { year: pick("year"), month: pick("month"), day: pick("day") };
  };
  const at = parts(date);
  const today = parts(now);
  const time = new Intl.DateTimeFormat("zh-CN", {
    timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
  return at.year === today.year
    ? `${at.month} 月 ${at.day} 日 ${time}`
    : `${at.year} 年 ${at.month} 月 ${at.day} 日 ${time}`;
}
