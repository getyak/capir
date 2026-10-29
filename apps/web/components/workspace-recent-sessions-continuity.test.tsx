// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ pathname: "/workspace/sessions/11111111-1111-4111-8111-111111111111" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname, useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({ default: (props: ComponentProps<"a">) => <a {...props} /> }));

import { invalidateWorkspaceDirectory, readCachedWorkspaceDirectory } from "@/lib/workspace-directory-cache";
import { resetSessionOrganizationStores, sessionOrganizationStore } from "@/lib/workspace-session-organization";
import { WorkspaceDirectoryScope } from "./workspace-directory-cache";
import { LocaleProvider } from "./locale-provider";
import { WorkspaceRecentSessions } from "./workspace-recent-sessions";
import { workspaceSessionFetch, WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";
import { useWorkspaceDirectory } from "./workspace-search";

const SESSION = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const STORAGE_SCOPE = "a".repeat(64);
const admission = `/api/workspace-sessions/${SESSION}/conversation-queue`;
type Pending = { url: string; signal?: AbortSignal | null; resolve: (response: Response) => void; reject: (error: Error) => void };
let root: Root;
let host: HTMLDivElement;
let binding: string;
let hold: boolean;
let pending: Pending[];
let rows: ReturnType<typeof session>[];

function session(id = SESSION, title = "Synthetic conversation") {
  return { session_id: id, title, state: "active", expires_at: "2030-01-01T00:00:00Z", person_label: "", person_id: null, is_unread: false };
}
function response(url: string, value = rows, owner = binding) {
  return Response.json(url.includes("/people") ? { people: [{ id: "synthetic-private-person", display_label: "Synthetic private person" }] } : { session_version: owner, sessions: value });
}
function PeopleReadback({ owner }: { owner: string }) {
  const directory = useWorkspaceDirectory(owner, true);
  return <p data-directory-probe>{directory.data?.people.people?.map(person => String(person.display_label)).join(",")}</p>;
}
async function render(next = binding) {
  binding = next;
  host.dataset.workspaceScope = next;
  await act(async () => root.render(<LocaleProvider locale="en"><WorkspaceDirectoryScope binding={next}>
    <WorkspaceRecentSessions binding={next} storageScope={STORAGE_SCOPE} />
    <PeopleReadback owner={next} />
  </WorkspaceDirectoryScope></LocaleProvider>));
}
async function send() {
  hold = true;
  await act(async () => { await workspaceSessionFetch(admission, { method: "POST", body: "{}" }); });
}
async function settle(value = rows, status = 200, owner = binding) {
  const requests = pending.splice(0);
  await act(async () => requests.forEach(({ url, resolve }) => resolve(status === 200 ? response(url, value, owner) : Response.json({}, { status }))));
}
function link(id = SESSION) { return host.querySelector<HTMLAnchorElement>(`a[href="/workspace/sessions/${id}"]`); }
function loading() { return host.querySelector('[aria-label="Reading conversations"]'); }

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  localStorage.clear();
  resetSessionOrganizationStores();
  invalidateWorkspaceDirectory(undefined, "discard");
  binding = "account-a"; hold = false; pending = []; rows = [session()];
  navigation.pathname = `/workspace/sessions/${SESSION}`;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method && init.method !== "GET") return Promise.resolve(Response.json({ accepted: true }));
    if (hold) return new Promise<Response>((resolve, reject) => pending.push({ url, signal: init?.signal, resolve, reject }));
    return Promise.resolve(response(url));
  }));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); invalidateWorkspaceDirectory(undefined, "discard"); localStorage.clear();
  resetSessionOrganizationStores();
  vi.unstubAllGlobals();
});

it("keeps the same selected row, list, focus and local scroll through send admission and deferred readback", async () => {
  await render();
  await act(async () => sessionOrganizationStore(STORAGE_SCOPE).setFlag(SESSION, "pinned", true));
  const selected = link()!; const list = selected.closest("ul")!;
  selected.focus(); list.scrollTop = 36;
  await send();
  expect(pending).toHaveLength(2);
  expect(readCachedWorkspaceDirectory(binding), "send invalidates shared cache even while mounted rows remain").toBeNull();
  expect(link(), "successful send must not unmount existing navigation").toBe(selected);
  expect(selected.closest("ul")).toBe(list);
  expect(document.activeElement).toBe(selected);
  expect(list.scrollTop).toBe(36);
  expect(selected.getAttribute("aria-current")).toBe("page");
  expect(selected.getAttribute("aria-label")).toContain("Pinned");
  expect(loading()).toBeNull();
  await settle([session(SESSION, "Updated synthetic title"), session(OTHER, "External new conversation")]);
  expect(link()).toBe(selected);
  expect(selected.textContent).toContain("Updated synthetic title");
  expect(link(OTHER)).not.toBeNull();
  expect(host.querySelectorAll(`a[href="/workspace/sessions/${SESSION}"]`)).toHaveLength(1);
});

it("retains the authorized send snapshot through a transient read failure and explicit retry", async () => {
  await render(); const selected = link();
  await send(); await settle(rows, 503);
  expect(link()).toBe(selected);
  expect(host.textContent).toContain("Cannot read right now");
  const retry = [...host.querySelectorAll("button")].find(button => button.textContent === "Retry")!;
  await act(async () => retry.click());
  expect(link()).toBe(selected); expect(loading()).toBeNull();
  await settle();
  expect(link()).toBe(selected);
  expect(host.textContent).not.toContain("Cannot read right now");
});

it("keeps initial loading honest and accepts an authoritative empty send readback", async () => {
  hold = true; await render(); expect(loading()).not.toBeNull(); expect(link()).toBeNull();
  await settle(); expect(link()).not.toBeNull();
  await send(); expect(link()).not.toBeNull();
  await settle([]); expect(link()).toBeNull(); expect(loading()).toBeNull();
});

it.each(["delete", "withdraw", "expire", "discard", "unauthorized"])("clears retained rows immediately for %s and rejects the late send readback", async kind => {
  await render(); await send(); const oldRead = pending.splice(0);
  await act(async () => {
    if (kind === "delete") await workspaceSessionFetch(`/api/workspace-sessions/${SESSION}`, { method: "DELETE" });
    if (kind === "withdraw") await workspaceSessionFetch(`${admission}/mutations`, { method: "POST", body: JSON.stringify({ kind: "withdraw" }) });
    if (kind === "expire") window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT));
    if (kind === "discard") invalidateWorkspaceDirectory(undefined, "discard");
    if (kind === "unauthorized") await workspaceSessionFetch(admission, { method: "POST" }, async () => Response.json({}, { status: 401 }));
  });
  expect(link()).toBeNull();
  await act(async () => oldRead.forEach(({ url, resolve }) => resolve(response(url))));
  expect(link()).toBeNull();
});

it("hides the previous workspace during an identity switch even when its send readback arrives late", async () => {
  await render(); await send(); const oldRead = pending.splice(0);
  await render("account-b"); expect(link()).toBeNull();
  await act(async () => oldRead.forEach(({ url, resolve }) => resolve(response(url, rows, "account-a"))));
  expect(link()).toBeNull();
  await settle([session(OTHER, "Account B synthetic conversation")]);
  expect(link()).toBeNull(); expect(link(OTHER)?.textContent).toContain("Account B synthetic conversation");
});

it.each(["people", "sessions"])("discards both mounted projections as soon as the %s read denies access, before a sibling read finishes", async source => {
  await render(); expect(host.textContent).toContain("Synthetic private person"); expect(link()).not.toBeNull();
  const expired = vi.fn(); window.addEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expired);
  try {
    await send(); const reads = pending.splice(0);
    const denied = reads.find(read => read.url.includes("/people") === (source === "people"))!;
    const late = reads.find(read => read !== denied)!;
    await act(async () => denied.resolve(Response.json({}, { status: 403 })));
    expect(link()).toBeNull(); expect(host.textContent).not.toContain("Synthetic private person");
    expect(readCachedWorkspaceDirectory(binding)).toBeNull(); expect(expired).not.toHaveBeenCalled();
    await act(async () => late.resolve(response(late.url)));
    expect(link()).toBeNull(); expect(host.textContent).not.toContain("Synthetic private person");
  } finally { window.removeEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expired); }
});

it("discards a credential-mismatched refresh for every reader and fences an older delayed body", async () => {
  await render(); await send(); const oldRead = pending.splice(0);
  let decode!: (value: unknown) => void;
  const body = new Promise<unknown>(resolve => { decode = resolve; });
  await act(async () => oldRead.forEach(({ url, resolve }) => {
    const result = response(url);
    if (!url.includes("/people")) Object.defineProperty(result, "json", { value: () => body });
    resolve(result);
  }));
  await send(); await settle(rows, 200, "different-credential");
  expect(link()).toBeNull(); expect(host.textContent).not.toContain("Synthetic private person");
  expect(readCachedWorkspaceDirectory(binding)).toBeNull();
  await act(async () => decode({ session_version: binding, sessions: rows }));
  expect(link()).toBeNull(); expect(host.textContent).not.toContain("Synthetic private person");
});

it("retracts every reader immediately when the decoded session binding mismatches while the people body hangs", async () => {
  await render(); await send(); const reads = pending.splice(0);
  await act(async () => reads.forEach(({ url, resolve }) => {
    const result = response(url, rows, "different-credential");
    if (url.includes("/people")) Object.defineProperty(result, "json", { value: () => new Promise(() => {}) });
    resolve(result);
  }));
  expect(link(), "known authority loss must not wait for the sibling body or its timeout").toBeNull();
  expect(host.textContent).not.toContain("Synthetic private person");
  expect(readCachedWorkspaceDirectory(binding)).toBeNull();
});

it.each(["503", "network"])("aborts the sibling after an early %s and fences its late body while a replacement read retains fresh authority", async failure => {
  await render(); await send(); const reads = pending.splice(0);
  const people = reads.find(read => read.url.includes("/people"))!;
  const sessions = reads.find(read => !read.url.includes("/people"))!;
  let lateBody!: (value: unknown) => void;
  const body = new Promise<unknown>(resolve => { lateBody = resolve; });
  const delayed = response(sessions.url); Object.defineProperty(delayed, "json", { value: () => body });
  await act(async () => sessions.resolve(delayed));
  await act(async () => failure === "503" ? people.resolve(Response.json({}, { status: 503 })) : people.reject(new TypeError("Synthetic network interruption")));
  expect(sessions.signal?.aborted).toBe(true);
  expect(link()).not.toBeNull(); expect(host.textContent).toContain("Synthetic private person");
  const retry = [...host.querySelectorAll("button")].find(button => button.textContent === "Retry")!;
  await act(async () => retry.click()); const replacement = pending.splice(0);
  expect(replacement).toHaveLength(2);
  await act(async () => lateBody({ session_version: "obsolete-mismatched-credential", sessions: rows }));
  expect(replacement.every(read => !read.signal?.aborted)).toBe(true);
  await act(async () => replacement.forEach(read => read.resolve(response(read.url, [session(SESSION, "Fresh authorized title")]))));
  expect(link()?.textContent).toContain("Fresh authorized title");
  expect(readCachedWorkspaceDirectory(binding)).not.toBeNull();
  // The cancelled source cannot revoke a replacement, but a fresh source's
  // actual denial must still retract both projections immediately.
  await send(); const denied = pending.splice(0);
  const source = denied.find(read => read.url.includes("/people") === (failure === "503"))!;
  await act(async () => source.resolve(failure === "503" ? Response.json({}, { status: 403 }) : response(source.url, rows, "new-mismatched-credential")));
  expect(link()).toBeNull(); expect(host.textContent).not.toContain("Synthetic private person");
  expect(readCachedWorkspaceDirectory(binding)).toBeNull();
  await act(async () => denied.filter(read => read !== source).forEach(read => read.resolve(response(read.url))));
  expect(link()).toBeNull();
});


it("keeps the row and focus through a successful title mutation and directory readback", async () => {
  await render(); const selected = link()!; selected.focus(); hold = true;
  await act(async () => { await workspaceSessionFetch(`/api/workspace-sessions/${SESSION}`, { method: "PATCH", body: "{}" }); });
  expect(link()).toBe(selected);
  expect(document.activeElement).toBe(selected);
  await settle([session(SESSION, "Renamed synthetic title")]);
  expect(link()).toBe(selected);
  expect(selected.textContent).toContain("Renamed synthetic title");
  expect(document.activeElement).toBe(selected);
});
