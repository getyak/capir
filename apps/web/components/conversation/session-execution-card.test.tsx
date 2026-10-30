import { LocaleProvider } from "../locale-provider";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import { SessionExecutionCard, SessionRunUpdate, SessionSendTime } from "./session-execution-card";

describe("in-place execution card", () => {
  it.each([
    ["en", "Memory request returned", "Technical details"],
    ["zh-CN", "记忆请求已返回", "技术详情"],
    ["zh-TW", "記憶請求已回傳", "技術詳情"],
    ["ja", "メモリへのリクエストが返りました", "技術的な詳細"],
    ["ko", "메모리 요청 응답이 도착했습니다", "기술 세부 정보"],
  ] as const)("describes returned Memory requests in %s without claiming a prepared or saved review", (locale, label, diagnostics) => {
    const html = renderToStaticMarkup(<LocaleProvider locale={locale}><SessionExecutionCard phase="running"
      stage={null} startedAt="2026-10-01T01:00:00Z" milestones={[]}
      completedTools={[{ name: "memory_review", completed_at: "2026-10-01T01:00:03Z" }]}/></LocaleProvider>);
    const activity = html.match(/<ol\b[^>]*data-tool-activity[^>]*>([\s\S]*?)<\/ol>/u)![1];
    expect(activity).toContain(label);
    expect(activity).not.toContain("memory_review");
    const technical = html.match(/<details\b[^>]*data-run-diagnostics[^>]*>([\s\S]*?)<\/details>/u)![0];
    expect(technical).toContain(diagnostics);
    expect(technical).toContain("<code>memory_review</code>");
    expect(technical).not.toMatch(/<details\b[^>]*\bopen=/u);
    expect(activity).not.toMatch(/prepared|saved|confirmed/iu);
  });

  it("keeps an unknown tool neutral and preserves its original diagnostic name", () => {
    for (const name of ["future_private_operation", "constructor"]) {
      const html = renderToStaticMarkup(<LocaleProvider locale="en"><SessionExecutionCard phase="failed"
        failureCode="MODEL_RUN_TIMEOUT" stage={null} startedAt="2026-10-01T01:00:00Z"
        endedAt="2026-10-01T01:00:08Z" milestones={[]}
        completedTools={[{ name, completed_at: "2026-10-01T01:00:03Z" }]}/></LocaleProvider>);
      const activity = html.match(/<ol\b[^>]*data-tool-activity[^>]*>([\s\S]*?)<\/ol>/u)![1];
      expect(activity).toContain("Operation returned");
      expect(activity).not.toContain(name);
      expect(html).toContain(`<code>${name}</code>`);
      expect(html).toContain("MODEL_RUN_TIMEOUT");
      expect(html).toContain('data-phase="failed"');
    }
  });

  it("names ordinary completed history as quiet activity details while retaining pending review state", () => {
    const record = (phase: "completed" | "waiting-review") => renderToStaticMarkup(<LocaleProvider locale="en"><SessionExecutionCard
      phase={phase} stage={null} startedAt="2026-10-01T01:00:00Z" endedAt="2026-10-01T01:00:08Z" milestones={[]}/></LocaleProvider>);
    const completed = record("completed");
    expect(completed.match(/<summary\b/g)).toHaveLength(1);
    expect(completed).toContain("Activity details");
    expect(completed).not.toContain("Finished");
    expect(completed).not.toContain('open=""');
    expect(record("waiting-review")).toContain("Ready for your review");
  });

  it("keeps unrecognized stage names in diagnostics rather than presenting an enum as progress", () => {
    const html = renderToStaticMarkup(<LocaleProvider locale="en"><SessionExecutionCard phase="running"
      stage={null} startedAt="2026-10-01T01:00:00Z"
      milestones={[{ stage: "future_stage", label: "future_stage", observedAt: "2026-10-01T01:00:01Z" }]}/></LocaleProvider>);
    expect(html).toContain("Processing update");
    expect(html).toContain("<code>future_stage</code>");
    expect(html.slice(0, html.indexOf("data-run-diagnostics"))).not.toContain("future_stage");
  });

  it.each(["queued", "running", "stopping", "waiting-review", "review-unknown", "completed", "failed", "interrupted"] as const)("keeps %s diagnostics behind the inline disclosure", phase => {
    const html = renderToStaticMarkup(<LocaleProvider locale="en"><SessionExecutionCard
      phase={phase} stage={null} startedAt="2026-10-01T01:00:00Z"
      endedAt="2026-10-01T01:00:08Z" milestones={[]}
      completedTools={[{ name: "contact_read", completed_at: "2026-10-01T01:00:03Z" }]}
    /></LocaleProvider>);
    const summary = html.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/u)![1];
    expect(summary).not.toMatch(/completion|elapsed|tool|contact_read/iu);
    expect(summary).not.toContain("data-elapsed-ms");
    expect(html).toContain("Recorded tool completions: 1");
    expect(html).toContain('data-elapsed-ms="8000"');
    expect(html).toContain("contact_read");
    expect(html).not.toContain('open=""');
  });
  it("counts only recorded tool completions and keeps stage observations separate", () => {
    const html = renderToStaticMarkup(createElement(SessionExecutionCard, {
      phase: "completed", stage: null,
      startedAt: "2026-10-01T01:00:00Z", endedAt: "2026-10-01T01:00:08Z",
      milestones: [{ stage: "contact_lookup", label: "正在查找相关人物", observedAt: "2026-10-01T01:00:01Z" }],
      completedTools: [{ name: "contact_read", completed_at: "2026-10-01T01:00:03Z" }],
    }));
    expect(html).toContain("已记录 1 次工具完成");
    expect(html).toContain('aria-label="工具完成记录"');
    expect(html).toContain("contact_read");
    expect(html).not.toContain("已记录 2 次");
    expect(html).not.toMatch(/%/u);
  });
  it("shows observed state and elapsed time without any fabricated percentage", () => {
    const html = renderToStaticMarkup(createElement(SessionExecutionCard, {
      phase: "running",
      stage: "contact_read",
      startedAt: "2026-09-30T01:00:00.000Z",
      milestones: [{ stage: "contact_lookup", label: "正在查找相关人物", observedAt: "2026-09-30T01:00:01.000Z" }],
      failureCode: null,
    }));
    expect(html).toContain('data-phase="running"');
    expect(html).toContain("capri");
    expect(html).toContain('role="status"');
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
    expect(html).toContain("已整理好，请你确认");
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
    expect(failed).toContain("未能完成");
    expect(failed).toContain("MODEL_RUN_TIMEOUT");
    const interrupted = renderToStaticMarkup(createElement(SessionExecutionCard, {
      phase: "interrupted",
      stage: null,
      startedAt: "2026-09-30T01:00:00.000Z",
      endedAt: "2026-09-30T01:00:03.000Z",
      milestones: [],
    }));
    expect(interrupted).toContain("处理已中断");
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

  it("keeps silence valid without filling dialogue with tool reads", () => {
    const silent = renderToStaticMarkup(createElement(SessionRunUpdate, { updates: [], stage: "contact_lookup", status: "" }));
    expect(silent).toBe("");
    expect(silent).not.toContain("data-run-update");
    const unknown = renderToStaticMarkup(createElement(SessionRunUpdate, { updates: [], stage: null, status: "正在处理" }));
    expect(unknown).toBe("");
  });

  it("formats the centered per-send timestamp from real message time", () => {
    const now = new Date();
    const today = renderToStaticMarkup(createElement(SessionSendTime, { at: now.toISOString() }));
    expect(today).toContain(`今天 ${now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`);
    expect(today).toContain(`dateTime="${now.toISOString()}"`);
    const past = renderToStaticMarkup(createElement(SessionSendTime, { at: "2026-09-24T09:46:00.000Z" }));
    expect(past).toMatch(/\d+月\d+日/u);
    const previousYear = new Date(now.getFullYear() - 1, 0, 15, 9, 30);
    const older = renderToStaticMarkup(createElement(SessionSendTime, { at: previousYear }));
    expect(older).toContain(`${previousYear.getFullYear()}年1月15日`);
    expect(older).toContain(`dateTime="${previousYear.toISOString()}"`);
    // No timestamp is invented when the message carries no observed time.
    expect(renderToStaticMarkup(createElement(SessionSendTime, { at: "not-a-date" }))).toBe("");
    expect(renderToStaticMarkup(createElement(SessionSendTime, { at: undefined }))).toBe("");
  });
});

it("keeps the whole unfinished Markdown reply readable before closed activity details", () => {
  const html = renderToStaticMarkup(createElement(SessionExecutionCard, {
    phase: "running", stage: "answer", startedAt: "2026-10-01T01:00:00Z", milestones: [],
    draft: "```ts\nconst x = 1;\n```\n\n1. First\n2. Second\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
  }));
  expect(html).toContain("回复草稿，尚未完成");
  expect(html).toContain("<pre");
  expect(html).toContain("<ol");
  expect(html).toContain("<table");
  expect(html).not.toContain("data-run-update");
  const root = new Window().document.createElement("div");
  root.innerHTML = html;
  const draft = root.querySelector('[aria-label="回复草稿，尚未完成"]');
  expect(draft?.closest("details")).toBeNull();
  expect(draft?.textContent).toContain("const x = 1;");
  expect(draft?.querySelector('[data-presentation="prose"]')?.textContent).toContain("const x = 1;");
  expect(root.querySelector("details")?.open).toBe(false);
  expect(root.querySelector("details")?.textContent).not.toContain("const x = 1;");
});

it("shows the observed stage on the reading axis before any reply arrives", () => {
  const root = new Window().document.createElement("div");
  root.innerHTML = renderToStaticMarkup(<LocaleProvider locale="en"><SessionExecutionCard
    phase="running" stage="contact_read" startedAt="2026-10-29T01:00:00Z"
    milestones={[]} statusInHeader/></LocaleProvider>);
  const progress = root.querySelector("[data-run-progress]");
  expect(progress?.textContent).toContain("Reading the related records");
  expect(progress?.closest("details")).toBeNull();
  expect(root.querySelector("details")?.open).toBe(false);
  expect(root.querySelector("details > summary")?.textContent).toBe("Activity details");
});

it("never presents a retained draft as a new live reply after terminal state", () => {
  for (const phase of ["completed", "failed", "interrupted", "waiting-review", "review-unknown"] as const) {
    const root = new Window().document.createElement("div");
    root.innerHTML = renderToStaticMarkup(<SessionExecutionCard phase={phase} stage="answer"
      startedAt="2026-10-29T01:00:00Z" endedAt="2026-10-29T01:00:03Z"
      milestones={[]} draft="Uncommitted preview"/>);
    expect(root.querySelector("[data-run-progress]")).toBeNull();
  }
});

it("keeps waiting, stopping and terminal outcomes distinct from active processing", () => {
  for (const phase of ["queued", "stopping", "failed", "interrupted", "completed"] as const) {
    const html = renderToStaticMarkup(createElement(SessionExecutionCard, {
      phase, stage: null, startedAt: "2026-10-05T01:00:00Z", milestones: [],
      endedAt: phase === "queued" || phase === "stopping" ? null : "2026-10-05T01:00:03Z",
    }));
    expect(html).not.toContain("正在处理");
    expect(html).not.toContain('data-processing-animated="true"');
    expect(html.includes('data-live="true"')).toBe(phase === "queued" || phase === "stopping");
  }
});

it("animates only a live running processing label", () => {
  const live = renderToStaticMarkup(createElement(SessionExecutionCard, {
    phase: "running", stage: "answer", startedAt: "2026-10-12T00:00:00Z", milestones: [],
  }));
  expect(live).toContain('data-processing-animated="true"');
  const ended = renderToStaticMarkup(createElement(SessionExecutionCard, {
    phase: "running", stage: "answer", startedAt: "2026-10-12T00:00:00Z", endedAt: "2026-10-12T00:00:03Z", milestones: [],
  }));
  expect(ended).not.toContain('data-processing-animated="true"');
});


it("uses the active English locale for execution, observed stages and times without translating draft or tool names", () => {
  const html = renderToStaticMarkup(<LocaleProvider locale="en">{createElement(SessionExecutionCard, {
    phase: "running", stage: "contact_read", startedAt: "2026-10-01T01:00:00Z", endedAt: "2026-10-01T01:00:08Z",
    milestones: [{ stage: "contact_lookup", label: "正在查找相关人物", observedAt: "2026-10-01T01:00:01Z" }],
    completedTools: [{ name: "contact_read", completed_at: "2026-10-01T01:00:02Z" }],
    draft: "保留原文",
  })}</LocaleProvider>);
  expect(html).toContain("Working");
  expect(html).toContain("Recorded tool completions: 1");
  expect(html).toContain("Looking up the people involved");
  expect(html).toContain('data-elapsed-ms="8000"');
  expect(html).toContain("Reply draft, not complete");
  expect(html).toContain("保留原文");
  expect(html).toContain("contact_read");
  expect(html).not.toContain("正在查找相关人物");
  expect(html).not.toContain("工具完成记录");
});
