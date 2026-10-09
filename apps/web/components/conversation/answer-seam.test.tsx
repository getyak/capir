// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAnswerSeamRegistry, type AnswerSeamRegistry } from "./answer-seam";
import { AnswerBlockFrame } from "./session-message-parts";

const SESSION = "sess-1";
const MESSAGE = "msg-1";
const BODY = "陈宇负责设计协作。试点阶段的时间已经确认，下周会给出第一版排期。";

let attention: AnswerSeamRegistry;
let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(() => {
  attention = createAnswerSeamRegistry();
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  vi.useRealTimers();
});

async function mountBlock(status: string, body = BODY, strict = false) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    const frame = createElement(AnswerBlockFrame, {
      attention,
      block: { id: "block-1", title: null, body, status },
      messageId: MESSAGE,
      sessionId: SESSION,
    });
    root!.render(strict ? createElement(StrictMode, null, frame) : frame);
  });
  return host;
}

function seam(): string | null {
  return host!.querySelector<HTMLElement>("[data-seam]")?.dataset.seam ?? null;
}

describe("one-shot agent completion seam", () => {
  it("keeps Strict Mode completion delivery single and finite", async () => {
    attention.observe(MESSAGE);
    vi.useFakeTimers();
    await mountBlock("informational", BODY, true);
    expect(seam()).toBe("new");
    act(() => vi.advanceTimersByTime(800));
    expect(seam()).toBeNull();
    expect(attention.claim(MESSAGE, "informational")).toBe("none");
  });
  it("requires an actual decision flag for a proposed block", () => {
    attention.observe(MESSAGE);
    expect(attention.claim(MESSAGE, "proposed", false)).toBe("none");
    expect(attention.claim(MESSAGE, "proposed", true)).toBe("seam");
  });

  it("never seams a lazily loaded historical response", async () => {
    await mountBlock("informational");
    expect(seam()).toBeNull();
  });

  it("seams exactly once when an observed run completes", async () => {
    attention.observe(MESSAGE);

    vi.useFakeTimers();
    await mountBlock("informational");
    expect(seam()).toBe("new");

    // One-shot: the same block never claims the seam again.
    expect(attention.claim(MESSAGE, "completed")).toBe("none");

    act(() => vi.advanceTimersByTime(800));
    expect(seam()).toBeNull();
  });

  it("seams a new pending review for the observed message but not display prose", () => {
    attention.observe(MESSAGE);
    expect(attention.claim(MESSAGE, "needs_review")).toBe("seam");
    expect(attention.claim(MESSAGE, "needs_review")).toBe("none");
    // Status is read from the block's status code; prose or unknown codes
    // (including a streaming stage like "answer") never seam.
    expect(attention.claim(MESSAGE, "answer")).toBe("none");
    expect(attention.claim(MESSAGE, "正在回复")).toBe("none");
    expect(attention.claim(MESSAGE, "")).toBe("none");
  });

  it("does not seam a reconnect that only observes history, not the finishing run", async () => {
    // A reconnected client renders the completed block without ever observing
    // the run: no red flash, no replay.
    await mountBlock("informational");
    expect(seam()).toBeNull();
    expect(attention.claim(MESSAGE, "completed")).toBe("none");
  });

  it("keeps attention isolated to the owning conversation and bounds history", () => {
    attention.observe(MESSAGE);
    expect(createAnswerSeamRegistry().claim(MESSAGE, "informational")).toBe("none");
    for (let i = 0; i < 129; i++) attention.observe(`new-${i}`);
    expect(attention.claim(MESSAGE, "informational")).toBe("none");
  });
  it("plays only one seam for a multi-block persisted message", () => {
    attention.observe(MESSAGE);
    expect(attention.claim(MESSAGE, "informational")).toBe("seam");
    expect(attention.claim(MESSAGE, "needs_review")).toBe("none");
  });
});
