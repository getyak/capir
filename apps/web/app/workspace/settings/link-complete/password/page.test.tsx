import { beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({ operation: vi.fn(), live: vi.fn(), check: vi.fn() }));
vi.mock("@/lib/server/stagedAuth", () => ({ readAuthOperation: boundary.operation, flowIsLive: boundary.live }));
vi.mock("@/app/workspace/settings/login-methods/actions", () => ({ completeStagedPassword: boundary.check, continueTargetLink: vi.fn() }));
import StagedPasswordPage from "./page";
const ref = "60000000-0000-4000-8000-000000000006";
const operation = { ref, intent: "change_password", accountId: "10000000-0000-4000-8000-000000000001", userId: "20000000-0000-4000-8000-000000000002", accountRevision: 2, userRevision: 3, createdAt: "2026-11-01T00:00:00.000Z", attempt: { attempt_id: "40000000-0000-4000-8000-000000000004", attempt_secret: "synthetic-page-proof-never-serialized" } };
function page(result?: string) {
  // Invoke the existing Page with runtime props: old zero-argument signature
  // must fail its behavior rather than a TypeScript excess-argument check.
  return Reflect.apply(StagedPasswordPage, undefined, [{ searchParams: Promise.resolve(result === undefined ? {} : { result }) }]);
}
beforeEach(() => {
  boundary.operation.mockReset(); boundary.live.mockReset(); boundary.check.mockReset();
  boundary.operation.mockResolvedValue(operation); boundary.live.mockReturnValue(true);
  boundary.check.mockResolvedValue({ passwordResult: { ref, state: "applied" }, saved: true });
});
describe("password result GET wiring", () => {
  it("checks the exact live operation read-only and serializes only projected state and scope", async () => {
    const tree = await page(ref);
    expect(boundary.check).toHaveBeenCalledTimes(1);
    const data = boundary.check.mock.calls[0][1] as FormData;
    expect(data.get("passwordMode")).toBe("check"); expect(data.get("operationRef")).toBe(ref);
    expect(data.get("newPassword")).toBeNull(); expect(data.get("attempt_secret")).toBeNull();
    expect(tree.props).toMatchObject({ resultRef: ref, initialState: { passwordResult: { ref, state: "applied" }, saved: true } });
    expect(JSON.stringify(tree.props)).not.toContain(operation.attempt.attempt_secret);
    expect(tree.key).toBe(ref);
  });
  it("rejects an older result reference before reading the newer operation", async () => {
    await expect(page("70000000-0000-4000-8000-000000000007")).rejects.toMatchObject({ digest: expect.stringContaining("/workspace/settings?section=account&link=error") });
    expect(boundary.check).not.toHaveBeenCalled();
  });
  it("uses the original lifetime guard before rendering either mode", async () => {
    boundary.live.mockReturnValue(false);
    await expect(page()).rejects.toMatchObject({ digest: expect.stringContaining("/workspace/settings?section=account&link=error") });
    expect(boundary.live).toHaveBeenCalledExactlyOnceWith(operation); expect(boundary.check).not.toHaveBeenCalled();
  });
  it("keeps an ordinary editor GET free of outcome or mutation calls", async () => {
    const tree = await page(); expect(boundary.check).not.toHaveBeenCalled();
    expect(tree.props.resultRef).toBeUndefined(); expect(tree.props.initialState).toBeUndefined();
    expect(JSON.stringify(tree.props)).not.toContain(operation.attempt.attempt_secret);
  });
});
