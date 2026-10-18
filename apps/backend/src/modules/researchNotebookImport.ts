import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { assertAccountActive, createRealIdentity, normalizeEmail } from "./accountIdentity.js";
import { encodePasswordCredential, verifyPasswordCredential } from "./passwordCredential.js";
import { appendAudit } from "../lib/audit.js";

export const RESEARCH_NOTEBOOK_SCHEMA = "research-notebook.v1";
export interface ResearchNote {
  key: string;
  text: string;
  section: "identity" | "analysis" | "learning" | "limits" | "platform" | "sources" | "dossier";
  metadata: Record<string, unknown>;
}
export interface ResearchNotebook {
  schema: typeof RESEARCH_NOTEBOOK_SCHEMA;
  namespace: string;
  people: Array<{ key: string; name: string; notes: ResearchNote[] }>;
}

/** No networking or identity inference; the operator supplies authorized notes. */
export function parseResearchNotebook(value: unknown): ResearchNotebook {
  if (!value || typeof value !== "object") throw new Error("INVALID_NOTEBOOK");
  const packet = value as ResearchNotebook;
  if (packet.schema !== RESEARCH_NOTEBOOK_SCHEMA || typeof packet.namespace !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(packet.namespace)
    || !Array.isArray(packet.people) || packet.people.length < 1 || packet.people.length > 2000) throw new Error("INVALID_NOTEBOOK");
  const people = new Set<string>();
  for (const person of packet.people) {
    if (!person || typeof person.key !== "string" || !/^[a-z0-9][a-z0-9._-]{0,119}$/.test(person.key)
      || people.has(person.key) || typeof person.name !== "string" || !person.name.trim() || person.name.length > 200
      || !Array.isArray(person.notes) || person.notes.length < 1 || person.notes.length > 100) throw new Error("INVALID_PERSON");
    people.add(person.key);
    const keys = new Set<string>();
    for (const note of person.notes) {
      if (!note || typeof note.key !== "string" || !/^[a-z0-9][a-z0-9._-]{0,119}$/.test(note.key) || keys.has(note.key)
        || typeof note.text !== "string" || !note.text.trim() || note.text.length > 1000
        || !["identity", "analysis", "learning", "limits", "platform", "sources", "dossier"].includes(note.section)
        || !note.metadata || typeof note.metadata !== "object" || Array.isArray(note.metadata)
        || JSON.stringify(note.metadata).length > 60_000) throw new Error("INVALID_NOTE");
      keys.add(note.key);
    }
  }
  return packet;
}
export function researchRecordId(accountId: string, namespace: string, key: string): string {
  const h = createHash("sha256").update(JSON.stringify([accountId, namespace, key])).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Operator-only provisioning. Existing credentials are proved, never replaced. */
export async function researchNotebookOwner(client: PoolClient, input: { email: string; displayName: string; password: string }) {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !input.displayName.trim() || input.displayName.length > 200
    || input.password.length < 8 || input.password.length > 128) throw new Error("INVALID_OWNER_INPUT");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`research-owner:${email}`]);
  const prior = await client.query<{ id: string; account_id: string; password_scrypt: string | null; status: string; locked_until: Date | null }>(
    `SELECT u.id,u.account_id,u.status,p.password_scrypt,p.locked_until FROM users u
     LEFT JOIN password_credentials p ON p.account_id=u.account_id AND p.user_id=u.id
     WHERE lower(btrim(u.email))=$1 FOR UPDATE OF u`, [email]);
  if (prior.rows.length) {
    const row = prior.rows.length === 1 ? prior.rows[0] : null;
    if (row) {
      await assertAccountActive(client, row.account_id);
      const account = await client.query<{ owner_user_id: string | null }>("SELECT owner_user_id FROM accounts WHERE id=$1", [row.account_id]);
      if (account.rows[0]?.owner_user_id !== row.id) throw new Error("OWNER_CONFLICT_OR_CREDENTIAL_INVALID");
      const credential = await client.query<{ password_scrypt: string; locked_until: Date | null }>(
        "SELECT password_scrypt,locked_until FROM password_credentials WHERE account_id=$1 AND user_id=$2 FOR UPDATE", [row.account_id, row.id]);
      row.password_scrypt = credential.rows[0]?.password_scrypt ?? null;
      row.locked_until = credential.rows[0]?.locked_until ?? null;
    }
    if (!row || row.status !== "active" || (row.locked_until && row.locked_until > new Date()) || !row.password_scrypt
      || !await verifyPasswordCredential(input.password, row.password_scrypt)) throw new Error("OWNER_CONFLICT_OR_CREDENTIAL_INVALID");
    await assertAccountActive(client, row.account_id);
    return { accountId: row.account_id, userId: row.id, created: false };
  }
  const accountId = randomUUID(), userId = randomUUID();
  await createRealIdentity(client, { accountId, userId, accountName: `${input.displayName} · 人物研究`,
    accountSlug: `personal-research-${accountId}`, email, displayName: input.displayName, kind: "password_human", username: email });
  await client.query("INSERT INTO password_credentials(account_id,user_id,password_scrypt) VALUES($1,$2,$3)",
    [accountId, userId, await encodePasswordCredential(input.password)]);
  // Mailbox ownership was not verified by this operator provisioning.
  await appendAudit(client, { accountId, actorUserId: userId }, "research.owner_provisioned", "user", userId,
    { method: "operator_authorized", mailbox_verified: false });
  return { accountId, userId, created: true };
}

/** Called inside ONE transaction. Replay never restores deleted or edited notes. */
export async function importResearchNotebook(client: PoolClient, owner: { accountId: string; userId: string }, input: unknown) {
  const packet = parseResearchNotebook(input);
  await assertAccountActive(client, owner.accountId);
  const user = await client.query("SELECT id FROM users WHERE account_id=$1 AND id=$2 AND status='active'", [owner.accountId, owner.userId]);
  if (!user.rowCount) throw new Error("OWNER_UNAVAILABLE");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`research-import:${owner.accountId}:${packet.namespace}`]);
  const receipt = { people: 0, notes: 0, replayedPeople: 0, replayedNotes: 0, peopleIds: [] as Array<{ key: string; id: string }> };
  for (const person of packet.people) {
    const personId = researchRecordId(owner.accountId, packet.namespace, `person:${person.key}`);
    const externalRef = `research:${packet.namespace}:${person.key}`;
    const prior = await client.query<{ id: string; display_label: string; status: string }>(
      "SELECT id,display_label,status FROM subjects WHERE account_id=$1 AND (id=$2 OR external_ref=$3) FOR UPDATE", [owner.accountId, personId, externalRef]);
    if (prior.rowCount) {
      const row = prior.rows[0];
      if (prior.rowCount !== 1 || row?.id !== personId || row.display_label !== person.name || row.status !== "active") throw new Error("PERSON_IMPORT_CONFLICT");
      receipt.replayedPeople++;
    } else {
      await client.query("INSERT INTO subjects(id,account_id,external_ref,display_label) VALUES($1,$2,$3,$4)", [personId, owner.accountId, externalRef, person.name]);
      receipt.people++;
    }
    receipt.peopleIds.push({ key: person.key, id: personId });
    for (const note of person.notes) {
      const id = researchRecordId(owner.accountId, packet.namespace, `note:${person.key}:${note.key}`);
      const locator = { kind: "document", locator: { ...note.metadata, schema: packet.schema, namespace: packet.namespace, person_key: person.key,
        note_key: note.key, section: note.section, review_status: "unreviewed_research" } };
      // Store interpretation as an attributed source statement, never fact or a user opinion.
      const text = `研究笔记（AI 整理，待复核）\n${note.text}`;
      if (text.length > 1000) throw new Error("NOTE_TOO_LONG");
      const digest = hash(JSON.stringify({ text, locator }));
      const priorNote = await client.query<{ display_text: string; status: string; owner_user_id: string; subject_id: string; content_hash: string | null; evidence_status: string | null }>(
        `SELECT m.display_text,m.status,m.owner_user_id,m.subject_id,e.content_hash,e.status AS evidence_status FROM memory_items m
         LEFT JOIN memory_item_evidence e ON e.account_id=m.account_id AND e.memory_item_id=m.id
         WHERE m.account_id=$1 AND m.id=$2 FOR UPDATE OF m`, [owner.accountId, id]);
      if (priorNote.rowCount) {
        const row = priorNote.rows[0];
        if (priorNote.rowCount !== 1 || row?.display_text !== text || row.status !== "active" || row.owner_user_id !== owner.userId
          || row.subject_id !== personId || row.content_hash !== digest || row.evidence_status !== "active") throw new Error("NOTE_IMPORT_CONFLICT");
        receipt.replayedNotes++;
        continue;
      }
      await client.query(`INSERT INTO memory_items(id,account_id,owner_user_id,scope,subject_id,display_text,statement_kind,speaker,reporter,time_status,created_by_user_id)
        VALUES($1,$2,$3,'person',$4,$5,'source_statement','AI 人物研究笔记','研究资料导入','unknown',$3)`, [id, owner.accountId, owner.userId, personId, text]);
      await client.query(`INSERT INTO memory_item_evidence(id,account_id,memory_item_id,locator,excerpt,content_hash)
        VALUES($1,$2,$3,$4,$5,$6)`, [researchRecordId(owner.accountId, packet.namespace, `evidence:${person.key}:${note.key}`), owner.accountId, id, locator, text, digest]);
      receipt.notes++;
    }
  }
  if (receipt.people || receipt.notes) await appendAudit(client, { accountId: owner.accountId, actorUserId: owner.userId },
    "research.notebook_imported", "account", owner.accountId, { namespace: packet.namespace, people: receipt.people, notes: receipt.notes,
      authority: "attributed_unreviewed_notes", identity_handles_created: 0, facts_confirmed: 0 });
  return receipt;
}
