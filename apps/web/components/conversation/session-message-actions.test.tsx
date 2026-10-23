// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThreadPrimitive } from "@assistant-ui/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../memory-review/memory-review-card", () => ({ MemoryReviewCard: () => <div data-proposal>Memory proposal</div> }));
vi.mock("./session-calendar-draft-card", () => ({ SessionCalendarDraftCard: () => <div data-proposal>Calendar proposal</div> }));
vi.mock("../mcp/mcp-request-card", () => ({ McpRequestCard: () => <div data-proposal>MCP proposal</div> }));
vi.mock("./conversation-images", () => ({ ConversationImageStrip: () => <div data-images>Image</div> }));

import { extractSessionMessageCopy } from "./session-message-actions";
import { SessionAssistantMessage, SessionUserMessage, type SessionProjectedMessage } from "./session-message-parts";
import { SessionRuntime } from "./session-runtime";
import { LocaleProvider } from "../locale-provider";

const data = (name: string, value: Record<string, unknown>) => ({ type: "data" as const, name: `talent-signal.${name}`, data: value });
function execution(phase = "completed", endedAt: string | null = "2026-10-23T00:00:08Z") {
  return data("execution", { phase, endedAt, startedAt: "2026-10-23T00:00:00Z", completedTools: [{ name: "PRIVATE_TOOL", completed_at: "2026-10-23T00:00:04Z" }] });
}
function answer(body = "**完成**的正文。\n\n- 第一步", overrides: Record<string, unknown> = {}) {
  return data("answer-block", { messageId: "turn-1", block: { id: "answer-1", kind: "answer", title: "下一步", body, status: "informational", requires_user_decision: false, ...overrides } });
}
function message(role: "user" | "assistant", content: SessionProjectedMessage["content"], id = `${role}-1`): SessionProjectedMessage {
  return { id, role, content, createdAt: new Date("2026-10-23T00:00:00Z") };
}
const proposals = [
  data("memory", { version: 1, proposalId: "PRIVATE_MEMORY", revision: 1 }),
  data("calendar", { version: 1, draftId: "PRIVATE_CALENDAR" }),
  data("mcp-interaction", { version: 1, requestId: "PRIVATE_MCP" }),
];

describe("safe message copy extraction", () => {
  it("preserves raw user whitespace and excludes image manifests and tools", () => {
    expect(extractSessionMessageCopy(message("user", [
      { type: "text", text: "  原文\n\n保留空格  " },
      data("user-images", { messageId: "user-1", images: [{ url: "PRIVATE_IMAGE_URL" }] }),
      data("mcp-human-result", { result: "PRIVATE_TOOL" }),
    ]))).toEqual({ text: "  原文\n\n保留空格  ", anchorBlockId: null });
    expect(extractSessionMessageCopy(message("user", [data("user-images", { images: [] })]))).toBeNull();
  });
  it("copies final answer Markdown while leaving all governed decisions out", () => {
    const payload = extractSessionMessageCopy(message("assistant", [execution("waiting-review"), answer(), ...proposals,
      answer("PRIVATE_DECISION", { id: "decision", kind: "proposal", status: "proposed", requires_user_decision: true }),
      { type: "text", text: "PRIVATE_PREVIEW" },
    ]));
    expect(payload).toEqual({ text: "### 下一步\n\n**完成**的正文。\n\n- 第一步", anchorBlockId: "answer-1" });
    expect(JSON.stringify(payload)).not.toContain("PRIVATE");
  });
  it.each(["queued", "running", "stopping", "failed", "interrupted", "review-unknown"])("does not copy %s output", phase => {
    expect(extractSessionMessageCopy(message("assistant", [execution(phase), answer()]))).toBeNull();
  });
  it("requires one valid final receipt and explicitly safe answer semantics", () => {
    for (const content of [
      [answer()], [execution("completed", null), answer()], [execution("completed", "invalid"), answer()],
      [execution(), execution("running"), answer()], [execution(), { type: "text" as const, text: "preview" }],
      [execution(), answer("review", { requires_user_decision: undefined })],
      [execution(), answer("review", { status: "proposed" })],
    ]) expect(extractSessionMessageCopy(message("assistant", content))).toBeNull();
  });
  it("keeps useful titles and joins only safe answer blocks in source order", () => {
    expect(extractSessionMessageCopy(message("assistant", [execution(), answer("first", { title: "回答" }),
      answer("second", { id: "second", title: null }),
    ]))).toEqual({ text: "first\n\nsecond", anchorBlockId: "second" });
  });
});

let host: HTMLDivElement;
let root: Root | null = null;
const writeText = vi.fn<(text: string) => Promise<void>>();
let originalClipboard: PropertyDescriptor | undefined;
const context = { binding: "synthetic", meetingBinding: "synthetic", entryCapability: null, scope: "synthetic", sessionId: "synthetic", status: "", sourceImagesByMessageId: {}, sourceTextByMessageId: {} };

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  writeText.mockReset().mockResolvedValue(undefined);
  originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root?.unmount()); root = null; host.remove();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
  vi.useRealTimers(); vi.unstubAllGlobals();
});
async function render(messages: SessionProjectedMessage[], locale: "zh-CN" | "en" = "zh-CN") {
  await act(async () => root!.render(<LocaleProvider locale={locale}><SessionRuntime messages={messages} running={false}>
    <ThreadPrimitive.Root><ThreadPrimitive.Messages>{({ message: current }) => current.role === "user"
      ? <SessionUserMessage context={context}/> : <SessionAssistantMessage context={context}/>}</ThreadPrimitive.Messages></ThreadPrimitive.Root>
  </SessionRuntime></LocaleProvider>));
}
const action = (label = "复制回答") => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

it("renders real runtime controls beneath user text and final prose before proposals", async () => {
  await render([
    message("user", [{ type: "text", text: "  用户\n文字  " }, data("user-images", { messageId: "user-1", images: [{}] })]),
    message("assistant", [execution(), answer(), ...proposals]),
  ]);
  expect(host.querySelectorAll("[data-message-actions]")).toHaveLength(2);
  expect(writeText).not.toHaveBeenCalled();
  const userActions = host.querySelector('[data-message-actions="user"]')!;
  expect(userActions.previousElementSibling?.hasAttribute("data-images")).toBe(true);
  expect(userActions.previousElementSibling?.previousElementSibling?.hasAttribute("data-user-message")).toBe(true);
  expect(userActions.nextElementSibling).toBeNull();
  expect(host.querySelector('[data-message-actions="assistant"]')?.nextElementSibling?.hasAttribute("data-proposal")).toBe(true);
  expect(host.querySelector('[data-presentation="prose"]')).not.toBeNull();
  await act(async () => action("复制消息").click());
  expect(writeText).toHaveBeenLastCalledWith("  用户\n文字  ");
  await act(async () => action().click());
  expect(writeText).toHaveBeenLastCalledWith("### 下一步\n\n**完成**的正文。\n\n- 第一步");
  expect(host.textContent).toContain("已复制");
});
it("never renders a copy control for incomplete answers or image-only messages", async () => {
  await render([message("assistant", [execution("running", null), answer()]),
    message("user", [data("user-images", { messageId: "user-1", images: [{}] })])]);
  expect(host.querySelector("[data-message-actions]")).toBeNull();
  expect(writeText).not.toHaveBeenCalled();
});
it("uses the active display locale for copy, retry and feedback while preserving source text", async () => {
  const source = "  用户\n原文  ";
  await render([message("user", [{ type: "text", text: source }]), message("assistant", [execution(), answer()])], "en");
  expect(action("Copy answer")).not.toBeNull();
  writeText.mockRejectedValueOnce(new Error("denied"));
  await act(async () => action("Copy message").click());
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Could not copy. Try again.");
  await act(async () => action("Retry copying message").click());
  expect(writeText).toHaveBeenLastCalledWith(source);
  expect(host.textContent).toContain("Copied");
  writeText.mockRejectedValueOnce(new Error("denied"));
  await act(async () => action("Copy answer").click());
  expect(action("Retry copying answer")).not.toBeNull();
});
it("offers visible retry after a rejected clipboard write and clears success feedback", async () => {
  writeText.mockRejectedValueOnce(new Error("denied"));
  await render([message("assistant", [execution(), answer()])]);
  await act(async () => action().click());
  expect(host.querySelector('[data-state="failed"]')).not.toBeNull();
  expect(host.querySelector('[role="status"]')?.textContent).toBe("复制失败，请重试");
  vi.useFakeTimers();
  await act(async () => action("重试复制回答").click());
  expect(writeText).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[data-state="copied"]')).not.toBeNull();
  await act(async () => vi.advanceTimersByTime(1800));
  expect(host.querySelector('[data-state="idle"]')).not.toBeNull();
});
it.each(["identity", "text"])("ignores a stale clipboard promise after %s changes and guards repeated clicks", async change => {
  let resolve!: () => void;
  writeText.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  await render([message("user", [{ type: "text", text: "old" }])]);
  await act(async () => { action("复制消息").click(); action("复制消息").click(); });
  expect(writeText).toHaveBeenCalledTimes(1);
  await render([message("user", [{ type: "text", text: change === "text" ? "new" : "old" }], change === "identity" ? "user-2" : "user-1")]);
  await act(async () => resolve());
  expect(host.querySelector('[data-state="copied"]')).toBeNull();
  await act(async () => action("复制消息").click());
  expect(writeText).toHaveBeenCalledTimes(2);
});
it("ignores clipboard completion after unmount", async () => {
  let resolve!: () => void;
  writeText.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  await render([message("user", [{ type: "text", text: "sent" }])]);
  await act(async () => action("复制消息").click());
  await act(async () => root!.unmount()); root = null;
  await act(async () => resolve());
  expect(host.querySelector("[data-message-actions]")).toBeNull();
});
it("cleans up the success feedback timer on unmount", async () => {
  vi.useFakeTimers();
  const timer = vi.spyOn(window, "setTimeout"), clear = vi.spyOn(window, "clearTimeout");
  await render([message("user", [{ type: "text", text: "sent" }])]);
  await act(async () => action("复制消息").click());
  const index = timer.mock.calls.findIndex(([, delay]) => delay === 1800);
  expect(index).toBeGreaterThanOrEqual(0);
  const handle = timer.mock.results[index]!.value;
  await act(async () => root!.unmount()); root = null;
  expect(clear).toHaveBeenCalledWith(handle);
  timer.mockRestore(); clear.mockRestore();
});
