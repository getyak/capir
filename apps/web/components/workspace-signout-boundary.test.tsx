// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "./locale-provider";
import { WorkspaceSessionBoundary } from "./workspace-session-boundary";
import { WorkspaceAccountMenu } from "./workspace-account-menu";
import { loadWorkspaceDirectory, readCachedWorkspaceDirectory, invalidateWorkspaceDirectory } from "@/lib/workspace-directory-cache";
import { readConversationDraft, writeConversationDraft } from "@/lib/conversation-local";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";
let root: Root; let host: HTMLDivElement; let sequence = 500;
let binding: string; const session = "11111111-1111-4111-8111-111111111111";
const loading = { status: "loading" as const }; const usage = { subscribe: () => () => {}, getSnapshot: () => loading, dispose() {}, refresh() {} };
async function mount(action: (data: FormData) => unknown, scope: string | null = binding, withMenu = true) {
  await act(async () => root.render(<LocaleProvider locale="en"><WorkspaceSessionBoundary binding={scope}>
    <div data-workspace-scope="account"><p>Private person and conversation body</p>{withMenu ? <WorkspaceAccountMenu accountName="Owner" workspaceName="Workspace" usageBinding={scope} usage={usage} signOutAction={action} /> : <p>Server recovery children</p>}</div>
  </WorkspaceSessionBoundary></LocaleProvider>));
}
async function submit() { await act(async () => host.querySelector<HTMLButtonElement>("[data-slot=account-trigger]")!.click()); await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
function seed() { writeConversationDraft(binding, session, { value: "Unsent original draft", writer: "tab", updatedAt: new Date().toISOString(), expiresAt: Date.now() + 60000 }); }
beforeEach(async () => {
  binding = (++sequence).toString(16).padStart(64, "0"); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); seed();
  await loadWorkspaceDirectory(binding, async () => ({ people: { people: [{ id: "private-person", display_label: "Private cache" }] }, sessions: { sessions: [] } }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; localStorage.clear(); sessionStorage.clear(); invalidateWorkspaceDirectory(undefined, "discard"); delete window.talentSignalDesktop; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each([false, true])("fences real private siblings and matching cache before failed confirmed navigation (%s)", async hosted => {
  if (hosted) window.talentSignalDesktop = { protocolVersion: 1, availableVersion: null };
  const destination = hosted ? "/login?callbackUrl=%2Fworkspace&intent=sign-out" : "/";
  const action = vi.fn().mockResolvedValue({ status: "signed_out", binding, redirectTo: destination });
  const replace = vi.spyOn(window.location, "replace").mockImplementation(() => {});
  vi.spyOn(window.location, "assign").mockImplementation(() => { expect(host.textContent).not.toContain("Private person"); throw new DOMException("blocked", "SecurityError"); });
  await mount(action); await submit();
  expect(host.textContent).not.toContain("Private person"); expect(document.querySelector("[data-slot=account-trigger]")).toBeNull();
  expect(readCachedWorkspaceDirectory(binding)).toBeNull(); expect(readConversationDraft(binding, session)).toBeNull();
  const link = host.querySelector<HTMLAnchorElement>("a")!; expect(link.getAttribute("href")).toBe(destination);
  expect(host.textContent).toContain("Local sign-out is confirmed"); expect(host.textContent).not.toContain("drafts are kept");
  await act(async () => window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT)));
  expect(host.querySelector("a")?.getAttribute("href")).toBe(destination); expect(replace).not.toHaveBeenCalled();
  link.addEventListener("click", event => event.preventDefault()); await act(async () => link.click()); expect(action).toHaveBeenCalledOnce();
});
it("keeps private context, cache and drafts on an ambiguous network failure", async () => {
  const action = vi.fn().mockRejectedValue(new TypeError("private transport detail")); await mount(action); await submit();
  expect(host.textContent).toContain("Private person and conversation body"); expect(readCachedWorkspaceDirectory(binding)).not.toBeNull();
  expect(readConversationDraft(binding, session)?.value).toBe("Unsent original draft"); expect(document.body.textContent).toContain("Sign-out could not be confirmed");
  expect(document.body.textContent).not.toContain("private transport detail");
});
it("does not lose completion if cookie revalidation unmounts the form into a null-scope boundary before resolution", async () => {
  window.talentSignalDesktop = { protocolVersion: 1, availableVersion: null };
  const destination = "/login?callbackUrl=%2Fworkspace&intent=sign-out";
  let finish!: (value: unknown) => void; const action = vi.fn<(data: FormData) => Promise<unknown>>(() => new Promise(resolve => { finish = resolve; }));
  vi.spyOn(window.location, "assign").mockImplementation(() => { throw new DOMException("blocked", "SecurityError"); });
  await mount(action); await submit();
  await act(async () => root.render(<p>Cookie revalidation transition</p>));
  await mount(action, null, false);
  await act(async () => finish({ status: "signed_out", binding, redirectTo: destination }));
  expect(host.textContent).toContain("Local sign-out is confirmed"); expect(host.textContent).not.toContain("Server recovery children"); expect(host.textContent).not.toContain("Private person");
  expect(readConversationDraft(binding, session)).toBeNull(); expect(host.querySelector("a")?.getAttribute("href")).toBe(destination);
});
it("rejects an old completion after another verified binding enters", async () => {
  let finish!: (value: unknown) => void; const action = vi.fn<(data: FormData) => Promise<unknown>>(() => new Promise(resolve => { finish = resolve; }));
  const navigate = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  await mount(action); await submit(); await mount(action, "f".repeat(64));
  await act(async () => finish({ status: "signed_out", binding, redirectTo: "/" }));
  expect(host.textContent).toContain("Private person"); expect(readConversationDraft(binding, session)?.value).toBe("Unsent original draft"); expect(navigate).not.toHaveBeenCalled();
});

it("does not revive A's old completion after a verified A to B to A transition", async () => {
  let finish!: (value: unknown) => void; const action = vi.fn<(data: FormData) => Promise<unknown>>(() => new Promise(resolve => { finish = resolve; }));
  const navigate = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  await mount(action); await submit(); await mount(action, "e".repeat(64)); await mount(action, binding);
  await act(async () => finish({ status: "signed_out", binding, redirectTo: "/" }));
  expect(host.textContent).toContain("Private person"); expect(readConversationDraft(binding, session)?.value).toBe("Unsent original draft"); expect(navigate).not.toHaveBeenCalled();
});
