import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "pg";
import { parseResearchNotebook, researchNotebookOwner, researchRecordId } from "./researchNotebookImport.js";
import { encodePasswordCredential, verifyPasswordCredential } from "./passwordCredential.js";
const packet = () => ({ schema: "research-notebook.v1", namespace: "synthetic-test", people: [{ key: "person-a", name: "Synthetic Person", notes: [{ key: "identity", text: "An attributed research proposal.", section: "identity", metadata: {} }] }] });
describe("research notebook ingress", () => {
  it("keeps name duplicates distinct with stable account-scoped IDs", () => {
    const input = packet(); input.people.push({ ...input.people[0]!, key: "person-b" });
    expect(parseResearchNotebook(input).people).toHaveLength(2);
    expect(researchRecordId("account-a", "fixture", "person-a")).toBe(researchRecordId("account-a", "fixture", "person-a"));
    expect(researchRecordId("account-a", "fixture", "person-a")).not.toBe(researchRecordId("account-b", "fixture", "person-a"));
  });
  it("rejects duplicate person/note keys, oversized prose and unsupported sections", () => {
    const duplicate = packet(); duplicate.people.push(duplicate.people[0]!);
    expect(() => parseResearchNotebook(duplicate)).toThrow("INVALID_PERSON");
    const notes = packet(); notes.people[0]!.notes.push(notes.people[0]!.notes[0]!);
    expect(() => parseResearchNotebook(notes)).toThrow("INVALID_NOTE");
    const long = packet(); long.people[0]!.notes[0]!.text = "a".repeat(1001);
    expect(() => parseResearchNotebook(long)).toThrow("INVALID_NOTE");
    const bad = packet(); bad.people[0]!.notes[0]!.section = "confirmed_fact";
    expect(() => parseResearchNotebook(bad)).toThrow("INVALID_NOTE");
    expect(() => parseResearchNotebook({ ...packet(), namespace: "../../private" })).toThrow("INVALID_NOTEBOOK");
    expect(() => parseResearchNotebook({ ...packet(), namespace: undefined })).toThrow("INVALID_NOTEBOOK");
  });
});

interface OwnerFixture {
  users: Array<{ id: string; account_id: string; status: string; password_scrypt: string | null; locked_until: Date | null }>;
  account: { id: string; retired_at: Date | null } | null;
  ownerUserId: string | null;
  credential: { password_scrypt: string; locked_until: Date | null } | null;
}

/** Bounded synthetic PoolClient: routes the owner-proof queries and records every call. */
function syntheticClient(fixture: Partial<OwnerFixture> = {}) {
  const state: OwnerFixture = { users: [], account: null, ownerUserId: null, credential: null, ...fixture };
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM users u")) return { rows: state.users };
    if (sql.includes("SELECT owner_user_id FROM accounts")) return { rows: state.account ? [{ owner_user_id: state.ownerUserId }] : [] };
    if (sql.includes("SELECT password_scrypt,locked_until FROM password_credentials")) return { rows: state.credential ? [state.credential] : [] };
    if (sql.includes("SELECT retired_at FROM accounts")) return { rows: state.account ? [state.account] : [] };
    if (sql.includes("INSERT INTO account_email_reservations")) return { rows: [{ normalized_email: params?.[0], state: "owned", account_id: params?.[1], user_id: params?.[2] }] };
    if (sql.includes("INSERT INTO audit_events")) return { rows: [{ sequence: "1" }] };
    return { rows: [] };
  });
  return {
    client: { query } as unknown as PoolClient,
    query,
    writes: () => query.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)),
  };
}

const ownerInput = (password: string) => ({ email: "owner@example.invalid", displayName: "Synthetic owner", password });

async function provenOwner(password: string): Promise<OwnerFixture> {
  const password_scrypt = await encodePasswordCredential(password);
  return {
    users: [{ id: "user-1", account_id: "account-1", status: "active", password_scrypt, locked_until: null }],
    account: { id: "account-1", retired_at: null },
    ownerUserId: "user-1",
    credential: { password_scrypt, locked_until: null },
  };
}

describe("research notebook owner proof", () => {
  // Real encode/verify, no composition or trimming rules: legacy short passwords stay provable.
  it.each(["x", "123456", "1234567", "12345678", "      ", "密码测试专用"])(
    "proves an existing canonical owner with a valid legacy password and never writes (%#)", async password => {
      const { client, writes } = syntheticClient(await provenOwner(password));
      await expect(researchNotebookOwner(client, ownerInput(password)))
        .resolves.toEqual({ accountId: "account-1", userId: "user-1", created: false });
      expect(writes()).toHaveLength(0);
    });

  it("rejects a wrong legacy password without provisioning or writes", async () => {
    const { client, writes } = syntheticClient(await provenOwner("123456"));
    await expect(researchNotebookOwner(client, ownerInput("654321"))).rejects.toThrow("OWNER_CONFLICT_OR_CREDENTIAL_INVALID");
    expect(writes()).toHaveLength(0);
  });

  it("rejects an owner mismatch from another account without writes", async () => {
    const fixture = await provenOwner("123456");
    const { client, writes } = syntheticClient({ ...fixture, ownerUserId: "user-2" });
    await expect(researchNotebookOwner(client, ownerInput("123456"))).rejects.toThrow("OWNER_CONFLICT_OR_CREDENTIAL_INVALID");
    expect(writes()).toHaveLength(0);
  });

  it("rejects when the credential rows for the owner are absent without writes", async () => {
    const fixture = await provenOwner("123456");
    const { client, writes } = syntheticClient({ ...fixture, credential: null });
    await expect(researchNotebookOwner(client, ownerInput("123456"))).rejects.toThrow("OWNER_CONFLICT_OR_CREDENTIAL_INVALID");
    expect(writes()).toHaveLength(0);
  });

  it("rejects ambiguous duplicate users without writes", async () => {
    const fixture = await provenOwner("123456");
    const { client, writes } = syntheticClient({ ...fixture, users: [...fixture.users, { ...fixture.users[0]!, id: "user-2" }] });
    await expect(researchNotebookOwner(client, ownerInput("123456"))).rejects.toThrow("OWNER_CONFLICT_OR_CREDENTIAL_INVALID");
    expect(writes()).toHaveLength(0);
  });

  it("rejects an inactive user even with the correct password without writes", async () => {
    const fixture = await provenOwner("123456");
    const { client, writes } = syntheticClient({ ...fixture, users: [{ ...fixture.users[0]!, status: "inactive" }] });
    await expect(researchNotebookOwner(client, ownerInput("123456"))).rejects.toThrow("OWNER_CONFLICT_OR_CREDENTIAL_INVALID");
    expect(writes()).toHaveLength(0);
  });

  it("rejects a retired account with the existing refusal and without writes", async () => {
    const fixture = await provenOwner("123456");
    const { client, writes } = syntheticClient({ ...fixture, account: { id: "account-1", retired_at: new Date() } });
    await expect(researchNotebookOwner(client, ownerInput("123456"))).rejects.toMatchObject({ code: "ACCOUNT_RETIRED" });
    expect(writes()).toHaveLength(0);
  });

  it("rejects a locked credential even with the correct password without writes", async () => {
    const fixture = await provenOwner("123456");
    const { client, writes } = syntheticClient({ ...fixture,
      credential: { password_scrypt: fixture.credential!.password_scrypt, locked_until: new Date(Date.now() + 60_000) } });
    await expect(researchNotebookOwner(client, ownerInput("123456"))).rejects.toThrow("OWNER_CONFLICT_OR_CREDENTIAL_INVALID");
    expect(writes()).toHaveLength(0);
  });

  it.each([1, 6, 7])(
    "rejects a missing user at %i characters before identity, credential or audit writes", async length => {
      const { client, query, writes } = syntheticClient();
      await expect(researchNotebookOwner(client, ownerInput("p".repeat(length)))).rejects.toThrow("INVALID_OWNER_INPUT");
      // The refusal happens only after proving there is no matching user, not as a global early return.
      expect(query.mock.calls.some(([sql]) => sql.includes("FROM users u"))).toBe(true);
      expect(writes()).toHaveLength(0);
    });

  it.each([8, 128])(
    "retains the %i-character creation path for a missing user with a verifiable credential", async length => {
      const password = "p".repeat(length);
      const { client, writes } = syntheticClient();
      const result = await researchNotebookOwner(client, ownerInput(password));
      expect(result).toEqual({ accountId: expect.any(String), userId: expect.any(String), created: true });
      const inserts = writes().map(([sql]) => sql);
      for (const table of ["account_email_reservations", "accounts", "users", "password_credentials", "audit_events"])
        expect(inserts.some(sql => sql.includes(`INSERT INTO ${table}`))).toBe(true);
      const auditWrite = writes().find(([sql]) => sql.includes("INSERT INTO audit_events"))!;
      expect((auditWrite[1] as unknown[])[3]).toBe("research.owner_provisioned");
      const credentialWrite = writes().find(([sql]) => sql.includes("INSERT INTO password_credentials"))!;
      const [accountId, userId, stored] = credentialWrite[1] as [string, string, string];
      expect({ accountId, userId }).toEqual({ accountId: result.accountId, userId: result.userId });
      await expect(verifyPasswordCredential(password, stored)).resolves.toBe(true);
      await expect(verifyPasswordCredential(`${password}x`, stored)).resolves.toBe(false);
    });

  it("accepts a 128-character existing-owner proof and rejects 129 characters before any query", async () => {
    const fixture = await provenOwner("p".repeat(128));
    const accepted = syntheticClient(fixture);
    await expect(researchNotebookOwner(accepted.client, ownerInput("p".repeat(128))))
      .resolves.toEqual({ accountId: "account-1", userId: "user-1", created: false });
    expect(accepted.writes()).toHaveLength(0);
    const rejected = syntheticClient(fixture);
    await expect(researchNotebookOwner(rejected.client, ownerInput("p".repeat(129)))).rejects.toThrow("INVALID_OWNER_INPUT");
    expect(rejected.query).not.toHaveBeenCalled();
  });

  it("rejects an empty password before any query", async () => {
    const { client, query } = syntheticClient(await provenOwner("x"));
    await expect(researchNotebookOwner(client, ownerInput(""))).rejects.toThrow("INVALID_OWNER_INPUT");
    expect(query).not.toHaveBeenCalled();
  });
});
