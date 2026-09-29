import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The account boundary for settings is the verified server session, not any
 * request parameter: `loadAccountSettings`/`updateAccountSettings` take no
 * account argument, so a signed-in account can only ever address itself. These
 * tests exercise that real module boundary instead of a stubbed success guard.
 */
const { authenticatedBackendClient } = vi.hoisted(() => ({
  authenticatedBackendClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./server/backendAuth", () => ({ authenticatedBackendClient }));

import { TalentSignalHttpError } from "@talent-signal/contracts";
import { loadAccountSettings, updateAccountSettings } from "./server/accountBackend";

function clientFor(accountName: string, calls: unknown[]) {
  return {
    accountSettings: async () => ({ workspace: { name: accountName } }),
    updateAccountSettings: async (input: unknown) => {
      calls.push(input);
      return { workspace: { name: accountName }, saved: true };
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("settings account isolation", () => {
  it("reads and writes only the account named by the verified session", async () => {
    const aCalls: unknown[] = [];
    const bCalls: unknown[] = [];
    authenticatedBackendClient.mockResolvedValue(clientFor("Account A", aCalls));
    expect(await loadAccountSettings()).toMatchObject({ workspace: { name: "Account A" } });
    await updateAccountSettings({ id: "op-a", kind: "profile", name: "A name", expected_revision: 1 });

    // A different signed-in browser is a different session client, and its
    // write lands only on that session's account.
    authenticatedBackendClient.mockResolvedValue(clientFor("Account B", bCalls));
    expect(await loadAccountSettings()).toMatchObject({ workspace: { name: "Account B" } });
    await updateAccountSettings({ id: "op-b", kind: "profile", name: "B name", expected_revision: 1 });

    expect(aCalls).toEqual([{ id: "op-a", kind: "profile", name: "A name", expected_revision: 1 }]);
    expect(bCalls).toEqual([{ id: "op-b", kind: "profile", name: "B name", expected_revision: 1 }]);
    // No mutation payload can carry an account or user id, so account B cannot
    // address account A by substituting an identifier.
    for (const call of [...aCalls, ...bCalls]) {
      expect(Object.keys(call as object)).not.toContain("account_id");
      expect(Object.keys(call as object)).not.toContain("workspace_id");
    }
  });

  it("refuses to read or write without a verified session", async () => {
    authenticatedBackendClient.mockResolvedValue(null);
    await expect(loadAccountSettings()).rejects.toBeInstanceOf(TalentSignalHttpError);
    await expect(
      updateAccountSettings({ id: "op", kind: "profile", name: "name", expected_revision: 1 }),
    ).rejects.toMatchObject({ status: 401 });
  });
});
