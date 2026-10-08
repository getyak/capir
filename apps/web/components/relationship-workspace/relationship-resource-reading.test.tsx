// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CONTRACT_VERSION, type RelationshipResourceDetail, type RelationshipResourceListItem } from "@talent-signal/contracts";
const fetcher = vi.hoisted(() => vi.fn());
vi.mock("@/components/workspace-session-request", () => ({
  relationshipIntegrationFetch: fetcher,
  relationshipIntegrationSessionExpired: () => false,
}));
import { RelationshipResourceComposer } from "./relationship-resource-composer";
const items: RelationshipResourceListItem[] = ["a", "b"].map((id) => ({
  id, capture_id: `capture-${id}`, capture_version: 1, kind: "personal_note",
  input_channel: "chat", display_name: `Source ${id}`, media_type: "text/plain", source_locator: null,
  observed_at: "2026-10-08T08:00:00Z", processing_state: "ready", duplicate_of_resource_id: null,
  discovered_from_resource_id: null, fragment_count: 0, proposed_fragment_count: 0,
  pending_claim_count: 0, conflicted_claim_count: 0, source_access_state: "available",
  source_authorization_state: "authorized", source_authorization_expires_at: null,
}));
const detail = (id: string): RelationshipResourceDetail => ({ contract_version: CONTRACT_VERSION, resource: items.find((x) => x.id === id)!, fragments: [], claim_proposals: [] });
const deferred = () => { let resolve!: (r: Response) => void; const promise = new Promise<Response>((r) => { resolve = r; }); return {promise, resolve}; };
let root: Root, host: HTMLDivElement;
const props = { personId: "person-a", relationshipContextId: "context-a", scopeLabel: "Owned test relationship", onCommitted: vi.fn(), onEvidenceChanged: vi.fn(), onIdentityCorrected: vi.fn(), onReviewCapture: vi.fn(), onScreenshot: vi.fn() };
const title = () => host.querySelector<HTMLHeadingElement>(".context-resource-review h3");
const button = (id: string) => host.querySelectorAll<HTMLButtonElement>(".context-resource-ledger__list > button")[id === "a" ? 0 : 1];
async function activate(id: string) { const n = button(id); n.focus(); await act(async () => n.dispatchEvent(new MouseEvent("click", {bubbles:true}))); return n; }
beforeEach(async () => {
  (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  fetcher.mockReset(); fetcher.mockImplementation(async (url: string) => Response.json(url.includes("resource_id=") ? detail(new URL(url, "http://local").searchParams.get("resource_id")!) : {resources:items}));
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(createElement(RelationshipResourceComposer, props)));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it("moves explicit source activation to its loaded heading, then restores the same list entry on close", async () => {
  const trigger = await activate("a"); expect(title()?.textContent).toContain("Source a"); expect(document.activeElement).toBe(title());
  const close = host.querySelector<HTMLButtonElement>('[aria-label="关闭依据审阅"]')!;
  await act(async () => close.dispatchEvent(new MouseEvent("click", {bubbles:true})));
  expect(title()).toBeNull(); expect(document.activeElement).toBe(trigger);
});
it("keeps the user's new control focused when an earlier read completes", async () => {
  const pending = deferred(); fetcher.mockImplementation(() => pending.promise); await activate("a");
  const note = host.querySelector<HTMLTextAreaElement>("textarea")!; note.focus();
  await act(async () => pending.resolve(Response.json(detail("a"))));
  expect(title()?.textContent).toContain("Source a"); expect(document.activeElement).toBe(note);
  expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
});
it("keeps the latest source when reads complete out of order", async () => {
  const a = deferred(), b = deferred(); fetcher.mockImplementation((url: string) => url.endsWith("=a") ? a.promise : b.promise);
  await activate("a"); await activate("b"); await act(async () => b.resolve(Response.json(detail("b"))));
  await act(async () => a.resolve(Response.json(detail("a"))));
  expect(title()?.textContent).toContain("Source b"); expect(document.activeElement).toBe(title());
});
it("retains the trigger on failure and allows a real retry", async () => {
  fetcher.mockResolvedValueOnce(Response.json({message:"Read unavailable"}, {status:503})); const trigger = await activate("a");
  expect(title()).toBeNull(); expect(document.activeElement).toBe(trigger); expect(host.textContent).toContain("Read unavailable");
  await activate("a"); expect(title()?.textContent).toContain("Source a"); expect(document.activeElement).toBe(title());
});
it("does not reopen a closed review when a pending second read returns", async () => {
  await activate("a"); const pending = deferred(); fetcher.mockImplementation(() => pending.promise); await activate("b");
  const close = host.querySelector<HTMLButtonElement>('[aria-label="关闭依据审阅"]')!;
  await act(async () => close.dispatchEvent(new MouseEvent("click", {bubbles:true})));
  await act(async () => pending.resolve(Response.json(detail("b")))); expect(title()).toBeNull();
});
it("ignores an obsolete read failure after a newer source succeeds", async () => {
  const a = deferred(), b = deferred(); fetcher.mockImplementation((url: string) => url.endsWith("=a") ? a.promise : b.promise);
  await activate("a"); await activate("b"); await act(async () => b.resolve(Response.json(detail("b"))));
  await act(async () => a.resolve(Response.json({message:"Obsolete failure"}, {status:503})));
  expect(title()?.textContent).toContain("Source b"); expect(host.textContent).not.toContain("Obsolete failure");
});
it("does not apply an in-flight response after the relationship changes", async () => {
  const pending = deferred(); fetcher.mockImplementation((url: string) => url.includes("resource_id=") ? pending.promise : Promise.resolve(Response.json({resources:items})));
  await activate("a"); await act(async () => root.render(createElement(RelationshipResourceComposer, {...props, relationshipContextId:"context-b"})));
  await act(async () => pending.resolve(Response.json(detail("a")))); expect(title()).toBeNull();
});

it("does not apply obsolete public-source research errors or leave the new source busy", async () => {
  const pending = deferred();
  fetcher.mockImplementation((url: string) => {
    if (url.includes("/research?")) return pending.promise;
    const id = new URL(url, "http://local").searchParams.get("resource_id")!;
    const value = detail(id);
    return Promise.resolve(Response.json(id === "a" ? {...value, resource: {...value.resource, kind: "public_url", source_locator: "https://example.invalid/source"}} : value));
  });
  await activate("a"); await activate("b");
  await act(async () => pending.resolve(Response.json({message:"Obsolete public-source status"}, {status:503})));
  expect(title()?.textContent).toContain("Source b");
  expect(host.textContent).not.toContain("Obsolete public-source status");
  expect(host.querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(false);
});
