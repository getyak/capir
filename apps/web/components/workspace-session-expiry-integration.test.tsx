// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { fetch as realFetch } from "undici";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/server/backendAuth", () => ({ readBackendSessionClaims: async () => null }));
vi.mock("@/lib/server/workspaceSessions", () => ({
  createUnscopedWorkspaceSession: vi.fn(), isWorkspaceSessionCursor: vi.fn(),
  isWorkspaceSessionId: vi.fn(), isWorkspaceSessionTimestamp: vi.fn(),
  loadWorkspaceSessionDirectory: vi.fn(), workspaceSessionDetailWire: vi.fn(),
  workspaceSessionSummaryWire: vi.fn(), workspaceSessionsBinding: vi.fn(),
}));
import { GET } from "@/app/api/workspace-sessions/route";
import { loadWorkspaceDirectory, readCachedWorkspaceDirectory, invalidateWorkspaceDirectory, workspaceDirectoryAbortError } from "@/lib/workspace-directory-cache";
import { readWorkspaceDirectory } from "./workspace-search";
import { workspaceSessionFetch } from "./workspace-session-request";
import { WorkspaceSessionBoundary } from "./workspace-session-boundary";

it("carries an actual directory-route expiry through an abort-linked response to native recovery", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.history.replaceState(null, "", "/workspace/sessions/synthetic#reply");
  window.talentSignalDesktop = { protocolVersion: 1, availableVersion: null };
  const replace = vi.spyOn(window.location, "replace").mockImplementation(() => {});
  const mount = document.createElement("div");
  mount.dataset.workspaceScope = "account-a";
  document.body.append(mount);
  const root = createRoot(mount);
  try {
    await act(async () => root.render(<WorkspaceSessionBoundary>Private page and account</WorkspaceSessionBoundary>));
    const routeResponse = await GET(new Request("http://localhost:3000/api/workspace-sessions"));
    expect(routeResponse.status).toBe(401);
    const body = await routeResponse.text();
    const transport: typeof fetch = async (input, init) => {
      if (String(input).includes("people")) return Response.json({ people: [] });
      // A real Fetch body follows the same abort signal used by the production
      // cache. Only HTTP metadata comes from the real route: no invented expiry
      // header or disconnected Response.json() can make this test pass.
      const response = await realFetch(`data:application/json,${encodeURIComponent(body)}`, { signal: init?.signal });
      Object.defineProperty(response, "status", { value: routeResponse.status });
      Object.defineProperty(response, "headers", { value: routeResponse.headers });
      return response as unknown as Response;
    };
    let failure: Error | undefined;
    await act(async () => {
      await loadWorkspaceDirectory("account-a", async signal => {
        const snapshot = await readWorkspaceDirectory("account-a", signal,
          (input, init) => workspaceSessionFetch(input, init, transport));
        if (!snapshot) throw workspaceDirectoryAbortError();
        return snapshot;
      })
        .catch(error => { failure = error; });
    });
    expect(failure?.name, failure?.stack).toBe("AbortError");
    expect(readCachedWorkspaceDirectory("account-a")).toBeNull();
    expect(mount.textContent).not.toContain("Private page and account");
    expect(replace).toHaveBeenCalledTimes(1);
    const destination = new URL(replace.mock.calls[0][0], window.location.origin);
    expect(destination.pathname).toBe("/login");
    expect(destination.searchParams.get("callbackUrl")).toBe("/workspace/sessions/synthetic#reply");
  } finally {
    await act(async () => root.unmount());
    invalidateWorkspaceDirectory(undefined, "discard");
    mount.remove(); delete window.talentSignalDesktop;
    replace.mockRestore(); window.history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  }
});
