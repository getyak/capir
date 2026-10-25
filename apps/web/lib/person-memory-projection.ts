import { translate } from "@/lib/i18n";
import type { LocaleTag, MemoryRecallItem } from "@talent-signal/contracts";

export const MEMORY_SCOPE_LABELS: Record<string, string> = {
  relationship: "我们之间", person: "关于对方", self: "关于我",
};

export function canEditMemory(item: MemoryRecallItem): boolean {
  return "can_edit" in item && item.can_edit === true;
}

export function memoryAttribution(item: MemoryRecallItem, locale: LocaleTag = "zh-CN"): string {
  const t = (key: string) => translate(locale, key);
  const kind = item.statement_kind === "source_statement"
    ? `${t("来源陈述")}${item.speaker ? ` · ${item.speaker}` : ""}`
    : item.statement_kind === "user_opinion" ? t("用户观点") : t("已保存事实");
  return `${kind}${item.display_text !== item.original_display_text ? ` · ${t("用户修改")}` : ""}${item.conflict_group_id ? ` · ${t("存在冲突 · 待核对")}` : ""}`;
}

export function memoryDate(value: string | null | undefined, locale: LocaleTag = "zh-CN"): string {
  if (!value || !Number.isFinite(Date.parse(value))) return translate(locale, "时间未记录");
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Shanghai" }).format(new Date(value));
}

/** An extractive reading projection. It never creates a new fact or timeline. */
export function memoryGroups(items: readonly MemoryRecallItem[]): Array<{ scope: string; items: MemoryRecallItem[] }> {
  const groups = new Map<string, MemoryRecallItem[]>();
  for (const item of items) {
    const entries = groups.get(item.scope) ?? [];
    entries.push(item);
    groups.set(item.scope, entries);
  }
  return ["relationship", "person", "self"].filter(scope => groups.has(scope))
    .map(scope => ({ scope, items: groups.get(scope)! }));
}

/** Only currently retained excerpts may be exposed as raw evidence. */
export function memorySources(item: MemoryRecallItem): MemoryRecallItem["evidence_refs"] {
  return item.evidence_retained ? item.evidence_refs.filter(ref => Boolean(ref.excerpt?.trim())) : [];
}

export function memorySourceLabel(ref: MemoryRecallItem["evidence_refs"][number], locale: LocaleTag = "zh-CN"): string {
  return translate(locale, ref.locator.kind === "message" ? "对话摘录" : ref.locator.kind === "image_region" ? "截图摘录" : "文档摘录");
}
