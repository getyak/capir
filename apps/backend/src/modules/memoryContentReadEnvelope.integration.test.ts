import { randomUUID, createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import type { MemoryReviewResponse } from "@talent-signal/contracts";
import { ApiError } from "../lib/apiError.js";
import { hashReviewCredential } from "./memoryReviewRead.js";
import { barrier, bounded, database, observedClient, requiredContentAPIs,
  withReviewFixture, type PreparedReview } from "./fixtures/memoryContentReadEnvelope.fixture.js";

type Fixture = Parameters<Parameters<typeof withReviewFixture>[0]>[0];

async function prepareInReadTransaction(client: PoolClient, f: Fixture): Promise<PreparedReview> {
  const { prepare } = requiredContentAPIs();
  await client.query("BEGIN");
  let result: PreparedReview;
  try { result = await prepare(client, f.auth, f.scopeID, f.credential); }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  // ACK (and any actual canonical readback a future mutation needs) precedes
  // returning prepared bytes to the final publication probe. No outer COMMIT.
  await client.query("COMMIT");
  return result;
}

function expectDenied(result: { error: unknown; value?: PreparedReview }) {
  expect(result.value === undefined).toBe(true);
  expect(result.error instanceof ApiError).toBe(true);
  expect((result.error as ApiError).statusCode).toBe(409);
}

// Failure reporters must never serialize a prepared review/credential. Keep
// exact deep/JSON/byte comparisons, but expose only a boolean even if parsing
// fails (native JSON SyntaxError messages may otherwise quote input bytes).
function sameJSON(encoded: string, expected: unknown): boolean {
  try { return isDeepStrictEqual(JSON.parse(encoded), expected); }
  catch { return false; }
}

describe.skipIf(!database)("joint Memory Review publication over real HTTP-owned rows and PostgreSQL", () => {
  it("preserves real legacy review bytes, one client, and no I/O after the joint final observation", async () => {
    await withReviewFixture(async f => {
      const baseline = await f.originalReview();
      const { create } = requiredContentAPIs();
      const factory = create({ config: f.config, deploymentWorkspaceIds: [f.accountId] });
      const connection = observedClient(await f.pool.connect());
      const beforePID = (await connection.client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
      try {
        const value = await factory(f.auth, f.authorization).run(connection.client, async passed => {
          expect((await passed.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid).toBe(beforePID);
          return prepareInReadTransaction(passed, f);
        });
        expect(isDeepStrictEqual(value.body, baseline.body)).toBe(true);
        expect(value.encodedBody === baseline.encodedBody).toBe(true);
        expect(sameJSON(value.encodedBody, baseline.body)).toBe(true);
        expect(value.body.review.items[0]?.display_text).toBe(f.sentence);
        expect(Object.isFrozen(value)).toBe(true);
        expect(Object.isFrozen(value.body)).toBe(true);
        expect(connection.state).toMatchObject({ finalQueries: 1, commitsBeforeFinal: 1,
          queriesAfterFinal: 0, finalAcknowledged: true, finalHasActualPositiveRow: true });
      } finally { connection.release(); }
    });
  }, 25_000);

  it("freezes actual configured audience instead of trusting a later mutable registration array", async () => {
    await withReviewFixture(async f => {
      const { create } = requiredContentAPIs();
      const audience = [f.accountId], config = { ...f.config };
      const factory = create({ config, deploymentWorkspaceIds: audience });
      audience.length = 0; // A registration mutation must not rewrite admitted scope.
      config.internalLabEnabled = true;
      const connection = observedClient(await f.pool.connect());
      try {
        const value = await factory(f.auth, f.authorization).run(connection.client, client => prepareInReadTransaction(client, f));
        expect(value.body.review.items[0]?.display_text).toBe(f.sentence);
        expect(connection.state.finalQueries).toBe(1);
      } finally { connection.release(); }
    });
  }, 25_000);

  it("rejects a configured audience mismatch without exposing otherwise valid review bytes", async () => {
    await withReviewFixture(async f => {
      const { create } = requiredContentAPIs();
      const connection = observedClient(await f.pool.connect());
      let called = false;
      try {
        const result = await Promise.resolve().then(() => create({ config: f.config, deploymentWorkspaceIds: [randomUUID()] })(f.auth, f.authorization)
          .run(connection.client, async client => { called = true; return prepareInReadTransaction(client, f); }))
          .then(value => ({ value, error: null }), error => ({ error }));
        expect("value" in result).toBe(false);
        expect(result.error instanceof ApiError).toBe(true);
        expect((result.error as ApiError).statusCode).toBe(403); // Existing configured-audience policy.
        expect(called).toBe(false);
      } finally { connection.release(); }
    });
  }, 25_000);

  it("refuses finalization inside an unclosed caller transaction instead of leaving a COMMIT after the fence", async () => {
    await withReviewFixture(async f => {
      const { create, prepare } = requiredContentAPIs();
      const connection = observedClient(await f.pool.connect());
      try {
        const result = await create({ config: f.config })(f.auth, f.authorization).run(connection.client, async passed => {
          await passed.query("BEGIN");
          return prepare(passed, f.auth, f.scopeID, f.credential);
        }).then(value => ({ value, error: null }), error => ({ error }));
        expectDenied(result);
        expect(connection.state.finalQueries).toBe(0);
        expect(connection.state.commitsBeforeFinal).toBe(0);
      } finally {
        // This cleanup occurs only after refusal; it never manufactures final
        // success or turns a real acknowledged COMMIT into a claimed rollback.
        if (!connection.state.released) await connection.client.query("ROLLBACK");
        connection.release();
      }
    });
  }, 25_000);

  it("accepts the actual still-live previous header while binding the new current generation", async () => {
    await withReviewFixture(async f => {
      await f.control.query("UPDATE sessions SET previous_token_hash=token_hash,previous_token_expires_at=clock_timestamp()+interval '1 hour',token_hash=$3 WHERE account_id=$1 AND id=$2",
        [f.accountId, f.auth.sessionId, createHash("sha256").update(randomUUID()).digest("hex")]);
      await f.assertActualHeaderAccepted();
      const { create } = requiredContentAPIs();
      const connection = observedClient(await f.pool.connect());
      try {
        const value = await create({ config: f.config })(f.auth, f.authorization)
          .run(connection.client, passed => prepareInReadTransaction(passed, f));
        expect(value.body.review.items[0]?.display_text).toBe(f.sentence);
        expect(connection.state.finalQueries).toBe(1);
      } finally { connection.release(); }
    });
  }, 25_000);

  it("cannot extend the original accepted previous-slot deadline during preparation", async () => {
    await withReviewFixture(async f => {
      const deadline = (await f.control.query<{ deadline: string }>(`UPDATE sessions
        SET previous_token_hash=token_hash,previous_token_expires_at=clock_timestamp()+interval '3 seconds',token_hash=$3
        WHERE account_id=$1 AND id=$2 RETURNING to_char(previous_token_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS deadline`,
      [f.accountId, f.auth.sessionId, createHash("sha256").update(randomUUID()).digest("hex")])).rows[0]!.deadline;
      await f.assertActualHeaderAccepted();
      const { create } = requiredContentAPIs();
      const connection = observedClient(await f.pool.connect());
      try {
        const result = await create({ config: f.config })(f.auth, f.authorization).run(connection.client, async passed => {
          const prepared = await prepareInReadTransaction(passed, f);
          await f.control.query("UPDATE sessions SET previous_token_expires_at=clock_timestamp()+interval '1 hour' WHERE account_id=$1 AND id=$2", [f.accountId, f.auth.sessionId]);
          await f.waitExpiry(deadline); return prepared;
        }).then(value => ({ value, error: null }), error => ({ error }));
        expectDenied(result);
      } finally { connection.release(); }
    });
  }, 25_000);

  it.each(["revoke_login", "rotate_current", "review_revision", "review_credential", "item_text"] as const)(
    "refuses %s withdrawn after genuine preparation, even when the encoded body remains unchanged", async change => {
      await withReviewFixture(async f => {
        const { create } = requiredContentAPIs();
        const connection = observedClient(await f.pool.connect());
        let preparedBody: MemoryReviewResponse | undefined;
        try {
          const result = await create({ config: f.config, deploymentWorkspaceIds: [f.accountId] })(f.auth, f.authorization)
            .run(connection.client, async passed => {
              const prepared = await prepareInReadTransaction(passed, f);
              preparedBody = prepared.body;
              if (change === "revoke_login") await f.control.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE account_id=$1 AND id=$2", [f.accountId, f.auth.sessionId]);
              if (change === "rotate_current") await f.control.query("UPDATE sessions SET previous_token_hash=token_hash,previous_token_expires_at=clock_timestamp()+interval '1 hour',token_hash=$3 WHERE account_id=$1 AND id=$2",
                [f.accountId, f.auth.sessionId, createHash("sha256").update(randomUUID()).digest("hex")]);
              if (change === "review_revision") await f.control.query("UPDATE memory_review_scopes SET revision=revision+1 WHERE account_id=$1 AND id=$2", [f.accountId, f.scopeID]);
              if (change === "review_credential") await f.control.query("UPDATE memory_review_credentials SET revoked_at=clock_timestamp() WHERE account_id=$1 AND review_scope_id=$2 AND credential_hash=$3",
                [f.accountId, f.scopeID, hashReviewCredential(f.credential)]);
              if (change === "item_text") await f.control.query("UPDATE memory_proposal_items SET display_text='Changed synthetic statement' WHERE account_id=$1 AND proposal_id=$2", [f.accountId, f.proposalID]);
              return prepared;
            }).then(value => ({ value, error: null }), error => ({ error }));
          expect(preparedBody?.review.items[0]?.display_text).toBe(f.sentence);
          expectDenied(result);
          expect(connection.state.finalQueries).toBe(1);
          expect(connection.state.queriesAfterFinal).toBe(0);
        } finally { connection.release(); }
      });
    }, 25_000);

  it("does not use transaction-start now() to publish a pending source after its real Session TTL passes", async () => {
    await withReviewFixture(async f => {
      const { create, prepare } = requiredContentAPIs();
      const connection = observedClient(await f.pool.connect());
      try {
        const result = await create({ config: f.config })(f.auth, f.authorization).run(connection.client, async passed => {
          await passed.query("BEGIN");
          let prepared: PreparedReview;
          try {
            prepared = await prepare(passed, f.auth, f.scopeID, f.credential);
            expect(prepared.body.review.items[0]?.display_text).toBe(f.sentence);
            const deadline = (await f.control.query<{ deadline: string }>(`UPDATE agent_sessions SET expires_at=clock_timestamp()+interval '1 second'
              WHERE account_id=$1 AND id=$2 RETURNING to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS deadline`, [f.accountId, f.sessionID])).rows[0]!.deadline;
            await f.waitExpiry(deadline);
          } catch (error) { await passed.query("ROLLBACK"); throw error; }
          await passed.query("COMMIT"); return prepared;
        }).then(value => ({ value, error: null }), error => ({ error }));
        expectDenied(result); expect(connection.state.commitsBeforeFinal).toBe(1);
      } finally { connection.release(); }
    });
  }, 25_000);

  it.each(["commit", "final"] as const)("charges the whole real %s ACK window without delivering after current-reader expiry", async phase => {
    await withReviewFixture(async f => {
      const { create } = requiredContentAPIs(), deadline = await f.shortenLogin();
      const entered = barrier(), release = barrier(); f.releaseOnClose(release.resolve);
      const connection = observedClient(await f.pool.connect(), { phase, entered, release });
      const pending = f.track(create({ config: f.config })(f.auth, f.authorization)
        .run(connection.client, passed => prepareInReadTransaction(passed, f))
        .then(value => ({ value, error: null }), error => ({ error })));
      try {
        await bounded(entered.promise);
        if (phase === "commit") expect(connection.state.realCommitsAcknowledged).toBe(1);
        else expect(connection.state.finalHasActualPositiveRow).toBe(true);
        await f.waitExpiry(deadline); release.resolve();
        expectDenied(await pending);
        expect(connection.state.queriesAfterFinal).toBe(0);
        // A post-COMMIT refusal is a read-delivery denial, not a rollback of the
        // already created source/proposal/scope or a reason to rotate credentials.
        expect((await f.control.query<{ count: number }>("SELECT count(*)::int AS count FROM memory_review_scopes WHERE account_id=$1 AND id=$2", [f.accountId, f.scopeID])).rows[0]?.count).toBe(1);
      } finally { release.resolve(); await pending; connection.release(); }
    });
  }, 25_000);

  it.each(["commit", "final"] as const)("delivers before expiry through the same real %s ACK path", async phase => {
    await withReviewFixture(async f => {
      const { create } = requiredContentAPIs(); await f.shortenLogin();
      const entered = barrier(), release = barrier(); f.releaseOnClose(release.resolve);
      const connection = observedClient(await f.pool.connect(), { phase, entered, release });
      const pending = f.track(create({ config: f.config })(f.auth, f.authorization)
        .run(connection.client, passed => prepareInReadTransaction(passed, f)));
      try {
        await bounded(entered.promise); release.resolve();
        const value = await pending;
        expect(value.body.review.items[0]?.display_text).toBe(f.sentence);
        expect(sameJSON(value.encodedBody, value.body)).toBe(true);
        expect(connection.state).toMatchObject({ finalQueries: 1, commitsBeforeFinal: 1,
          finalHasActualPositiveRow: true, queriesAfterFinal: 0 });
      } finally { release.resolve(); await pending.catch(() => {}); connection.release(); }
    });
  }, 25_000);

  it("rejects a caller's copy of a real body with an invented domain fence", async () => {
    await withReviewFixture(async f => {
      const { create } = requiredContentAPIs();
      const connection = observedClient(await f.pool.connect());
      try {
        const result = await create({ config: f.config })(f.auth, f.authorization).run(connection.client, async passed => {
          const actual = await prepareInReadTransaction(passed, f);
          return { ...actual, finalFence: { kind: "review", accountId: f.accountId, scopeID: f.scopeID } };
        }).then(value => ({ value, error: null }), error => ({ error }));
        expectDenied(result); // An attacker-provided object is never a positive control.
      } finally { connection.release(); }
    });
  }, 25_000);
});
