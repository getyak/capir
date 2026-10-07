import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PersonDirectoryItem } from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";
import { PeopleDirectoryApp } from "./people-directory-app";
import { PeopleDirectorySearch } from "./people-directory-search";

const person: PersonDirectoryItem = {
  id: "person-a", display_label: "林知遥", context_count: 1,
  capture_count: 2, confirmed_identity_count: 1,
  last_activity_at: "2026-09-20T08:00:00Z", profile: null, avatar: null,
  contexts: [{ id: "context-a", display_label: "项目沟通", last_activity_at: "2026-09-20T08:00:00Z" }],
  identity_matches: [{ kind: "expired_handle", handle_type: "email", display_hint: "l***@example.test", source_resource_id: null, expired_at: "2026-09-01T00:00:00Z" }],
};
const props = { error: null, people: [], query: "", returnSessionId: null, sessionRecoveryHref: null };

describe("people directory states", () => {
  it("clears a committed filter without dropping the originating conversation", () => {
    const filtered = renderToStaticMarkup(createElement(PeopleDirectorySearch, { query: "林", returnSessionId: "session-a" }));
    expect(filtered).toContain('aria-label="清除人物搜索"');
    expect(filtered).toContain('href="/workspace/people?session=session-a"');
    expect(filtered).toContain('name="session"');
    expect(filtered).toContain('value="session-a"');
    const unfiltered = renderToStaticMarkup(createElement(PeopleDirectorySearch, { query: "", returnSessionId: "session-a" }));
    expect(unfiltered).not.toContain('aria-label="清除人物搜索"');
  });
  it("distinguishes unavailable data from an empty directory", () => {
    const unavailable = renderToStaticMarkup(createElement(PeopleDirectoryApp, { ...props, error: "暂时无法连接" }));
    expect(unavailable).toContain("暂不可用");
    expect(unavailable).toContain("目录暂时不可用；已保存的联系人资料不会改变。");
    expect(unavailable).not.toContain("0 位人物");
    expect(unavailable).not.toContain("0 位联系人");
    expect(unavailable).not.toContain("还没有人物");
    const empty = renderToStaticMarkup(createElement(PeopleDirectoryApp, props));
    expect(empty).toContain("0 位人物");
    expect(empty).toContain("每段关系保留自己的上下文。");
    expect(empty).not.toContain("0 位联系人");
    expect(empty).toContain("添加第一位联系人");
    expect(empty).not.toContain("每位联系人保留独立身份，资料只在对应关系情境中使用。");
  });
  it("keeps historical identity and relationship scope explicit", () => {
    const html = renderToStaticMarkup(createElement(PeopleDirectoryApp, { ...props, people: [person], query: "林", returnSessionId: "session-a" }));
    expect(html).toContain("历史邮箱：l***@example.test");
    expect(html).toContain("项目沟通");
    expect(html).toContain("关系情境与资料");
    expect(html).toContain("1 位匹配人物");
    expect(html.match(/\d+ 位/g)).toHaveLength(1);
    expect(html).not.toContain("1 位匹配联系人");
    expect(html).toContain("这次选择会保留原对话入口，但不会自动改变对话范围。");
    expect(html).toContain("/workspace/people/person-a?session=session-a");
    expect(html).toContain("项目沟通");
    expect(html).toContain('name="session"');
    expect(html).toContain('value="session-a"');
  });
  it("uses only the confirmed avatar URL without referring the private page", () => {
    const html = renderToStaticMarkup(createElement(PeopleDirectoryApp, { ...props, people: [{ ...person, avatar: {
      url: "https://example.test/avatar.png", source_profile_url: "https://example.test/profile",
      source_platform: "fixture", retrieved_at: "2026-09-20T08:00:00Z", confirmed_at: "2026-09-20T08:00:00Z",
    } }] }));
    expect(html).toContain('src="https://example.test/avatar.png"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain('loading="lazy"');
  });
});
