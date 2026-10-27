// @vitest-environment happy-dom
import { act, Component, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { writeConversationDraft, readConversationDraft } from "@/lib/conversation-local";
import { WorkspaceAccountMenu } from "./workspace-account-menu";
import { LocaleProvider } from "./locale-provider";
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }; static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p>Unhandled action error</p> : this.props.children; }
}
let sequence = 1000;
let binding = "a".repeat(64); const otherBinding = "b".repeat(64);
const session = "11111111-1111-4111-8111-111111111111";
let root: Root; let host: HTMLDivElement;
const loading = { status: "loading" as const };
const usage = { subscribe: () => () => {}, getSnapshot: () => loading, dispose() {}, refresh() {} };
function seed() {
  writeConversationDraft(binding, session, { value: "Unsent original draft", writer: "tab", updatedAt: new Date().toISOString(), expiresAt: Date.now() + 60000 });
  sessionStorage.setItem("talent-signal:meeting-draft-pending:v1:original", "original meeting intent");
  localStorage.setItem("talent-signal:workspace-session-organization:v1:" + binding, "original organization");
  sessionStorage.setItem("talent-signal:time-edit:" + binding, "original time intent");
}
async function mount(action: (data: FormData) => unknown, scope = binding) {
  await act(async () => root.render(<Boundary><LocaleProvider locale="en"><WorkspaceAccountMenu accountName="Owner" workspaceName="Workspace" usageBinding={scope} signOutAction={action} usage={usage} /></LocaleProvider></Boundary>));
}
async function open() { await act(async () => host.querySelector<HTMLButtonElement>("[data-slot=account-trigger]")!.click()); }
async function submit() { await act(async () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
function expectKept() {
  expect(readConversationDraft(binding, session)?.value).toBe("Unsent original draft");
  expect(sessionStorage.getItem("talent-signal:meeting-draft-pending:v1:original")).toBe("original meeting intent");
  expect(localStorage.getItem("talent-signal:workspace-session-organization:v1:" + binding)).toBe("original organization");
  expect(sessionStorage.getItem("talent-signal:time-edit:" + binding)).toBe("original time intent");
}
beforeEach(() => { binding = (++sequence).toString(16).padStart(64, "0"); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.spyOn(console, "error").mockImplementation(() => {}); host = document.createElement("div"); document.body.append(host); root = createRoot(host); seed(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete window.talentSignalDesktop; document.body.innerHTML = ""; localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("preserves every local intent when a deployed action is missing and offers only user-initiated reload", async () => {
  const action = vi.fn().mockRejectedValue(new UnrecognizedActionError("missing action")); const reload = vi.spyOn(window.location, "reload").mockImplementation(() => {});
  await mount(action); await open(); await submit(); expectKept();
  expect(action).toHaveBeenCalledTimes(1); expect(document.body.textContent).not.toContain("Unhandled action error");
  expect(document.querySelector('[role=alert]')?.textContent).toContain("This page was updated. Reload it, then choose Sign out again. Your local drafts are kept.");
  expect(reload).not.toHaveBeenCalled();
  const button = [...document.querySelectorAll("button")].find(node => node.textContent === "Reload page")!;
  await act(async () => button.click()); expect(reload).toHaveBeenCalledOnce(); expect(action).toHaveBeenCalledTimes(1); expectKept();
});
it.each([new Error("private error must not leak"), undefined, { status: "signed_out", binding, redirectTo: "https://foreign.invalid" }, { status: "signed_out", binding: otherBinding, redirectTo: "/" }])("preserves drafts when outcome cannot be confirmed: %j", async result => {
  const action = vi.fn().mockImplementation(async () => { if (result instanceof Error) throw result; return result; });
  await mount(action); await open(); await submit(); expectKept(); expect(action).toHaveBeenCalledOnce();
  expect(document.querySelector('[role=alert]')?.textContent).toContain("Sign-out could not be confirmed.");
  expect(document.body.textContent).not.toContain("private error must not leak");
});
it("cleans the existing local stores only after a matching confirmed receipt and uses the fixed destination", async () => {
  let finish!: (value: unknown) => void; const action = vi.fn<(data: FormData) => Promise<unknown>>(() => new Promise(resolve => { finish = resolve; })); const navigate = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  await mount(action); await open(); await submit(); expectKept();
  expect((action.mock.calls[0]![0] as FormData).get("workspaceBinding")).toBe(binding);
  await act(async () => finish({ status: "signed_out", binding, redirectTo: "/" }));
  expect(readConversationDraft(binding, session)).toBeNull(); expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0); expect(navigate).toHaveBeenCalledWith("/");
});
it("does not clear or navigate for an old receipt after the rendered account changes", async () => {
  let finish!: (value: unknown) => void; const action = vi.fn<(data: FormData) => Promise<unknown>>(() => new Promise(resolve => { finish = resolve; })); const navigate = vi.spyOn(window.location, "assign").mockImplementation(() => {});
  await mount(action); await open(); await submit(); await mount(action, otherBinding);
  await act(async () => finish({ status: "signed_out", binding, redirectTo: "/" })); expectKept(); expect(navigate).not.toHaveBeenCalled();
});

it.each([false, true])("uses truthful local-signout recovery after navigation throws, with no POST replay (%s)", async hosted => {
  if (hosted) window.talentSignalDesktop = { protocolVersion: 1, availableVersion: null };
  const destination = hosted ? "/login?callbackUrl=%2Fworkspace&intent=sign-out" : "/";
  const action = vi.fn().mockResolvedValue({ status: "signed_out", binding, redirectTo: destination });
  vi.spyOn(window.location, "assign").mockImplementation(() => { throw new DOMException("Navigation blocked", "SecurityError"); });
  await mount(action); await open(); await submit();
  expect(readConversationDraft(binding, session)).toBeNull(); expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
  const alert = document.querySelector('[role=alert]')!;
  expect(alert.textContent).toContain("Local sign-out is confirmed. Local cleanup or navigation did not finish.");
  expect(alert.textContent).not.toContain("drafts are kept");
  const link = alert.querySelector<HTMLAnchorElement>("a")!;
  expect(link.getAttribute("href")).toBe(destination);
  link.addEventListener("click", event => event.preventDefault());
  await act(async () => link.click());
  await submit(); expect(action).toHaveBeenCalledTimes(1);
  expect(document.querySelector<HTMLButtonElement>('form button[type="submit"]')?.disabled).toBe(true);
});

it("does not claim an identity change when the current workspace could not be verified", async () => {
  const action = vi.fn().mockResolvedValue({ status: "scope_changed" });
  await mount(action); await open(); await submit(); expectKept();
  expect(document.querySelector('[role=alert]')?.textContent).toContain("The current signed-in workspace could not be verified. This sign-out request was not executed.");
  expect(document.querySelector('[role=alert]')?.textContent).not.toContain("workspace changed");
});
