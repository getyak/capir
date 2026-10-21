// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { timeFixtureActivity } from "@/lib/test/time-fixtures";
const route = vi.hoisted(() => ({ pathname: "/workspace/meetings", search: "day=2026-09-21&tz=UTC" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname, useSearchParams: () => new URLSearchParams(route.search), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("./workspace-composer", () => ({ WorkspaceComposer: () => null }));
vi.mock("./conversation/use-conversation", () => ({ useConversation: ({ initial }: { initial: { state: string; title: string } }) => ({
  ready: true, unavailable: initial.state !== "active", messages: [], attachments: [], draft: "", detail: initial,
  preview: null, connection: "connected", error: null, entryCapability: null, preparing: false, submitting: false, mutating: false,
  handoffEntries: {}, handoffPreviews: {}, runOutcome: {}, readbackStalled: [], snapshot: null,
  submit: vi.fn(), mutate: vi.fn(), addFiles: vi.fn(), removeAttachment: vi.fn(), changeDraft: vi.fn(),
}) }));
// Models Link's documented onNavigate boundary; live browser acceptance must
// additionally prove the actual compiled App Router Link path.
vi.mock("next/link", () => ({ default: ({ href, onNavigate, children, ...props }: ComponentProps<"a"> & { href: string; onNavigate?: () => void }) => <a {...props} href={href} onClick={event => {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.currentTarget.target === "_blank") return;
  onNavigate?.(); window.history.pushState(null, "", href); route.pathname = new URL(window.location.href).pathname; route.search = "";
}}>{children}</a> }));
import { WorkspaceNavigationContinuityProvider } from "./workspace-navigation-continuity";
import { TimeReadOnlyInspector } from "./time-read-only-inspector";
import { SessionSourceHeading } from "./session-source-heading";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";
import { QueuedConversation } from "./conversation/queued-conversation";
import type { SessionDetail } from "./session-workbench/session-detail-state";
const SESSION = timeFixtureActivity.source_id;
const activity = { ...timeFixtureActivity, id: `session_activity:${SESSION}:2026-09-21`, kind: "session_activity" as const, title: "Synthetic source", status: "recorded" as const };
const detail: SessionDetail = {
  session_id: SESSION, revision: 1, updated_at: "2026-09-21T00:00:00.000Z", expires_at: "2099-01-01T00:00:00.000Z",
  state: "active", title: "Synthetic source", turn_count: 0, is_unread: false, scope_kind: "unresolved_intent", person_id: null,
  relationship_context_id: null, person_label: "", context_label: "", deleted_at: null, display_authority: "stale_unconfirmed",
  composer_draft: null, composer_draft_updated_at: null, turns: [],
};
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); route.pathname = "/workspace/meetings"; route.search = "day=2026-09-21&tz=UTC";
  window.history.replaceState(null, "", `${route.pathname}?${route.search}`);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render({ binding = "a", scope = "a".repeat(64), loading = false, ready = true, publisher = binding, sessionId = SESSION, terminal }: { binding?: string; scope?: string; loading?: boolean; ready?: boolean; publisher?: string; sessionId?: string; terminal?: SessionDetail["state"] } = {}) {
  await act(async () => root.render(<WorkspaceNavigationContinuityProvider scope={scope} binding={binding}>
    {route.pathname === "/workspace/meetings" ? <TimeReadOnlyInspector binding={publisher} activity={activity} loading={false} error={null} complete navigationNotice="" zone="UTC" onClose={() => {}} onRetry={() => {}} onPersonTimeline={() => {}} /> : loading ? <h1>Loading placeholder</h1> : terminal ? <QueuedConversation initialDetail={{...detail,state:terminal}} scope={scope} chatBinding="chat" detailBinding={binding}/> : <><SessionSourceHeading binding={binding} sessionId={sessionId} ready={ready}>Synthetic source</SessionSourceHeading><input aria-label="Retained draft" /></>}
  </WorkspaceNavigationContinuityProvider>));
}
async function source() { await act(async () => host.querySelector<HTMLAnchorElement>("a")!.click()); }
async function flush() { await act(async () => new Promise(resolve => setTimeout(resolve, 20))); }
it("hands a normal source Link to the final ready heading once and preserves scroll", async () => {
  await render(); await source(); await render({ loading: true }); await flush();
  expect(document.activeElement).toBe(document.body);
  await render(); const heading = host.querySelector("h1")!, focus = vi.spyOn(heading, "focus"); await flush();
  expect(document.activeElement).toBe(heading); expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  await render(); await flush(); expect(focus).toHaveBeenCalledTimes(1);
});
it.each(["deleted", "expired", "unavailable"] as const)("hands off to the actual Queued terminal %s title", async terminal => {
  await render(); await source(); await render({ terminal }); await flush();
  expect(host.textContent).toContain("这段对话已结束或登录状态发生变化");
  expect(document.activeElement).toBe(host.querySelector("h1"));
});
it("waits for conversation readiness and yields permanently to restored draft focus", async () => {
  await render(); await source(); await render({ ready: false }); await flush();
  expect(document.activeElement).toBe(document.body);
  host.querySelector("input")!.focus(); await render(); await flush();
  expect(document.activeElement).toBe(host.querySelector("input"));
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  await render({ ready: false }); await render(); await flush();
  expect(document.activeElement).toBe(document.body);
});
it("does not focus a Session reached without the source producer", async () => {
  route.pathname = `/workspace/sessions/${SESSION}`; route.search = ""; window.history.replaceState(null, "", route.pathname);
  await render(); await flush(); expect(document.activeElement).toBe(document.body);
});
it.each(["binding", "scope", "publisher"])("rejects an account %s mismatch", async kind => {
  await render({ publisher: kind === "publisher" ? "stale" : "a" }); await source();
  await render(kind === "binding" ? { binding: "b" } : kind === "scope" ? { scope: "b".repeat(64) } : {});
  await flush(); expect(document.activeElement).toBe(document.body);
});
it.each(["popstate", WORKSPACE_SESSION_EXPIRED_EVENT])("cancels on %s before a ready target", async type => {
  await render(); await source(); await render({ ready: false });
  await act(async () => window.dispatchEvent(new Event(type)));
  await render(); await flush(); expect(document.activeElement).toBe(document.body);
});
it("does not recreate a source intent after expiry even on the same mounted account", async () => {
  await render(); await act(async () => window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT)));
  await source(); await render(); await flush(); expect(document.activeElement).toBe(document.body);
});
it("drops a delayed request after its bounded lifetime", async () => {
  const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now);
  await render(); await source(); await render({ ready: false });
  vi.mocked(Date.now).mockReturnValue(now + 30_001);
  await render(); await flush(); expect(document.activeElement).toBe(document.body);
});
it("does not consume for a different Session or an extra URL query", async () => {
  await render(); await source(); await render({ sessionId: "11111111-1111-4111-8111-111111111111" }); await flush();
  expect(document.activeElement).toBe(document.body);
  route.search = "other=1"; window.history.replaceState(null, "", `${route.pathname}?${route.search}`);
  await render(); await flush(); expect(document.activeElement).toBe(document.body);
  route.search = ""; window.history.replaceState(null, "", route.pathname);
  await render(); await flush(); expect(document.activeElement).toBe(document.body);
});
it.each([{ctrlKey:true}, {metaKey:true}, {shiftKey:true}, {altKey:true}])("does not publish for a modified click %j", async modifiers => {
  await render(); await act(async () => host.querySelector("a")!.dispatchEvent(new MouseEvent("click", {bubbles:true,cancelable:true,...modifiers})));
  route.pathname = `/workspace/sessions/${SESSION}`; route.search = ""; window.history.pushState(null, "", route.pathname);
  await render(); await flush(); expect(document.activeElement).toBe(document.body);
});
it("does not publish for a new-tab link", async () => {
  await render(); host.querySelector("a")!.target = "_blank"; await source();
  route.pathname = `/workspace/sessions/${SESSION}`; route.search = ""; window.history.pushState(null, "", route.pathname);
  await render(); await flush(); expect(document.activeElement).toBe(document.body);
});
it("yields to a control focused after commit but before its deferred focus", async () => {
  await render(); await source(); vi.useFakeTimers();
  await render(); host.querySelector("input")!.focus();
  await act(async () => vi.runOnlyPendingTimers()); vi.useRealTimers();
  expect(document.activeElement).toBe(host.querySelector("input"));
});
it("cancels a deferred focus on unmount", async () => {
  await render(); await source(); vi.useFakeTimers(); await render();
  const heading = host.querySelector("h1")!, focus = vi.spyOn(heading, "focus");
  await act(async () => root.render(null)); await act(async () => vi.runOnlyPendingTimers()); vi.useRealTimers();
  expect(focus).not.toHaveBeenCalled();
});
it("drops the old request after a newer ordinary navigation even when that navigation is blocked", async () => {
  await render(); await source(); await render({ ready: false });
  const link = document.createElement("a"); link.href = "/workspace/people"; link.onclick = event => event.preventDefault(); document.body.append(link);
  await act(async () => link.click()); link.remove();
  await render(); await flush(); expect(document.activeElement).toBe(document.body);
});
it("ignores an unparseable link without breaking the workspace click boundary", async () => {
  await render(); const errors = vi.fn(); window.addEventListener("error", errors);
  const link = document.createElement("a"); link.href = "http://["; link.onclick = event => event.preventDefault(); document.body.append(link);
  try {
    await act(async () => link.click()); expect(errors).not.toHaveBeenCalled();
    await source(); await render(); await flush(); expect(document.activeElement).toBe(host.querySelector("h1"));
  } finally { link.remove(); window.removeEventListener("error", errors); }
});
