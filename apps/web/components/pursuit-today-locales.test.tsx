import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { LocaleTag } from "@talent-signal/contracts";
import { LocaleProvider } from "./locale-provider";
import { PursuitTodayPage } from "./pursuit-today-page";
import type { PursuitTodayItem } from "@/lib/pursuitToday";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const item: PursuitTodayItem = { pursuitId: "pursuit-one", title: "合作目标原文", targetOutcome: "accepted_offer", targetDate: "2026-10-25", milestone: "final_conversation", revision: 7,
  personLabel: "林知遥", attentionKind: "action", attentionTitle: "跟进事项原文", attentionDetail: "原始说明", proposalId: null, proposalStatus: null, proposalItemCount: 0,
  action: { id: "action-one", title: "行动原文", owner: "陈工", dueAt: "2026-10-25T09:00:00Z", status: "in_progress" }, gap: null, evidenceState: "available", agentContext: null };
function render(locale: LocaleTag, items = [item], overrides: Partial<Parameters<typeof PursuitTodayPage>[0]> = {}) {
  return renderToStaticMarkup(<LocaleProvider locale={locale}><PursuitTodayPage error={null} expanded={false} projection={{ workspaceId: "workspace", items, attentionCount: items.length, noActionCount: 0, totalPursuits: items.length }} providerMode="safe_deterministic" sessionRecoveryHref={null} {...overrides} /></LocaleProvider>);
}
it.each([
  ["en", "Assigned action", "Target outcome", "Current milestone"],
  ["zh-CN", "已分配行动", "目标结果", "当前里程碑"],
  ["zh-TW", "已指派行動", "目標結果", "目前里程碑"],
  ["ja", "割り当て済みのアクション", "目標とする結果", "現在のマイルストーン"],
  ["ko", "배정된 행동", "목표 결과", "현재 이정표"],
] as const)("localizes Today action chrome in %s while preserving authored work and destinations", (locale, assigned, outcome, milestone) => {
  const html = render(locale);
  for (const text of [assigned, outcome, milestone, item.title, item.attentionTitle, item.personLabel!, "陈工"]) expect(html).toContain(text);
  expect(html).toContain('href="/workspace/pursuits/pursuit-one"');
  if (locale === "en") { expect(html).toContain("October 25, 2026"); expect(html).toContain("Evidence available"); expect(html).not.toContain("当前里程碑"); }
});
it("localizes no-action, partial evidence and recovery without turning missing authority into an available source", () => {
  const empty = render("en", [], { projection: { workspaceId: "workspace", items: [], attentionCount: 0, noActionCount: 3, totalPursuits: 3 } });
  expect(empty).toContain("No pending work for these goals"); expect(empty).toContain("3 active goals have no pending review, assigned action or evidence-backed gap.");
  const partial = render("en", [{ ...item, evidenceState: "partial" }]);
  expect(partial).toContain("Partial evidence available"); expect(partial).toContain("This goal has no reviewed, authorized capture linked to it yet.");
  const unavailable = render("en", [{ ...item, evidenceState: "unavailable" }]);
  expect(unavailable).toContain("Source permissions are unavailable, so a new run cannot cite this source.");
  const recovery = render("en", [], { error: "用户原始错误说明", sessionRecoveryHref: "/login?callbackUrl=%2Fworkspace%2Ftoday" });
  expect(recovery).toContain("Sign in again to continue today&#x27;s work."); expect(recovery).toContain("用户原始错误说明");
});
it("localizes the eligible run's controls without changing the prompt, source refs or review-only authority", () => {
  const html = render("en", [{ ...item, agentContext: { captureId: "capture-one", evidenceRefs: ["e1", "e2"] } }]);
  expect(html).toContain("Run objective"); expect(html).toContain("Review only; no external effects");
  expect(html).toContain(`只审阅“${item.title}”范围内已授权的证据。暂存一项最小且有证据支持的目标更新；如果没有安全、真实的变化，则记录无需行动。`);
  expect(html).toContain("Read 2 exact evidence fragments. Output will be a proposal or no action.");
});
