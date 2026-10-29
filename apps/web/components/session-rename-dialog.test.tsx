// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionRenameDialog } from "./session-rename-dialog";
import { LocaleProvider } from "./locale-provider";

const mocks = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn() }));
vi.mock("./workspace-session-request", () => ({ workspaceSessionFetch: mocks.request }));
vi.mock("@/lib/workspace-refresh", () => ({ requestWorkspaceRefresh: mocks.refresh }));
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const target = { id, binding: "binding", scope: "scope", onRenamed: vi.fn() };
let root: Root;
let host: HTMLDivElement;
const close = vi.fn();
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.request.mockResolvedValue(Response.json({ session_version: "binding", detail: { session_id: id, state: "active", revision: 3, title: "Original title" } }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<LocaleProvider locale="en"><SessionRenameDialog target={target} title="Cached title" onClose={close} /></LocaleProvider>));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
function submit() { document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }

it("reads the current revision and closes only after verified save", async () => {
  const input = document.querySelector("input")!;
  expect(input.value).toBe("Original title");
  mocks.request.mockResolvedValue(Response.json({ detail: { session_id: id, revision: 4, title: "Original title" } }));
  await act(async () => submit());
  const request = JSON.parse(mocks.request.mock.calls[1][1].body);
  expect(request).toMatchObject({ title: "Original title", expected_revision: 3 });
  expect(target.onRenamed).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
it("retains the entered title on conflict and does not report success", async () => {
  mocks.request.mockResolvedValue(Response.json({}, { status: 409 }));
  await act(async () => submit());
  expect(document.querySelector("input")!.value).toBe("Original title");
  expect(document.querySelector('[role="alert"]')!.textContent).toContain("changed");
  expect(target.onRenamed).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
});
it("cancel makes no mutation", async () => {
  const cancel = [...document.querySelectorAll("button")].find(button => button.textContent === "Cancel")!;
  await act(async () => cancel.click());
  expect(mocks.request).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledOnce();
});
