import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/apiError.js";
import { barrier, bounded, database, observedClient, requiredContentAPIs, withReviewFixture, type PreparedReview } from "./fixtures/memoryContentReadEnvelope.fixture.js";

describe.skipIf(!database)("Memory Review preparation reads one real repeatable snapshot", () => {
  it("acknowledges REPEATABLE READ before returning the private BEGIN to the loader", async () => {
    await withReviewFixture(async f => {
      const { create, prepare } = requiredContentAPIs();
      const connection = observedClient(await f.pool.connect());
      try {
        const value = await create({ config: f.config })(f.auth, f.authorization).run(connection.client, async client => {
          await client.query("BEGIN");
          try {
            const isolation = (await client.query<{ transaction_isolation: string }>("SHOW transaction_isolation")).rows[0]!;
            expect(isolation.transaction_isolation === "repeatable read").toBe(true);
            const result = await prepare(client, f.auth, f.scopeID, f.credential);
            await client.query("COMMIT"); return result;
          } catch (error) { await client.query("ROLLBACK"); throw error; }
        });
        expect(value.body.review.items[0]?.display_text).toBe(f.sentence);
        expect(connection.state.finalQueries).toBe(1);
      } finally { connection.release(); }
    });
  }, 25_000);

  it("refuses preparation outside an actual private acknowledged transaction", async () => {
    await withReviewFixture(async f => {
      const { create, prepare } = requiredContentAPIs();
      const connection = observedClient(await f.pool.connect());
      try {
        const result = await create({ config: f.config })(f.auth, f.authorization)
          .run(connection.client, client => prepare(client, f.auth, f.scopeID, f.credential))
          .then(value => ({ value, error: null }), error => ({ error }));
        expect("value" in result).toBe(false);
        expect(result.error instanceof ApiError && result.error.statusCode === 409).toBe(true);
        expect(connection.state.finalQueries).toBe(0);
      } finally { connection.release(); }
    });
  }, 25_000);

  it.each(["item_projection", "source_message"] as const)("keeps exact original bytes through actual intermediate %s B then restored A on a second connection", async mode => {
    await withReviewFixture(async f => {
      const baseline = await f.originalReview();
      const { create, prepare } = requiredContentAPIs();
      const connection = observedClient(await f.pool.connect());
      const captured = barrier(), releaseCapture = barrier(), committed = barrier(), releasePublication = barrier();
      f.releaseOnClose(releaseCapture.resolve); f.releaseOnClose(releasePublication.resolve);
      let productPID = 0, capturedOnce = false;
      const client = new Proxy(connection.client, { get(target, key) {
        if (key !== "query") { const value: unknown = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; }
        return (...args: unknown[]) => {
          const input: unknown = args[0];
          const text = typeof input === "string" ? input : input && typeof input === "object" ? Reflect.get(input, "text") : undefined;
          const actual: unknown = Reflect.apply(target.query, target, args);
          // Delay only the first real domain-capture ACK. No invented rows,
          // stamp, transaction result, permission or successful final decision.
          if (capturedOnce || typeof text !== "string" || !text.includes("FROM review_observation") || !text.includes("item_sources")) return actual;
          capturedOnce = true;
          return Promise.resolve(actual).then(async result => {
            const rows: unknown = result && typeof result === "object" ? Reflect.get(result, "rows") : undefined;
            const row: unknown = Array.isArray(rows) && rows.length === 1 ? rows[0] : undefined;
            const stamp: unknown = row && typeof row === "object" ? Reflect.get(row, "content_stamp") : undefined;
            expect(typeof stamp === "string" && /^[a-f0-9]{64}$/u.test(stamp)).toBe(true);
            captured.resolve(); await releaseCapture.promise; return result;
          });
        };
      } });
      const originalItem = (await f.control.query<{ display_text: string; original_display_text: string; source_excerpt: string; locator: unknown }>(
        "SELECT display_text,original_display_text,source_excerpt,locator FROM memory_proposal_items WHERE account_id=$1 AND proposal_id=$2", [f.accountId, f.proposalID])).rows[0]!;
      const originalSource = (await f.control.query<{ payload: unknown }>("SELECT payload FROM agent_sessions WHERE account_id=$1 AND id=$2", [f.accountId, f.sessionID])).rows[0]!;
      const pending = f.track(create({ config: f.config })(f.auth, f.authorization).run(client, async passed => {
        await passed.query("BEGIN");
        let prepared: PreparedReview;
        try {
          productPID = (await passed.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
          prepared = await prepare(passed, f.auth, f.scopeID, f.credential);
        } catch (error) { await passed.query("ROLLBACK"); throw error; }
        await passed.query("COMMIT"); committed.resolve();
        await releasePublication.promise; return prepared;
      }));
      try {
        await bounded(captured.promise);
        const changed = mode === "item_projection"
          ? await f.control.query<{ pid: number }>(`UPDATE memory_proposal_items SET display_text=$3,original_display_text=$3,source_excerpt=$3,
              locator=jsonb_set(locator,'{message_id}',to_jsonb($4::text)) WHERE account_id=$1 AND proposal_id=$2 RETURNING pg_backend_pid() AS pid`,
            [f.accountId, f.proposalID, "Synthetic intermediate B that must not be published.", randomUUID()])
          : await f.control.query<{ pid: number }>(`UPDATE agent_sessions SET payload=jsonb_set(payload,'{turns,0,objective}',to_jsonb($3::text))
              WHERE account_id=$1 AND id=$2 RETURNING pg_backend_pid() AS pid`, [f.accountId, f.sessionID, "Synthetic intermediate source B."]);
        expect(changed.rowCount).toBe(1); expect(changed.rows[0]!.pid !== productPID).toBe(true);
        // B is actually committed before the reader can receive capture ACK.
        releaseCapture.resolve(); await bounded(committed.promise);
        const restored = mode === "item_projection"
          ? await f.control.query("UPDATE memory_proposal_items SET display_text=$3,original_display_text=$4,source_excerpt=$5,locator=$6::jsonb WHERE account_id=$1 AND proposal_id=$2",
            [f.accountId, f.proposalID, originalItem.display_text, originalItem.original_display_text, originalItem.source_excerpt, JSON.stringify(originalItem.locator)])
          : await f.control.query("UPDATE agent_sessions SET payload=$3::jsonb WHERE account_id=$1 AND id=$2", [f.accountId, f.sessionID, JSON.stringify(originalSource.payload)]);
        expect(restored.rowCount).toBe(1);
        releasePublication.resolve();
        const value = await pending;
        expect(isDeepStrictEqual(value.body, baseline.body)).toBe(true);
        expect(value.encodedBody === baseline.encodedBody).toBe(true);
        expect(value.body.review.items[0]?.display_text).toBe(f.sentence);
        expect(connection.state).toMatchObject({ finalQueries: 1, commitsBeforeFinal: 1, finalHasActualPositiveRow: true, queriesAfterFinal: 0 });
      } finally { releaseCapture.resolve(); releasePublication.resolve(); await pending.catch(() => {}); connection.release(); }
    });
  }, 25_000);
});
