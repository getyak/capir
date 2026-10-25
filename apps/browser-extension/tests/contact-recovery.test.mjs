import assert from "node:assert/strict";
import test from "node:test";
import { contactRecoveryJournal } from "../load-unpacked/lib/contact-recovery.js";
import { recoverContactTaskInWeb } from "../load-unpacked/lib/contact-handoff.js";

function memoryStorage() {
  const values = {};
  return { values, async get() { return structuredClone(values); }, async set(data) { Object.assign(values, structuredClone(data)); }, async remove(key) { delete values[key]; } };
}

test("persists only bounded recovery identity before sending and survives both panel and worker restart", async () => {
  const storage = memoryStorage(), origin = "http://localhost:3000", requestKey = "original-reviewed-request";
  await contactRecoveryJournal(storage, () => 1000).claim(origin, "original-session", requestKey);
  const reopened = contactRecoveryJournal(storage, () => 2000);
  assert.deepEqual(await reopened.list(), [{ origin, sessionVersion: "original-session", requestKey, createdAt: 1000 }]);
  assert.equal((await reopened.claim(origin, "original-session", requestKey)).requestKey, requestKey);
  await assert.rejects(reopened.claim(origin, "original-session", "new-copy"), /CONTACT_RECOVERY_PENDING/);
  await assert.rejects(reopened.claim(origin, "other-session", requestKey), /CONTACT_RECOVERY_SCOPE_CHANGED/);
  await reopened.complete(requestKey);
  assert.equal((await contactRecoveryJournal(storage, () => 2500).list())[0].completed, true);
  await reopened.claim(origin, "original-session", "next-intent");
  assert.doesNotMatch(JSON.stringify(storage.values), /data_base64|image|source_excerpt|title|cookie|access_token/);
  assert.deepEqual(await contactRecoveryJournal(storage, () => 31 * 86_400_000).list(), []);
  assert.equal(Object.keys(storage.values).length, 0);
});

test("lost response recovery reads the original receipt without POST and denies replacement sessions", async () => {
  const oldFetch = globalThis.fetch, oldLocation = globalThis.location;
  const origin = "http://localhost:3000", task = "10000000-0000-4000-8000-000000000001", calls = [];
  let activeSession = "original-session", status = "running";
  globalThis.location = { origin, pathname: "/contact-agent" };
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => url.endsWith("session") ? { status: "ready", session_version: activeSession, contact_agent: true } : { task_id: task, status } };
  };
  try {
    const result = await recoverContactTaskInWeb(origin, "original-session", "original-reviewed-request");
    assert.equal(result.contact_task_id, task);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, "/api/contact-agent/tasks?handoff_request_id=original-reviewed-request");
    assert.ok(calls.every(call => !call.options.method || call.options.method === "GET"));
    calls.length = 0; activeSession = "replacement";
    assert.equal((await recoverContactTaskInWeb(origin, "original-session", "original-reviewed-request")).code, "session_changed");
    assert.equal(calls.length, 1);
    activeSession = "original-session"; status = "deleted";
    assert.equal((await recoverContactTaskInWeb(origin, "original-session", "original-reviewed-request")).state, "unavailable");
  } finally { globalThis.fetch = oldFetch; if (oldLocation === undefined) delete globalThis.location; else globalThis.location = oldLocation; }
});

test("bounds completed receipts without evicting unknown operations or blocking ordinary later captures", async () => {
  const storage = memoryStorage(); let now = 1000;
  const journal = contactRecoveryJournal(storage, () => now++);
  await journal.claim("http://localhost:3000", "pending-owner", "pending-original");
  for (let index = 0; index < 21; index++) {
    await journal.claim("http://localhost:3000", "active-owner", `completed-${index}`);
    await journal.complete(`completed-${index}`);
  }
  const records = await journal.list();
  assert.equal(records.length, 20);
  assert.ok(records.some(record => record.requestKey === "pending-original"));
  assert.ok(records.some(record => record.requestKey === "completed-20"));
  assert.ok(!records.some(record => record.requestKey === "completed-0"));
});
