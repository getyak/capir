import { afterEach, beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ value: "", set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: () => f.value ? { value: f.value } : undefined,
  set: (name: string, value: string, options: unknown) => { f.value = value; f.set(name, value, options); },
  delete: () => { f.value = ""; },
}) }));
vi.mock("./backendAuth", () => ({
  authSecret: () => "test-workspace-fixture-secret-long-enough",
  backendAuthBaseUrl: () => "http://backend.test",
}));
import { setTestWorkspaceSession, testWorkspaceSession, rebindTestWorkspaceParent } from "./testWorkspaceSession";
import { decode } from "next-auth/jwt";
const primary = {
  backendAccessToken: "generation-one", backendAccountId: "owner", backendUserId: "owner",
  backendAccountName: "Owner", backendAccountSlug: "owner", backendRole: "admin" as const,
  backendUsername: null, backendExpiresAt: "2099-01-01T00:00:00.000Z",
  backendSessionId: "11111111-1111-4111-8111-111111111111",
};
const data = { workspaceId: "isolated-workspace", entryId: "bounded-entry", name: "Fixture",
  claims: { ...primary, backendSessionId: undefined, backendAccessToken: "bounded-lab-access", backendAccountId: "isolated-workspace" } };
beforeEach(() => { f.value = ""; f.set.mockClear(); });
afterEach(() => vi.useRealTimers());
it("retains the encrypted selected test workspace through the same Mac session's access renewal", async () => {
  await setTestWorkspaceSession(primary, data);
  const renewed = { ...primary, backendAccessToken: "generation-two", backendExpiresAt: "2099-01-02T00:00:00.000Z" };
  expect((await testWorkspaceSession(renewed))?.workspaceId).toBe(data.workspaceId);
});
it("rejects a selected workspace after a new canonical primary session even for the same owner", async () => {
  await setTestWorkspaceSession(primary, data);
  await expect(testWorkspaceSession({ ...primary, backendSessionId: "22222222-2222-4222-8222-222222222222" }))
    .rejects.toMatchObject({ code: "backend_session_expired" });
});
it("preserves ordinary Web exact-access parent binding", async () => {
  await setTestWorkspaceSession({ ...primary, backendSessionId: undefined }, data);
  await expect(testWorkspaceSession({ ...primary, backendSessionId: undefined, backendAccessToken: "new-web-login" }))
    .rejects.toMatchObject({ code: "backend_session_expired" });
});
it("does not extend the test workspace's own encrypted-cookie lifetime when the Mac renews", async () => {
  vi.useFakeTimers();
  const start = Date.now();
  await setTestWorkspaceSession(primary, data);
  vi.setSystemTime(start + 25 * 60 * 60_000);
  await expect(testWorkspaceSession({ ...primary, backendAccessToken: "renewed" }))
    .rejects.toMatchObject({ code: "backend_session_expired" });
});
it("migrates only an already verified legacy selection on initial enrollment without extending its deadline", async () => {
  vi.useFakeTimers();
  const start = Date.now();
  const legacy = { ...primary, backendSessionId: undefined };
  await setTestWorkspaceSession(legacy, data);
  const original = await decode({ token: f.value, secret: "test-workspace-fixture-secret-long-enough", salt: "talent-signal.test-workspace" });
  vi.setSystemTime(start + 2 * 60 * 60_000);
  await rebindTestWorkspaceParent(legacy, primary);
  expect((await testWorkspaceSession(primary))?.entryId).toBe(data.entryId);
  const migrated = await decode({ token: f.value, secret: "test-workspace-fixture-secret-long-enough", salt: "talent-signal.test-workspace" });
  expect(migrated?.exp).toBe(original?.exp);
});
it("never carries an existing canonical device selection into a different primary session", async () => {
  await setTestWorkspaceSession(primary, data);
  const other = { ...primary, backendSessionId: "22222222-2222-4222-8222-222222222222" };
  await rebindTestWorkspaceParent(primary, other);
  await expect(testWorkspaceSession(other)).rejects.toMatchObject({ code: "backend_session_expired" });
});
