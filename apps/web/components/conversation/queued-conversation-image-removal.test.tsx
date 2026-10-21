// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
// Component boundary test. Real composer/file-picker, byte lifecycle and browser
// hit testing are separately accepted on the protected synthetic Web surface.
vi.mock("../workspace-composer", () => ({ WorkspaceComposer: ({ id, value, disabled }: { id: string; value: string; disabled: boolean }) => <textarea id={id} defaultValue={value} disabled={disabled}/> }));
vi.mock("./use-conversation", async () => {
  const { useState } = await import("react");
  return { useConversation: () => {
    const [attachments, setAttachments] = useState(["first", "second"].map(id => ({ id, url: `blob:${id}`, manifest: { file_name: `${id}.png` } })));
    return {
      ready: true, messages: [], attachments, draft: "Synthetic retained draft", detail: null,
      preview: null, connection: "connected", error: null, entryCapability: null,
      unavailable: false, preparing: false, submitting: false, mutating: false,
      handoffEntries: {}, handoffPreviews: {}, runOutcome: {}, readbackStalled: [], snapshot: null,
      submit: vi.fn(), mutate: vi.fn(), addFiles: vi.fn(), changeDraft: vi.fn(),
      removeAttachment: (id: string) => setAttachments(current => current.filter(item => item.id !== id)),
    };
  } };
});
import { QueuedConversation } from "./queued-conversation";

it("returns image removal to the live composer without losing text or another image", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const otherComposer = document.createElement("textarea"); otherComposer.id = "queued-conversation-composer"; document.body.append(otherComposer);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<QueuedConversation scope={"a".repeat(64)} chatBinding="chat" detailBinding="detail" bootstrap={{sessionId:"11111111-1111-4111-8111-111111111111",capability:"synthetic"}}/>));
    const button = host.querySelector<HTMLButtonElement>('[aria-label="移除第 1 张图片"]')!;
    const composer = host.querySelector<HTMLTextAreaElement>("textarea")!, focus = vi.spyOn(composer, "focus");
    button.focus(); await act(async () => button.click());
    expect(host.querySelectorAll("img")).toHaveLength(1);
    expect(host.querySelector("img")?.getAttribute("alt")).toBe("second.png");
    expect(composer.value).toBe("Synthetic retained draft");
    expect(document.activeElement).toBe(composer);
    expect(focus).toHaveBeenCalledExactlyOnceWith({preventScroll:true});
  } finally { await act(async () => root.unmount()); host.remove(); otherComposer.remove(); vi.unstubAllGlobals(); }
});
