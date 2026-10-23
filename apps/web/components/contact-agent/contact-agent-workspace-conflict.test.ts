// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScreenshotContactTaskResponse } from "@talent-signal/agent";
import { ContactAgentWorkspace } from "./contact-agent-workspace";
import { ContactProfileReview } from "./contact-profile-review";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("@/components/workspace-session-request", () => ({ workspaceSessionFetch: fetcher }));
vi.mock("@/components/product-feedback", () => ({ ProductFeedback: () => null }));

type Task = ScreenshotContactTaskResponse;
function task(revision = 1, taskID = "source-a"): Task {
  return {
    task_id: taskID, revision, status: "waiting_for_user", created_at: "2026-09-24T00:00:00Z",
    source: { title: taskID, kind: "selected_text", url: "", time_basis: "imported_at" },
    source_text: "Synthetic evidence", contact: null, contact_draft: null, summary: null,
    question: "选择归档人物", candidates: [{ person_id: "person-a", relationship_context_id: "context-a", display_name: "合成人物", relationship_label: "合成关系" }],
    extraction: { conversation_kind: "chat", messages: [] }, message_count: 0,
    events: [], limitations: [], findings: [], profile_fields: [], public_sources: [],
  } as unknown as Task;
}
const conflict = () => Response.json({ code: "CONTACT_TASK_REVISION_CHANGED", message: "CONTACT_TASK_REVISION_CHANGED" }, { status: 409 });
let host: HTMLDivElement, root: Root;
const posts = () => fetcher.mock.calls.filter(([, init]) => init?.method === "POST");
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
async function render(id = "source-a", props = {}) {
  await act(async () => root.render(createElement(ContactAgentWorkspace, { initialTaskID: id, ...props })));
  await flush();
}
function button(text: string) {
  return [...host.querySelectorAll<HTMLButtonElement>("button")].find(e => e.textContent?.includes(text));
}
async function click(text: string) {
  const target = button(text); expect(target, text).toBeTruthy(); expect(target!.disabled).toBe(false);
  await act(async () => target!.click()); await flush();
}
async function type(selector: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  expect(input).toBeTruthy();
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  await act(async () => input.dispatchEvent(new Event("input", { bubbles: true })));
}
beforeEach(() => {
  vi.resetAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  fetcher.mockImplementation((url: string) => Promise.resolve(Response.json(url.endsWith("/tasks") ? { tasks: [] } : task())));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("source conflict decisions", () => {
  it("refreshes revision, preserves input, and waits for a second explicit decision", async () => {
    let revision = 1;
    fetcher.mockImplementation((url: string, init: RequestInit) => {
      if (init.method === "POST") { if (revision === 1) { revision = 2; return Promise.resolve(conflict()); } return Promise.resolve(Response.json({ ...task(3), status: "completed", question: null })); }
      return Promise.resolve(Response.json(url.endsWith("/tasks") ? { tasks: [] } : task(revision)));
    });
    await render(); await type('input[maxlength="200"]', "保留的编辑");
    await click("归入 合成人物");
    expect(posts()).toHaveLength(1);
    expect(host.querySelector<HTMLInputElement>('input[maxlength="200"]')!.value).toBe("保留的编辑");
    expect(host.querySelector('[role="alert"]')!.textContent).toContain("请核对后重新选择");
    expect(host.textContent).not.toContain("CONTACT_TASK_REVISION_CHANGED");
    await click("归入 合成人物");
    expect(posts().map(([, init]) => JSON.parse(init.body).expected_revision)).toEqual([1, 2]);
  });

  it("discards stale deletion consent and requests it again", async () => {
    let revision = 1;
    fetcher.mockImplementation((url: string, init: RequestInit) => {
      if (init.method === "POST") { revision = 2; return Promise.resolve(conflict()); }
      return Promise.resolve(Response.json(url.endsWith("/tasks") ? { tasks: [] } : task(revision)));
    });
    await render(); await click("删除这次采集"); await click("确认删除来源");
    expect(posts()).toHaveLength(1);
    expect(button("确认删除来源")).toBeUndefined();
    expect(button("删除这次采集")).toBeTruthy();
  });

  it("blocks mutations after failed refresh and retries only the read", async () => {
    let conflicted = false, readFails = true;
    fetcher.mockImplementation((url: string, init: RequestInit) => {
      if (init.method === "POST") { conflicted = true; return Promise.resolve(conflict()); }
      if (url.endsWith("/tasks")) return Promise.resolve(Response.json({ tasks: [] }));
      if (conflicted && readFails) return Promise.resolve(Response.json({ message: "unavailable" }, { status: 503 }));
      return Promise.resolve(Response.json(task(conflicted ? 2 : 1)));
    });
    await render(); await type('input[maxlength="200"]', "编辑仍在"); await click("归入 合成人物");
    expect(button("归入 合成人物")!.disabled).toBe(true);
    expect(host.querySelector<HTMLInputElement>('input[maxlength="200"]')!.value).toBe("编辑仍在");
    readFails = false; await click("刷新来源状态");
    expect(posts()).toHaveLength(1); expect(button("归入 合成人物")!.disabled).toBe(false);
  });

  it("ignores an old conflict read after another task becomes selected", async () => {
    let conflicted = false, finish: (response: Response) => void = () => {};
    fetcher.mockImplementation((url: string, init: RequestInit) => {
      if (init.method === "POST") { conflicted = true; return Promise.resolve(conflict()); }
      if (url.endsWith("/tasks")) return Promise.resolve(Response.json({ tasks: [] }));
      if (url.endsWith("source-b")) return Promise.resolve(Response.json(task(7, "source-b")));
      if (conflicted) return new Promise<Response>(resolve => { finish = resolve; });
      return Promise.resolve(Response.json(task()));
    });
    await render(); await click("归入 合成人物"); await render("source-b");
    await act(async () => finish(Response.json(task(2)))); await flush();
    expect(host.querySelector("#contact-task-source-b")).toBeTruthy();
    expect(host.querySelector("#contact-task-source-a")).toBeNull();
  });

  it("does not expose empty processing records or a source archive self-link", async () => {
    const saved = { ...task(), contact: { person_id: "person-a", relationship_context_id: "context-a", display_name: "合成人物", disposition: "created" } };
    fetcher.mockImplementation((url: string) => Promise.resolve(Response.json(url.includes("contact-intelligence") ? { tasks: [saved], person_revision: 1 } : url.endsWith("/tasks") ? { tasks: [] } : saved)));
    await render("source-a", { personID: "person-a", contextID: "context-a" });
    expect(host.textContent).not.toContain("查看实际处理记录");
    expect([...host.querySelectorAll("a")].some(e => e.href.includes("/captures/people/person-a"))).toBe(false);
  });
});

it("preserves profile edits only while their source evidence is unchanged", async () => {
  const draft = { display_name: "原姓名", platform: "synthetic", fields: [{ clue_index: 0, kind: "company", value: "原公司", source_image_index: 0, source_excerpt: "原公司依据" }] };
  const confirm = vi.fn().mockResolvedValue(undefined);
  const paint = async (revision: number, source = draft) => {
    await act(async () => root.render(createElement(ContactProfileReview, { task: { ...task(revision), contact_draft: source } as Task, busy: false, onConfirm: confirm })));
  };
  await paint(1); await type('input[maxlength="300"]', "我的核对"); await paint(2);
  expect(host.querySelector<HTMLInputElement>('input[maxlength="300"]')!.value).toBe("我的核对");
  await click("添加为新联系人"); expect(confirm.mock.calls[0][0].expected_revision).toBe(2);
  expect(confirm.mock.calls[0][0].create_new).toBe(true);
  await paint(3, { ...draft, fields: [{ ...draft.fields[0], value: "新公司", source_excerpt: "新的来源依据" }] });
  expect(host.querySelector<HTMLInputElement>('input[maxlength="300"]')!.value).toBe("新公司");
  expect(host.textContent).toContain("资料依据已变化");
});
