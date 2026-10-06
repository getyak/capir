// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ code: "MODEL_RUN_TOKEN_BUDGET_EXHAUSTED" }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/workspace/sessions", useSearchParams: () => new URLSearchParams() }));
vi.mock("../workspace-composer", () => ({ WorkspaceComposer: () => null }));
vi.mock("./use-conversation", () => ({ useConversation: () => ({
  ready: true, messages: [], attachments: [], draft: "", detail: null,
  preview: null, connection: "connected", error: null, entryCapability: null,
  unavailable: false, preparing: false, submitting: false, mutating: false,
  snapshot: { active: null, paused: true, queued: [{ queue_entry_id: "entry", message_id: "message",
    objective: "", status: "failed", failure_code: state.code,
    images: [{ attachment_id: "image", file_name: "synthetic.png", media_type: "image/png", byte_size: 12, content_hash: "a".repeat(64) }] }] },
  submit: vi.fn(), mutate: vi.fn(), addFiles: vi.fn(), removeAttachment: vi.fn(), changeDraft: vi.fn(),
}) }));
vi.mock("./conversation-images", () => ({ ConversationImageStrip: () => createElement("img", { alt: "保留的图片" }) }));
import { QueuedConversation, queueFailureText } from "./queued-conversation";

it.each(["MODEL_RUN_TOKEN_BUDGET_EXHAUSTED", "CLAUDE_HARNESS_TOKEN_BUDGET_EXHAUSTED"])("renders the retained failed image with budget reason and recovery controls: %s", async code => {
  state.code = code;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const mount = document.createElement("div");
  document.body.append(mount);
  const root = createRoot(mount);
  try {
    await act(async () => root.render(createElement(QueuedConversation, {
      scope: "a".repeat(64), chatBinding: "chat", detailBinding: "detail",
      bootstrap: { sessionId: "session", capability: "test-capability" },
    })));
    expect(mount.textContent).toContain("token 预算，原图已保留");
    expect(mount.textContent).not.toContain("超时");
    expect(mount.querySelector('img[alt="保留的图片"]')).not.toBeNull();
    expect([...mount.querySelectorAll("button")].some(button => button.textContent === "重试")).toBe(true);
    expect(mount.querySelector('[aria-label="移除第 1 条待处理消息"]')).not.toBeNull();
  } finally {
    await act(async () => root.unmount());
    mount.remove();
    vi.unstubAllGlobals();
  }
});

it("keeps timeout, text-only exhaustion and unknown failures distinct", () => {
  expect(queueFailureText("MODEL_RUN_TIMEOUT", true)).toContain("图片分析超时");
  expect(queueFailureText("MODEL_RUN_TOKEN_BUDGET_EXHAUSTED", false)).toContain("消息已保留");
  expect(queueFailureText("arbitrary-provider-prose", true)).toBe("上次未完成，请重试或移除");
});
