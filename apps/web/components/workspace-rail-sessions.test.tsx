// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "./locale-provider";
import { WorkspaceShellNav } from "./workspace-shell-nav";

const directory = vi.hoisted(() => ({ data: null as unknown, loading: false, failed: false, retry: vi.fn() }));
vi.mock("./workspace-search", () => ({ useWorkspaceDirectory: () => directory, WorkspaceGlobalSearchDialog: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/workspace", useRouter: () => ({ push: vi.fn() }) }));
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); host?.remove(); root = undefined; host = undefined; });
function render() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host ??= document.createElement("div");
  if (!host.isConnected) document.body.append(host);
  root ??= createRoot(host);
  act(() => root!.render(<LocaleProvider locale="en"><WorkspaceShellNav binding="current" /></LocaleProvider>));
}
function seed() {
  directory.data = { sessions: { session_version: "current", sessions: ["First conversation with 林晓", "Second conversation with 林晓"].map((title, index) => ({
    session_id: `00000000-0000-4000-8000-00000000000${index + 1}`, state: "active", title,
    person_id: "same-person", person_label: "林晓", expires_at: "2030-01-01T00:00:00Z", is_unread: false,
  })) } };
  directory.failed = false;
}
it("retains exact Session shortcuts on a transient failed refresh and fails closed on cleared directory data", () => {
  seed(); render();
  directory.failed = true; render();
  const shortcuts = [...host!.querySelectorAll<HTMLAnchorElement>('a[aria-label$="with 林晓"]')];
  expect(shortcuts.map(link => link.getAttribute("href"))).toEqual([
    "/workspace/sessions/00000000-0000-4000-8000-000000000001", "/workspace/sessions/00000000-0000-4000-8000-000000000002",
  ]);
  directory.data = null; render();
  expect(host!.textContent).not.toContain("with 林晓");
  expect(host!.querySelector('a[aria-label$="with 林晓"]')).toBeNull();
});
it("discloses full titles on keyboard focus and touch without resolving a Session from its shared person", async () => {
  seed(); render();
  const links = [...host!.querySelectorAll<HTMLAnchorElement>('a[aria-label$="with 林晓"]')];
  act(() => links[1]!.focus());
  const title = await vi.waitFor(() => { const value = document.querySelector('[data-session-shortcut-title]'); expect(value).not.toBeNull(); return value!; });
  expect(title.textContent).toContain("Second conversation with 林晓");
  expect(title.querySelector('a')?.getAttribute("href")).toBe(links[1]!.getAttribute("href"));
  await act(async () => links[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await vi.waitFor(() => expect(document.querySelector('[data-session-shortcut-title]')).toBeNull());
  act(() => links[0]!.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true })));
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => links[0]!.dispatchEvent(click));
  expect(click.defaultPrevented).toBe(true);
  await vi.waitFor(() => expect(document.querySelector('[data-session-shortcut-title]')?.textContent).toContain("First conversation with 林晓"));
});
