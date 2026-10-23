import { NextRequest } from "next/server";
import { TalentSignalHttpError } from "@talent-signal/contracts";
import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ auth: vi.fn(), people: vi.fn() }));
vi.mock("@/auth", () => ({ auth: f.auth }));
vi.mock("@/lib/server/localBackend", () => ({ isIntegrationMode: () => true, loadPeopleDirectory: f.people }));
import { GET } from "./route";
beforeEach(() => { f.auth.mockReset().mockResolvedValue({ user: { id: "synthetic" } }); f.people.mockReset(); });
it("publishes canonical expiry metadata when the Web session is missing", async () => {
  f.auth.mockResolvedValue(null);
  const response = await GET(new NextRequest("http://localhost:3000/api/local-integration/people"));
  expect(response.status).toBe(401);
  expect(response.headers.get("X-Talent-Signal-Session-Status")).toBe("expired");
  expect(await response.json()).toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
  expect(f.people).not.toHaveBeenCalled();
});
it.each([[401, "SESSION_EXPIRED", "expired"], [401, "UNKNOWN", null], [503, "SESSION_EXPIRED", null]])(
  "labels only confirmed credential failures (%s, %s)", async (status, code, expected) => {
    f.people.mockRejectedValue(new TalentSignalHttpError(status, code, "Unavailable", null));
    const response = await GET(new NextRequest("http://localhost:3000/api/local-integration/people"));
    expect(response.headers.get("X-Talent-Signal-Session-Status")).toBe(expected);
  },
);
