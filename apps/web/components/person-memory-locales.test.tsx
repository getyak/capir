// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LocaleTag, MemoryRecallItem } from "@talent-signal/contracts";
import { LocaleProvider } from "./locale-provider";
import { PersonMemoryContent } from "./person-memory-content";
const fetcher = vi.hoisted(() => vi.fn());
vi.mock("./workspace-session-request", () => ({ workspaceSessionFetch: fetcher, WORKSPACE_SESSION_EXPIRED_EVENT: "session-expired" }));
const personId = "11111111-1111-4111-8111-111111111111";
const sessionId = "33333333-3333-4333-8333-333333333333";
const item = { id: "old", scope: "relationship", statement_kind: "source_statement", display_text: "对方计划下月参与试点", original_display_text: "对方计划下月参与试点", subject_id: personId,
  relationship_context_id: null, speaker: "对方", reporter: "记录者原名", valid_time: null, observed_time: "2026-10-12T01:00:00Z", time_status: "future", sensitivity: "normal", version: 1, supersedes_id: null, conflict_group_id: "conflict-original-id",
  evidence_retained: true, evidence_refs: [{ excerpt: "下个月可以聊一下试点", locator: { kind: "message", session_id: sessionId, message_id: "source-message" }, source_session_id: sessionId }], created_at: "2026-10-13T00:00:00Z", can_edit: true } as MemoryRecallItem;
let host: HTMLDivElement; let root: Root;
async function mount(locale: LocaleTag, items = [item], hasMore = false) {
  await act(async () => root.render(<LocaleProvider locale={locale}><PersonMemoryContent personId={personId} binding="binding" entryCapability="entry" initialItems={items} hasMore={hasMore} nextCursor={hasMore ? "signed-next" : null} /></LocaleProvider>));
}
function button(label: string) { const value = [...host.querySelectorAll("button")].find(node => node.textContent === label); if (!value) throw new Error(`Missing ${label}`); return value; }
async function click(label: string) { await act(async () => button(label).click()); }
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); fetcher.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it.each([
  ["en", "Confirmed memories", "Individual memories", "Reading overview", "Original excerpts", "Source statement", "Conflict · needs review"],
  ["zh-CN", "已确认记忆", "逐条记忆", "阅读概览", "原始摘录", "来源陈述", "存在冲突 · 待核对"],
  ["zh-TW", "已確認記憶", "逐條記憶", "閱讀概覽", "原始摘錄", "來源陳述", "內容衝突 · 待核對"],
  ["ja", "確認済みの記憶", "個別の記憶", "閲覧用の概要", "元の抜粋", "出典の発言", "矛盾あり · 要確認"],
  ["ko", "확인된 기억", "개별 기억", "읽기 개요", "원문 발췌", "출처 진술", "상충하는 내용 · 확인 필요"],
] as const)("localizes loaded Memory states in %s while preserving exact statements, attribution and excerpts", async (locale, title, memory, reading, raw, attribution, conflict) => {
  await mount(locale);
  for (const text of [title, memory, reading, raw, attribution, conflict, "对方", item.display_text]) expect(host.textContent).toContain(text);
  await click(reading); expect(host.textContent).toContain(item.display_text); expect(host.textContent).toContain(conflict);
  await click(raw); expect(host.querySelector("blockquote")?.textContent).toBe("下个月可以聊一下试点");
  expect(host.textContent).toContain("记录者原名"); expect(host.textContent).toContain("conflict-original-id");
  expect(host.querySelector(`a[href='/workspace/sessions/${sessionId}']`)).not.toBeNull();
  if (locale === "en") { expect(host.textContent).not.toContain("来源时间"); expect(host.textContent).toContain("Source time"); expect(host.textContent).toContain("Oct 12, 2026"); }
});

it("switches locale with an unsaved editor without resetting the draft or sending a request", async () => {
  await mount("zh-CN"); await click("修改");
  const textarea = host.querySelector("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, "我的未保存原话"); textarea.dispatchEvent(new Event("input", { bubbles: true })); });
  await mount("en");
  expect(host.querySelector("textarea")).toBe(textarea); expect(textarea.value).toBe("我的未保存原话");
  expect(host.textContent).toContain("Edit this memory"); expect(button("Save edits")).toBeDefined();
  expect(fetcher).not.toHaveBeenCalled();
  await click("Cancel"); expect(host.querySelector("textarea")).toBeNull(); expect(host.textContent).toContain(item.display_text);
});

it("localizes failed pagination without calling unreadable memory empty or changing request scope", async () => {
  await mount("en", [item], true); fetcher.mockResolvedValueOnce(Response.json({}, { status: 404 }));
  await click("Load more memories");
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("The memory or access scope is unavailable. Reopen this person's page.");
  expect(host.textContent).not.toContain("No confirmed memories yet");
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("cursor=signed-next"), expect.objectContaining({ cache: "no-store", headers: { "x-memory-entry-capability": "entry", "x-workspace-session": "binding" } }));
});

it.each([
  ["zh-CN", "还没有关于这个人的记忆。", "开始记录"],
  ["en", "No memories about this person yet.", "Start a note"],
  ["zh-TW", "還沒有關於這個人的記憶。", "開始記錄"],
  ["ja", "この人についての記憶はまだありません。", "記録を始める"],
  ["ko", "아직 이 사람에 대한 기억이 없어요.", "기록 시작"],
] as const)("keeps a short localized empty state in %s", async (locale, sentence, action) => {
  await mount(locale, []);
  expect(host.querySelector("p")?.textContent).toBe(sentence);
  expect(host.querySelector("a")).toBeNull();
  expect(host.textContent).not.toContain(action);
  expect(host.querySelector("nav")).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});
