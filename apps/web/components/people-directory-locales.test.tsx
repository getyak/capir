import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { LocaleTag, PersonDirectoryItem } from "@talent-signal/contracts";
import { LocaleProvider } from "./locale-provider";
import { PeopleDirectoryApp } from "./people-directory-app";
vi.mock("next/navigation", () => ({ usePathname: () => "/workspace/people" }));
const session = "33333333-3333-4333-8333-333333333333";
const person: PersonDirectoryItem = { id: "person-a", display_label: "林知遥", context_count: 1, capture_count: 2, confirmed_identity_count: 1,
  last_activity_at: "2026-09-20T08:00:00Z", profile: null, avatar: null,
  contexts: [{ id: "context-a", display_label: "项目沟通原文", last_activity_at: "2026-09-20T08:00:00Z" }],
  identity_matches: [{ kind: "expired_handle", handle_type: "email", display_hint: "l***@example.test", source_resource_id: null, expired_at: "2026-09-01T00:00:00Z" }] };
const defaults = { error: null, people: [], query: "", returnSessionId: null, sessionRecoveryHref: null };
function render(locale: LocaleTag, props: Partial<Parameters<typeof PeopleDirectoryApp>[0]> = {}) {
  return renderToStaticMarkup(<LocaleProvider locale={locale}><PeopleDirectoryApp {...defaults} {...props} /></LocaleProvider>);
}
it.each([
  ["en", "Each relationship keeps its own context.", "Matching people: 1"],
  ["zh-CN", "每段关系保留自己的上下文。", "1 位匹配人物"],
  ["zh-TW", "每段關係保留各自的脈絡。", "1 位符合的人物"],
  ["ja", "それぞれの関係の文脈を個別に保持します。", "一致する人物：1人"],
  ["ko", "각 관계의 맥락을 따로 유지합니다.", "일치하는 인물: 1명"],
] as const)("localizes the normal full People listing in %s without changing authored identity, context or historical contact", (locale, description, count) => {
  const html = render(locale, { people: [person], query: "林", returnSessionId: session });
  for (const text of [description, count, "林知遥", "项目沟通原文", "l***@example.test"]) expect(html).toContain(text);
  expect(html).toContain(`/workspace/people/person-a?directory_query=%E6%9E%97&amp;session=${session}`);
  expect(html).toContain(`/workspace?surface=desk&amp;intent=create-contact&amp;session=${session}`);
  if (locale === "en") { expect(html).toContain("does not automatically change the conversation scope"); expect(html).toContain("Earlier Email"); }
});
it("localizes empty, filtered-empty and bounded results without claiming an exhaustive result", () => {
  const empty = render("en");
  expect(empty).toContain("People: 0"); expect(empty).toContain("No people yet");
  expect(empty).toContain("Start with a chat or an introduction to organize your first contact.");
  const filtered = render("en", { query: "林", returnSessionId: session });
  expect(filtered).toContain("No matching people"); expect(filtered).toContain("Contact details stay masked");
  expect(filtered).toContain(`/workspace/people?session=${session}`);
  const people = Array.from({ length: 200 }, (_, index) => ({ ...person, id: `person-${index}` }));
  expect(render("en", { people })).toContain("Showing the first 200 people");
  expect(render("en", { people, query: "林" })).toContain("Showing the first 200 matching people");
});
it("localizes unavailable and session-recovery copy without showing a successful empty result", () => {
  const html = render("en", { error: "无法连接账号专属后端；系统不会从陈旧数据推断关系状态。", query: "林", returnSessionId: session });
  expect(html).toContain("Connection temporarily interrupted"); expect(html).toContain("The directory is temporarily unavailable. Saved contact data will not change.");
  expect(html).toContain("Reload"); expect(html).not.toContain("People: 0"); expect(html).not.toContain("No people yet");
  expect(html).toContain(`/workspace/people?query=%E6%9E%97&amp;session=${session}`);
  const expired = render("en", { error: "登录状态已失效，请重新登录后继续。", sessionRecoveryHref: "/login?callbackUrl=%2Fworkspace%2Fpeople" });
  expect(expired).toContain("Signing in again returns to the same directory view");
  expect(expired).toContain('href="/login?callbackUrl=%2Fworkspace%2Fpeople"');
  expect(expired).not.toContain("登录状态");
});
