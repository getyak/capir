// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { WorkspaceSessionBoundary } from "./workspace-session-boundary";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";
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
