// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/workspace" }));
vi.mock("next/navigation", () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { WorkspaceShellNav } from "./workspace-shell-nav";
import { WorkspaceRecentSessions } from "./workspace-recent-sessions";
import { resetSessionOrganizationStores, sessionOrganizationStore } from "@/lib/workspace-session-organization";

const SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const directory = vi.hoisted(() => ({
  data: null as unknown,
  loading: false,
  failed: false,
  retry: vi.fn(),
}));
vi.mock("./workspace-search", () => ({
  useWorkspaceDirectory: () => directory,
  WorkspaceGlobalSearchDialog: () => null,
}));

let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(() => {
  window.localStorage.clear();
  resetSessionOrganizationStores();
  route.pathname = "/workspace";
  directory.data = {
    sessions: {
      session_version: "binding",
      sessions: [
        row(SESSION_A, "准备下周沟通"),
        row(SESSION_B, "整理试点记录"),
      ],
    },
  };
  directory.loading = false;
  directory.failed = false;
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

function row(id: string, title: string) {
  return {
    session_id: id,
    state: "active",
    title,
    expires_at: "2030-01-01T00:00:00Z",
    is_unread: false,
  };
}

function mount(element: React.ReactElement) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
}

function selectionMarks(): HTMLElement[] {
  return [...host!.querySelectorAll<HTMLElement>("[data-selection]")];
}

describe("one shared sliding selection highlight", () => {
  it("keeps an already-returned pinned session before the eight-row recent cap", () => {
    sessionOrganizationStore("c".repeat(64)).setFlag(SESSION_B, "pinned", true);
    directory.data = { sessions: { session_version: "binding", sessions: [
      ...Array.from({ length: 9 }, (_, i) => row(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, `recent-${i}`)),
      row(SESSION_B, "较早的置顶会话"),
    ] } };
    mount(createElement(WorkspaceRecentSessions, { binding: "binding", storageScope: "c".repeat(64) }));
    act(() => host!.querySelector<HTMLButtonElement>("button[aria-controls]")!.click());
    const rows = host!.querySelectorAll("[data-arrival]");
    expect(rows).toHaveLength(8);
    expect(rows[0]!.textContent).toContain("较早的置顶会话");
  });

  it("keeps the first successful asynchronous history static", () => {
    directory.loading = true; directory.data = null;
    mount(createElement(WorkspaceRecentSessions, { binding: "binding", storageScope: "c".repeat(64) }));
    act(() => host!.querySelector<HTMLButtonElement>("button[aria-controls]")!.click());
    directory.loading = false;
    directory.data = { sessions: { session_version: "binding", sessions: [row(SESSION_A, "历史会话")] } };
    act(() => root!.render(createElement(WorkspaceRecentSessions, { binding: "binding", storageScope: "c".repeat(64) })));
    expect(host!.querySelector('[data-arrival="true"]')).toBeNull();
  });

  it("keeps exactly one highlight in the primary navigation and moves it with the route", () => {
    mount(createElement(WorkspaceShellNav, { binding: null }));
    let marks = selectionMarks();
    expect(marks).toHaveLength(1);
    const firstRow = marks[0]!.closest("a")!;
    expect(firstRow.getAttribute("href")).toBe("/workspace");
    expect(firstRow.getAttribute("aria-current")).toBe("page");

    act(() => {
      route.pathname = "/workspace/people";
      root!.render(createElement(WorkspaceShellNav, { binding: null }));
    });
    marks = selectionMarks();
    expect(marks).toHaveLength(1);
    const secondRow = marks[0]!.closest("a")!;
    expect(secondRow.getAttribute("href")).toBe("/workspace/people");
    expect(secondRow.getAttribute("aria-current")).toBe("page");
    // The previous row keeps link semantics without a stale current surface.
    expect(firstRow.getAttribute("aria-current")).toBeNull();
  });

  it("scopes the recent Session list highlight to its own list", () => {
    route.pathname = `/workspace/sessions/${SESSION_B}`;
    mount(
      createElement(WorkspaceRecentSessions, {
        binding: "binding",
        storageScope: "c".repeat(64),
      }),
    );
    act(() => {
      // Expand the group (it starts collapsed in current HEAD behavior).
      const disclosure = host!.querySelector<HTMLButtonElement>("button[aria-controls]");
      disclosure!.click();
    });
    const marks = selectionMarks();
    expect(marks).toHaveLength(1);
    const rowLink = marks[0]!.closest("a")!;
    expect(rowLink.getAttribute("href")).toBe(`/workspace/sessions/${SESSION_B}`);
    expect(rowLink.getAttribute("aria-current")).toBe("page");
  });
});

describe("new session insertion motion", () => {
  it("marks only the arriving row and keeps hydrated rows still", () => {
    mount(
      createElement(WorkspaceRecentSessions, {
        binding: "binding",
        storageScope: "c".repeat(64),
      }),
    );
    act(() => {
      host!.querySelector<HTMLButtonElement>("button[aria-controls]")!.click();
    });
    const before = [...host!.querySelectorAll<HTMLElement>("[data-arrival]")];
    expect(before.map((item) => item.dataset.arrival)).toEqual(["false", "false"]);

    // The shared directory cache revalidates after create/admit; the new
    // session arrives at the top while the older rows stay put.
    const SESSION_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    directory.data = {
      sessions: {
        session_version: "binding",
        sessions: [
          row(SESSION_C, "新的对话"),
          row(SESSION_A, "准备下周沟通"),
          row(SESSION_B, "整理试点记录"),
        ],
      },
    };
    act(() => {
      root!.render(
        createElement(WorkspaceRecentSessions, {
          binding: "binding",
          storageScope: "c".repeat(64),
        }),
      );
    });
    const after = [...host!.querySelectorAll<HTMLElement>("[data-arrival]")];
    expect(after.map((item) => item.dataset.arrival)).toEqual(["true", "false", "false"]);
    expect(after[0]!.textContent).toContain("新的对话");
    // The arriving row animates from a new-only initial state.
    expect(after[0]!.style.opacity).toBe("0");
    expect(after[1]!.style.opacity).not.toBe("0");
  });

  it("renders rows in place without entrance motion under reduced motion", () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      mount(
        createElement(WorkspaceRecentSessions, {
          binding: "binding",
          storageScope: "c".repeat(64),
        }),
      );
      act(() => {
        host!.querySelector<HTMLButtonElement>("button[aria-controls]")!.click();
      });
      const SESSION_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
      directory.data = {
        sessions: {
          session_version: "binding",
          sessions: [
            row(SESSION_C, "新的对话"),
            row(SESSION_A, "准备下周沟通"),
          ],
        },
      };
      act(() => {
        root!.render(
          createElement(WorkspaceRecentSessions, {
            binding: "binding",
            storageScope: "c".repeat(64),
          }),
        );
      });
      const arriving = host!.querySelector<HTMLElement>(`[data-arrival="true"]`);
      expect(arriving).not.toBeNull();
      // Reduced motion: the entrance initial state is never painted.
      expect(arriving!.style.opacity).not.toBe("0");
      expect(arriving!.style.transform ?? "").not.toContain("-10px");
    } finally {
      window.matchMedia = original;
    }
  });
});
