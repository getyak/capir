/** Real source-owner reads against the explicit disposable PostgreSQL fixture.
 * These parameter observations are not a joined credential/Memory read grant. */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CONTRACT_VERSION, type ResourceCaptureRequest, type ResourceCaptureResponse,
  type UnscopedChatTaskResponse } from "@talent-signal/contracts";
import { createHarnessSourceGuardWithBinding, readHarnessRunSourceBinding,
  type HarnessSourceAuthority } from "./harnessSourceGuard.js";
import { savedMemoryDatabase, withSavedMemoryFixture,
  type SavedMemoryFixture } from "./fixtures/savedMemoryDiscovery.fixture.js";

if (process.env.GET_455_HARNESS_SOURCE_BINDING_TEST_REQUIRED === "1" && !savedMemoryDatabase) {
  throw new Error("Source owner binding requires the explicit disposable loopback PostgreSQL fixture.");
}

async function actualSource(f: SavedMemoryFixture) {
  const objective = "A synthetic source-owner Session for immutable parameter observations.";
  const task = await f.post({ idempotency_key: randomUUID(), objective });
  expect(task.statusCode).toBe(201);
  const sessionID = randomUUID();
  const session = await f.saveAnswer(sessionID, objective, task.json<UnscopedChatTaskResponse>());
  // A real negative retention-clock transition only. Give the actual Session
  // a non-rounded six-digit deadline without extending it or fabricating proof.
  const narrowed = await f.pool.query<{ expires_at: Date; exact_expiry: string; stamp: string }>(
    `UPDATE agent_sessions SET expires_at=date_trunc('milliseconds',expires_at)-interval '1 microsecond'
     WHERE account_id=$1 AND created_by_user_id=$2 AND id=$3
     RETURNING expires_at,to_char(expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS exact_expiry,
       md5(jsonb_build_array(payload->'turns',payload->'personID',payload->'relationshipContextID')::text) AS stamp`,
    [f.auth.accountId, f.auth.userId, sessionID]);
  expect(narrowed.rowCount).toBe(1);
  const row = narrowed.rows[0];
  if (!row) throw new Error("The actual owner Session omitted its source clock.");
  expect(row.exact_expiry.endsWith("999Z")).toBe(true);
  // The real AFTER transition trigger has now run. This is fixture readback,
  // not an epoch substituted into an already exposed Memory/body projection.
  const generation = (await f.pool.query<{ generation: string }>(
    `SELECT COALESCE((SELECT generation FROM harness_source_generations WHERE account_id=$1),0)::text AS generation`,
    [f.auth.accountId])).rows[0]?.generation;
  if (!generation) throw new Error("The actual source generation is missing.");
  return { sessionID, session, ...row, generation };
}

async function actualPerson(f: SavedMemoryFixture) {
  const id = randomUUID(), email = `source-binding-${id}@example.invalid`, now = new Date().toISOString();
  const payload: ResourceCaptureRequest = { contract_version: CONTRACT_VERSION, idempotency_key: randomUUID(),
    channel: "chat", purpose: "Synthetic human source binding", captured_at: now, source_timezone: "UTC",
    person_scope: { status: "new_person", display_label: "Synthetic source contact",
      relationship_context: { status: "proposed", label: "Synthetic source conversation", purpose: "Verify source owner facts" },
      binding_basis: "The synthetic human confirms this contact and email." },
    resource: { client_resource_id: id, kind: "contact_record", display_name: "Synthetic source contact", media_type: "text/plain",
      observed_at: now, source_timezone: "UTC", retention: { requested_mode: "evidence_crop", source_scope: "reviewed_extracted_text" } },
    confirmed_identity_handles: [{ type: "email", value: email, source_client_resource_id: id }],
    fragments: [{ client_resource_id: id, kind: "contact_field", sequence: 0, text: email,
      locator: { kind: "contact_field", field: "email", source_record_version: "synthetic-source-binding-v1" },
      attribution: { actor_kind: "recruiter", status: "confirmed" }, review_status: "reviewed",
      parser: { name: "synthetic-human-contact", version: "1" } }] };
  const created = await f.request({ method: "POST", url: "/v1/resource-captures", payload });
  expect(created.statusCode).toBe(201);
  const identity = created.json<ResourceCaptureResponse>().identity;
  expect(identity.status).toBe("bound");
  if (!identity.person_id) throw new Error("The actual owner capture omitted its Person.");
  return identity.person_id;
}

describe.skipIf(!savedMemoryDatabase)("actual source-owner parameter binding with PostgreSQL", { concurrent: false }, () => {
  it("captures the actual same-read source generation, Session stamp and six-digit original clock", async () => {
    await withSavedMemoryFixture(async f => {
      const source = await actualSource(f);
      const owner = await createHarnessSourceGuardWithBinding(f.pool, f.auth, source.sessionID,
        () => ({ expiresAt: source.expires_at, personIDs: [] }));
      const binding = readHarnessRunSourceBinding(owner.source, owner.guard, f.auth);
      expect(binding.accountId === f.auth.accountId && binding.userId === f.auth.userId).toBe(true);
      expect(binding.generation).toBe(source.generation);
      expect(binding.sessionStamp).toBe(source.stamp);
      expect(binding.sessionID).toBe(source.sessionID);
      expect(binding.sessionExpiresAt).toBe(source.exact_expiry);
      expect(binding.sourceExpiresAt).toBe(source.expires_at.toISOString().slice(0, -1) + "000Z");
      expect(binding.sourceExpiresAt < source.exact_expiry).toBe(true);
      expect(binding.personIDs).toEqual([]);
      await owner.guard();
      expect(readHarnessRunSourceBinding(owner.source, owner.guard, f.auth)).toEqual(binding);
      // No current-auth, canonical publication or access permission is inferred
      // from the metadata decoder returning these actual source parameters.
    });
  }, 15_000);

  it("keeps a real initially unloaded Session source pending and permanently retires the handle after an actual owner update", async () => {
    await withSavedMemoryFixture(async f => {
      const source = await actualSource(f);
      let authority: HarnessSourceAuthority | undefined;
      const owner = await createHarnessSourceGuardWithBinding(f.pool, f.auth, source.sessionID, () => authority);
      expect(() => readHarnessRunSourceBinding(owner.source, owner.guard, f.auth)).toThrow();
      authority = { expiresAt: source.expires_at, personIDs: [] }; await owner.guard();
      expect(readHarnessRunSourceBinding(owner.source, owner.guard, f.auth).sessionExpiresAt).toBe(source.exact_expiry);
      const objective = "A second synthetic source-owner turn changes the actual Session.";
      const next = await f.post({ idempotency_key: randomUUID(), objective });
      expect(next.statusCode).toBe(201);
      await f.saveAnswer(source.sessionID, objective, next.json<UnscopedChatTaskResponse>(), {
        expectedRevision: source.session.revision, priorTurns: source.session.payload!.turns });
      await expect(owner.guard()).rejects.toMatchObject({ code: "HARNESS_SOURCE_CHANGED" });
      expect(() => readHarnessRunSourceBinding(owner.source, owner.guard, f.auth)).toThrow();
    });
  }, 15_000);

  it("retains actual owner-captured people when a dynamic callback omits an earlier Person", async () => {
    await withSavedMemoryFixture(async f => {
      const first = await actualPerson(f), second = await actualPerson(f), source = await actualSource(f);
      let people = [first];
      const owner = await createHarnessSourceGuardWithBinding(f.pool, f.auth, source.sessionID,
        () => ({ expiresAt: source.expires_at, personIDs: people }));
      people = [second]; await owner.guard();
      const expected = [first, second].sort();
      expect(readHarnessRunSourceBinding(owner.source, owner.guard, f.auth).personIDs).toEqual(expected);
      people = []; await owner.guard();
      expect(readHarnessRunSourceBinding(owner.source, owner.guard, f.auth).personIDs).toEqual(expected);
      // The actual identity transition still advances the source owner's real
      // generation; omitting it from the callback cannot restore this handle.
      const expired = await f.pool.query(`UPDATE identity_handles SET valid_until=clock_timestamp()-interval '1 second'
        WHERE account_id=$1 AND subject_id=$2 AND status='confirmed'`, [f.auth.accountId, first]);
      expect((expired.rowCount ?? 0) > 0).toBe(true);
      await expect(owner.guard()).rejects.toMatchObject({ code: "HARNESS_SOURCE_CHANGED" });
      expect(() => readHarnessRunSourceBinding(owner.source, owner.guard, f.auth)).toThrow();
    });
  }, 15_000);
});
