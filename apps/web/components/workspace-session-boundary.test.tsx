// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LocaleProvider } from "./locale-provider";
import { WorkspaceSessionBoundary } from "./workspace-session-boundary";
import { workspaceSessionFetch, WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";
it("removes mounted private chrome and content only on confirmed session loss", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const mount = document.createElement("div"); document.body.append(mount);
  const root = createRoot(mount);
  try {
    await act(async () => root.render(createElement(WorkspaceSessionBoundary, null, createElement("div", null, "Private person and account"))));
    await act(async () => window.dispatchEvent(new Event("offline")));
    expect(mount.textContent).toContain("Private person and account");
    await act(async () => window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT)));
    expect(mount.textContent).not.toContain("Private person and account");
    expect(mount.textContent).toContain("登录已失效");
    expect(mount.querySelector("a")?.getAttribute("href")).toContain("reason=backend_session_expired");
  } finally { await act(async () => root.unmount()); mount.remove(); vi.unstubAllGlobals(); }
});

it("hands a recognized API expiry to the native login route with the original return target", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/workspace/sessions/synthetic?view=chat#reply");
  window.talentSignalDesktop = { protocolVersion: 1, availableVersion: null };
  const replace = vi.spyOn(window.location, "replace").mockImplementation(() => {});
  const mount = document.createElement("div");
  mount.dataset.workspaceScope = "synthetic-scope";
  document.body.append(mount);
  const root = createRoot(mount);
  try {
    await act(async () => root.render(createElement(WorkspaceSessionBoundary, null, "Private fixture")));
    await act(async () => {
      await workspaceSessionFetch("/api/workspace-sessions", {}, async () =>
        Response.json({ code: "SESSION_EXPIRED" }, { status: 401 }));
    });
    expect(mount.textContent).not.toContain("Private fixture");
    expect(replace).toHaveBeenCalledTimes(1);
    const destination = new URL(replace.mock.calls[0][0], window.location.origin);
    expect(destination.pathname).toBe("/login");
    expect(destination.searchParams.get("callbackUrl")).toBe("/workspace/sessions/synthetic?view=chat#reply");
    expect(destination.searchParams.get("reason")).toBe("backend_session_expired");
  } finally {
    await act(async () => root.unmount());
    mount.remove();
    delete window.talentSignalDesktop;
    replace.mockRestore();
    window.history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  }
});

it("keeps browser expiry recovery explicit and never navigates on a transport error", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const replace = vi.spyOn(window.location, "replace").mockImplementation(() => {});
  const mount = document.createElement("div");
  mount.dataset.workspaceScope = "synthetic-scope";
  document.body.append(mount);
  const root = createRoot(mount);
  try {
    await act(async () => root.render(createElement(WorkspaceSessionBoundary, null, "Private fixture")));
    await act(async () => {
      await expect(workspaceSessionFetch("/api/workspace-sessions", {}, async () => {
        throw new TypeError("Network unavailable");
      })).rejects.toThrow("Network unavailable");
    });
    expect(mount.textContent).toContain("Private fixture");
    expect(replace).not.toHaveBeenCalled();
    await act(async () => window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT)));
    expect(mount.textContent).not.toContain("Private fixture");
    expect(mount.querySelector("a")?.getAttribute("href")).toContain("/login?");
    expect(replace).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount()); mount.remove(); replace.mockRestore(); vi.unstubAllGlobals();
  }
});

it("renders the recovery state in the active interface language", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const mount = document.createElement("div"); document.body.append(mount);
  const root = createRoot(mount);
  try {
    await act(async () => root.render(<LocaleProvider locale="en"><WorkspaceSessionBoundary>Private fixture</WorkspaceSessionBoundary></LocaleProvider>));
    await act(async () => window.dispatchEvent(new Event(WORKSPACE_SESSION_EXPIRED_EVENT)));
    expect(mount.querySelector("main")?.lang).toBe("en");
    expect(mount.querySelector("h1")?.textContent).toBe("Your session has expired");
    expect(mount.querySelector("a")?.textContent).toBe("Sign in again");
  } finally { await act(async () => root.unmount()); mount.remove(); vi.unstubAllGlobals(); }
});
