import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionExecutionCard, SessionRunUpdate, SessionSendTime } from "./session-execution-card";

describe("in-place execution card", () => {
  it("shows observed state and elapsed time without any fabricated percentage", () => {
    const html = renderToStaticMarkup(createElement(SessionExecutionCard, {
      phase: "running",
      stage: "contact_read",
      startedAt: "2026-09-30T01:00:00.000Z",
      milestones: [{ stage: "contact_lookup", label: "正在查找相关人物", observedAt: "2026-09-30T01:00:01.000Z" }],
      failureCode: null,
    }));
    expect(html).toContain("执行中");
    expect(html).toContain("正在阅读相关记录");
    expect(html).toContain("用时");
    expect(html).toContain("data-elapsed-ms");
    expect(html).toContain("正在查找相关人物");
    // No unknown-total percentage anywhere in the execution record.
    expect(html).not.toMatch(/%/u);
    expect(html).toContain("<details");
  });

  it("keeps a pending decision distinct from a completed execution", () => {
    const html = renderToStaticMarkup(createElement(SessionExecutionCard, {
      phase: "waiting-review",
      stage: null,
      startedAt: "2026-09-30T01:00:00.000Z",
      endedAt: "2026-09-30T01:00:08.000Z",
      milestones: [],
    }));
    expect(html).toContain("执行完成，待你确认");
    expect(html).toContain("结束");
    // A pinned terminal duration never grows while the transcript is reopened.
    expect(html).toContain("用时 8 秒");
  });

  it("names failure and interruption with their real code", () => {
    const failed = renderToStaticMarkup(createElement(SessionExecutionCard, {
      phase: "failed",
      stage: null,
      startedAt: "2026-09-30T01:00:00.000Z",
      endedAt: "2026-09-30T01:00:03.000Z",
      milestones: [],
      failureCode: "MODEL_RUN_TIMEOUT",
    }));
    expect(failed).toContain("执行未完成");
    expect(failed).toContain("MODEL_RUN_TIMEOUT");
    const interrupted = renderToStaticMarkup(createElement(SessionExecutionCard, {
      phase: "interrupted",
      stage: null,
      startedAt: "2026-09-30T01:00:00.000Z",
      endedAt: "2026-09-30T01:00:03.000Z",
      milestones: [],
    }));
    expect(interrupted).toContain("执行已中断");
    expect(interrupted).toContain('data-phase="interrupted"');
  });
});

describe("milestone update and per-send time", () => {
  it("renders the observed updates as ephemeral milestone dialogue", () => {
    const html = renderToStaticMarkup(createElement(SessionRunUpdate, { updates: ["我先核对两人的沟通记录。", "再看下一步该确认什么。"], stage: "answer", status: "" }));
    expect(html).toContain("我先核对两人的沟通记录。");
    expect(html).toContain("再看下一步该确认什么。");
    expect(html).toContain("data-run-update");
  });

  it("keeps silence valid and fills it only with the observed stage", () => {
    const silent = renderToStaticMarkup(createElement(SessionRunUpdate, { updates: [], stage: "contact_lookup", status: "" }));
    expect(silent).toContain("正在查找相关人物");
    expect(silent).not.toContain("data-run-update");
    const unknown = renderToStaticMarkup(createElement(SessionRunUpdate, { updates: [], stage: null, status: "正在处理" }));
    expect(unknown).toContain("正在处理");
  });

  it("formats the centered per-send timestamp from real message time", () => {
    const now = new Date();
    const today = renderToStaticMarkup(createElement(SessionSendTime, { at: now.toISOString() }));
    expect(today).toContain(`今天 ${now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`);
    const past = renderToStaticMarkup(createElement(SessionSendTime, { at: "2026-09-24T09:46:00.000Z" }));
    expect(past).toMatch(/\d+月\d+日/u);
    // No timestamp is invented when the message carries no observed time.
    expect(renderToStaticMarkup(createElement(SessionSendTime, { at: "not-a-date" }))).toBe("");
    expect(renderToStaticMarkup(createElement(SessionSendTime, { at: undefined }))).toBe("");
  });
});
