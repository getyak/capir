import { expect, it } from "vitest";
import type { LocaleTag } from "@talent-signal/contracts";
import { timeFixtureActivity } from "./test/time-fixtures";
import { timeActivitySummary, timeCoverageNote } from "./time-workspace";
import { translate } from "./i18n";
const coverage = "会话活动仅覆盖保留期内的会话（最多 30 天）。设备日历与其他应用不会被导入；此处显示的日程均在 capri 内创建。";
it.each(["en", "zh-CN", "zh-TW", "ja", "ko"] as LocaleTag[])("only localizes exact system-owned summaries/coverage templates in %s", locale => {
  expect(timeActivitySummary({ ...timeFixtureActivity, kind: "person_created", summary: "新建人物" }, locale)).toBe(translate(locale, "新建人物"));
  expect(timeActivitySummary({ ...timeFixtureActivity, kind: "meeting_draft", summary: "未经确认的日程草稿" }, locale)).toBe(translate(locale, "未经确认的日程草稿"));
  expect(timeActivitySummary({ ...timeFixtureActivity, kind: "public_source_update", summary: "定时公开来源读取产生新的拟议依据，等待你审阅。" }, locale)).toBe(translate(locale, "定时公开来源读取产生新的拟议依据，等待你审阅。"));
  expect(timeActivitySummary({ ...timeFixtureActivity, kind: "session_activity", summary: "12 条当日会话记录" }, locale)).toBe(translate(locale, "{count} 条当日会话记录", { count: 12 }));
  expect(timeActivitySummary({ ...timeFixtureActivity, summary: "新建人物" }, locale)).toBe("新建人物");
  expect(timeActivitySummary({ ...timeFixtureActivity, kind: "person_created", summary: "新建人物：原始备注" }, locale)).toBe("新建人物：原始备注");
  expect(timeCoverageNote(coverage, locale)).toBe(translate(locale, coverage));
  expect(timeCoverageNote(`本次仅回顾该范围内前 12 条活动；受记录数量或上下文长度限制，范围不完整。${coverage}`, locale)).toContain(translate(locale, "本次仅回顾该范围内前 {count} 条活动；受记录数量或上下文长度限制，范围不完整。", { count: 12 }));
  expect(timeCoverageNote(`${coverage} 额外原文`, locale)).toBe(`${coverage} 额外原文`);
});
it("shows known summaries in English instead of falling back to Chinese", () => {
  expect(timeActivitySummary({ ...timeFixtureActivity, kind: "session_activity", summary: "12 条当日会话记录" }, "en")).toBe("12 conversation records that day");
  expect(timeActivitySummary({ ...timeFixtureActivity, kind: "meeting_draft", summary: "未经确认的日程草稿" }, "en")).toBe("Unconfirmed schedule draft");
});
