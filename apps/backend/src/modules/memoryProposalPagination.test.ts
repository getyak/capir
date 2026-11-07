import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { MemoryProposalRecord } from "@talent-signal/contracts";
import type { DatabaseClient } from "../database/pool.js";
import type { AuthContext } from "./auth.js";
import type { ProposalRow } from "./memoryReviewStore.js";
import { listMemoryProposals } from "./memoryReviewRead.js";
import { readMemoryProposalPage } from "./memoryProposalPagination.js";
import { openMemoryProposalCursor } from "./memoryProposalCursor.js";
import { labWorkspaceSessionActiveSQL } from "./labWorkspaceAccess.js";

vi.mock("./memorySourceVerification.js", () => ({
  verifyPendingSourceAuthority: vi.fn(async () => ({
    proposalSourceAvailable: true, unavailableItemIds: new Set<string>(),
  })),
}));

describe("Memory proposal list admission before its bounded window", () => {
  it("does not let fifty newer private-self proposals conceal an older permitted person proposal", async () => {
    const auth: AuthContext = { accountId: randomUUID(), userId: randomUUID(), sessionId: randomUUID(),
      accountSlug: "synthetic-pagination", userEmail: "owner@synthetic.local", userKind: "simulated_human" };
    const personId = randomUUID();
    const rows = Array.from({ length: 51 }, (_, index) => ({
      id: randomUUID(), account_id: auth.accountId, created_by_user_id: auth.userId,
      surface: "chat", revision: 1, status: "open", contact_decision: "existing",
      contact_status: "resolved", identity_authority: "human_selection", target_person_id: personId,
      target_relationship_context_id: null, created_at: new Date(2_000_000_000_000 - index),
      expires_at: new Date(2_000_100_000_000),
    } as ProposalRow));
    const older = rows[50]!;
    const queries: string[] = [];
    // This narrow query double models the ordering regression, not PostgreSQL
    // semantics. Real mixed-scope SQL execution is covered by the Hosted PG case.
    const client = { query: vi.fn(async (sql: string, params: unknown[]) => {
      queries.push(sql);
      if (sql.includes("AS revalidated")) return { rows: [{ revalidated: true }] };
      if (sql.includes("FROM memory_proposals")) {
        const prefiltered = sql.includes("EXISTS") && sql.includes("memory_proposal_items");
        return { rows: (prefiltered ? [older] : rows).slice(0, 50).map(row => ({ ...row,
          qualified_count: 1, qualified_default_count: 1 })) };
      }
      if (sql.includes("FROM memory_proposal_items")) {
        return { rows: [{ id: randomUUID(), scope: params[1] === older.id ? "person" : "self",
          subject_id: params[1] === older.id ? personId : null,
          relationship_context_id: null, status: "pending", default_selected: true }] };
      }
      throw new Error("Unexpected synthetic query");
    }) } as unknown as DatabaseClient;
    const page = await listMemoryProposals(client, auth, "people", personId, null);
    expect(page.proposals.map(row => row.proposal_id)).toEqual([older.id]);
    const listQuery = queries.find(sql => sql.includes("FROM memory_proposals"))!;
    expect(listQuery.indexOf("memory_proposal_items")).toBeLessThan(listQuery.indexOf("LIMIT"));
    expect(page.proposals[0]?.item_count).toBe(1);
  });
});

describe("bounded proposal page publication", () => {
  function fixture(count = 50) {
    const now = Date.now();
    const auth: AuthContext = { accountId: randomUUID(), userId: randomUUID(), sessionId: randomUUID(),
      accountSlug: "page-fixture", userEmail: "page@synthetic.local", userKind: "simulated_human" };
    const scope = { purpose: "people" as const, personId: randomUUID(), contextId: null, sourceSessionId: null };
    const authority = { token_hash: "a".repeat(64), expires_at: new Date(now + 3_600_000), checked_ms: String(now),
      snapshot_at: new Date(now).toISOString().replace(/(\.\d{3})Z$/u, "$1000Z") };
    const rows = Array.from({ length: count }, (_, index) => ({ id: randomUUID(), revision: 1,
      created_at: new Date("2026-09-22T10:00:00.123Z"), cursor_time: `2026-09-22T10:00:00.123${String(999 - index).padStart(3, "0")}Z`,
      qualified_count: 1, qualified_default_count: 1 } as unknown as ProposalRow & { cursor_time: string }));
    let current = { ...authority };
    let finalAvailable = true, initialAvailable = true;
    const query = vi.fn(async (sql: string, _params: unknown[]) => {
      if (sql.includes("AS revalidated")) return { rows: [{ revalidated: finalAvailable }] };
      if (sql.includes("qualified AS MATERIALIZED")) return { rows: finalAvailable ? [current] : [] };
      if (sql.includes("FROM sessions")) return { rows: initialAvailable ? [current] : [] };
      if (sql.includes("FROM memory_proposals p")) return { rows };
      throw new Error("Unexpected bounded page query");
    });
    const client = { query } as unknown as DatabaseClient;
    const serialize = vi.fn(async (row: ProposalRow) => ({ proposal_id: row.id, revision: row.revision,
      item_count: 1, default_selected_count: 1 } as MemoryProposalRecord | null));
    const read = (request = { paginate: true } as { paginate?: boolean | undefined; cursor?: string | null | undefined }) =>
      readMemoryProposalPage(client, auth, scope, request, serialize);
    return { auth, scope, rows, authority, query, read, serialize,
      unavailableInitial: () => { initialAvailable = false; }, unavailableFinal: () => { finalAvailable = false; },
      rotate: () => { current = { ...current, token_hash: "b".repeat(64) }; },
      advance: () => { current = { ...current, checked_ms: String(now + 10_000) }; } };
  }

  it("verifies no more than50 candidates and returns49 plus a proven continuation without consuming its probe", async () => {
    const f = fixture();
    const page = await f.read();
    expect(f.serialize).toHaveBeenCalledTimes(50);
    expect(page.proposals.map(row => row.proposal_id)).toEqual(f.rows.slice(0, 49).map(row => row.id));
    expect(page.has_more).toBe(true);
    const state = openMemoryProposalCursor(page.next_cursor!, f.authority.token_hash,
      { ...f.scope, accountId: f.auth.accountId, userId: f.auth.userId, loginSessionId: f.auth.sessionId },
      { nowMs: Number(f.authority.checked_ms), sessionExpiresAtMs: f.authority.expires_at.getTime() });
    expect(state.beforeId).toBe(f.rows[48]!.id);
    expect(state.beforeCreatedAt).toBe(f.rows[48]!.cursor_time);
    const query = f.query.mock.calls.find(([sql]) => sql.startsWith("SELECT p.*"))!;
    expect(query[0]).toMatch(/ORDER BY p.created_at DESC, p.id LIMIT 50$/u);
    expect(query[0]).toContain("source_revision_hash");
    expect(query[0].indexOf("admitted.item_count > 0")).toBeLessThan(query[0].lastIndexOf("LIMIT 50"));
    const envelope = f.query.mock.calls.find(([sql]) => sql.includes("qualified AS MATERIALIZED"))!;
    expect(JSON.parse(envelope[1][7] as string)).toHaveLength(50);
  });

  it("keeps the old first-page shape and50-row budget without reading key material", async () => {
    const f = fixture(); f.unavailableInitial();
    const page = await f.read({});
    expect(page.proposals).toHaveLength(50);
    expect(Object.keys(page).sort()).toEqual(["contract_version", "proposals"]);
    expect(f.query).toHaveBeenCalledTimes(2);
    expect(f.query.mock.calls.every(([sql]) => !sql.includes("FROM sessions"))).toBe(true);
  });

  it("returns a truthful final page without cursor when fewer than50 qualified rows remain", async () => {
    const page = await fixture(2).read();
    expect(page.proposals).toHaveLength(2); expect(page.has_more).toBe(false); expect(page.next_cursor).toBeNull();
  });

  it("uses the original live Lab lineage gate before selection and after all source awaits", async () => {
    const f = fixture(1);
    await f.read();
    const initial = f.query.mock.calls.find(([sql]) => sql.includes("FROM sessions"))!;
    const final = f.query.mock.calls.find(([sql]) => sql.includes("qualified AS MATERIALIZED"))!;
    for (const [sql] of [initial, final]) {
      // Query-wiring proof only; actual lineage mutations execute in Hosted PG.
      expect(sql).toContain(labWorkspaceSessionActiveSQL);
      expect(sql).toMatch(/FROM sessions\s+JOIN accounts/u);
      expect(sql).toContain("JOIN users ON users.account_id = sessions.account_id");
    }
  });

  it("rejects an unexpected driver result above the fixed candidate budget before verification", async () => {
    const f = fixture(51);
    await expect(f.read()).rejects.toThrow(/fresh read/);
    expect(f.serialize).not.toHaveBeenCalled();
  });

  it("does not reset the original cutoff or cursor deadline on continuation", async () => {
    const f = fixture();
    const first = await f.read();
    f.advance();
    const second = await f.read({ paginate: true, cursor: first.next_cursor });
    const decode = (cursor: string) => openMemoryProposalCursor(cursor, f.authority.token_hash,
      { ...f.scope, accountId: f.auth.accountId, userId: f.auth.userId, loginSessionId: f.auth.sessionId },
      { nowMs: Number(f.authority.checked_ms) + 10_000, sessionExpiresAtMs: f.authority.expires_at.getTime() });
    expect(decode(second.next_cursor!).validUntilMs).toBe(decode(first.next_cursor!).validUntilMs);
    expect(second.snapshot_at).toBe(first.snapshot_at);
    const queries = f.query.mock.calls.filter(([sql]) => sql.startsWith("SELECT p.*"));
    expect(queries[1]![1].slice(-3)).toEqual([first.snapshot_at, f.rows[48]!.cursor_time, f.rows[48]!.id]);
  });

  it.each(["filtered", "count_drift", "source_changed", "rotation", "unknown_session"])(
    "fails closed without partial page metadata when %s occurs", async mode => {
      const f = fixture();
      if (mode === "unknown_session") f.unavailableInitial();
      else f.serialize.mockImplementationOnce(async row => {
        if (mode === "source_changed") f.unavailableFinal();
        if (mode === "rotation") f.rotate();
        return mode === "filtered" ? null : { proposal_id: row.id, revision: row.revision,
          item_count: mode === "count_drift" ? 2 : 1, default_selected_count: 1 } as MemoryProposalRecord;
      });
      await expect(f.read()).rejects.toThrow("The proposal list changed. Start a fresh read.");
      if (mode === "unknown_session") {
        expect(f.serialize).not.toHaveBeenCalled();
        expect(f.query.mock.calls.some(([sql]) => sql.startsWith("SELECT p.*"))).toBe(false);
      }
    });
});
