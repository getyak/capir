// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/workspace", binding: "a" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
vi.mock("./workspace-session-request", () => ({
  WORKSPACE_SESSION_EXPIRED_EVENT: "test-session-expired",
  workspaceSessionFetch: vi.fn(),
}));
import { workspaceSessionFetch } from "./workspace-session-request";
import { useWorkspaceDirectory, WorkspaceGlobalSearchDialog } from "./workspace-search";
import { WorkspaceDirectoryScope } from "./workspace-directory-cache";
import { invalidateWorkspaceDirectory, readCachedWorkspaceDirectory } from "@/lib/workspace-directory-cache";

let root: Root;
let host: HTMLDivElement;
const request = vi.mocked(workspaceSessionFetch);
function payload(label = "合成人物") {
  return { people: [{ id: "person-a", display_label: label }], session_version: navigation.binding, sessions: [] };
}
function Consumer({ binding }: { binding: string | null }) {
  const result = useWorkspaceDirectory(binding, true);
  return createElement("p", null, result.loading ? "loading" : result.failed ? "failed" : result.data?.people.people?.map(person => person.display_label).join(","));
}
function tree(binding: string | null, strict = false) {
  const content = createElement(WorkspaceDirectoryScope, { binding },
    createElement(Consumer, { binding }), createElement(Consumer, { binding }));
  return strict ? createElement(StrictMode, null, content) : content;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  navigation.pathname = "/workspace";
  navigation.binding = "a";
  invalidateWorkspaceDirectory(undefined, "discard");
  request.mockReset().mockImplementation(async () => Response.json(payload()));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  invalidateWorkspaceDirectory(undefined, "discard");
});

describe("rendered workspace directory continuity", () => {
  it("reopens search cleanly and preserves the new query through directory refresh", async () => {
    await act(async () => root.render(createElement(WorkspaceGlobalSearchDialog, { binding: "a" })));
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="搜索"]')!;
    await act(async () => trigger.click());
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="关闭搜索"]')!.click());
    await act(async () => trigger.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const input = dialog.querySelector<HTMLInputElement>("input")!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(input, "合成人物");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(dialog.querySelector("[data-search-result]")?.textContent).toContain("合成人物");
    await act(async () => invalidateWorkspaceDirectory(undefined, "revalidate"));
    expect(input.value).toBe("合成人物");
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(dialog.querySelector("[data-search-result]")?.textContent).toContain("合成人物");
  });

  it("deduplicates consumers and keeps the directory on a warm route change", async () => {
    await act(async () => root.render(tree("a")));
    expect(host.textContent).toBe("合成人物合成人物");
    expect(request).toHaveBeenCalledTimes(2);
    navigation.pathname = "/workspace/people";
    await act(async () => root.render(tree("a")));
    expect(host.textContent).toBe("合成人物合成人物");
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("removes deleted rows immediately while readback hangs, then fails closed", async () => {
    await act(async () => root.render(tree("a")));
    const pending: Array<(response: Response) => void> = [];
    request.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    await act(async () => invalidateWorkspaceDirectory(undefined, "revalidate"));
    expect(host.textContent).toBe("loadingloading");
    expect(host.textContent).not.toContain("合成人物");
    await act(async () => pending.forEach(resolve => resolve(Response.json({}, { status: 503 }))));
    expect(host.textContent).toBe("failedfailed");
    expect(host.textContent).not.toContain("合成人物");
  });
  it("discards the previous identity when a null shell becomes bound and switches again", async () => {
    await act(async () => root.render(tree(null)));
    await act(async () => root.render(tree("a")));
    expect(readCachedWorkspaceDirectory("a")).not.toBeNull();
    navigation.binding = "b";
    await act(async () => root.render(tree("b")));
    expect(readCachedWorkspaceDirectory("a")).toBeNull();
    expect(readCachedWorkspaceDirectory("b")).not.toBeNull();
    await act(async () => root.render(tree(null)));
    expect(readCachedWorkspaceDirectory("b")).toBeNull();
    expect(host.textContent).not.toContain("合成人物");
  });
  it("recovers normally through a StrictMode lifecycle rehearsal", async () => {
    await act(async () => root.render(tree("a", true)));
    expect(host.textContent).toBe("合成人物合成人物");
  });
});
