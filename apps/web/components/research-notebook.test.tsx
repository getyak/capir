import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { MemoryRecallItem } from "@talent-signal/contracts";
import { ResearchNotebook, researchNoteMetadata, safeResearchLink } from "./research-notebook";
function item(section: string, extra: Record<string, unknown> = {}): MemoryRecallItem {
  return { id: section, scope: "person", statement_kind: "source_statement", display_text: "研究笔记（AI 整理，待复核）\nA supplied note.", original_display_text: "A supplied note.", subject_id: "person", relationship_context_id: null,
    speaker: "AI 人物研究笔记", reporter: "research", valid_time: null, observed_time: null, time_status: "unknown", sensitivity: "normal", version: 1, supersedes_id: null, conflict_group_id: null, evidence_retained: true,
    evidence_refs: [{ excerpt: "A supplied note.", locator: { kind: "document", locator: { schema: "research-notebook.v1", note_key: section, section, review_status: "unreviewed_research", ...extra } }, capture_id: null, source_resource_id: null, source_session_id: null, source_message_id: null, source_artifact_id: null }], created_at: "2026-10-01T00:00:00Z" };
}
describe("research notebook reading", () => {
  it("preserves unknown identity, proposed status and ordinary memory distinction", () => {
    const html = renderToStaticMarkup(<ResearchNotebook items={[item("identity")]} />);
    expect(html).toContain("待人工复核"); expect(html).toContain("账号留空");
    expect(html).not.toContain("已确认的联系方式");
    expect(researchNoteMetadata({ ...item("identity"), statement_kind: "fact" })).toBeNull();
  });
  it("shows platform attribution/exclusion and source reading limits with safe links", () => {
    const html = renderToStaticMarkup(<ResearchNotebook items={[item("platform", { platform: "GitHub", url: "https://github.com/synthetic-person", role: "历史排除", ownership: "Not the same person", evidenceUrl: "javascript:alert(1)", captureStatus: "目标页未读取", use: "原始候选" }), item("sources", { sources: [{ url: "https://synthetic.invalid/article", title: "<script>danger</script>", readStatus: "unread", limits: "Partial window only" }] })]} />);
    expect(html).toContain("历史排除"); expect(html).toContain("目标页未读取"); expect(html).toContain("Partial window only");
    expect(html).toContain("href=\"https://github.com/synthetic-person\""); expect(html).not.toContain("javascript:"); expect(html).not.toContain("<script>danger");
  });
  it("rejects credential URLs and executable schemes; keeps empty archive absent", () => {
    expect(safeResearchLink("https://user:secret@synthetic.invalid")).toBeNull();
    expect(safeResearchLink("data:text/html,hi")).toBeNull(); expect(safeResearchLink("/api/private")).toBeNull();
    expect(renderToStaticMarkup(<ResearchNotebook items={[]} />)).toBe("");
  });
});
