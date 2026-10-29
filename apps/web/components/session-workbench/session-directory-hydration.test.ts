// @vitest-environment happy-dom
import { act, createElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { SessionDirectory, type SessionSummary } from "./session-directory";

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  vi.useRealTimers();
});

it("hydrates the same session time when loading crosses a relative-time boundary", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers({ toFake: ["Date"] });
  const renderedAt = "2026-09-24T10:59:59.900Z";
  vi.setSystemTime(new Date(renderedAt));
  const session: SessionSummary = {
    session_id: "11111111-1111-4111-8111-111111111111", revision: 1,
    updated_at: "2026-09-24T10:00:00.000Z", expires_at: "2026-09-25T10:00:00Z",
    state: "active", title: "Synthetic hydration boundary", turn_count: 1,
    is_unread: false, scope_kind: "unresolved_intent", person_label: "",
    context_label: "", scope: { kind: "unresolved_intent" },
  };
  const props = { initialSessions: [session], initialComplete: true,
    initialNextCursor: null, sessionVersion: "synthetic", initialError: null,
    sessionRecoveryHref: null, renderedAt };
  host = document.createElement("div");
  host.innerHTML = renderToString(createElement(SessionDirectory, props));
  document.body.append(host);
  expect(host.textContent).toContain("59 分钟前");
  vi.setSystemTime(new Date("2026-09-24T11:00:00.100Z"));
  const recoverable = vi.fn();
  await act(async () => {
    root = hydrateRoot(host!, createElement(SessionDirectory, props), { onRecoverableError: recoverable });
  });
  expect(recoverable).not.toHaveBeenCalled();
  expect(host.textContent).toContain("59 分钟前");
});


it("accepts a fresh server directory when navigation retains the client component", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const { createRoot } = await import("react-dom/client");
  const sample = { session_id: "11111111-1111-4111-8111-111111111111", revision: 1,
    updated_at: "2026-10-29T00:00:00Z", expires_at: "2030-01-01T00:00:00Z",
    state: "active", title: "Old synthetic title", turn_count: 1, is_unread: false,
    scope_kind: "unresolved_intent", person_label: "", context_label: "", scope: { kind: "unresolved_intent" },
  } as SessionSummary;
  const props = { renderedAt: "2026-10-29T00:00:00Z", initialSessions: [sample], initialComplete: true,
    initialNextCursor: null, sessionVersion: "binding", initialError: null, sessionRecoveryHref: null };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root!.render(createElement(SessionDirectory, props)));
  expect(host.textContent).toContain("Old synthetic title");
  await act(async () => root!.render(createElement(SessionDirectory, { ...props, initialSessions: [{ ...sample, title: "Fresh synthetic title", revision: 2 }] })));
  expect(host.textContent).toContain("Fresh synthetic title");
  expect(host.textContent).not.toContain("Old synthetic title");
});
