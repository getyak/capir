import { TalentSignalClient } from "@talent-signal/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackendSessionExpiredError } from "@/lib/backend-session";

const { readClaims, backend } = vi.hoisted(() => ({ readClaims: vi.fn(), backend: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/backendAuth", () => ({
  readBackendSessionClaims: readClaims,
  backendAuthBaseUrl: () => "http://127.0.0.1:4317",
}));
vi.mock("@/lib/server/browser-capture", async (original) => ({
  ...await original<typeof import("@/lib/server/browser-capture")>(),
  browserBackend: backend,
}));

import { GET as session } from "./session/route";
import { POST as submit } from "./captures/route";
import { GET as receipt } from "./captures/[requestId]/route";

const currentSession = vi.spyOn(TalentSignalClient.prototype, "currentSession");
const claims = {
  backendAccessToken: "synthetic-token", backendAccountId: "account-a",
  backendAccountName: "A", backendAccountSlug: "a", backendUserId: "user-a",
  backendExpiresAt: "2099-01-01T00:00:00Z", backendRole: "member" as const,
  backendUsername: null,
};
function request(origin = "https://workspace.example") {
  return new Request("http://localhost:3000/api/browser-extension/captures", {
    method: "POST", headers: { origin, host: "workspace.example" },
    body: "invalid body must not be read before login is available",
  });
}
const routes = [
  { name: "session", run: () => session() },
  { name: "capture submission", run: () => submit(request()) },
  { name: "capture receipt", run: () => receipt(new Request("http://localhost:3000"), {
    params: Promise.resolve({ requestId: "synthetic-request-1234" }),
  }) },
];
beforeEach(() => {
  vi.clearAllMocks();
  readClaims.mockResolvedValue(claims);
  currentSession.mockResolvedValue({} as never);
});

describe.each(routes)("browser $name login recovery", ({ run }) => {
  it("requires login after confirmed revocation before any backend dispatch", async () => {
    readClaims.mockRejectedValue(new BackendSessionExpiredError());
    const result = await run();
    expect(result.status).toBe(401);
    expect(await result.json()).toMatchObject({ code: "session_stale" });
    expect(backend).not.toHaveBeenCalled();
    expect(currentSession).not.toHaveBeenCalled();
  });
  it("keeps temporary renewal failure recoverable without dispatch or secret leakage", async () => {
    readClaims.mockRejectedValue(new Error("PRIVATE_AUTH_PROOF_MUST_NOT_LEAK"));
    const result = await run();
    expect(result.status).toBe(503);
    const body = await result.text();
    expect(JSON.parse(body)).toMatchObject({ code: "backend_unavailable" });
    expect(body).not.toContain("PRIVATE_AUTH_PROOF_MUST_NOT_LEAK");
    expect(backend).not.toHaveBeenCalled();
    expect(currentSession).not.toHaveBeenCalled();
  });
  it("keeps missing login unauthorized", async () => {
    readClaims.mockResolvedValue(null);
    const result = await run();
    expect(result.status).toBe(401);
    expect(await result.json()).toMatchObject({ code: "session_stale" });
    expect(backend).not.toHaveBeenCalled();
  });
});

it("recognizes backend revocation after the session preflight", async () => {
  currentSession.mockRejectedValue(new BackendSessionExpiredError());
  const result = await session();
  expect(result.status).toBe(401);
  expect(await result.json()).toMatchObject({ code: "session_stale" });
});
it("keeps a backend transport failure recoverable", async () => {
  currentSession.mockRejectedValue(new Error("PRIVATE_AUTH_PROOF_MUST_NOT_LEAK"));
  const result = await session();
  expect(result.status).toBe(503);
  expect(await result.text()).not.toContain("PRIVATE_AUTH_PROOF_MUST_NOT_LEAK");
});
it("rejects a foreign submission origin before resolving credentials", async () => {
  expect((await submit(request("https://attacker.example"))).status).toBe(403);
  expect(readClaims).not.toHaveBeenCalled();
  expect(backend).not.toHaveBeenCalled();
});
