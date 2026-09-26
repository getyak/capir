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
