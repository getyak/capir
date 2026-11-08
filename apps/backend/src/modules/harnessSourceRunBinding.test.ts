/** Pure owner-identity/metadata seams only. Database rows below are doubles,
 * never real PostgreSQL, credential, canonical completion or availability proof. */
import type { DatabaseClient } from "../database/pool.js";
import type { AuthContext } from "./auth.js";
import { describe, expect, it } from "vitest";
import { createHarnessSourceGuard, createHarnessSourceGuardWithBinding, readHarnessRunSourceBinding,
  type HarnessRunSourceHandle, type HarnessSourceAuthority } from "./harnessSourceGuard.js";

const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const auth = (): AuthContext => ({ accountId: id(1), userId: id(2), sessionId: id(3),
  accountSlug: "synthetic-source", userEmail: "synthetic@example.invalid", userKind: "password_human" });
const sessionID = id(4), stamp = "a".repeat(32);
const until = "2030-01-02T03:04:05.123456Z";
const floor = new Date("2030-01-02T03:04:00.123Z");
const six = (value: Date) => value.toISOString().slice(0, -1) + "000Z";
function row(parameters: readonly unknown[], expiry: string | null = until) {
  return { generation: "9007199254740993", session_stamp: parameters[2] === null ? null : stamp, current: true,
    source_expires_at: parameters[3] === null ? null : six(parameters[3] as Date),
    session_expires_at: parameters[2] === null ? null : expiry,
    source_person_ids: [...parameters[4] as string[]] };
}
type Result = { rows: unknown[] };
function database(impl: (parameters: readonly unknown[], sql: string) => Promise<Result> = async p => ({ rows: [row(p)] })) {
  const statements: Array<{ sql: string; parameters: readonly unknown[] }> = [];
  return { statements, client: { async query(sql: string, parameters: unknown[]) {
    statements.push({ sql, parameters }); return impl(parameters, sql);
  } } as unknown as DatabaseClient };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("private source owner binding, not an access grant", () => {
  it("returns detached exact original parameter facts beside the owner admission", async () => {
    const original = auth(), people = [id(6), id(5)], db = database();
    const owner = await createHarnessSourceGuardWithBinding(db.client, original, sessionID,
      () => ({ expiresAt: floor, personIDs: people }));
    const binding = readHarnessRunSourceBinding(owner.source, owner.guard, original);
    expect(binding).toEqual({ accountId: original.accountId, userId: original.userId, sessionID,
      generation: "9007199254740993", sessionStamp: stamp, sessionExpiresAt: until,
      sourceExpiresAt: "2030-01-02T03:04:00.123000Z", personIDs: [id(5), id(6)] });
    people.length = 0;
    expect(binding.personIDs).toEqual([id(5), id(6)]);
    expect(Object.isFrozen(binding) && Object.isFrozen(binding.personIDs) && Object.isFrozen(owner.source)).toBe(true);
    expect(Object.keys(owner.source)).toEqual([]);
    expect(db.statements).toHaveLength(1);
    expect(db.statements[0]!.sql).toContain("AS source_expires_at");
    expect(db.statements[0]!.parameters).toEqual([original.accountId, original.userId, sessionID, floor, [id(6), id(5)]]);
  });

  it("rejects JSON, metadata clones, other guards and other account/actor/login bindings", async () => {
    const current = auth(), db = database(), source = () => ({ expiresAt: floor, personIDs: [] });
    const first = await createHarnessSourceGuardWithBinding(db.client, current, sessionID, source);
    const second = await createHarnessSourceGuardWithBinding(db.client, current, sessionID, source);
    const metadata = readHarnessRunSourceBinding(first.source, first.guard, current);
    for (const forged of [{}, JSON.parse(JSON.stringify(first.source)), { ...metadata }, new Proxy(first.source, {})]) {
      expect(() => readHarnessRunSourceBinding(forged as HarnessRunSourceHandle, first.guard, current)).toThrow();
    }
    for (const guard of [second.guard, async () => first.guard()])
      expect(() => readHarnessRunSourceBinding(first.source, guard, current)).toThrow();
    for (const changed of [{ ...current, accountId: id(20) }, { ...current, userId: id(21) },
      { ...current, sessionId: id(22) }, { ...current, userKind: "apple_human" as const }])
      expect(() => readHarnessRunSourceBinding(first.source, first.guard, changed)).toThrow();
    expect(readHarnessRunSourceBinding(first.source, first.guard, current)).toEqual(metadata);
  });

  it("only narrows original Session/source floors and retains every observed person", async () => {
    let expiry = until, current: HarnessSourceAuthority = { expiresAt: floor, personIDs: [id(5)] };
    const db = database(async p => ({ rows: [row(p, expiry)] }));
    const owner = await createHarnessSourceGuardWithBinding(db.client, auth(), sessionID, () => current);
    expiry = "2030-01-03T03:04:05.123456Z";
    current = { expiresAt: new Date("2030-01-03T03:04:00.123Z"), personIDs: [id(6)] };
    await owner.guard();
    expect(readHarnessRunSourceBinding(owner.source, owner.guard, auth())).toMatchObject({
      sessionExpiresAt: until, sourceExpiresAt: "2030-01-02T03:04:00.123000Z", personIDs: [id(5), id(6)] });
    expiry = "2030-01-01T03:04:05.123456Z";
    current = { expiresAt: new Date("2030-01-01T03:04:00.123Z"), personIDs: [] };
    await owner.guard();
    const narrowed = readHarnessRunSourceBinding(owner.source, owner.guard, auth());
    expect(narrowed).toMatchObject({ sessionExpiresAt: expiry, sourceExpiresAt: "2030-01-01T03:04:00.123000Z",
      personIDs: [id(5), id(6)] });
    expiry = until; current = { expiresAt: floor, personIDs: [] };
    await owner.guard();
    expect(readHarnessRunSourceBinding(owner.source, owner.guard, auth())).toEqual(narrowed);
  });

  it("keeps undefined observations pending and never turns their disappearance into independence", async () => {
    let current: HarnessSourceAuthority | undefined;
    const db = database(), owner = await createHarnessSourceGuardWithBinding(db.client, auth(), sessionID, () => current);
    expect(() => readHarnessRunSourceBinding(owner.source, owner.guard, auth())).toThrow();
    current = { expiresAt: floor, personIDs: [id(5)] }; await owner.guard();
    const before = readHarnessRunSourceBinding(owner.source, owner.guard, auth());
    current = undefined; await owner.guard();
    expect(() => readHarnessRunSourceBinding(owner.source, owner.guard, auth())).toThrow();
    current = { expiresAt: new Date("2030-01-03T00:00:00.000Z"), personIDs: [] }; await owner.guard();
    expect(readHarnessRunSourceBinding(owner.source, owner.guard, auth())).toEqual(before);
  });

  it("cannot restore a failed handle by restoring source rows or making a later guard succeed", async () => {
    let changed = false;
    const db = database(async p => ({ rows: [{ ...row(p), generation: changed ? "9007199254740994" : "9007199254740993" }] }));
    const owner = await createHarnessSourceGuardWithBinding(db.client, auth(), sessionID,
      () => ({ expiresAt: floor, personIDs: [] }));
    changed = true; await expect(owner.guard()).rejects.toMatchObject({ code: "HARNESS_SOURCE_CHANGED" });
    changed = false; await owner.guard();
    expect(() => readHarnessRunSourceBinding(owner.source, owner.guard, auth())).toThrow();
  });

  it("keeps the real independent Lab probe ahead of source reads and retires metadata on stop", async () => {
    const current = { ...auth(), userKind: "lab_human" as const }, order: string[] = [];
    let stopped = false;
    const db = database(async p => { order.push("source"); return { rows: [row(p)] }; });
    const probe = database(async () => { order.push("probe"); return { rows: [{ state: "active",
      expires_at: new Date("2030-01-05T00:00:00Z"), stop_clear: !stopped }] }; });
    const owner = await createHarnessSourceGuardWithBinding(db.client, current, sessionID,
      () => { order.push("owner-data"); return { expiresAt: floor, personIDs: [] }; }, probe.client);
    stopped = true; await expect(owner.guard()).rejects.toMatchObject({ code: "HARNESS_SOURCE_CHANGED" });
    expect(order).toEqual(["probe", "owner-data", "source", "probe"]);
    expect(() => readHarnessRunSourceBinding(owner.source, owner.guard, current)).toThrow();
  });

  it("does not let a slower older defined source overwrite a newer undefined observation", async () => {
    let current: HarnessSourceAuthority | undefined = { expiresAt: floor, personIDs: [id(5)] };
    const pending: Array<{ value: ReturnType<typeof row>; result: ReturnType<typeof deferred<Result>> }> = [];
    const firstStarted = deferred<void>(), secondStarted = deferred<void>();
    let reads = 0;
    const db = database(async p => {
      if (++reads === 1) return { rows: [row(p)] };
      const result = deferred<Result>(); pending.push({ value: row(p), result });
      if (pending.length === 1) firstStarted.resolve(); else secondStarted.resolve();
      return result.promise;
    });
    const owner = await createHarnessSourceGuardWithBinding(db.client, auth(), sessionID, () => current);
    const first = owner.guard(); await firstStarted.promise;
    current = undefined; const second = owner.guard(); await secondStarted.promise;
    expect(() => readHarnessRunSourceBinding(owner.source, owner.guard, auth())).toThrow();
    pending[1]!.result.resolve({ rows: [pending[1]!.value] }); await second;
    pending[0]!.result.resolve({ rows: [pending[0]!.value] }); await first;
    expect(() => readHarnessRunSourceBinding(owner.source, owner.guard, auth())).toThrow();
  });

  it("freezes the original actor before asynchronous admission and rejects hooks at the metadata boundary", async () => {
    const input = auth(), before = { ...input }, started = deferred<void>(), result = deferred<Result>();
    let parameters: readonly unknown[] = [];
    const db = database(async p => { parameters = p; started.resolve(); return result.promise; });
    const pending = createHarnessSourceGuardWithBinding(db.client, input, sessionID,
      () => ({ expiresAt: floor, personIDs: [] }));
    await started.promise; input.accountId = id(40); input.userId = id(41);
    result.resolve({ rows: [row(parameters)] }); const owner = await pending;
    expect(readHarnessRunSourceBinding(owner.source, owner.guard, before).accountId).toBe(before.accountId);
    expect(() => readHarnessRunSourceBinding(owner.source, owner.guard, input)).toThrow();
    let touched = 0;
    const hooked = Object.defineProperty(auth(), "accountId", { enumerable: true, get() { touched++; return before.accountId; } });
    const proxy = new Proxy(auth(), { ownKeys() { touched++; return []; } });
    for (const value of [hooked, proxy]) expect(() => readHarnessRunSourceBinding(owner.source, owner.guard, value)).toThrow();
    expect(touched).toBe(0);
  });

  it("keeps the original no-binding SQL text and an undefined-source guard path", async () => {
    const db = database(async () => ({ rows: [{ generation: "0", session_stamp: null, current: true }] }));
    const guard = await createHarnessSourceGuard(db.client, auth(), undefined, () => undefined);
    await guard();
    expect(db.statements).toHaveLength(2);
    expect(db.statements.every(statement => !statement.sql.includes("source_expires_at"))).toBe(true);
    expect(db.statements.map(statement => statement.parameters)).toEqual([
      [auth().accountId, auth().userId, null, null, []], [auth().accountId, auth().userId, null, null, []] ]);
  });
});
