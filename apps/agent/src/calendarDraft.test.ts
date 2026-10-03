import { describe, expect, it } from "vitest";
import { calendarDraftCapability } from "./calendarDraft.js";

const context = { sourceRequestID: "10000000-0000-4000-8000-000000000001", referenceTime: "2026-09-09T02:00:00Z", timeZone: "Asia/Shanghai" };
const objective = "明天下午三点和陈夏聊半小时，帮我准备日历草稿。";
const input = { title: "与陈夏会谈", starts_at: "2026-09-10T15:00:00+08:00", ends_at: "2026-09-10T15:30:00+08:00", time_zone: "Asia/Shanghai", source_excerpt: "明天下午三点和陈夏聊半小时" };
const signal = new AbortController().signal;

describe("review-only calendar capability", () => {
  it("binds a supplemental exact quote to its original message without granting an external action", async () => {
    const messageID = "20000000-0000-4000-8000-000000000002";
    const capability = calendarDraftCapability({ ...context,
      resolveMessageExcerpt: excerpt => objective.includes(excerpt) ? { messageID, text: objective } : false,
    }, "initial unrelated task");
    expect((await capability.tools[0]!.execute(input, signal)).isError).toBe(false);
    expect(capability.draft()).toMatchObject({ source_message_id: messageID,
      source_request_id: context.sourceRequestID, source_excerpt: input.source_excerpt, external_effect: "none" });
  });
  it("admits only one of concurrent image drafts and preserves its image receipt", async () => {
    let release!:()=>void;
    const barrier=new Promise<void>(resolve=>{release=resolve;});
    const source={artifact_id:"image",content_hash:"a".repeat(64),inspection_request_id:"inspection"};
    const capability=calendarDraftCapability({...context,validateImageExcerpt:async()=>{await barrier;return source;}},"");
    const calls=[1,2].map(()=>capability.tools[0]!.execute({...input,source_image_artifact_id:"image"},signal));
    release();const results=await Promise.all(calls);
    expect(results.filter(r=>!r.isError)).toHaveLength(1);
    expect(capability.draft()?.source_image).toEqual(source);
  });
  it("stages the exact source and zoned interval without an external effect", async () => {
    const capability = calendarDraftCapability(context, objective);
    expect(capability.draft()).toBeUndefined();
    const tool = capability.tools[0]!;
    expect(tool.description).not.toContain(context.referenceTime);
    expect(capability.clock).toContain(context.referenceTime);
    expect((await tool.execute(input, signal)).isError).toBe(false);
    expect(capability.draft()).toMatchObject({ title: input.title, starts_at: "2026-09-10T07:00:00.000Z", ends_at: "2026-09-10T07:30:00.000Z",
      source_excerpt: input.source_excerpt, source_request_id: context.sourceRequestID, status: "needs_review", external_effect: "none" });
    expect((await tool.execute(input, signal)).isError).toBe(true);
  });
  it("withholds drafts with invented quotes, wrong timezone offsets or reversed intervals", async () => {
    for (const changed of [
      { source_excerpt: "a different message" }, { time_zone: "UTC" },
      { starts_at: "2026-09-10T15:00:00Z" }, { ends_at: "2026-09-10T14:00:00+08:00" },
    ]) {
      const capability = calendarDraftCapability(context, objective);
      expect((await capability.tools[0]!.execute({ ...input, ...changed }, signal)).isError).toBe(true);
      expect(capability.draft()).toBeUndefined();
    }
  });
  it("rejects blank provenance before a draft can be staged", async () => {
    const capability = calendarDraftCapability(context, objective);
    await expect(
      capability.tools[0]!.execute(
        { ...input, source_excerpt: "   " },
        signal,
      ),
    ).rejects.toThrow();
    expect(capability.draft()).toBeUndefined();
  });
  it("does not guess a timezone or create an ambient capability", () => {
    expect(calendarDraftCapability(undefined, objective).tools).toEqual([]);
    expect(() => calendarDraftCapability({ ...context, sourceRequestID: "forged" }, objective)).toThrow("CONTEXT_INVALID");
  });
  it("derives the next calendar date from the frozen zoned clock across month and year boundaries", () => {
    for (const [referenceTime, timeZone, today, tomorrow] of [
      ["2026-01-31T23:30:00Z", "Asia/Shanghai", "2026-02-01", "2026-02-02"],
      ["2026-01-01T00:30:00Z", "America/Los_Angeles", "2025-12-31", "2026-01-01"],
      ["2026-03-08T09:30:00Z", "America/Los_Angeles", "2026-03-08", "2026-03-09"],
    ]) {
      const capability = calendarDraftCapability({ ...context, referenceTime: referenceTime!, timeZone: timeZone! }, objective);
      expect(capability.clock).toContain(`today ${today}; tomorrow ${tomorrow}`);
    }
    expect(calendarDraftCapability(undefined, objective).instructions).toBe("");
  });
});
