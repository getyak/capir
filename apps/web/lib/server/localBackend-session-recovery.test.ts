import { afterEach, expect, it, vi } from "vitest";
import { TalentSignalClient } from "@talent-signal/contracts";
vi.mock("./backendAuth", () => ({ authenticatedBackendClient: async () => new TalentSignalClient("http://127.0.0.1:4317", "synthetic-authority") }));
import { loadPeopleDirectory } from "./localBackend";
afterEach(() => vi.unstubAllGlobals());
it("routes actual current-session rejection to login recovery before any directory read", async () => {
  const request = vi.fn<typeof fetch>(async () => Response.json({ error: { code: "SESSION_INVALID", message: "The session is no longer active." } }, { status: 401 }));
  vi.stubGlobal("fetch", request);
  await expect(loadPeopleDirectory()).rejects.toMatchObject({ name: "BackendSessionExpiredError", code: "backend_session_expired", status: 401 });
  expect(request).toHaveBeenCalledTimes(1);
  expect(String(request.mock.calls[0]?.[0])).toContain("/v1/auth/session");
});
it("preserves a real server outage for retry instead of reporting logout", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { code: "UNAVAILABLE", message: "Retry later" } }, { status: 503 })));
  await expect(loadPeopleDirectory()).rejects.toMatchObject({ status: 503, code: "UNAVAILABLE" });
});
