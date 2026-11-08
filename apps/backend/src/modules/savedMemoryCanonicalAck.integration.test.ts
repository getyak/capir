/** Real HTTP/Review/PG source cases; source-only until the explicit Hosted run.
 * The sole artificial seam changes delivery of an already successful driver
 * COMMIT response. It never changes SQL, rows, credentials or published state. */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { UnscopedChatTaskResponse } from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";
import { assertDenied, savedMemoryDatabase, withSavedMemoryRuntime } from "./fixtures/savedMemoryRuntime.fixture.js";

if (process.env.GET_455_CANONICAL_ACK_TEST_REQUIRED === "1" && !savedMemoryDatabase) {
  throw new Error("GET455 canonical-ACK verification requires the explicit disposable loopback database.");
}

type Runtime = Parameters<Parameters<typeof withSavedMemoryRuntime>[0]>[0];
type Lease = { commands: string[]; registrations: number; driverCommits: number; deliveries: number;
  releases: number; discarded: boolean };

function textOf(query: unknown): string | undefined {
  if (typeof query === "string") return query;
  if (!query || typeof query !== "object") return undefined;
  const value: unknown = Object.getOwnPropertyDescriptor(query, "text")?.value;
  return typeof value === "string" ? value : undefined;
}

/** Both pg connect overloads remain real. In particular pool.query's callback
 * checkout retains the original error/client/release tuple and callback this.
 * Only closed command names/counters are retained; query params are untouched. */
function interceptAck(pool: Pool, afterDriverCommit: () => Promise<void>) {
  const descriptor = Object.getOwnPropertyDescriptor(pool, "connect"), original = pool.connect;
  let active = true, target: Lease | undefined;
  const observe = (raw: PoolClient): PoolClient => {
    const lease: Lease = { commands: [], registrations: 0, driverCommits: 0, deliveries: 0, releases: 0, discarded: false };
    const release = raw.release;
    return new Proxy(raw, { get(client, key) {
      const value = Reflect.get(client, key, client);
      if (key === "release") return (...args: unknown[]) => {
        lease.releases++; lease.discarded = args[0] === true;
        return Reflect.apply(release, client, args);
      };
      if (key !== "query") return typeof value === "function" ? value.bind(client) : value;
      return (...args: unknown[]) => {
        const text = textOf(args[0]);
        const command = text && /^\s*(BEGIN|COMMIT|ROLLBACK)\b/iu.exec(text)?.[1]?.toUpperCase();
        if (command) {
          if (lease.commands.length >= 16) throw new Error("The closed ACK observer exceeded its command bound.");
          lease.commands.push(command);
        }
        const result: unknown = Reflect.apply(value, client, args);
        const promise = result && typeof (result as { then?: unknown }).then === "function"
          ? result as Promise<unknown> : undefined;
        if (active && text && /^\s*SELECT\s+register_saved_memory_durable_lineage\s*\(/iu.test(text) && promise) {
          return promise.then(rows => {
            if (target && target !== lease) throw new Error("More than one lease registered the target completion.");
            target = lease; lease.registrations++;
            return rows; // The actual driver's object and rows are returned unchanged.
          });
        }
        if (active && command === "COMMIT" && target === lease && promise) {
          return promise.then(async ack => {
            const actualCommand: unknown = ack && typeof ack === "object"
              ? Object.getOwnPropertyDescriptor(ack, "command")?.value : undefined;
            if (actualCommand !== "COMMIT") throw new Error("The actual driver did not acknowledge COMMIT.");
            lease.driverCommits++; lease.deliveries++;
            if (lease.deliveries !== 1) throw new Error("The target COMMIT delivery was repeated.");
            await afterDriverCommit();
            return ack; // Delay only, or throw the explicit synthetic delivery fault.
          });
        }
        return result; // Callback queries and all other promise results stay real.
      };
    } });
  };
  function connect(this: Pool, ...args: unknown[]): unknown {
    const callback = args[0];
    if (typeof callback === "function") {
      const forwarded = [...args];
      forwarded[0] = function(this: unknown, ...values: unknown[]) {
        if (!values[0] && values[1]) values[1] = observe(values[1] as PoolClient);
        return Reflect.apply(callback, this, values);
      };
      return Reflect.apply(original, this, forwarded);
    }
    const pending = Reflect.apply(original, this, args) as Promise<PoolClient>;
    return pending.then(observe);
  }
  Object.defineProperty(pool, "connect", { configurable: true, writable: true, value: connect });
  return {
    observation: () => target,
    restore: () => {
      active = false;
      if (Object.getOwnPropertyDescriptor(pool, "connect")?.value !== connect) {
        throw new Error("The owned ACK observer was replaced before restoration.");
      }
      if (descriptor) Object.defineProperty(pool, "connect", descriptor);
      else if (!Reflect.deleteProperty(pool, "connect")) throw new Error("The owned ACK observer could not restore connect.");
    },
  };
}

async function deliverOnce<T>(seam: ReturnType<typeof interceptAck>, operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } finally { seam.restore(); }
}

function expectCommittedLease(seam: ReturnType<typeof interceptAck>, discarded: boolean): void {
  const seen = seam.observation();
  expect(seen).toBeDefined();
  expect(seen).toMatchObject({ registrations: 1, driverCommits: 1, deliveries: 1, releases: 1, discarded });
  expect(seen?.commands.filter(command => command === "COMMIT")).toHaveLength(1);
  expect(seen?.commands).not.toContain("ROLLBACK");
}

async function canonical(r: Runtime, key: string): Promise<UnscopedChatTaskResponse> {
  // A different Pool/connection observes the real committed rows. No 201,
  // lineage or marker is inserted through this readback helper.
  const rows = (await r.control.query<{ body: UnscopedChatTaskResponse; required: boolean;
    format_version: number | null; completion_bound: boolean | null; retention_kind: string | null;
    no_deadline: boolean; no_origin: boolean; same_transaction: boolean | null }>(`
    SELECT i.response_body AS body,i.saved_memory_lineage_required AS required,t.format_version,
      t.completion_idempotency_id=i.id AS completion_bound,t.retention_kind,
      t.expires_at IS NULL AS no_deadline,t.source_origin_session_id IS NULL AS no_origin,
      t.xmin=i.xmin AS same_transaction
    FROM idempotency_records i LEFT JOIN agent_task_memory_lineage t
      ON t.account_id=i.account_id AND t.reader_actor_id=i.actor_user_id AND t.task_id::text=i.response_body->>'task_id'
    WHERE i.account_id=$1 AND i.actor_user_id=$2 AND i.operation_scope='create_unscoped_chat_task'
      AND i.idempotency_key=$3 AND i.status='completed' AND i.response_status=201`,
  [r.f.auth.accountId, r.f.auth.userId, key])).rows;
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (!row) throw new Error("The real completed canonical row was not visible on the independent pool.");
  expect(row).toMatchObject({ required: true, format_version: 2, completion_bound: true,
    retention_kind: "canonical_no_session", no_deadline: true, no_origin: true, same_transaction: true });
  return row.body;
}

describe.skipIf(!savedMemoryDatabase)("saved Memory real canonical commit with an explicit ACK-delivery seam", () => {
  it("reports a lost delivery as unknown, then reads the actually committed V2 reply without another model", async () => {
    await withSavedMemoryRuntime(async r => {
      const statement = "My synthetic canonical-ACK notebook is copper.";
      const memory = await r.f.acceptSelf(statement); r.configure("self", memory.itemID);
      const key = randomUUID(), objective = "Read my accepted synthetic canonical-ACK notebook.", calls = r.calls();
      const seam = interceptAck(r.f.pool, async () => { throw new Error("SYNTHETIC_ACK_DELIVERY_FAILURE"); });
      const failed = await deliverOnce(seam, () => r.post({ idempotency_key: key, objective }));
      expect(failed.statusCode).toBe(503);
      expect(failed.json<{ error: { code: string } }>().error.code).toBe("SAVED_MEMORY_COMMIT_UNKNOWN");
      expect(failed.body).not.toContain(statement);
      expectCommittedLease(seam, true);
      expect(r.calls()).toBe(calls + 1);
      const saved = await canonical(r, key);
      expect(saved.blocks[0]?.body).toBe(statement);
      expect(await r.current()).toBe(200);
      const replay = await r.post({ idempotency_key: key, objective });
      expect(replay.statusCode).toBe(201);
      expect(replay.json<UnscopedChatTaskResponse>()).toEqual(saved);
      expect(r.calls()).toBe(calls + 1);
    });
  }, 15_000);

  it("withholds a committed old-branch reply after delayed ACK expiry, then lets the renewed login read the same result", async () => {
    await withSavedMemoryRuntime(async r => {
      const statement = "My synthetic delayed-ACK notebook is violet.";
      const memory = await r.f.acceptSelf(statement); r.configure("self", memory.itemID);
      const login = await r.shortenAndRotateLogin();
      const key = randomUUID(), objective = "Read my accepted synthetic delayed-ACK notebook.", calls = r.calls();
      let originalBranchLiveAtDriverAck: boolean | null = null, waitedRealExpiry = false;
      const seam = interceptAck(r.f.pool, async () => {
        const live = (await r.control.query<{ live: boolean }>(`SELECT previous_token_expires_at>clock_timestamp() AS live
          FROM sessions WHERE account_id=$1 AND user_id=$2 AND id=$3 AND revoked_at IS NULL`,
        [r.f.auth.accountId, r.f.auth.userId, r.f.auth.sessionId])).rows;
        originalBranchLiveAtDriverAck = live.length === 1 && live[0]?.live === true;
        await login.waitOriginalExpiry(); // Real3s previous-branch deadline, existing4s poll budget.
        waitedRealExpiry = true;
      });
      const denied = await deliverOnce(seam, () => login.oldPost({ idempotency_key: key, objective }));
      // If CI could not reach legal COMMIT before the original branch expired,
      // this prerequisite must fail; no fake clock, TTL extension or larger test.
      expect(originalBranchLiveAtDriverAck).toBe(true);
      expect(waitedRealExpiry).toBe(true);
      assertDenied(denied, statement);
      expectCommittedLease(seam, false);
      expect(r.calls()).toBe(calls + 1);
      expect((await login.oldRequest({ method: "GET", url: "/v1/auth/session" })).statusCode).toBe(401);
      expect(await r.current()).toBe(200);
      const saved = await canonical(r, key);
      expect(saved.blocks[0]?.body).toBe(statement);
      const replay = await r.post({ idempotency_key: key, objective });
      expect(replay.statusCode).toBe(201);
      expect(replay.json<UnscopedChatTaskResponse>()).toEqual(saved);
      expect(r.calls()).toBe(calls + 1);
    });
  }, 15_000);
});
