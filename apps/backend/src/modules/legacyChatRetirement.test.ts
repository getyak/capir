import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import { retireLegacyChatOwnerAfterFailure, sweepLegacyChatExecutions } from "./legacyChatRetirement.js";

describe("authority-reducing legacy retirement acquisition",() => {
  it.each(["owner","candidate-scan"] as const)("bounds %s acquisition and only releases a client that arrives later",async kind => {
    vi.useFakeTimers({ toFake: ["setTimeout","clearTimeout"] });
    let provide!: (client: PoolClient) => void;
    const acquired = new Promise<PoolClient>(resolve => { provide = resolve; });
    const commands: string[] = []; let releases = 0,settled = false;
    const client = { query: async (sql: string) => { commands.push(sql); return { rows: [],rowCount: 1 }; },
      release: () => { releases++; } } as unknown as PoolClient;
    const pool = { connect: () => acquired,query: async (sql: string) => {
      const checkedOut = await acquired;
      try { return await checkedOut.query(sql); } finally { checkedOut.release(); }
    } } as unknown as Pool;
    const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
    const work = kind === "candidate-scan" ? sweepLegacyChatExecutions(pool) : retireLegacyChatOwnerAfterFailure(pool,{ accountId: uuid(1),accountSlug: "synthetic",userId: uuid(2),
      userKind: "password_human",userEmail: "synthetic@example.invalid",sessionId: uuid(3) },{
      accountId: uuid(1),parentID: uuid(4),taskID: uuid(5),attemptID: uuid(6),instance: uuid(7),generation: "1",nonce: uuid(8),
    },"cancelled","client_disconnected");
    const pending = work.then(() => { settled = true; },() => { settled = true; });
    try {
      await vi.advanceTimersByTimeAsync(2_000);
      const endedAtDeadline = settled;
      provide(client); await pending; await Promise.resolve(); await Promise.resolve();
      expect(endedAtDeadline).toBe(true);
      expect(commands).toEqual([]); expect(releases).toBe(1);
    } finally { provide(client); await pending; vi.useRealTimers(); }
  });
});
