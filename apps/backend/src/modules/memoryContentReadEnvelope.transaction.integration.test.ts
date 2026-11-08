import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/apiError.js";
import { database, observedClient, requiredContentAPIs, withReviewFixture } from "./fixtures/memoryContentReadEnvelope.fixture.js";

// Real PostgreSQL propositions, not query doubles or caller-made auth/fences.
// This supplements the unchanged17 Review cases; it does not replace their
// COMMIT/final-ACK expiry, current-source or exact-body obligations.
describe.skipIf(!database)("Memory content reader requires an actual autocommit boundary", () => {
  it("observes different top-level xid8 values in successive autocommit statements on the same real client", async () => {
    await withReviewFixture(async f => {
      const client = await f.pool.connect();
      try {
        const first = (await client.query<{ xid: string; pid: number }>("SELECT pg_current_xact_id()::text AS xid,pg_backend_pid() AS pid")).rows[0]!;
        const second = (await client.query<{ xid: string; pid: number }>("SELECT pg_current_xact_id()::text AS xid,pg_backend_pid() AS pid")).rows[0]!;
        expect(/^[1-9][0-9]*$/u.test(first.xid) && /^[1-9][0-9]*$/u.test(second.xid)).toBe(true);
        expect(first.pid === second.pid).toBe(true); expect(first.xid !== second.xid).toBe(true);
      } finally { client.release(); }
    });
  }, 25_000);

  it.each(["BEGIN", "BEGIN READ ONLY"] as const)("observes one top-level xid8 across two real statements in caller %s", async begin => {
    await withReviewFixture(async f => {
      const client = await f.pool.connect();
      try {
        await client.query(begin);
        const initial = (await client.query<{ xid: string | null }>("SELECT pg_current_xact_id_if_assigned()::text AS xid")).rows[0]!;
        expect(initial.xid === null).toBe(true); // No application/table write supplied an XID.
        const first = (await client.query<{ xid: string }>("SELECT pg_current_xact_id()::text AS xid")).rows[0]!;
        const second = (await client.query<{ xid: string }>("SELECT pg_current_xact_id()::text AS xid")).rows[0]!;
        expect(/^[1-9][0-9]*$/u.test(first.xid)).toBe(true); expect(first.xid === second.xid).toBe(true);
      } finally { try { await client.query("ROLLBACK"); } finally { client.release(); } }
    });
  }, 25_000);

  it.each(["BEGIN", "BEGIN READ ONLY"] as const)("refuses a pre-existing no-write %s before load and leaves that caller transaction alone", async begin => {
    await withReviewFixture(async f => {
      const { create, prepare } = requiredContentAPIs();
      const connection = observedClient(await f.pool.connect());
      let called = false;
      try {
        await connection.client.query(begin);
        // Only a transaction-local synthetic marker. No product/global setting,
        // permission or source row is changed; ROLLBACK in finally restores it.
        await connection.client.query("SET LOCAL application_name='synthetic-memory-content-outer'");
        const initial = (await connection.client.query<{ xid: string | null }>("SELECT pg_current_xact_id_if_assigned()::text AS xid")).rows[0]!;
        expect(initial.xid === null).toBe(true);
        const result = await create({ config: f.config })(f.auth, f.authorization).run(connection.client, async client => {
          called = true; return prepare(client, f.auth, f.scopeID, f.credential);
        }).then(value => ({ value, error: null }), error => ({ error }));
        expect("value" in result).toBe(false);
        expect(result.error instanceof ApiError && result.error.statusCode === 409).toBe(true);
        expect(called).toBe(false);
        expect(connection.state.finalQueries).toBe(0); expect(connection.state.commitsBeforeFinal).toBe(0);
        const marker = (await connection.client.query<{ marker: string }>("SELECT current_setting('application_name') AS marker")).rows[0]!;
        expect(marker.marker === "synthetic-memory-content-outer").toBe(true);
      } finally { try { await connection.client.query("ROLLBACK"); } finally { connection.release(); } }
    });
  }, 25_000);

  it("still completes a genuine short preparation transaction and publishes the original Review on that same client", async () => {
    await withReviewFixture(async f => {
      const { create, prepare } = requiredContentAPIs();
      const connection = observedClient(await f.pool.connect());
      try {
        const value = await create({ config: f.config })(f.auth, f.authorization).run(connection.client, async client => {
          await client.query("BEGIN");
          try {
            const prepared = await prepare(client, f.auth, f.scopeID, f.credential);
            await client.query("COMMIT"); return prepared;
          } catch (error) { await client.query("ROLLBACK"); throw error; }
        });
        expect(value.body.review.items[0]?.display_text).toBe(f.sentence);
        expect(connection.state).toMatchObject({ finalQueries: 1, commitsBeforeFinal: 1, finalHasActualPositiveRow: true, queriesAfterFinal: 0 });
      } finally { connection.release(); }
    });
  }, 25_000);
});
