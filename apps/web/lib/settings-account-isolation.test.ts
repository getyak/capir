import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Wiring-level coverage for the settings account boundary.
 *
 * What this proves: the settings backend module takes NO account argument, so
 * no request-controlled value can select which account is read or written, and
 * a missing verified session is refused before any backend call. What this does
 * NOT prove: runtime cross-account authorization. That is enforced inside
 * `mutateAccountSettings` in apps/backend/src/modules/accountManagement.ts,
 * where every statement binds `auth.accountId` (and `auth.userId` when a user is
 * addressed) from the verified session, so a foreign id in the body matches no
 * row. There is no two-account integration fixture for the settings routes, so
 * that backend guarantee remains unverified at runtime in this change.
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
    // The module's signatures carry no account parameter, so a caller cannot
    // even express "write to account A" from account B's session.
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
