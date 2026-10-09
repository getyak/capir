// @vitest-environment happy-dom
//
// Monitor reliability and diagnostics: truthful refresh controls (explicit
// auto-refresh, 5/10/30s intervals, visible-tab polling, historical-pagination
// pause, independent detail polling), truthful trace states (exact statuses,
// honest durations, separate failed-tool counts, metadata-only traces after
// source loss), inline conversation source images through the existing
// authenticated message route, and regression capture version binding.
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetcher = vi.hoisted(() => vi.fn());
vi.mock("./workspace-session-request", () => ({
  WORKSPACE_SESSION_EXPIRED_EVENT: "talent-signal:workspace-session-expired",
  workspaceSessionFetch: fetcher,
  workspaceSessionExpired: () => false,
  relationshipIntegrationFetch: fetcher,
  relationshipIntegrationSessionExpired: () => false,
}));
vi.mock("next/link", async () => {
  const react = await import("react");
  return { default: ({ href, children, ...rest }: Record<string, unknown>) => react.createElement("a", { href: String(href), ...rest }, children as never) };
});
vi.mock("next/image", async () => {
  const react = await import("react");
  return { default: ({ src, alt }: Record<string, unknown>) => react.createElement("img", { src: String(src), alt: String(alt ?? "") }) };
});

import { CONTRACT_VERSION, type ProductRunDetail, type ProductRunList, type ProductRunSummary } from "@talent-signal/contracts";
import { ProductRunMonitor } from "./product-run-monitor";

const BINDING = "bound-login-version";
const RUN1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TASK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SESSION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MESSAGE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const HASH = "a".repeat(64);
const NEW_HASH = "b".repeat(64);

function envelope(value: unknown, overrides: Record<string, unknown> = {}) {
  return { status: "complete", original_bytes: 40, retained_bytes: 40, sha256: HASH, value, ...overrides };
}

function runFixture(overrides: Partial<ProductRunSummary> = {}): ProductRunSummary {
  return {
    id: RUN1, task_id: TASK, session_id: SESSION, platform: "web", task_kind: "relationship_chat",
    objective: "帮我整理这段对话", status: "completed", created_at: "2026-10-07T10:00:00.000Z", updated_at: "2026-10-07T10:00:05.000Z",
    duration_ms: 5000, attempts: 1, output_hash: HASH,
    feedback: { revision: 0, sentiment: null, reasons: [], comment: "", correction: "", selected_text: "", updated_at: null },
    model: "model-a", span_count: 1, content_available: true, ...overrides,
  };
}

function spanFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "span-1", parent_id: null, name: "relationship.answer", kind: "llm", status: "completed",
    started_at: "2026-10-07T10:00:00.000Z", finished_at: "2026-10-07T10:00:01.000Z",
    input: envelope({ question: "hi" }), output: envelope({ answer: "hello" }), metadata: { model: "model-a" }, error: null,
    ...overrides,
  };
}

function detailFixture(overrides: Record<string, unknown> = {}): ProductRunDetail {
  return {
    contract_version: CONTRACT_VERSION,
    run: runFixture(),
    input: envelope({ question: "hi" }),
    output: { blocks: [{ id: "b1", title: "回答", body: "回答正文 ABC" }] },
    spans: [], history: [], execution: null, corrections: [], ...overrides,
  } as ProductRunDetail;
}

function listBody(runs: ProductRunSummary[], nextCursor: string | null = null): ProductRunList {
  return {
    contract_version: CONTRACT_VERSION, runs, next_cursor: nextCursor,
    counts: { all: runs.length, helpful: 0, unhelpful: 0, unrated: runs.length },
  };
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

let mount: HTMLDivElement;
let root: Root;
let visibility = "visible";

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  Object.defineProperty(document, "hidden", { configurable: true, get: () => visibility !== "visible" });
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  mount.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  fetcher.mockReset();
});

async function render(node: ReactElement) {
  await act(async () => { root.render(node); });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function setVisibility(next: string) {
  visibility = next;
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
}

function buttonByText(text: string): HTMLButtonElement {
  const found = [...mount.querySelectorAll("button")].find((node) => node.textContent?.includes(text));
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

function buttonByLabel(label: string): HTMLButtonElement {
  const found = [...mount.querySelectorAll("button")].find((node) => node.getAttribute("aria-label") === label);
  if (!found) throw new Error(`button not found: ${label}`);
  return found;
}

async function click(text: string) {
  await act(async () => {
    buttonByText(text).click();
    await vi.advanceTimersByTimeAsync(1);
  });
}

function setCheckbox(input: HTMLInputElement) {
  act(() => { input.click(); });
}

function change(select: HTMLSelectElement, value: string) {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const text = () => mount.textContent ?? "";
const listFetches = () => fetcher.mock.calls.filter(([url]) => String(url).includes("/api/product-runs?"));
const detailFetches = () => fetcher.mock.calls.filter(([url]) => /\/api\/product-runs\/[\w-]{36}$/.test(String(url)));

function selectRun(name: string) {
  const run = [...mount.querySelectorAll("button")].find((node) => node.textContent?.includes(name));
  if (!run) throw new Error(`run not found: ${name}`);
  act(() => { run.click(); });
}

describe("monitor refresh controls", () => {
  it("withdraws old filter results before the debounce and while the new read is pending", async () => {
    const pending = deferred<Response>();
    fetcher.mockImplementation(async (input: RequestInfo | URL) => String(input).includes("platform=ios")
      ? pending.promise : jsonResponse(listBody([runFixture({ objective: "旧筛选结果" })])));
    await render(<ProductRunMonitor />);
    expect(text()).toContain("旧筛选结果");
    change(mount.querySelector<HTMLSelectElement>('select[aria-label="来源平台"]')!, "ios");
    expect(text()).not.toContain("旧筛选结果");
    expect(text()).toContain("正在读取运行记录");
    await advance(250);
    expect(text()).not.toContain("旧筛选结果");
    await act(async () => {
      pending.resolve(jsonResponse(listBody([runFixture({ objective: "新筛选结果", platform: "ios" })])));
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(text()).toContain("新筛选结果");
  });

  it("polls the latest page every 10 seconds by default only while the tab is visible", async () => {
    fetcher.mockImplementation(async () => jsonResponse(listBody([runFixture()])));
    await render(<ProductRunMonitor />);
    expect(listFetches()).toHaveLength(1);

    await advance(9_000);
    expect(listFetches()).toHaveLength(1);
    await advance(1_500);
    expect(listFetches()).toHaveLength(2);

    setVisibility("hidden");
    await advance(30_000);
    expect(listFetches()).toHaveLength(2);

    setVisibility("visible");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    // One bounded immediate resume fetch, never a replay of hidden ticks.
    expect(listFetches()).toHaveLength(3);
    expect(text()).toContain("每 10 秒更新");
  });

  it("honors the explicit auto-refresh toggle and the 5/30 second intervals", async () => {
    fetcher.mockImplementation(async () => jsonResponse(listBody([runFixture()])));
    await render(<ProductRunMonitor />);
    const toggle = mount.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const interval = mount.querySelector<HTMLSelectElement>('select[aria-label="自动刷新间隔"]')!;
    expect(toggle.checked).toBe(true);
    expect(interval.value).toBe("10000");

    setCheckbox(toggle);
    await advance(60_000);
    expect(listFetches()).toHaveLength(1);
    expect(text()).toContain("自动更新已关闭");

    setCheckbox(toggle);
    change(interval, "5000");
    await advance(5_500);
    expect(listFetches()).toHaveLength(2);

    change(interval, "30000");
    await advance(29_000);
    expect(listFetches()).toHaveLength(2);
    await advance(1_500);
    expect(listFetches()).toHaveLength(3);
  });

  it("changes selected-detail polling controls without triggering an immediate read", async () => {
    fetcher.mockImplementation(async (input: RequestInfo | URL) => /\/api\/product-runs\/[\w-]{36}$/.test(String(input))
      ? jsonResponse(detailFixture()) : jsonResponse(listBody([runFixture()])));
    await render(<ProductRunMonitor />);
    selectRun("帮我整理这段对话");
    await advance(1);
    expect(detailFetches()).toHaveLength(1);
    const toggle = mount.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const interval = mount.querySelector<HTMLSelectElement>('select[aria-label="自动刷新间隔"]')!;
    setCheckbox(toggle);
    await advance(60_000);
    expect(detailFetches()).toHaveLength(1);
    change(interval, "30000");
    await advance(1);
    expect(detailFetches()).toHaveLength(1);
    setCheckbox(toggle);
    await advance(29_000);
    expect(detailFetches()).toHaveLength(1);
    await advance(1_000);
    expect(detailFetches()).toHaveLength(2);
  });

  it("pauses latest-page polling during historical pagination while the selected detail polls independently", async () => {
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/api\/product-runs\/[\w-]{36}$/.test(url)) return jsonResponse(detailFixture());
      return jsonResponse(listBody([runFixture()], "cursor-1"));
    });
    await render(<ProductRunMonitor />);
    selectRun("帮我整理这段对话");
    await advance(1);
    expect(detailFetches()).toHaveLength(1);

    await click("加载更多");
    expect(text()).toContain("自动更新已暂停");
    const listCount = listFetches().length;
    await advance(30_000);
    expect(listFetches()).toHaveLength(listCount);
    expect(detailFetches().length).toBeGreaterThan(1);
  });

  it("returns to the latest list on manual refresh and resumes polling", async () => {
    let page = 0;
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("cursor=")) return jsonResponse(listBody([runFixture({ id: RUN2, objective: "历史运行问题" })]));
      page += 1;
      return jsonResponse(listBody([runFixture({ objective: `最新问题 ${page}` })], page === 1 ? "cursor-1" : null));
    });
    await render(<ProductRunMonitor />);
    await click("加载更多");
    expect(text()).toContain("历史运行问题");

    await act(async () => {
      buttonByLabel("刷新运行").click();
      await vi.advanceTimersByTimeAsync(1);
    });
    await advance(1);
    expect(text()).toContain("最新问题");
    expect(text()).not.toContain("历史运行问题");
    expect(text()).toContain("每 10 秒更新");
    const before = listFetches().length;
    await advance(10_500);
    expect(listFetches().length).toBe(before + 1);
    const lastCall = listFetches().at(-1)!;
    expect(String(lastCall[0])).not.toContain("cursor=");
  });

  it("disables load-more in flight and deduplicates run IDs across appended pages", async () => {
    const gate = deferred<Response>();
    let calls = 0;
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("cursor=")) { calls += 1; return gate.promise; }
      return jsonResponse(listBody([runFixture()], "cursor-1"));
    });
    await render(<ProductRunMonitor />);
    const more = buttonByText("加载更多");
    expect(more.disabled).toBe(false);
    more.click();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(buttonByText("正在加载").disabled).toBe(true);
    await act(async () => {
      gate.resolve(jsonResponse(listBody([runFixture(), runFixture({ id: RUN2, objective: "第二条运行" })], "cursor-2")));
      await vi.advanceTimersByTimeAsync(1);
    });
    await advance(1);
    expect(calls).toBe(1);
    expect(text().match(/帮我整理这段对话/g)).toHaveLength(1);
    expect(text()).toContain("第二条运行");
    expect(buttonByText("加载更多").disabled).toBe(false);
  });

  it("fences stale list and detail responses with generation tickets", async () => {
    const slowList = deferred<Response>();
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("platform=ios")) return jsonResponse(listBody([runFixture(), runFixture({ id: RUN2, objective: "iOS 运行" })]));
      if (url.includes("/api/product-runs?")) return slowList.promise;
      return jsonResponse(detailFixture());
    });
    await render(<ProductRunMonitor />);
    const platformSelect = mount.querySelector<HTMLSelectElement>('select[aria-label="来源平台"]')!;
    change(platformSelect, "web");
    await advance(250);
    change(platformSelect, "ios");
    await advance(250);
    expect(text()).toContain("iOS 运行");
    await act(async () => {
      slowList.resolve(jsonResponse(listBody([runFixture({ objective: "过期的第一批结果" })])));
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(text()).not.toContain("过期的第一批结果");

    // Detail selection race: a late response for the first selection never wins.
    const slowDetail = deferred<Response>();
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith(RUN1)) return slowDetail.promise;
      if (url.endsWith(RUN2)) return jsonResponse(detailFixture({ run: runFixture({ id: RUN2, objective: "第二个问题" }) }));
      return jsonResponse(listBody([runFixture(), runFixture({ id: RUN2, objective: "第二个问题" })]));
    });
    selectRun("帮我整理这段对话");
    await advance(1);
    selectRun("iOS 运行");
    await advance(1);
    expect(text()).toContain("第二个问题");
    await act(async () => {
      slowDetail.resolve(jsonResponse(detailFixture({ run: runFixture({ objective: "第一个问题" }) })));
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(text()).not.toContain("第一个问题");
  });

  it("keeps separate list and detail freshness, failure and stale labels with retry", async () => {
    let listFails = true, detailFails = true;
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/api\/product-runs\/[\w-]{36}$/.test(url)) {
        if (detailFails) return jsonResponse({ message: "详情暂时不可用。" }, { status: 503 });
        return jsonResponse(detailFixture());
      }
      if (listFails) return jsonResponse({ message: "运行记录暂时不可用。" }, { status: 503 });
      return jsonResponse(listBody([runFixture()]));
    });
    await render(<ProductRunMonitor />);
    expect(text()).toContain("列表 · 连接中断 · 保留上次结果");
    expect(text()).toContain("运行记录暂时不可用。");

    listFails = false;
    await click("重新连接");
    expect(text()).toContain("列表 · 更新于");

    selectRun("帮我整理这段对话");
    await advance(1);
    expect(text()).toContain("详情 · 读取失败 · 保留上次结果");

    detailFails = false;
    await click("重试");
    expect(text()).toContain("详情 · 更新于");
    expect(text()).toContain("回答正文 ABC");

    // A failed refresh keeps the previous detail but labels it stale.
    detailFails = true;
    await advance(10_500);
    expect(text()).toContain("以下保留上次读取的结果，可能已过时。");
    expect(text()).toContain("回答正文 ABC");
  });
});

describe("trace states", () => {
  it("shows failed tools separately from the final run status after an eventual success", async () => {
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/api\/product-runs\/[\w-]{36}$/.test(url)) return jsonResponse(detailFixture({
        run: runFixture({ span_count: 3 }),
        spans: [
          spanFixture({ id: "s1", name: "memory_review", kind: "tool", status: "failed", error: "Operation failed" }),
          spanFixture({ id: "s2", name: "memory_review", kind: "tool", status: "failed", error: "Operation failed" }),
          spanFixture({ id: "s3", name: "relationship.answer", kind: "llm", status: "completed" }),
        ],
      }));
      return jsonResponse(listBody([runFixture()]));
    });
    await render(<ProductRunMonitor />);
    selectRun("帮我整理这段对话");
    await advance(1);
    await click("执行链路");
    expect(text()).toContain("最终状态");
    expect(text()).toContain("已完成");
    expect(text()).toContain("失败工具");
    expect(text()).toContain("记录步骤");
    // Counts never infer overall success: final status and failed tools coexist.
    expect(text().indexOf("最终状态")).toBeLessThan(text().indexOf("失败工具"));
    expect(mount.querySelectorAll("li").length).toBe(3);
  });

  it("preserves every exact status label including unknown statuses", async () => {
    const statuses = ["completed", "failed", "cancelled", "interrupted", "waiting_for_user", "partial", "fallback", "weird_state"];
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/api\/product-runs\/[\w-]{36}$/.test(url)) return jsonResponse(detailFixture({
        spans: statuses.map((status, index) => spanFixture({ id: `s${index}`, name: `step-${status}`, status })),
      }));
      return jsonResponse(listBody([runFixture()]));
    });
    await render(<ProductRunMonitor />);
    selectRun("帮我整理这段对话");
    await advance(1);
    await click("执行链路");
    for (const label of ["已完成", "失败", "已停止", "已中断", "待确认", "部分完成", "已降级"]) expect(text()).toContain(label);
    expect(text()).toContain("weird_state");
  });

  it("shows unknown duration on malformed timestamps and in progress only while actually running", async () => {
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/api\/product-runs\/[\w-]{36}$/.test(url)) return jsonResponse(detailFixture({
        run: runFixture({ status: "failed", duration_ms: null }),
        spans: [
          spanFixture({ id: "s1", name: "broken_time", status: "failed", started_at: "not-a-date", finished_at: "not-a-date" }),
          spanFixture({ id: "s2", name: "live_step", status: "running", started_at: "not-a-date", finished_at: "not-a-date" }),
        ],
      }));
      return jsonResponse(listBody([runFixture({ status: "failed", duration_ms: null })]));
    });
    await render(<ProductRunMonitor />);
    expect(text()).toContain("失败 · 耗时未知");
    selectRun("帮我整理这段对话");
    await advance(1);
    await click("执行链路");
    expect(text()).toContain("耗时未知");
    expect(text()).toContain("进行中");
    expect(text()).not.toContain("NaN");
  });

  it("keeps the metadata trace when content is withdrawn while hiding bodies, originals and feedback", async () => {
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/api\/product-runs\/[\w-]{36}$/.test(url)) return jsonResponse(detailFixture({
        run: runFixture({ content_available: false, objective: "Original content unavailable" }),
        input: null, output: null,
        spans: [spanFixture({ id: "s1", name: "memory_review", input: { status: "unavailable", original_bytes: 0, retained_bytes: 0, sha256: null }, output: { status: "unavailable", original_bytes: 0, retained_bytes: 0, sha256: null }, metadata: { model: "model-a", failure_code: "X" } })],
        history: [{ id: "h1", revision: 1, output_hash: HASH, platform: "web", sentiment: "helpful", reasons: [], comment: "旧反馈", correction: "", selected_text: "", updated_at: "2026-10-07T10:01:00.000Z", output: null }],
      }));
      return jsonResponse(listBody([runFixture({ content_available: false, objective: "Original content unavailable" })]));
    });
    await render(<ProductRunMonitor />);
    selectRun("Original content unavailable");
    await advance(1);
    expect(text()).toContain("原始内容已不可用");
    expect(text()).not.toContain("回答正文 ABC");
    expect(text()).not.toContain("旧反馈");
    await click("执行链路");
    expect(text()).toContain("memory_review");
    expect(text()).toContain("调用元数据");
    expect(text()).toContain("model-a");
    expect(text()).toContain("原始内容已不可用。");
  });

  it("drops previously shown bodies when a refresh withdraws the source", async () => {
    let withdrawn = false;
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/api\/product-runs\/[\w-]{36}$/.test(url)) return jsonResponse(withdrawn
        ? detailFixture({ run: runFixture({ content_available: false }), input: null, output: null })
        : detailFixture());
      return jsonResponse(listBody([runFixture()]));
    });
    await render(<ProductRunMonitor />);
    selectRun("帮我整理这段对话");
    await advance(1);
    expect(text()).toContain("回答正文 ABC");
    withdrawn = true;
    await advance(10_500);
    expect(text()).not.toContain("回答正文 ABC");
    expect(text()).toContain("原始内容已不可用");
  });
});

describe("inline conversation source images", () => {
  const manifest = (index: number, name: string) => ({
    attachment_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    file_name: name, media_type: "image/png", byte_size: 8, content_hash: HASH,
  });
  const conversationInput = envelope({ session_id: SESSION, message_id: MESSAGE, objective: "看下这两张图", images: [manifest(0, "a.png"), manifest(1, "b.png")] });
  const conversationDetail = (overrides: Record<string, unknown> = {}) => detailFixture({
    run: runFixture({ task_kind: "conversation", session_id: SESSION }),
    input: conversationInput, ...overrides,
  });

  function imageFetches() {
    return fetcher.mock.calls.filter(([url]) => String(url).includes("/api/workspace-sessions/"));
  }

  it("loads each manifest through the existing message route in immutable order without base64", async () => {
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/workspace-sessions/")) return new Response(new Blob([`bytes-${url}`]), { status: 200 });
      if (/\/api\/product-runs\/[\w-]{36}$/.test(url)) return jsonResponse(conversationDetail());
      return jsonResponse(listBody([runFixture({ task_kind: "conversation" })]));
    });
    await render(<ProductRunMonitor sessionBinding={BINDING} />);
    selectRun("帮我整理这段对话");
    await advance(1);
    await click("上下文");
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(imageFetches().map(([url]) => String(url))).toEqual([
      `/api/workspace-sessions/${SESSION}/conversation-images/${MESSAGE}/0`,
      `/api/workspace-sessions/${SESSION}/conversation-images/${MESSAGE}/1`,
    ]);
    for (const [, init] of imageFetches()) {
      expect((init as RequestInit).headers).toMatchObject({ "x-workspace-session": BINDING });
    }
    expect(text()).toContain("原始图片 1 · a.png");
    expect(text()).toContain("原始图片 2 · b.png");
    expect(text().indexOf("a.png")).toBeLessThan(text().indexOf("b.png"));
    expect(mount.innerHTML).not.toContain("data:image/");
    // An explicit binding never triggers a bootstrap read.
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("/api/chat-artifacts/"))).toBe(false);
  });

  it("mints the login binding from the existing authenticated read even without an upstream artifact task", async () => {
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      // The existing bootstrap read returns the rendered login binding even
      // when the upstream has no artifacts (404); response.ok is never required.
      if (url.includes("/api/chat-artifacts/")) return jsonResponse({ message: "no artifacts" }, { status: 404, headers: { "x-workspace-session": BINDING } });
      if (url.includes("/api/workspace-sessions/")) return new Response(new Blob(["bytes"]), { status: 200 });
      if (/\/api\/product-runs\/[\w-]{36}$/.test(url)) return jsonResponse(conversationDetail());
      return jsonResponse(listBody([runFixture({ task_kind: "conversation" })]));
    });
    await render(<ProductRunMonitor />);
    selectRun("帮我整理这段对话");
    await advance(1);
    await click("上下文");
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(fetcher.mock.calls.some(([url]) => String(url).includes(`/api/chat-artifacts/${TASK}`))).toBe(true);
    expect(imageFetches()).toHaveLength(2);
    for (const [, init] of imageFetches()) {
      expect((init as RequestInit).headers).toMatchObject({ "x-workspace-session": BINDING });
    }
  });

  it("withdraws displayed source bytes in the same commit when the login binding goes away; late bytes never render", async () => {
    const first = deferred<Response>(), late = deferred<Response>();
    let created = 0;
    const revoked: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:source-${++created}`);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => { revoked.push(String(url)); });
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/chat-artifacts/")) return jsonResponse({ message: "session changed" }, { status: 401 });
      if (url.includes("/api/workspace-sessions/")) return url.endsWith("/0") ? first.promise : late.promise;
      if (/\/api\/product-runs\/[\w-]{36}$/.test(url)) return jsonResponse(conversationDetail());
      return jsonResponse(listBody([runFixture({ task_kind: "conversation" })]));
    });
    await render(<ProductRunMonitor sessionBinding={BINDING} />);
    selectRun("帮我整理这段对话");
    await advance(1);
    await click("上下文");
    await act(async () => {
      first.resolve(new Response(new Blob(["old-bytes"]), { status: 200 }));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(mount.querySelectorAll("img").length).toBe(1);
    const shown = mount.querySelector("img")!.getAttribute("src");
    expect(shown).toBe("blob:source-1");

    // Login binding withdrawn: the displayed source disappears in this commit,
    // not one effect pass later, and its object URL is revoked.
    await act(async () => { root.render(<ProductRunMonitor sessionBinding={null} />); });
    expect(mount.querySelectorAll("img").length).toBe(0);
    expect(revoked).toContain("blob:source-1");
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(text()).toContain("当前登录无法读取原始图片，请重新打开工作台。");

    // Late bytes belonging to the withdrawn login can never render.
    await act(async () => {
      late.resolve(new Response(new Blob(["late-bytes"]), { status: 200 }));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(mount.querySelectorAll("img").length).toBe(0);
    expect(created).toBe(1);
  });

  it("never fetches or renders source bytes without an authenticated login binding", async () => {
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/chat-artifacts/")) return jsonResponse({ message: "session changed" }, { status: 401 });
      if (url.includes("/api/workspace-sessions/")) return jsonResponse({ message: "no binding" }, { status: 409 });
      if (/\/api\/product-runs\/[\w-]{36}$/.test(url)) return jsonResponse(conversationDetail());
      return jsonResponse(listBody([runFixture({ task_kind: "conversation" })]));
    });
    await render(<ProductRunMonitor />);
    selectRun("帮我整理这段对话");
    await advance(1);
    await click("上下文");
    await act(async () => { await vi.advanceTimersByTimeAsync(20); });
    expect(imageFetches()).toHaveLength(0);
    expect(mount.querySelectorAll("img").length).toBe(0);
    expect(text()).toContain("当前登录无法读取原始图片，请重新打开工作台。");
  });

  it("never falls back to another session/message or a file name when identity or manifests are invalid", async () => {
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/api\/product-runs\/[\w-]{36}$/.test(url)) return jsonResponse(conversationDetail({
        input: envelope({ session_id: SESSION, message_id: "not-a-message", images: [manifest(0, "a.png")] }),
      }));
      return jsonResponse(listBody([runFixture({ task_kind: "conversation" })]));
    });
    await render(<ProductRunMonitor sessionBinding={BINDING} />);
    selectRun("帮我整理这段对话");
    await advance(1);
    await click("上下文");
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(imageFetches()).toHaveLength(0);
    expect(mount.querySelectorAll("img").length).toBe(0);
  });

  it("shows no input image when the source is withdrawn or the context is absent", async () => {
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/api\/product-runs\/[\w-]{36}$/.test(url)) return jsonResponse(conversationDetail({
        run: runFixture({ task_kind: "conversation", content_available: false }), input: null,
      }));
      return jsonResponse(listBody([runFixture({ task_kind: "conversation" })]));
    });
    await render(<ProductRunMonitor sessionBinding={BINDING} />);
    selectRun("帮我整理这段对话");
    await advance(1);
    await click("上下文");
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(imageFetches()).toHaveLength(0);
    expect(mount.querySelectorAll("img").length).toBe(0);
    expect(text()).toContain("原始内容已不可用");
  });

  it("keeps the screenshot-task image route unchanged", async () => {
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/api\/product-runs\/[\w-]{36}$/.test(url)) return jsonResponse(detailFixture({
        run: runFixture({ task_kind: "screenshot" }),
        output: { source_images: [{ image_index: 0 }] },
      }));
      return jsonResponse(listBody([runFixture({ task_kind: "screenshot" })]));
    });
    await render(<ProductRunMonitor sessionBinding={BINDING} />);
    selectRun("帮我整理这段对话");
    await advance(1);
    await click("上下文");
    expect(mount.querySelector(`img[src="/api/contact-agent/tasks/${TASK}/images/0"]`)).not.toBeNull();
    expect(imageFetches()).toHaveLength(0);
  });
});

describe("regression capture version binding", () => {
  const replayableDetail = (outputHash: string | null) => detailFixture({
    run: runFixture({ output_hash: outputHash }),
    spans: [spanFixture({ name: "relationship.answer", status: "completed", input: envelope({ question: "hi" }) })],
  });

  it("binds capture to the exact output hash and resets when the hash changes", async () => {
    let currentDetail = replayableDetail(HASH);
    const posts: unknown[] = [];
    fetcher.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/cases")) { posts.push(JSON.parse(String(init?.body))); return jsonResponse({ id: "case-1" }); }
      if (/\/api\/product-runs\/[\w-]{36}$/.test(url)) return jsonResponse(currentDetail);
      return jsonResponse(listBody([runFixture()]));
    });
    await render(<ProductRunMonitor />);
    selectRun("帮我整理这段对话");
    await advance(1);
    expect(text()).toContain("加入回归证据库");
    const textarea = mount.querySelector("textarea")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(textarea, "保留‘时间待确认’");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("加入回归证据库");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ output_hash: HASH, expected_behavior: "保留‘时间待确认’" });
    expect(text()).toContain("已加入回归证据库");

    currentDetail = replayableDetail(NEW_HASH);
    await advance(10_500);
    expect(text()).not.toContain("已加入回归证据库");
    expect(text()).toContain("加入回归证据库");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(mount.querySelector("textarea")!, "新的预期");
      mount.querySelector("textarea")!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("加入回归证据库");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(posts[1]).toMatchObject({ output_hash: NEW_HASH });
  });

  it("disables capture on a blank output hash and keeps image runs explicitly non-replayable", async () => {
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/api\/product-runs\/[\w-]{36}$/.test(url)) return jsonResponse(detailFixture({ run: runFixture({ output_hash: null }) }));
      return jsonResponse(listBody([runFixture()]));
    });
    await render(<ProductRunMonitor />);
    selectRun("帮我整理这段对话");
    await advance(1);
    expect(text()).toContain("缺少可比较的答案版本");
    expect([...mount.querySelectorAll("button")].some((node) => node.textContent?.includes("加入回归证据库"))).toBe(false);

    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/api\/product-runs\/[\w-]{36}$/.test(url)) return jsonResponse(detailFixture({
        spans: [spanFixture({ name: "relationship.answer", status: "completed", input: envelope({ question: "hi", images: [{ data: "…" }] }) })],
      }));
      return jsonResponse(listBody([runFixture()]));
    });
    await click("返回运行列表");
    selectRun("帮我整理这段对话");
    await advance(1);
    expect(text()).toContain("含图片的回答不可自动回放");
  });

  it("exports purpose-bound content carrying the same captured version", async () => {
    const created: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => { created.push(blob as Blob); return "blob:export"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    fetcher.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (/\/api\/product-runs\/[\w-]{36}$/.test(url)) return jsonResponse(replayableDetail(HASH));
      return jsonResponse(listBody([runFixture()]));
    });
    await render(<ProductRunMonitor />);
    selectRun("帮我整理这段对话");
    await advance(1);
    await click("导出运行与反馈");
    expect(created).toHaveLength(1);
    const payload = JSON.parse(await created[0]!.text());
    expect(payload.purpose).toBe("product-run-review-and-case-design");
    expect(payload.captured_output_hash).toBe(HASH);
    expect(payload.run.output_hash).toBe(payload.captured_output_hash);
    expect(payload.feedback_role).toContain("not gold labels");
  });
});
