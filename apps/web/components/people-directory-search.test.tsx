// @vitest-environment happy-dom
import { act, startTransition, useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

// Node's next/form entry is the Pages implementation. Exercise the same real
// App Router Form branch that Next aliases into this application.
vi.mock("next/dist/esm/client/components/links", () => ({ mountFormInstance() {}, unmountPrefetchableInstance() {} }));
vi.mock("next/dist/esm/shared/lib/app-router-context.shared-runtime", async () => import("next/dist/shared/lib/app-router-context.shared-runtime"));
vi.mock("next/form", async () => vi.importActual<{ default: typeof import("next/form").default }>("next/dist/esm/client/app-dir/form"));
// Link's full navigation owns the Next Flight cache and is verified in the
// real browser. This boundary adapter retains its onNavigate/focus contract.
vi.mock("next/link", async () => {
  const React = await import("react");
  const { AppRouterContext: Context } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  function LinkAdapter({ href, onNavigate, children, ref, prefetch: _prefetch, scroll: _scroll, ...props }: {
    href: string; onNavigate?: (event: { preventDefault(): void }) => void; children: React.ReactNode;
    ref?: React.Ref<HTMLAnchorElement>; prefetch?: boolean; scroll?: boolean;
  }) {
    void _prefetch; void _scroll;
    const router = React.useContext(Context);
    return <a {...props} ref={ref} href={href} onClick={event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      let cancelled = false;
      onNavigate?.({ preventDefault() { cancelled = true; } });
      if (!cancelled) router?.push(href);
    }}>{children}</a>;
  }
  return { default: LinkAdapter };
});
vi.mock("next/navigation", () => ({ usePathname: () => "/workspace/people" }));
import { PeopleDirectoryApp } from "./people-directory-app";

const returnSession = "33333333-3333-4333-8333-333333333333";
let root: Root;
let host: HTMLDivElement;
let restore!: (query: string) => void;
let navigations: { query: string; href: string; finish: () => void }[];

function Harness({ initial = "" }: { initial?: string }) {
  const [page, setPage] = useState({ query: initial, people: [], error: null });
  useLayoutEffect(() => { restore = query => setPage({ query, people: [], error: null }); }, []);
  const [router] = useState<AppRouterInstance>(() => ({
    bfcacheId: "people-directory-harness",
    push(href: string) {
      const url = new URL(href, window.location.origin);
      const query = url.searchParams.get("query") ?? "";
      let finish!: () => void;
      const response = new Promise<void>(resolve => { finish = resolve; });
      navigations.push({ query, href, finish });
      startTransition(async () => {
        await response;
        setPage({ query, people: [], error: null });
      });
    },
    replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {},
  }));
  return <AppRouterContext.Provider value={router}>
    <PeopleDirectoryApp {...page} returnSessionId={returnSession} sessionRecoveryHref={null} />
    <button data-outside>Outside search</button>
  </AppRouterContext.Provider>;
}
function input() { return host.querySelector<HTMLInputElement>('input[name="query"]')!; }
function submit() { return host.querySelector<HTMLButtonElement>('button[type="submit"]')!; }
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function send() {
  await act(async () => input().form!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: submit() })));
}
async function finish(index = navigations.length - 1) { await act(async () => navigations[index]!.finish()); }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/workspace/people");
  navigations = [];
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  for (const operation of navigations) operation.finish();
  await act(async () => root.unmount());
  host.remove(); vi.unstubAllGlobals();
});
async function mount(initial = "") { await act(async () => root.render(<Harness initial={initial} />)); }

it("keeps the actual input and a newer draft when a submitted query finishes late", async () => {
  await mount();
  const field = input();
  await act(async () => field.focus());
  await type("林"); await send();
  expect(submit().getAttribute("aria-busy")).toBe("true");
  await type("林岚的新条件"); await finish();
  expect(input()).toBe(field);
  expect(input().value).toBe("林岚的新条件");
  expect(document.activeElement).toBe(field);
  expect(host.querySelector("[data-results-query]")?.textContent).toContain("林");
  expect(submit().getAttribute("aria-busy")).toBe("false");
  expect(new URL(navigations[0]!.href, window.location.origin).searchParams.get("session")).toBe(returnSession);
});

it("shows real App Form pending and lets a second search own the new draft", async () => {
  await mount();
  await type("first"); await send();
  expect(submit().getAttribute("aria-busy")).toBe("true");
  await type("second"); await send();
  expect(navigations.map(operation => operation.query)).toEqual(["first", "second"]);
  await finish(0);
  expect(input().value).toBe("second");
  await finish(1);
  expect(input().value).toBe("second");
  expect(host.querySelector("[data-results-query]")?.textContent).toContain("second");
  expect(submit().getAttribute("aria-busy")).toBe("false");
});

it("restores committed Back/Forward queries through the same input node", async () => {
  await mount("first"); const field = input();
  await type("unsent");
  await act(async () => restore("previous"));
  expect(input()).toBe(field); expect(input().value).toBe("previous");
  await act(async () => restore("first"));
  expect(input()).toBe(field); expect(input().value).toBe("first");
});

it.each(["", "first"])("keeps an unsent draft when only the results for %j refresh", async query => {
  await mount(query);
  const field = input();
  await act(async () => field.focus());
  await type("unsent draft");
  // The query stays committed; only the server's result-array identity changes.
  await act(async () => restore(query));
  expect(input()).toBe(field);
  expect(input().value).toBe("unsent draft");
  expect(document.activeElement).toBe(field);
});

it("keeps a newer draft through later refreshes after its older search completed", async () => {
  await mount();
  await type("first"); await send();
  await type("newer unsent draft"); await finish();
  expect(input().value).toBe("newer unsent draft");
  await act(async () => restore("first"));
  await act(async () => restore("first"));
  expect(input().value).toBe("newer unsent draft");
  expect(host.querySelector("[data-results-query]")?.textContent).toContain("first");
});

it("settles a repeated submitted query and clears its receipt before history navigation", async () => {
  await mount("first");
  await send(); await finish();
  expect(input().value).toBe("first");
  expect(submit().getAttribute("aria-busy")).toBe("false");
  await type("unsent");
  await act(async () => restore("previous"));
  expect(input().value).toBe("previous");
  await act(async () => restore("first"));
  expect(input().value).toBe("first");
});

it.each(["search", "clear"])("keeps the pending %s receipt when the older committed results refresh", async action => {
  await mount("first");
  if (action === "search") { await type("next"); await send(); }
  else {
    const clear = host.querySelector<HTMLAnchorElement>('a[aria-label="清除人物搜索"]')!;
    await act(async () => { clear.focus(); clear.click(); });
  }
  await type("newer unsent draft");
  await act(async () => restore("first"));
  expect(input().value).toBe("newer unsent draft");
  await finish();
  expect(input().value).toBe("newer unsent draft");
});

it("does not navigate or enable mouse Search while IME text is provisional", async () => {
  await mount();
  await act(async () => input().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  await type("候选");
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true }));
    input().form!.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: submit() }));
    submit().click();
  });
  expect(submit().disabled).toBe(true); expect(navigations).toHaveLength(0);
  await act(async () => input().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  await act(async () => input().dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true })));
  await send(); expect(navigations).toHaveLength(1);
  await finish();
});

it.each(["top", "empty"])("returns keyboard focus after %s clear without changing the return Session", async location => {
  await mount("missing");
  const links = [...host.querySelectorAll<HTMLAnchorElement>("a")];
  const clear = location === "top" ? links.find(link => link.getAttribute("aria-label") === "清除人物搜索")!
    : links.find(link => link.textContent === "清除搜索")!;
  await act(async () => { clear.focus(); clear.click(); });
  await finish();
  expect(input().value).toBe(""); expect(document.activeElement).toBe(input());
  expect(new URL(navigations[0]!.href, window.location.origin).searchParams.get("session")).toBe(returnSession);
});

it("does not steal focus when the user moves elsewhere during a slow clear", async () => {
  await mount("missing");
  const clear = [...host.querySelectorAll<HTMLAnchorElement>("a")].find(link => link.textContent === "清除搜索")!;
  await act(async () => { clear.focus(); clear.click(); });
  const outside = host.querySelector<HTMLButtonElement>("[data-outside]")!;
  await act(async () => { outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); outside.focus(); });
  await finish();
  expect(document.activeElement).toBe(outside);
});

it("preserves a deliberate move to another search control during a slow clear", async () => {
  await mount("missing");
  const clear = host.querySelector<HTMLAnchorElement>('a[aria-label="清除人物搜索"]')!;
  await act(async () => { clear.focus(); clear.click(); submit().focus(); });
  await finish();
  expect(document.activeElement).toBe(submit());
});

it("keeps a newer unsent draft when clearing an older committed search finishes", async () => {
  await mount("missing");
  const clear = [...host.querySelectorAll<HTMLAnchorElement>("a")].find(link => link.textContent === "清除搜索")!;
  await act(async () => { clear.focus(); clear.click(); input().focus(); });
  await type("A new search draft"); await finish();
  expect(input().value).toBe("A new search draft");
  expect(document.activeElement).toBe(input());
  await act(async () => restore(""));
  expect(input().value).toBe("A new search draft");
});

it("does not reclaim focus after an intentional move to nonfocusable space", async () => {
  await mount("missing");
  const clear = [...host.querySelectorAll<HTMLAnchorElement>("a")].find(link => link.textContent === "清除搜索")!;
  await act(async () => { clear.focus(); clear.click(); });
  const blank = document.createElement("div"); host.append(blank);
  await act(async () => { blank.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); clear.blur(); });
  await finish();
  expect(document.activeElement).toBe(document.body);
});
