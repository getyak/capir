import { describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import type { LegacyChatAuthority } from "./legacyChatAuthority.js";
import { createLegacyChatDatabase, LegacyChatCommitUnknown } from "./legacyChatDatabase.js";

function fixture() {
  const commands: string[] = [];
  let borrows = 0, releases = 0, open = false, commitFails = false, late: PoolClient | undefined;
  const client = { query: async (sql: string) => {
    commands.push(sql);
    if (sql === "COMMIT" && commitFails) throw new Error("synthetic lost acknowledgement");
    return { rows: [{ value: sql }], rowCount: 1 };
  }, release: () => { open = false; releases++; } } as unknown as PoolClient;
  const pool = { connect: async () => { if (open) throw new Error("only product client already borrowed"); open = true; borrows++; return client; } } as unknown as Pool;
  const authority = { assertCurrent: async () => {}, withClient: async <T>(value: PoolClient, work: (guarded: PoolClient) => Promise<T>) => {
    let live = true;
    const guarded = new Proxy(value, { get(target, key) {
      if (key !== "query") return Reflect.get(target, key, target);
      return (...args: unknown[]) => { if (!live) throw new Error("released guarded client"); return Reflect.apply(target.query, target, args); };
    } });
    late = guarded;
    try { return await work(guarded); } finally { live = false; }
  } } as unknown as LegacyChatAuthority;
  return { pool, authority, commands, stats: () => ({ borrows, releases }),
    failCommit: () => { commitFails = true; }, lateQuery: () => late!.query("too late") };
}

describe("short legacy owner database facade", () => {
  it("uses the passed transaction client for nested source checks under max=1", async () => {
    const f = fixture(), owner = createLegacyChatDatabase(f.pool, f.authority);
    const value = await owner.run(async client => {
      await client.query("owner fence");
      return (await owner.database.query("source check")).rows[0]?.value;
    });
    expect(value).toBe("source check");
    expect(f.stats()).toEqual({ borrows: 1, releases: 1 });
    expect(f.commands).toEqual(["BEGIN", "SET LOCAL lock_timeout='2s'", "SET LOCAL statement_timeout='5s'",
      "owner fence", "source check", "COMMIT"]);
    expect(() => f.lateQuery()).toThrow("released guarded client");
  });

  it("does not route an unrelated async caller through another operation's borrowed client", async () => {
    const f = fixture(), owner = createLegacyChatDatabase(f.pool, f.authority);
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(done => { enter = done; }), held = new Promise<void>(done => { release = done; });
    const first = owner.run(async client => { enter(); await held; await client.query("first"); });
    await entered;
    const second = owner.database.query("unrelated");
    await Promise.resolve();
    expect(f.commands).not.toContain("unrelated");
    release(); await first; await second;
    expect(f.stats()).toEqual({ borrows: 2, releases: 2 });
    expect(f.commands.indexOf("unrelated")).toBeGreaterThan(f.commands.indexOf("COMMIT"));
  });

  it("keeps COMMIT acknowledgement uncertainty distinct from rollback", async () => {
    const f = fixture(); f.failCommit();
    const owner = createLegacyChatDatabase(f.pool, f.authority);
    await expect(owner.run(async client => { await client.query("write"); })).rejects.toBeInstanceOf(LegacyChatCommitUnknown);
    expect(f.commands).toContain("COMMIT"); expect(f.commands).not.toContain("ROLLBACK");
    expect(f.stats()).toEqual({ borrows: 1, releases: 1 });
  });

  it("rolls back a known pre-COMMIT failure and allows later cleanup through the gate", async () => {
    const f = fixture(), owner = createLegacyChatDatabase(f.pool, f.authority);
    const failure = new Error("synthetic original proof failure");
    await expect(owner.run(async () => { throw failure; })).rejects.toBe(failure);
    expect(f.commands).toContain("ROLLBACK"); expect(f.commands).not.toContain("COMMIT");
    expect((await owner.database.query("cleanup read")).rows[0]?.value).toBe("cleanup read");
    expect(f.stats()).toEqual({ borrows: 2, releases: 2 });
  });
});
