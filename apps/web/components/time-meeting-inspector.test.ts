// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingDraftRecord } from "@talent-signal/contracts";

// Per-task synthetic records only; no real draft content is used here.
const mock = vi.hoisted(() => ({
  request: vi.fn(),
  fetch: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mock.push, replace: mock.replace, refresh: mock.refresh }),
}));
vi.mock("@/lib/time-workspace-client", () => ({ timeRequest: mock.request }));
vi.mock("@/components/workspace-session-request", async (original) => ({
  ...(await original<typeof import("@/components/workspace-session-request")>()),
  workspaceSessionFetch: mock.fetch,
}));

import { TimeMeetingInspector } from "./time-meeting-inspector";

const draftA: MeetingDraftRecord = {
  id: "c1000000-0000-4000-8000-000000000001",
  status: "needs_review",
  external_effect: "none",
  revision: 1,
  source_task_id: "c2000000-0000-4000-8000-000000000001",
  origin_session_id: "c3000000-0000-4000-8000-000000000001",
  created_at: "2026-09-16T00:00:00.000Z",
  updated_at: "2026-09-16T00:00:00.000Z",
  expires_at: "2099-10-01T00:00:00.000Z",
  content_available: true,
  title: "Synthetic meeting A",
  starts_at: "2026-09-16T01:30:00.000Z",
  ends_at: "2026-09-16T02:00:00.000Z",
  time_zone: "Asia/Shanghai",
  source_excerpt: "Synthetic private excerpt A",
  reference_time: "2026-09-15T00:00:00.000Z",
  redacted_at: null,
  dismissed_at: null,
};
const draftB: MeetingDraftRecord = {
  ...draftA,
  id: "c1000000-0000-4000-8000-000000000002",
  source_task_id: "c2000000-0000-4000-8000-000000000002",
  origin_session_id: "c3000000-0000-4000-8000-000000000002",
  revision: 2,
  title: "Synthetic meeting B",
  source_excerpt: "Synthetic private excerpt B",
};

let root: Root, host: HTMLDivElement;
const binding = "c4000000-0000-4000-8000-000000000001";

async function render(id: string, revision: number) {
  await act(async () => {
    root.render(
      createElement(TimeMeetingInspector, {
        id,
        revision,
        binding,
        returnHref: "/workspace/meetings?month=2026-09&day=2026-09-16",
        refreshKey: 0,
      }),
    );
  });
}
function button(label: string) {
  return [...host.querySelectorAll("button")].find((item) => item.textContent === label);
}
function titleInput() {
  return host.querySelector<HTMLInputElement>('input[maxlength="200"]');
}
function expectNoActionableReview() {
  expect(host.querySelector('[data-testid="calendar-draft-review"]')).toBeNull();
  expect(host.querySelector("input")).toBeNull();
  for (const label of ["下载日历草稿", "从待核对中移除"]) {
    expect(button(label)).toBeUndefined();
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  mock.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  sessionStorage.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  sessionStorage.clear();
});

describe("TimeMeetingInspector draft admission", () => {
  it("renders the same-identity revision-bound response with actionable controls", async () => {
    mock.request.mockResolvedValue({ draft: draftB });
    await render(draftB.id, 2);
    expect(mock.request).toHaveBeenCalledWith(
      `/api/meeting-drafts/${draftB.id}`,
      binding,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expected_revision: 2 }),
      }),
    );
    expect(host.querySelector('[data-testid="calendar-draft-review"]')).not.toBeNull();
    expect(titleInput()!.value).toBe("Synthetic meeting B");
    expect(host.textContent).toContain("Synthetic private excerpt B");
    expect(host.querySelectorAll("input")).toHaveLength(3);
    for (const label of ["下载日历草稿", "从待核对中移除"]) {
      expect(button(label)).toBeTruthy();
    }
  });

  it("refuses a schema-valid response whose draft identity is not the requested one", async () => {
    mock.request.mockResolvedValue({ draft: draftA });
    await render(draftB.id, 2);
    expectNoActionableReview();
    expect(host.textContent).not.toContain("Synthetic private excerpt A");
    expect(host.textContent).not.toContain("Synthetic meeting A");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(button("重新读取")).toBeTruthy();
  });

  it("refuses a schema-valid response whose revision is not the revision-bound request", async () => {
    mock.request.mockResolvedValue({ draft: { ...draftB, revision: 3 } });
    await render(draftB.id, 2);
    expectNoActionableReview();
    expect(host.textContent).not.toContain("Synthetic private excerpt B");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(button("重新读取")).toBeTruthy();
  });

  it("cannot let a late response for one draft supply fields after the selection changes", async () => {
    let late!: (value: unknown) => void;
    mock.request.mockImplementationOnce(() => new Promise((resolve) => { late = resolve; }));
    mock.request.mockResolvedValue({ draft: draftB });
    await render(draftA.id, 1);
    expect(host.textContent).toContain("正在核对草稿来源…");
    await render(draftB.id, 2);
    expect(titleInput()!.value).toBe("Synthetic meeting B");
    await act(async () => late({ draft: draftA }));
    expect(titleInput()!.value).toBe("Synthetic meeting B");
    expect(host.textContent).toContain("Synthetic private excerpt B");
    expect(host.textContent).not.toContain("Synthetic private excerpt A");
  });

  it("remounts review state through the loading branch when the selection changes", async () => {
    mock.request.mockResolvedValue({ draft: draftA });
    await render(draftA.id, 1);
    const title = titleInput()!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Unsent private edit");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(titleInput()!.value).toBe("Unsent private edit");
    let next!: (value: unknown) => void;
    mock.request.mockImplementationOnce(() => new Promise((resolve) => { next = resolve; }));
    await render(draftB.id, 2);
    expect(host.textContent).toContain("正在核对草稿来源…");
    expect(host.textContent).not.toContain("Synthetic private excerpt A");
    await act(async () => next({ draft: draftB }));
    expect(titleInput()!.value).toBe("Synthetic meeting B");
    expect(host.textContent).toContain("Synthetic private excerpt B");
    expect(host.textContent).not.toContain("Unsent private edit");
  });

  it("recovers through the retry action once an admitted response arrives", async () => {
    mock.request.mockResolvedValueOnce({ draft: draftA }).mockResolvedValue({ draft: draftB });
    await render(draftB.id, 2);
    expectNoActionableReview();
    expect(host.textContent).toContain("会议草稿暂时无法读取。");
    await act(async () => { button("重新读取")!.click(); });
    expect(mock.request).toHaveBeenCalledTimes(2);
    expect(titleInput()!.value).toBe("Synthetic meeting B");
    expect(button("从待核对中移除")).toBeTruthy();
  });
});
