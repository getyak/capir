/** Real stage HTTP/PG commit-order proof. The only artificial seam pauses
 * the actual target driver's COMMIT before dispatch. No SQL, row, credential,
 * ACK or successful publication is fabricated. Both fresh and replay must wait. */
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Pool, type PoolClient } from "pg";
import type { MemoryProposalStageRequest, UnscopedChatTaskResponse } from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";
import { memoryStageDatabase, withMemoryProposalStageFixture } from "./fixtures/memoryProposalStage.fixture.js";

if (process.env.GET_457_STAGE_HTTP_ACK_TEST_REQUIRED === "1" && !memoryStageDatabase)
  throw new Error("Stage HTTP commit verification requires the explicit disposable loopback database.");

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The real stage transaction did not reach its bounded commit barrier.")), 5_000);
  })]); } finally { if (timer) clearTimeout(timer); }
}
function textOf(query: unknown): string | undefined {
  if (typeof query === "string") return query;
  if (!query || typeof query !== "object") return undefined;
  const value: unknown = Object.getOwnPropertyDescriptor(query, "text")?.value;
  return typeof value === "string" ? value : undefined;
}
type Lease = { commits: number; acknowledged: number; releases: number; commands: string[] };
/** Preserve both real pg connect overloads. Identify only the closed operation
 * symbol on the actual claim INSERT; do not retain or print SQL parameters. */
function holdStageCommit(pool: Pool) {
  const descriptor = Object.getOwnPropertyDescriptor(pool, "connect"), original = pool.connect;
  const entered = deferred(), gate = deferred(), released = deferred();
  let active = true, target: Lease | undefined;
  const observe = (raw: PoolClient): PoolClient => {
    const lease: Lease = { commits: 0, acknowledged: 0, releases: 0, commands: [] };
    return new Proxy(raw, { get(client, key) {
      const value = Reflect.get(client, key, client);
      if (key === "release") return (...args: unknown[]) => {
        const result = Reflect.apply(value, client, args);
        lease.releases++; if (target === lease) released.resolve(); return result;
      };
      if (key !== "query") return typeof value === "function" ? value.bind(client) : value;
      return (...args: unknown[]) => {
        const text = textOf(args[0]);
        const command = text && /^\s*(BEGIN|COMMIT|ROLLBACK)\b/iu.exec(text)?.[1]?.toUpperCase();
        if (command) {
          if (lease.commands.length >= 16) throw new Error("The stage observer exceeded its closed command bound.");
          lease.commands.push(command);
        }
        if (active && target === lease && command === "COMMIT") {
          if (typeof args[args.length - 1] === "function") throw new Error("The target stage COMMIT unexpectedly used a callback.");
          lease.commits++; if (lease.commits !== 1) throw new Error("The target stage COMMIT was repeated.");
          entered.resolve();
          return gate.promise.then(() => Reflect.apply(value, client, args)).then((ack: unknown) => {
            const actualCommand = ack && typeof ack === "object" ? Object.getOwnPropertyDescriptor(ack, "command")?.value : undefined;
            if (actualCommand !== "COMMIT") throw new Error("The real stage driver did not acknowledge COMMIT.");
            lease.acknowledged++; return ack;
          });
        }
        const result: unknown = Reflect.apply(value, client, args);
        const parameters = Array.isArray(args[1]) ? args[1] : undefined;
        if (active && text && /^\s*INSERT\s+INTO\s+idempotency_records\b/iu.test(text)
          && parameters?.[3] === "stage_memory_proposal") {
          if (!result || typeof (result as { then?: unknown }).then !== "function")
            throw new Error("The actual stage claim unexpectedly omitted its driver promise.");
          return (result as Promise<unknown>).then(rows => {
            if (target && target !== lease) throw new Error("More than one lease claimed the target stage operation.");
            target = lease; return rows;
          });
        }
        return result;
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
    return (Reflect.apply(original, this, args) as Promise<PoolClient>).then(observe);
  }
  Object.defineProperty(pool, "connect", { configurable: true, writable: true, value: connect });
  return { entered: () => bounded(entered.promise), release: gate.resolve,
    observation: () => target, released: () => target ? bounded(released.promise) : Promise.resolve(),
    restore: () => {
      active = false;
      if (Object.getOwnPropertyDescriptor(pool, "connect")?.value !== connect)
        throw new Error("The owned stage observer was replaced before restoration.");
      if (descriptor) Object.defineProperty(pool, "connect", descriptor);
      else if (!Reflect.deleteProperty(pool, "connect")) throw new Error("The stage observer could not restore connect.");
    } };
}

describe.skipIf(!memoryStageDatabase)("Memory stage HTTP waits for the real transaction COMMIT", () => {
  it.each([false, true])("withholds HTTP success until actual commit (replay=%s)",
    async replay => withMemoryProposalStageFixture(async f => {
      const control = new Pool({ connectionString: memoryStageDatabase, max: 1,
        connectionTimeoutMillis: 2_000, statement_timeout: 5_000, query_timeout: 6_000 });
      try {
        const statement = "My synthetic stage-ACK notebook is copper.";
        const source = await f.post({ idempotency_key: randomUUID(), objective: statement });
        expect(source.statusCode).toBe(201);
        const sessionID = randomUUID(), saved = await f.saveAnswer(sessionID, statement, source.json<UnscopedChatTaskResponse>());
        const request: MemoryProposalStageRequest = { idempotency_key: randomUUID(), surface: "chat", session_id: sessionID,
          source_message_id: saved.payload!.turns[0]!.id, source_task_id: null, person_id: null, relationship_context_id: null,
          contact_decision: "none", identity_clue: null, new_contact: null,
          proposer: { kind: "human", name: "Synthetic stage-ACK", version: "1" },
          items: [{ scope: "self", operation: "add", statement_kind: "source_statement", display_text: statement,
            subject_id: null, relationship_context_id: null, speaker: "me", reporter: "me", valid_time: null,
            observed_time: null, time_status: "known", sensitivity: "normal", source_excerpt: statement,
            source_locator: { kind: "message", session_id: sessionID, message_id: saved.payload!.turns[0]!.id },
            previous_memory_item_id: null, previous_revision: null, previous_text: null,
            reason: "Synthetic human stage request to verify actual commit visibility." }] };
        const visible = async () => (await control.query<{ proposals: string; completed: string }>(`SELECT
          (SELECT count(*) FROM memory_proposals WHERE account_id=$1 AND created_by_user_id=$2)::text AS proposals,
          (SELECT count(*) FROM idempotency_records WHERE account_id=$1 AND actor_user_id=$2
            AND operation_scope='stage_memory_proposal' AND idempotency_key=$3 AND status='completed')::text AS completed`,
        [f.auth.accountId, f.auth.userId, request.idempotency_key])).rows[0];
        let originalReplayBody: unknown;
        if (replay) {
          const original = await f.request({ method: "POST", url: "/v1/memory/proposals", payload: request });
          expect(original.statusCode).toBe(201);
          originalReplayBody = original.json();
          // Establish the real committed replay prerequisite independently; do
          // not retry the stage action or insert its row by hand.
          const deadline = performance.now() + 2_000;
          while ((await visible())?.completed !== "1" && performance.now() < deadline) await delay(10);
          expect(await visible()).toEqual({ proposals: "1", completed: "1" });
        }
        const seam = holdStageCommit(f.pool);
        let settled = false;
        const pending = f.request({ method: "POST", url: "/v1/memory/proposals", payload: request });
        void pending.then(() => { settled = true; }, () => { settled = true; });
        try {
          await seam.entered();
          // This actual independent PG round trip also drains the HTTP promise
          // microtasks; there is no fake clock or arbitrary sleep-based oracle.
          expect(await visible()).toEqual({ proposals: replay ? "1" : "0", completed: replay ? "1" : "0" });
          expect(settled).toBe(false);
          expect(seam.observation()).toMatchObject({ commits: 1, acknowledged: 0, releases: 0 });
          seam.release();
          const response = await pending;
          expect(response.statusCode).toBe(replay ? 200 : 201);
          expect(response.headers["idempotent-replayed"]).toBe(replay ? undefined : "false");
          if (replay) { expect(originalReplayBody).toBeDefined(); expect(response.json()).toEqual(originalReplayBody); }
          const staged = response.json<{ proposal: { proposal_id: string } }>();
          await seam.released();
          expect(seam.observation()).toMatchObject({ commits: 1, acknowledged: 1, releases: 1 });
          expect(seam.observation()?.commands).not.toContain("ROLLBACK");
          expect(await visible()).toEqual({ proposals: "1", completed: "1" });
          const opened = await f.request({ method: "POST", url: `/v1/memory/proposals/${staged.proposal.proposal_id}/reviews`,
            payload: { purpose: "chat", person_id: null, relationship_context_id: null } });
          expect(opened.statusCode).toBe(200);
        } finally {
          seam.release();
          await Promise.allSettled([pending]);
          try { await seam.released(); } finally { seam.restore(); }
        }
      } finally { await control.end(); }
    }), 15_000,
  );
});
