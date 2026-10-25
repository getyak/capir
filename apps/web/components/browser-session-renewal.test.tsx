// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { BrowserSessionRenewal } from "./browser-session-renewal";
import { WORKSPACE_SESSION_EXPIRED_EVENT } from "./workspace-session-request";
afterEach(() => { vi.unstubAllGlobals(); });
it("rolls the cookie on startup and foreground without exposing credentials or treating an outage as logout", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn().mockImplementation(async () => Response.json({ status: "unavailable" }, { status: 503 })); vi.stubGlobal("fetch", fetcher);
  const expired = vi.fn(); window.addEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expired);
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  try {
    await act(async () => root.render(createElement(BrowserSessionRenewal)));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("/api/auth/persistent");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "same-origin", headers: { "x-capri-session-renewal": "1" } });
    expect(fetcher.mock.calls[0][1].body).toBeUndefined(); expect(expired).not.toHaveBeenCalled();
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(fetcher).toHaveBeenCalledTimes(2); expect(expired).not.toHaveBeenCalled();
    fetcher.mockImplementation(async () => Response.json({ status: "revoked" }, { status: 401 }));
    await act(async () => window.dispatchEvent(new Event("online")));
    expect(expired).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
    window.dispatchEvent(new Event("focus")); expect(fetcher).toHaveBeenCalledTimes(3);
  } finally { await act(async () => root.unmount()); mount.remove(); window.removeEventListener(WORKSPACE_SESSION_EXPIRED_EVENT, expired); }
});

it("receives the pending cookie response before a bounded second POST, without retry loops", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetcher = vi.fn().mockImplementationOnce(async () => Response.json({ status: "pending" }))
    .mockImplementation(async () => Response.json({ status: "authenticated" })); vi.stubGlobal("fetch", fetcher);
  const mount = document.createElement("div"); document.body.append(mount); const root = createRoot(mount);
  try {
    await act(async () => root.render(createElement(BrowserSessionRenewal)));
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockImplementation(async () => Response.json({ status: "pending" }));
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(fetcher).toHaveBeenCalledTimes(4);
  } finally { await act(async () => root.unmount()); mount.remove(); }
});
