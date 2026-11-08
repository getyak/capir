import { randomUUID } from "node:crypto";
import type { UnscopedChatTaskResponse } from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";
import { sessionDatabase, SessionRecoveryProcess, waitSessionCondition, withEmptySessionScenario } from "./fixtures/legacyChatSessionContinuity.fixture.js";

// New finite Session slice, not arbitrary history/tool/Native coverage. All
// records and credentials belong to generated accounts in the guarded CI DB.
describe.skipIf(!sessionDatabase)("empty Session durable source, publication and private retirement", () => {
  it.each([false, true])("publishes disabled completion and real Session lineage once (internalLab=%s)", async internalLab => {
    await withEmptySessionScenario({ disabled: true, internalLab }, async f => {
      const session = await f.createSession(), first = f.start(session.id), result = await first.promise;
      expect(result.statusCode).toBe(201); expect(f.calls()).toBe(0);
      const body = result.json<UnscopedChatTaskResponse>(), row = await f.ledger(first.key, session.id);
      expect(row).toBeDefined(); expect(row?.state).toBe("completed"); expect(row?.dispatched).toBe(false); expect(row?.scrubbed).toBe(true);
      expect(row?.task_id).toBe(body.task_id);
      expect(await f.counts(session.id)).toEqual({ lineage: 1, audits: 1 });
      const repeat = await f.start(session.id, first.key).promise;
      expect(repeat.statusCode).toBe(201); expect(repeat.json<UnscopedChatTaskResponse>().task_id).toBe(body.task_id);
      expect(await f.counts(session.id)).toEqual({ lineage: 1, audits: 1 }); expect(f.calls()).toBe(0);
    });
  }, 15_000);

  it("serializes two different-key ready attempts on one Session without allowing each to ignore the other's lineage", async () => {
    await withEmptySessionScenario({}, async f => {
      const session = await f.createSession(); f.holdCall(1); f.holdCall(2); f.holdReady();
      const first = f.start(session.id); await f.waitCalls(1);
      const second = f.start(session.id); await f.waitCalls(2);
      // Checkpoint transactions are committed one at a time, then their real
      // ACK returns are held. Both ready rows therefore exist before either
      // finalizer can publish, without holding any SQL transaction open.
      f.releaseCall(1); await waitSessionCondition(() => f.readyCount() === 1);
      f.releaseCall(2); await waitSessionCondition(() => f.readyCount() === 2);
      const before = [await f.ledger(first.key, session.id), await f.ledger(second.key, session.id)];
      expect(before.map(row => row?.state)).toEqual(["result_ready", "result_ready"]);
      expect(before.every(row => row?.snapshot_version === 2 && row.exact_session && !row.scrubbed)).toBe(true);
      f.releaseReady();
      const responses = await Promise.all([first.promise, second.promise]);
      expect(responses.map(response => response.statusCode).sort()).toEqual([201, 409]);
      expect(await f.counts(session.id)).toEqual({ lineage: 1, audits: 1 });
      const after = [await f.ledger(first.key, session.id), await f.ledger(second.key, session.id)];
      expect(after.every(row => row?.scrubbed)).toBe(true);
      expect(after.filter(row => row?.state === "completed")).toHaveLength(1);
      for (let i = 0; i < after.length; i++) expect(after[i]?.attempt_id).toBe(before[i]?.attempt_id);
      expect(f.calls()).toBe(2);
    });
  }, 15_000);

  it("fences the real legacy lineage writer before the durable final source check", async () => {
    await withEmptySessionScenario({}, async f => {
      const session = await f.createSession(); f.holdCall(1); f.holdCall(2); f.holdReady();
      const durable = f.start(session.id); await f.waitCalls(1);
      f.releaseCall(1); await waitSessionCondition(() => f.readyCount() === 1);
      expect((await f.ledger(durable.key, session.id))?.state).toBe("result_ready");
      // A current-message request is intentionally outside this new empty
      // slice. It exercises the unchanged real synchronous completion owner.
      const legacy = f.start(session.id, randomUUID(), randomUUID()); await f.waitCalls(2);
      f.holdNextSource(); f.releaseReady();
      await waitSessionCondition(() => f.sourceEntered.settled());
      // The actual durable SELECT has acquired its Session FOR UPDATE lock.
      // The actual legacy writer's FOR SHARE NOWAIT must now fail, rather than
      // insert a phantom origin task between empty check and publication.
      f.releaseCall(2);
      const losing = await legacy.promise; expect(losing.statusCode).toBe(409);
      f.releaseSource();
      const winning = await durable.promise; expect(winning.statusCode).toBe(201);
      expect(await f.counts(session.id)).toEqual({ lineage: 1, audits: 1 });
      expect((await f.ledger(durable.key, session.id))?.scrubbed).toBe(true); expect(f.calls()).toBe(2);
    });
  }, 15_000);

  it.each(["queue", "origin_task", "mcp_request", "oauth_request", "outbox"] as const)(
    "does not classify an empty payload as server-empty when %s context already exists", async kind => {
      await withEmptySessionScenario({}, async f => {
        const session = await f.createSession(), id = randomUUID();
        if (kind === "origin_task") {
          // Actual old completion producer supplies the origin row; no task
          // or reply is fabricated just to make this predicate non-empty.
          expect((await f.start(session.id, randomUUID(), randomUUID()).promise).statusCode).toBe(201);
          expect(await f.counts(session.id)).toEqual({ lineage: 1, audits: 1 });
        } else if (kind === "queue") {
          await f.q(`INSERT INTO conversation_queue_entries(account_id,session_id,id,message_id,created_by_user_id,
            sequence,status,objective,idempotency_key,expires_at)
            VALUES($1,$2,$3,$4,$5,1,'queued','Synthetic reserved input',$6,clock_timestamp()+interval '1 hour')`,
          [f.accountId, session.id, id, randomUUID(), f.userId, "queued-" + id]);
        } else if (kind === "outbox") {
          // Outbox has its own owner/scope; no MCP Session ref is added to
          // accidentally satisfy a different negative predicate.
          await f.q(`INSERT INTO mcp_continuation_outbox(account_id,request_id,created_by_user_id,session_id,message_id,
            idempotency_key,body) VALUES($1,$2,$3,$4,$5,$6,'Synthetic pending continuation')`,
          [f.accountId, id, f.userId, session.id, randomUUID(), "outbox-" + id]);
        } else {
          await f.q(`INSERT INTO mcp_interaction_requests(account_id,id,created_by_user_id,call_id,kind,state,purpose,
            target,arguments_display,choices,session_id,bound_arguments,expires_at)
            VALUES($1,$2,$3,$2,'oauth','pending','Synthetic pending request',$4::jsonb,'{}','[]'::jsonb,$5,'{}',clock_timestamp()+interval '1 hour')`,
          [f.accountId, id, f.userId, JSON.stringify({ auth_mode: null, connection_label: "Synthetic", server_origin: "internal:choice", tool_name: null }),
            kind === "mcp_request" ? session.id : null]);
          if (kind === "oauth_request") await f.q(`INSERT INTO mcp_oauth_connect_requests(connect_request_id,account_id,id,
            created_by_user_id,session_id,provider,mcp_server_url,expires_at)
            VALUES($1,$2,$3,$4,$5,'synthetic','https://mcp.example.invalid',clock_timestamp()+interval '1 hour')`,
          ["synthetic-" + id, f.accountId, id, f.userId, session.id]);
        }
        const call = f.calls() + 1; f.holdCall(call);
        const pending = f.start(session.id); await f.waitCalls(call);
        const row = await f.ledger(pending.key, session.id);
        expect(row).toBeUndefined(); // Legitimate ineligible route stays legacy.
        expect((await f.q<{ empty: boolean }>("SELECT jsonb_array_length(payload->'turns')=0 AS empty FROM agent_sessions WHERE account_id=$1 AND id=$2",
          [f.accountId, session.id])).rows[0]?.empty).toBe(true);
        f.releaseCall(call);
        expect((await pending.promise).statusCode).toBe(201);
        expect(f.calls()).toBe(call);
      });
    }, 15_000);

  it.each(["delete", "context", "expiry"] as const)("scrubs the target Session's pending private copy before a held provider is released (%s)", async kind => {
    await withEmptySessionScenario({}, async f => {
      // The context mutation reuses a real earlier producer result, not a
      // fabricated stored turn or an invented history permission.
      const prior = kind === "context" ? await f.start(undefined).promise : null;
      if (prior) expect(prior.statusCode).toBe(201);
      const session = await f.createSession(), call = f.calls() + 1; f.holdCall(call);
      const held = f.start(session.id); await f.waitCalls(call);
      const original = await f.ledger(held.key, session.id);
      expect(original?.snapshot_version).toBe(2); expect(original?.exact_session).toBe(true); expect(original?.scrubbed).toBe(false);
      if (kind === "delete") {
        const response = await f.app.inject({ method: "DELETE", url: "/v1/agent-sessions/" + session.id, headers: f.headers,
          payload: { expected_revision: session.revision, idempotency_key: randomUUID() } });
        expect(response.statusCode).toBe(200);
      } else if (kind === "context") {
        const body = prior!.json<UnscopedChatTaskResponse>(), stamp = body.created_at;
        const turn = { id: randomUUID(), objective: "Give a synthetic greeting.", createdAt: stamp, response: {
          contractVersion: body.contract_version, taskID: body.task_id, contextManifestID: body.context_manifest_id,
          knowledgeSnapshotID: body.knowledge_snapshot_id, disposition: body.disposition, createdAt: stamp } };
        const response = await f.app.inject({ method: "PUT", url: "/v1/agent-sessions/" + session.id, headers: f.headers,
          payload: { expected_revision: session.revision, idempotency_key: randomUUID(),
            payload: { ...session.payload, turns: [turn], updatedAt: new Date().toISOString() } } });
        expect(response.statusCode).toBe(200);
      } else {
        // Shortening only the synthetic owned Session emulates real expiry;
        // its canonical GET invokes the actual retention owner before purge.
        await f.q("UPDATE agent_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1 AND id=$2", [f.accountId, session.id]);
        expect((await f.app.inject({ method: "GET", url: "/v1/agent-sessions/" + session.id, headers: f.headers })).statusCode).toBe(200);
      }
      const retired = await f.ledger(held.key, session.id);
      expect(retired?.scrubbed).toBe(true); expect(retired?.state).not.toBe("completed");
      expect(retired?.attempt_id).toBe(original?.attempt_id); expect(retired?.fixed_deadline).toBe(original?.fixed_deadline);
      f.releaseCall(call);
      expect((await held.promise).statusCode).toBe(409);
      expect(await f.counts(session.id)).toEqual({ lineage: 0, audits: 0 });
    });
  }, 15_000);

  it("does not retire an unrelated empty Session or bump the account source epoch", async () => {
    await withEmptySessionScenario({}, async f => {
      const a = await f.createSession(), b = await f.createSession(); f.holdCall(1); f.holdCall(2);
      const first = f.start(a.id); await f.waitCalls(1); const second = f.start(b.id); await f.waitCalls(2);
      const epoch = async () => (await f.q<{ value: string }>("SELECT COALESCE((SELECT generation FROM harness_source_generations WHERE account_id=$1),0)::text AS value", [f.accountId])).rows[0]!.value;
      const before = await epoch();
      const deleted = await f.app.inject({ method: "DELETE", url: "/v1/agent-sessions/" + a.id, headers: f.headers,
        payload: { expected_revision: a.revision, idempotency_key: randomUUID() } });
      expect(deleted.statusCode).toBe(200); expect(await epoch()).toBe(before);
      expect((await f.ledger(first.key, a.id))?.scrubbed).toBe(true);
      expect((await f.ledger(second.key, b.id))?.scrubbed).toBe(false);
      f.releaseCall(2); expect((await second.promise).statusCode).toBe(201);
      f.releaseCall(1); expect((await first.promise).statusCode).toBe(409);
      expect(await f.counts(a.id)).toEqual({ lineage: 0, audits: 0 }); expect(await f.counts(b.id)).toEqual({ lineage: 1, audits: 1 });
      expect(f.calls()).toBe(2);
    });
  }, 15_000);

  it("retains a pending source across a title-only canonical update", async () => {
    await withEmptySessionScenario({}, async f => {
      const session = await f.createSession(); f.holdCall(1); const held = f.start(session.id); await f.waitCalls(1);
      const before = await f.ledger(held.key, session.id);
      const update = await f.app.inject({ method: "PUT", url: "/v1/agent-sessions/" + session.id, headers: f.headers,
        payload: { expected_revision: session.revision, idempotency_key: randomUUID(),
          payload: { ...session.payload, title: "Synthetic renamed Session", updatedAt: new Date().toISOString() } } });
      expect(update.statusCode).toBe(200);
      const current = await f.ledger(held.key, session.id);
      expect(current?.scrubbed).toBe(false); expect(current?.attempt_id).toBe(before?.attempt_id);
      f.releaseCall(1); expect((await held.promise).statusCode).toBe(201);
      expect(await f.counts(session.id)).toEqual({ lineage: 1, audits: 1 });
    });
  }, 15_000);

  it.each([false, true])("restores only the original Session/deadline after actual ready-owner death (deleteSession=%s)", async deleteSession => {
    await withEmptySessionScenario({}, async f => {
      const children: SessionRecoveryProcess[] = [];
      try {
        const session = await f.createSession(), key = randomUUID();
        // This actual source lifetime is shorter than the60s execution cap.
        // Later extension cannot rebase the stored original deadline.
        const owner = new SessionRecoveryProcess("ready_committed"); children.push(owner); await owner.ready();
        const originalLogin = await f.loginChild(owner);
        await f.q("UPDATE agent_sessions SET expires_at=clock_timestamp()+interval '50 seconds' WHERE account_id=$1 AND id=$2", [f.accountId, session.id]);
        const request = { idempotency_key: key, objective: "Give a synthetic greeting.", session_id: session.id };
        const pending = owner.http("POST", "/v1/chat/unscoped-tasks", originalLogin, request, 0);
        const notice = await owner.notice("ready_committed"); expect(notice.calls).toBe(1);
        const before = await f.ledger(key, session.id);
        expect(before?.state).toBe("result_ready"); expect(before?.snapshot_version).toBe(2);
        expect(before?.exact_session).toBe(true); expect(before?.lease_elapsed).toBe(false);
        expect((await f.q<{ original: boolean }>(`SELECT e.execution_deadline=s.expires_at
          AND e.source_snapshot->>'expiresAt'=to_char(e.execution_deadline AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
          AND e.source_snapshot->>'sessionExpiresAt'=to_char(s.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS original
          FROM legacy_chat_executions e JOIN idempotency_records p ON p.account_id=e.account_id AND p.id=e.idempotency_id
          JOIN agent_sessions s ON s.account_id=e.account_id AND s.id=$3
          WHERE p.account_id=$1 AND p.idempotency_key=$2`, [f.accountId, key, session.id])).rows[0]?.original).toBe(true);
        await owner.killOwner(); expect((await pending).closed).toBe(true);
        if (deleteSession) {
          const removed = await f.app.inject({ method: "DELETE", url: "/v1/agent-sessions/" + session.id, headers: f.headers,
            payload: { expected_revision: session.revision, idempotency_key: randomUUID() } });
          expect(removed.statusCode).toBe(200);
          expect((await f.ledger(key, session.id))?.scrubbed).toBe(true);
        } else {
          // Only the owned source TTL is restored to its legal original max.
          // No proof, execution deadline or real30s lease is modified.
          await f.q("UPDATE agent_sessions SET expires_at=created_at+interval '30 days' WHERE account_id=$1 AND id=$2", [f.accountId, session.id]);
        }
        const replacement = new SessionRecoveryProcess("normal"); children.push(replacement); await replacement.ready();
        if (!deleteSession) {
          await waitSessionCondition(async () => {
            const current = await f.ledger(key, session.id);
            expect(current?.task_id).toBe(before?.task_id); expect(current?.attempt_id).toBe(before?.attempt_id);
            expect(current?.fixed_deadline).toBe(before?.fixed_deadline);
            return current?.lease_elapsed === true;
          }, 40_000); // The actual unchanged product lease must really expire.
        }
        const fresh = await f.loginChild(replacement);
        const response = await replacement.http("POST", "/v1/chat/unscoped-task-resolve", fresh, { idempotency_key: key });
        const after = await f.ledger(key, session.id);
        expect(after?.attempt_id).toBe(before?.attempt_id); expect(after?.task_id).toBe(before?.task_id);
        expect(after?.fixed_deadline).toBe(before?.fixed_deadline); expect(after?.scrubbed).toBe(true);
        expect(await replacement.calls()).toBe(0);
        if (deleteSession) {
          expect(response.status).toBe(409); expect(after?.state).not.toBe("completed");
          expect(await f.counts(session.id)).toEqual({ lineage: 0, audits: 0 });
        } else {
          expect(response.status).toBe(201); expect(after?.state).toBe("completed");
          expect((response.body as UnscopedChatTaskResponse).task_id).toBe(before?.task_id);
          expect(await f.counts(session.id)).toEqual({ lineage: 1, audits: 1 });
          expect((await f.q<{ origin: string }>("SELECT origin_session_id::text AS origin FROM agent_session_chat_tasks WHERE account_id=$1 AND task_id=$2",
            [f.accountId, before?.task_id])).rows).toEqual([{ origin: session.id }]);
          const replay = await replacement.http("POST", "/v1/chat/unscoped-tasks", fresh, request);
          expect(replay.status).toBe(201); expect(replay.body).toEqual(response.body);
          expect(await replacement.calls()).toBe(0); expect(await f.counts(session.id)).toEqual({ lineage: 1, audits: 1 });
        }
      } finally {
        const results = await Promise.allSettled(children.map(child => child.close()));
        expect(results.every(result => result.status === "fulfilled"), "Every task-owned child exit must be verified.").toBe(true);
      }
    });
  }, 90_000);
});
