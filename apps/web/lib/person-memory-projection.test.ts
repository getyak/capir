import { describe, expect, it } from "vitest";
import type { MemoryRecallItem } from "@talent-signal/contracts";
import { canEditMemory, memoryAttribution, memoryDate, memoryGroups, memorySources } from "./person-memory-projection";
const item = { id: "i", scope: "person", statement_kind: "source_statement", speaker: "对方", display_text: "对方说可能下月搬家", original_display_text: "对方说可能下月搬家", evidence_retained: true,
  evidence_refs: [{ excerpt: "可能下个月搬家", locator: { kind: "message", session_id: null, message_id: null } }] } as MemoryRecallItem;
describe("person Memory projections", () => {
  it("keeps exact sentences and attribution instead of generating new biography or current facts", () => {
    expect(memoryGroups([item])[0]!.items[0]!.display_text).toBe(item.display_text);
    expect(memoryAttribution(item)).toBe("来源陈述 · 对方");
    expect(memoryAttribution({ ...item, display_text: "修改" })).toBe("来源陈述 · 对方 · 用户修改");
  });
  it("never exposes excerpts after retention or authorization removes source evidence", () => {
    expect(memorySources(item)).toHaveLength(1); expect(memorySources({ ...item, evidence_retained: false })).toEqual([]);
    expect(memorySources({ ...item, evidence_refs: [{ ...item.evidence_refs[0]!, excerpt: "" }] })).toEqual([]);
  });
  it("orders scopes by the relationship question and represents unknown time explicitly", () => {
    expect(memoryGroups([item, { ...item, scope: "self" }, { ...item, scope: "relationship" }]).map(group => group.scope)).toEqual(["relationship", "person", "self"]);
    expect(memoryDate(null)).toBe("时间未记录"); expect(memoryDate("invalid")).toBe("时间未记录");
  });
  it("keeps conflict authority explicit and fails closed on missing edit permission", () => {
    expect(memoryAttribution({ ...item, conflict_group_id: "conflict" })).toContain("存在冲突 · 待核对");
    expect(canEditMemory(item)).toBe(false); expect(canEditMemory({ ...item, ...{ can_edit: true } })).toBe(true);
  });
});
