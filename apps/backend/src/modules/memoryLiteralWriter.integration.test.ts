import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMemoryLiteralAcceptedRow, verifyMemoryLiteralProposalRow } from "./memoryLiteralIntegrity.js";
import { database, descriptor, descriptorTuple, hash, messageLocatorHash, withWriterFixture, writerAPIs,
  type CurrentReview, type ProposalRow, type WriterFixture } from "./fixtures/memoryLiteralWriter.fixture.js";

// DB-backed private core tests. These do not claim a production v2 HTTP route,
// human reading, final-authority publication, unknown-COMMIT recovery or v2 draft save.
const suite = database ? describe : describe.skip;
const legacyText = "I prefer complete source notes before a decision.";
const rawCases = [
  { label: "NFC", raw: "I prefer café summaries first." },
  { label: "NFD", raw: "I prefer cafe\u0301 summaries first." },
  { label: "nonBMP, whitespace and newline", raw: " \tI prefer 😀 source notes.\nI verify every quotation. \t" },
  { label: "more than1000 meaningful UTF16 units", raw: "I prefer " + "完整证据，".repeat(220) + "before I approve a decision." },
];

function confirmation(f: WriterFixture, review: CurrentReview, row: ProposalRow, finalText: string,
  overrides: Record<string, unknown> = {}) {
  const d = descriptor(finalText), entry = { purpose: "chat", person_id: null, relationship_context_id: null,
    source_session_id: f.sessionID, pursuit_id: null, pursuit_role_id: null, pursuit_role_evidence_fragment_id: null,
    pursuit_capture_id: null, pursuit_capture_version: null };
  const input = { version: "memory-literal-confirmation.v1", account_id: f.accountId, actor_user_id: f.userId,
    review_scope_id: review.review.review_scope_id, review_revision: review.review.review_revision,
    proposal_id: review.review.proposal_id, proposal_revision: review.review.proposal_revision,
    entry_scope: entry, item_id: row.id, item_added_revision: row.added_revision, decision: "accept", previous_item_version: null,
    proposal_manifest_digest: row.content_manifest_digest, final: { kind: "inline", edited_text: finalText, descriptor: d }, ...overrides };
  // Client-side explicit confirmation from the real current rows, encoded by an
  // independent fixed-order oracle. No create/verify implementation under test.
  const tuple = [input.version, input.account_id, input.actor_user_id, input.review_scope_id, input.review_revision,
    input.proposal_id, input.proposal_revision, ["chat", null, null, f.sessionID, null, null, null, null, null],
    input.item_id, input.item_added_revision, input.decision, input.previous_item_version, input.proposal_manifest_digest,
    ["inline", [d.sha256, d.utf8_bytes, d.utf16_code_units, d.unicode_scalar_count]]];
  return { ...input, confirmation_digest: hash(JSON.stringify(tuple)) };
}

function commitRequest(f: WriterFixture, review: CurrentReview, rows: ProposalRow[], finalTexts = rows.map(row => row.display_text), key = randomUUID()) {
  return { content_protocol: "literal-v2", idempotency_key: key, expected_proposal_revision: review.review.proposal_revision,
    expected_review_revision: review.review.review_revision, contact_decision: "none", selected_item_ids: rows.map(row => row.id),
    confirmations: rows.map((row, i) => confirmation(f, review, row, finalTexts[i]!)), reason: "Explicit synthetic inline confirmation" };
}

async function expectRefused(promise: Promise<unknown>, codes: readonly string[]) {
  let refused = false, code: unknown;
  try { await promise; } catch (error) {
    refused = true;
    if (error && typeof error === "object") {
      try {
        const slot = Object.getOwnPropertyDescriptor(error, "code");
        if (slot && "value" in slot) code = slot.value as unknown;
      } catch { /* Unknown error reflection is not a domain refusal. */ }
    }
  }
  expect(refused).toBe(true);
  // Unknown SQL/TypeError/setup failures cannot satisfy a domain-refusal test.
  // Only the safe code-membership boolean is formatted, never an exception body.
  expect(typeof code === "string" && codes.includes(code)).toBe(true);
}
const stale = ["MEMORY_COMMIT_STALE", "MEMORY_REVIEW_DRAFT_STALE", "MEMORY_REVIEW_SCOPE_MISMATCH",
  "MEMORY_CONTENT_INVALID", "MEMORY_CONTENT_UNAVAILABLE"] as const;

async function assertCanonicalRoles(f: WriterFixture, proposal: ProposalRow, raw: string, finalText: string, start: number) {
  const end = start + raw.length, locatorHash = messageLocatorHash(f.sessionID, f.messageID, start, end);
  const range = { kind: "message", session_id: f.sessionID, message_id: f.messageID, range_version: 1,
    representation: "authored_message_text.v1", offset_unit: "utf16_code_unit", character_start: start, character_end: end,
    source_revision_hash: f.sourceRevision, source_text_sha256: hash(f.sourceText), excerpt_sha256: hash(raw) };
  const rangeTuple = ["message", f.sessionID, f.messageID, 1, "authored_message_text.v1", "utf16_code_unit", start, end,
    f.sourceRevision, hash(f.sourceText), hash(raw)];
  const proposalManifest = { version: "literal-v2", original_content_protocol: "literal-v2", display_text: descriptor(raw),
    original_display_text: descriptor(raw), source_excerpt: descriptor(raw), source_revision_hash: f.sourceRevision,
    source_locator_sha256: locatorHash, message_range: range };
  expect(proposal.content_protocol).toBe("literal-v2"); expect(proposal.display_text).toBe(raw);
  expect(proposal.original_display_text).toBe(raw); expect(proposal.source_excerpt).toBe(raw);
  expect(proposal.source_excerpt_hash).toBe(hash(raw)); expect(proposal.source_revision_hash).toBe(f.sourceRevision);
  expect(proposal.content_manifest).toEqual(proposalManifest);
  expect(proposal.content_manifest_digest).toBe(hash(JSON.stringify(["literal-v2", "literal-v2", descriptorTuple(raw),
    descriptorTuple(raw), descriptorTuple(raw), f.sourceRevision, locatorHash, rangeTuple])));
  await verifyMemoryLiteralProposalRow({ ...proposal });

  const stored = await f.canonicalRows(proposal.proposal_id);
  const accepted = stored.items.find(row => row.source_proposal_item_id === proposal.id);
  expect(Boolean(accepted)).toBe(true); if (!accepted) throw new Error("Canonical accepted row missing.");
  const evidence = stored.evidence.filter(row => row.memory_item_id === accepted.id);
  expect(evidence).toHaveLength(1); const e = evidence[0]!;
  expect(e.id === proposal.id || e.id === accepted.id).toBe(false);
  const evidenceManifest = { version: "literal-v2", excerpt: descriptor(raw), source_revision_hash: f.sourceRevision,
    source_locator_sha256: locatorHash, message_range: range };
  const evidenceDigest = hash(JSON.stringify(["memory-evidence-literal-v2", descriptorTuple(raw), f.sourceRevision, locatorHash, rangeTuple]));
  expect(e.content_protocol).toBe("literal-v2"); expect(e.content_version).toBe(1);
  expect(e.excerpt).toBe(raw); expect(e.content_hash).toBe(hash(raw)); expect(e.content_manifest).toEqual(evidenceManifest);
  expect(e.content_manifest_digest).toBe(evidenceDigest);
  const refs = [{ evidence_id: e.id, content_protocol: "literal-v2", content_version: 1, content_manifest_digest: evidenceDigest }];
  const acceptedManifest = { version: "accepted-memory-literal.v1", original_content_protocol: "literal-v2",
    display_text: descriptor(finalText), original_display_text: descriptor(raw), reviewed_evidence: refs };
  const acceptedDigest = hash(JSON.stringify(["memory-accepted-literal.v1", "literal-v2", descriptorTuple(finalText), descriptorTuple(raw),
    [[e.id, "literal-v2", 1, evidenceDigest]]]));
  expect(accepted.content_protocol).toBe("literal-v2"); expect(accepted.status).toBe("active");
  expect(accepted.display_text).toBe(finalText); expect(accepted.original_display_text).toBe(raw);
  expect(accepted.content_manifest).toEqual(acceptedManifest); expect(accepted.content_manifest_digest).toBe(acceptedDigest);
  await verifyMemoryLiteralAcceptedRow({ ...accepted }, evidence.map(row => ({ ...row })));
  expect(stored.receipts).toHaveLength(1); const receipt = stored.receipts[0]!;
  expect(receipt.created_item_ids.includes(accepted.id)).toBe(true);
  const change = receipt.changes.find(row => row.proposal_item_id === proposal.id);
  expect(Boolean(change)).toBe(true);
  expect(change?.accepted_content).toEqual({ content_protocol: "literal-v2", content_manifest_digest: acceptedDigest,
    final_descriptor: descriptor(finalText), original_content_protocol: "literal-v2", original_descriptor: descriptor(raw), reviewed_evidence: refs });
  return { accepted, evidence: e, receipt };
}

suite("canonical literal-v2 writer, real Auth/Session/Stage/Review/confirmation/COMMIT readback", () => {
  it.each(rawCases)("stores every role with exact $label bytes and real new evidence membership", async ({ raw }) => {
    const api = writerAPIs(), prefix = "Synthetic authored source:\n", source = prefix + raw + "\nEnd of source.";
    await withWriterFixture(source, async f => {
      const staged = await f.stage(api, f.request([f.candidate(raw, prefix.length)]));
      expect(staged.replayed).toBe(false);
      const rows = await f.proposalItems(staged.proposal.proposal_id); expect(rows).toHaveLength(1);
      expect((await f.canonicalRows(staged.proposal.proposal_id)).items).toHaveLength(0);
      const review = await f.open(api, staged.proposal.proposal_id);
      expect(review.review.source_session_id).toBe(f.sessionID); expect(review.review.items).toHaveLength(1);
      const preview = review.review.items[0]!.display_text_preview;
      expect(raw.startsWith(preview.text_preview)).toBe(true); expect(preview.text_preview.length <= 256).toBe(true);
      expect(preview.reference.descriptor).toEqual(descriptor(raw));
      expect(preview.coverage.total_utf16_code_units).toBe(raw.length);
      expect(preview.coverage.total_utf8_bytes).toBe(Buffer.byteLength(raw, "utf8"));
      expect(Object.hasOwn(review.review.items[0]!, "display_text")).toBe(false);
      const request = commitRequest(f, review, rows), committed = await f.commit(api, review, request);
      expect(committed.status).toBe(201); expect(committed.body.content_protocol).toBe("literal-v2");
      const result = await assertCanonicalRoles(f, rows[0]!, raw, raw, prefix.length);
      expect(committed.body.receipt.commit_id).toBe(result.receipt.commit_id);
      const beforeReplay = await f.effects(), replay = await f.commit(api, review, request);
      expect(replay.replayed).toBe(true); expect(replay.body.receipt.commit_id).toBe(result.receipt.commit_id);
      expect(await f.effects()).toEqual(beforeReplay);
    });
  }, 15_000);

  it("keeps normalized-equivalent NFC/NFD/whitespace/newline choices distinct in one accepted batch", async () => {
    const api = writerAPIs(), nfc = rawCases[0]!.raw, nfd = rawCases[1]!.raw;
    const choices = [nfc, nfd, " \t" + nfc + "\n", nfc.replace(" summaries", "\n summaries")], source = choices.join("\n");
    await withWriterFixture(source, async f => {
      let start = 0;
      const candidates = choices.map(raw => { const candidate = f.candidate(raw, start); start += raw.length + 1; return candidate; });
      const staged = await f.stage(api, f.request(candidates));
      const rows = await f.proposalItems(staged.proposal.proposal_id); expect(rows).toHaveLength(4);
      expect(rows.map(row => row.display_text).sort()).toEqual([...choices].sort());
      const review = await f.open(api, staged.proposal.proposal_id); expect(review.review.items).toHaveLength(4);
      await f.commit(api, review, commitRequest(f, review, rows));
      for (const row of rows) {
        const index = choices.indexOf(row.display_text); expect(index >= 0).toBe(true);
        const offset = choices.slice(0, index).reduce((sum, raw) => sum + raw.length + 1, 0);
        await assertCanonicalRoles(f, row, row.display_text, row.display_text, offset);
      }
      const stored = await f.canonicalRows(staged.proposal.proposal_id);
      expect(stored.items).toHaveLength(4); expect(stored.evidence).toHaveLength(4);
      expect(new Set(stored.evidence.map(row => row.id)).size).toBe(4);
    });
  }, 15_000);

  it("does not turn an existing normalized-equivalent Memory into raw literal equality", async () => {
    const api = writerAPIs(), a = rawCases[0]!.raw, b = rawCases[1]!.raw;
    await withWriterFixture(a + "\n" + b, async f => {
      const first = await f.stage(api, f.request([f.candidate(a, 0)]));
      const firstRows = await f.proposalItems(first.proposal.proposal_id), firstReview = await f.open(api, first.proposal.proposal_id);
      await f.commit(api, firstReview, commitRequest(f, firstReview, firstRows));
      const second = await f.stage(api, f.request([f.candidate(b, a.length + 1)]));
      const secondRows = await f.proposalItems(second.proposal.proposal_id); expect(secondRows).toHaveLength(1);
      const secondReview = await f.open(api, second.proposal.proposal_id);
      await f.commit(api, secondReview, commitRequest(f, secondReview, secondRows));
      await assertCanonicalRoles(f, firstRows[0]!, a, a, 0);
      await assertCanonicalRoles(f, secondRows[0]!, b, b, a.length + 1);
    });
  }, 15_000);

  it("replays the exact Stage key without new identities and refuses a different request under it", async () => {
    const api = writerAPIs(), a = legacyText, b = "I prefer a deliberate decision after explicit review.";
    await withWriterFixture(a + "\n" + b, async f => {
      const key = randomUUID(), request = f.request([f.candidate(a, 0)], key);
      const first = await f.stage(api, request), before = await f.effects(), replay = await f.stage(api, request);
      expect(replay.replayed).toBe(true); expect(replay.proposal.proposal_id).toBe(first.proposal.proposal_id);
      expect(await f.effects()).toEqual(before);
      await expectRefused(f.stage(api, f.request([f.candidate(b, a.length + 1)], key)), ["IDEMPOTENCY_KEY_REUSED"]);
      expect(await f.effects()).toEqual(before);
    });
  }, 15_000);

  it("requires explicit positions for repeated substrings and preserves the chosen second occurrence", async () => {
    const api = writerAPIs(), raw = legacyText, source = raw + "\n" + raw;
    await withWriterFixture(source, async f => {
      const before = await f.effects(), item = f.candidate(raw, 0);
      const unpositioned = { ...item, source_locator: { kind: "message", session_id: f.sessionID, message_id: f.messageID } };
      await expectRefused(f.stage(api, f.request([unpositioned])), ["MEMORY_CONTENT_RANGE_INVALID"]);
      expect(await f.effects()).toEqual(before);
      const staged = await f.stage(api, f.request([f.candidate(raw, raw.length + 1)]));
      const rows = await f.proposalItems(staged.proposal.proposal_id), review = await f.open(api, staged.proposal.proposal_id);
      await f.commit(api, review, commitRequest(f, review, rows));
      await assertCanonicalRoles(f, rows[0]!, raw, raw, raw.length + 1);
    });
  }, 15_000);

  it("refuses a valid first item plus a late wrong range without any partial Stage effects", async () => {
    const api = writerAPIs(), a = legacyText, b = "I prefer exact quotations before approval.";
    await withWriterFixture(a + "\n" + b, async f => {
      const before = await f.effects();
      await expectRefused(f.stage(api, f.request([f.candidate(a, 0), f.candidate(b, 0)])), ["MEMORY_CONTENT_RANGE_INVALID"]);
      expect(await f.effects()).toEqual(before);
    });
  }, 15_000);

  it("refuses a UTF16 range through a surrogate pair instead of repairing the source", async () => {
    const api = writerAPIs();
    await withWriterFixture("😀" + legacyText, async f => {
      const before = await f.effects();
      await expectRefused(f.stage(api, f.request([f.candidate(legacyText, 1)])), ["MEMORY_CONTENT_RANGE_INVALID"]);
      expect(await f.effects()).toEqual(before);
    });
  }, 15_000);

  it("keeps reviewed historical source/original separate from a newly edited final literal", async () => {
    const api = writerAPIs(), finalText = " \tI prefer complete evidence and explicit approval.\nI keep the exact wording. ";
    await withWriterFixture(legacyText, async f => {
      const staged = await f.stage(api, f.request([f.candidate(legacyText, 0)])), rows = await f.proposalItems(staged.proposal.proposal_id);
      const review = await f.open(api, staged.proposal.proposal_id);
      await f.commit(api, review, commitRequest(f, review, rows, [finalText]));
      await assertCanonicalRoles(f, rows[0]!, legacyText, finalText, 0);
    });
  }, 15_000);

  it("rejects a late item's validly encoded but noncurrent proof atomically", async () => {
    const api = writerAPIs(), a = legacyText, b = "I prefer explicit review before saving a Memory.";
    await withWriterFixture(a + "\n" + b, async f => {
      const staged = await f.stage(api, f.request([f.candidate(a, 0), f.candidate(b, a.length + 1)]));
      const rows = await f.proposalItems(staged.proposal.proposal_id), review = await f.open(api, staged.proposal.proposal_id);
      const request = commitRequest(f, review, rows);
      request.confirmations[1] = confirmation(f, review, rows[1]!, rows[1]!.display_text, { proposal_manifest_digest: "0".repeat(64) });
      const before = await f.effects(); await expectRefused(f.commit(api, review, request), stale);
      expect(await f.effects()).toEqual(before);
    });
  }, 15_000);

  it("refuses same-length changed inline bytes with the previously confirmed descriptor", async () => {
    const api = writerAPIs();
    await withWriterFixture(legacyText, async f => {
      const staged = await f.stage(api, f.request([f.candidate(legacyText, 0)])), rows = await f.proposalItems(staged.proposal.proposal_id);
      const review = await f.open(api, staged.proposal.proposal_id), request = commitRequest(f, review, rows);
      const changed = legacyText.replace("source", "direct"); expect(changed.length).toBe(legacyText.length);
      request.confirmations[0]!.final.edited_text = changed;
      const before = await f.effects(); await expectRefused(f.commit(api, review, request), stale);
      expect(await f.effects()).toEqual(before);
    });
  }, 15_000);

  it.each(["account_id", "actor_user_id", "review_scope_id", "proposal_id"])("refuses a validly hashed forged current %s without granting access", async field => {
    const api = writerAPIs();
    await withWriterFixture(legacyText, async f => {
      const staged = await f.stage(api, f.request([f.candidate(legacyText, 0)])), rows = await f.proposalItems(staged.proposal.proposal_id);
      const review = await f.open(api, staged.proposal.proposal_id), request = commitRequest(f, review, rows);
      request.confirmations[0] = confirmation(f, review, rows[0]!, legacyText, { [field]: randomUUID() });
      const before = await f.effects(); await expectRefused(f.commit(api, review, request), [...stale, "MEMORY_NOT_FOUND"]);
      expect(await f.effects()).toEqual(before);
    });
  }, 15_000);

  it("refuses confirmation after actual Session DELETE/source withdrawal without partial effects", async () => {
    const api = writerAPIs();
    await withWriterFixture(legacyText, async f => {
      const staged = await f.stage(api, f.request([f.candidate(legacyText, 0)])), rows = await f.proposalItems(staged.proposal.proposal_id);
      const review = await f.open(api, staged.proposal.proposal_id), request = commitRequest(f, review, rows);
      await f.withdrawSource();
      const before = await f.effects();
      const sourceRefused = await f.commit(api, review, request).then(() => false, error => {
        try {
          if (!error || typeof error !== "object") return false;
          const code = Object.getOwnPropertyDescriptor(error, "code"), status = Object.getOwnPropertyDescriptor(error, "statusCode");
          return Boolean(code && "value" in code && code.value === "MEMORY_SOURCE_UNAVAILABLE"
            && status && "value" in status && status.value === 409);
        } catch { return false; }
      });
      expect(sourceRefused).toBe(true);
      expect(await f.effects()).toEqual(before);
      const after = await f.canonicalRows(staged.proposal.proposal_id);
      expect(after.items.length).toBe(0); expect(after.evidence.length).toBe(0); expect(after.receipts.length).toBe(0);
    });
  }, 15_000);

  it("requires the real rendered review credential even with an otherwise valid confirmation", async () => {
    const api = writerAPIs();
    await withWriterFixture(legacyText, async f => {
      const staged = await f.stage(api, f.request([f.candidate(legacyText, 0)])), rows = await f.proposalItems(staged.proposal.proposal_id);
      const review = await f.open(api, staged.proposal.proposal_id), request = commitRequest(f, review, rows), before = await f.effects();
      await expectRefused(f.commit(api, { ...review, review_credential: "synthetic-invalid-rendered-credential" }, request), ["MEMORY_REVIEW_CREDENTIAL_INVALID"]);
      expect(await f.effects()).toEqual(before);
    });
  }, 15_000);

  it("does not accept a real legacy draft ref as a manufactured v2 current draft", async () => {
    const api = writerAPIs(), other = "I prefer bounded full text before confirming a new Memory.";
    await withWriterFixture(legacyText + "\n" + other, async f => {
      const legacy = await f.actualLegacyDraft();
      const staged = await f.stage(api, f.request([f.candidate(other, legacyText.length + 1)]));
      const rows = await f.proposalItems(staged.proposal.proposal_id), review = await f.open(api, staged.proposal.proposal_id);
      const request = commitRequest(f, review, rows), current = request.confirmations[0]!;
      const draftFinal = { kind: "draft", reference: { reference_version: 1, content_protocol: "legacy-v1", content_manifest_digest: null,
        descriptor: descriptor(legacyText), target: { kind: "review_draft", draft_id: legacy.draftID, draft_revision: legacy.revision,
          review_scope_id: legacy.scopeID, item_id: legacy.itemID, field: "edited_text" } } };
      const referenceTuple = [1, ["review_draft", legacy.draftID, legacy.revision, legacy.scopeID, legacy.itemID, "edited_text"],
        "legacy-v1", null, descriptorTuple(legacyText)];
      const draftDigest = hash(JSON.stringify([current.version, current.account_id, current.actor_user_id, current.review_scope_id,
        current.review_revision, current.proposal_id, current.proposal_revision,
        ["chat", null, null, f.sessionID, null, null, null, null, null], current.item_id, current.item_added_revision,
        current.decision, current.previous_item_version, current.proposal_manifest_digest, ["draft", referenceTuple]]));
      const before = await f.effects();
      await expectRefused(f.commit(api, review, { ...request, confirmations: [{ ...current, final: draftFinal, confirmation_digest: draftDigest }] }),
        ["MEMORY_CONTENT_INVALID", "MEMORY_CONTENT_VERSION_UNSUPPORTED", "MEMORY_REVIEW_DRAFT_STALE"]);
      expect(await f.effects()).toEqual(before);
    });
  }, 15_000);
});
