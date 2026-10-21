// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mutation = vi.hoisted(() => ({ finish: null as ((success: boolean) => void) | null, calls: [] as unknown[] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../workspace-composer", () => ({ WorkspaceComposer: ({ id }: { id: string }) => <textarea id={id}/> }));
vi.mock("./use-conversation", async () => {
  const { useState } = await import("react");
  return { useConversation: () => {
    const [mutating, setMutating] = useState(false);
    return {
      ready: true, messages: [], attachments: [], draft: "", detail: null,
      preview: null, connection: "connected", error: null, entryCapability: null,
      unavailable: false, preparing: false, submitting: false, mutating,
      handoffEntries: {}, handoffPreviews: {}, runOutcome: {}, readbackStalled: [],
      snapshot: { paused: true, active: null, queued: [1, 2].map(n => ({ queue_entry_id: `entry-${n}`, message_id: `message-${n}`, status: "queued", objective: `Synthetic ${n}` })) },
      submit: vi.fn(), addFiles: vi.fn(), changeDraft: vi.fn(), removeAttachment: vi.fn(),
      mutate: async (input: unknown) => {
        mutation.calls.push(input); setMutating(true);
        const result = await new Promise<boolean>(resolve => { mutation.finish = resolve; });
        setMutating(false); return result;
      },
    };
  } };
});
import { QueuedConversation } from "./queued-conversation";

let host: HTMLDivElement, root: ReturnType<typeof createRoot>;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mutation.finish = null; mutation.calls = [];
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<QueuedConversation scope={"a".repeat(64)} chatBinding="chat" detailBinding="detail" bootstrap={{sessionId:"11111111-1111-4111-8111-111111111111",capability:"synthetic"}}/>));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const edit = (position = 1) => host.querySelector<HTMLButtonElement>(`[aria-label="编辑第 ${position} 条待处理消息"]`)!;
const form = () => host.querySelector<HTMLFormElement>("form")!;
const button = (text: string) => [...form().querySelectorAll("button")].find(el => el.textContent === text)!;
async function open(position = 1) { edit(position).focus(); await act(async () => edit(position).click()); }
async function save() { button("保存").focus(); await act(async () => button("保存").click()); }

it("keeps Continue typing focus in its own composer through a failed request", async () => {
  const foreign = document.createElement("textarea"); foreign.id = "queued-conversation-composer"; document.body.prepend(foreign);
  try {
    const trigger = [...host.querySelectorAll("button")].find(button => button.textContent === "继续处理")!;
    trigger.focus(); await act(async () => trigger.click());
    const own = host.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")!;
    expect(document.activeElement).toBe(own);
    expect(trigger.disabled).toBe(true);
    expect(mutation.calls).toEqual([{ kind: "continue" }]);
    await act(async () => mutation.finish!(false));
    expect(document.activeElement).toBe(own); expect(trigger.disabled).toBe(false);
  } finally { foreign.remove(); }
});

it("never steals focus after Continue settles if the reader moved elsewhere", async () => {
  const trigger = [...host.querySelectorAll("button")].find(button => button.textContent === "继续处理")!;
  trigger.focus(); await act(async () => trigger.click());
  const other = document.createElement("button"); document.body.append(other); other.focus();
  try { await act(async () => mutation.finish!(true)); expect(document.activeElement).toBe(other); }
  finally { other.remove(); }
});

it("returns Cancel to the same entry's newly mounted edit control, not another canvas", async () => {
  const foreign = document.createElement("button"); foreign.setAttribute("aria-label", "编辑第 1 条待处理消息"); document.body.prepend(foreign);
  try {
    await open(); button("取消").focus(); await act(async () => button("取消").click());
    expect(form()).toBeNull(); expect(document.activeElement).toBe(edit()); expect(mutation.calls).toHaveLength(0);
    expect(host.textContent).toContain("Synthetic 1"); expect(host.textContent).toContain("Synthetic 2");
  } finally { foreign.remove(); }
});

it("reveals the returned edit control inside only its queue after a taller image row replaces the editor", async () => {
  await open();
  const queue = host.querySelector<HTMLElement>('[aria-label="可控补充"]')!;
  Object.defineProperties(queue, { clientHeight: { value: 108, configurable: true }, clientTop: { value: 1, configurable: true } });
  const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this === queue) return new DOMRect(0, 100, 300, 110);
    if (this.matches("[data-queue-edit]")) return new DOMRect(30, 260 - queue.scrollTop, 44, 44);
    return new DOMRect(30, 120, 44, 44);
  });
  try {
    button("取消").focus();
    await act(async () => button("取消").click());
    expect(document.activeElement).toBe(edit());
    expect(queue.scrollTop).toBe(101);
    expect(document.documentElement.scrollTop).toBe(0);
    expect(document.body.scrollTop).toBe(0);
  } finally { measure.mockRestore(); }
});

it("reveals a clipped queue target above while leaving visible, oversized and root focus alone", () => {
  const queue = host.querySelector<HTMLElement>('[aria-label="可控补充"]')!;
  Object.defineProperties(queue, { clientHeight: { value: 108, configurable: true }, clientTop: { value: 1, configurable: true } });
  queue.scrollTop = 50;
  let target = new DOMRect(30, 95, 44, 44);
  const measure = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this === queue ? new DOMRect(0, 100, 300, 110) : target;
  });
  const composer = host.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")!;
  try {
    edit().focus(); expect(queue.scrollTop).toBe(38);
    composer.focus(); target = new DOMRect(30, 130, 44, 44);
    edit().focus(); expect(queue.scrollTop).toBe(38);
    composer.focus(); target = new DOMRect(30, 95, 44, 200);
    edit().focus(); expect(queue.scrollTop).toBe(38);
    queue.tabIndex = -1; queue.focus(); expect(queue.scrollTop).toBe(38);
  } finally { measure.mockRestore(); }
});

it("keeps Save focus during the request and returns success to the same entry", async () => {
  await open(); await save();
  expect(button("保存").disabled).toBe(false); expect(button("保存").getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(button("保存"));
  await act(async () => mutation.finish!(true));
  expect(form()).toBeNull(); expect(document.activeElement).toBe(edit());
  expect(mutation.calls).toEqual([{kind:"edit",queue_entry_id:"entry-1",objective:"Synthetic 1"}]);
});

it("keeps a failed edit open and does not submit again while saving", async () => {
  await open(); await save(); await act(async () => button("保存").click());
  expect(mutation.calls).toHaveLength(1);
  await act(async () => mutation.finish!(false));
  expect(form()).not.toBeNull(); expect(document.activeElement).toBe(button("保存"));
  expect(form().querySelector("textarea")!.value).toBe("Synthetic 1");
});

it("does not steal focus moved to the composer while Save is pending", async () => {
  await open(); await save();
  const composer = host.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")!; composer.focus();
  await act(async () => mutation.finish!(true));
  expect(form()).toBeNull(); expect(document.activeElement).toBe(composer);
});

it("returns a cancelled pending Save to the usable composer without later stealing focus", async () => {
  await open(); await save(); button("取消").focus(); await act(async () => button("取消").click());
  const composer = host.querySelector<HTMLTextAreaElement>("#queued-conversation-composer")!;
  expect(document.activeElement).toBe(composer);
  await act(async () => mutation.finish!(true));
  expect(document.activeElement).toBe(composer);
  await open(2);
  expect(form().querySelector("textarea")!.value).toBe("Synthetic 2");
  expect(document.activeElement).toBe(form().querySelector("textarea"));
});
