/** GET455 runtime tests only. Reuse the frozen real-password/Memory fixture;
 * replace only its existing tool-capable synthetic provider method. No DB result,
 * accepted Memory, credential grant or successful publication is fabricated. */
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { ScriptedAgentProvider, type AgentToolResult } from "@talent-signal/agent";
import { CONTRACT_VERSION, type MemoryCommitRequest, type MemoryCommitResponse, type MemoryProposalCandidate,
  type MemoryProposalStageRequest, type MemoryReviewResponse, type SessionResponse,
  type UnscopedChatTaskRequest, type UnscopedChatTaskResponse, type ResourceCaptureRequest,
  type ResourceCaptureResponse, type MemoryRecallResponse } from "@talent-signal/contracts";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import { Pool } from "pg";
import { expect } from "vitest";
import { buildApp } from "../../app.js";
import { independentReply, savedMemoryDatabase, withSavedMemoryFixture,
  type SavedMemoryFixture } from "./savedMemoryDiscovery.fixture.js";

export { independentReply, savedMemoryDatabase };
if (process.env.GET_455_MEMORY_RUNTIME_TEST_REQUIRED === "1" && !savedMemoryDatabase) {
  throw new Error("GET455 runtime verification requires the explicit disposable loopback database.");
}
type Request = (options: Omit<InjectOptions, "headers">) => Promise<LightMyRequestResponse>;
type Kind = "self" | "recall" | "search";
export type RuntimeStamp = { memory_item_id: string; item_version: number; lineage_epoch: string;
  memory_owner_id: string; scope: string; subject_id: string | null; relationship_context_id: string | null };
export type ToolOnlyMemory = { itemID: string; version: number; text: string; personID: string;
  contextID: string; email: string };
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The synthetic provider did not reach its bounded barrier.")), milliseconds);
  })]); } finally { if (timer) clearTimeout(timer); }
}
export function assertDenied(response: LightMyRequestResponse, excluded: string): void {
  // A generic500 is not evidence of a correct terminal authority rejection.
  expect(response.statusCode).toBeGreaterThanOrEqual(400);
  expect(response.statusCode).toBeLessThan(500);
  expect(response.body.includes(excluded)).toBe(false);
}

export async function withSavedMemoryRuntime(operation: (runtime: {
  f: SavedMemoryFixture; control: Pool; request: Request;
  post(body: UnscopedChatTaskRequest): Promise<LightMyRequestResponse>;
  start(body: UnscopedChatTaskRequest): Promise<LightMyRequestResponse>;
  configure(kind: Kind, selectedID: string, terms?: string[]): void;
  configureToolOnly(kind: "recall" | "search", memory: ToolOnlyMemory): void;
  acceptToolOnlyPerson(): Promise<ToolOnlyMemory>;
  holdNext(): { entered(): Promise<void>; release(): void };
  calls(): number;
  tools(): readonly AgentToolResult[];
  manifest(): readonly string[];
  lastRunID(): string | undefined;
  delivered(): readonly { id: string; version: number; display_text: string }[];
  stamp(id: string): Promise<RuntimeStamp>;
  current(): Promise<number>;
  shortenAndRotateLogin(): Promise<{ oldRequest: Request; oldPost(body: UnscopedChatTaskRequest): Promise<LightMyRequestResponse>; waitOriginalExpiry(): Promise<void> }>;
  reviewedUpdate(id: string, version: number, previous: string, replacement: string): Promise<{ commitID: string; revision: number }>;
}) => Promise<void>): Promise<void> {
  await withSavedMemoryFixture(async f => {
    // The imported frozen fixture rejects non-postgres/options/hash/foreign
    // URLs before either Pool exists. This is the same disposable DB, not a
    // resident fallback. Only this new control connection is owned here.
    const control = new Pool({ connectionString: savedMemoryDatabase, max: 1,
      connectionTimeoutMillis: 2_000, statement_timeout: 5_000, query_timeout: 6_000 });
    const originalRun = f.provider.run;
    const requests = new Set<Promise<LightMyRequestResponse>>();
    const renewalSecret = randomBytes(32).toString("base64url");
    let sidecar: Awaited<ReturnType<typeof buildApp>> | undefined;
    let count = 0, kind: Kind = "self", selectedID = "", terms: string[] = [], runID: string | undefined;
    let personTool: ToolOnlyMemory | undefined;
    let resultTools: readonly AgentToolResult[] = [], manifest: readonly string[] = [];
    let delivery: Array<{ id: string; version: number; display_text: string }> = [];
    let nextHold: { entered: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | undefined;
    const releases = new Set<() => void>();
    f.provider.run = async (...args: Parameters<typeof originalRun>) => {
      const [input, invokeTool, signal] = args;
      count++;
      runID = input.runID;
      manifest = [...input.toolManifest];
      delivery = (input.selfMemoryContext?.items ?? []).map(item => ({ id: item.id,
        version: item.version, display_text: item.display_text }));
      const mode = f.provider.mode === "neutral" ? "neutral" : kind;
      const steps: Array<{ tool: string; input: unknown }> = mode === "search"
        ? [{ tool: "search_saved_memory", input: { terms: [...terms], limit: 10 } }]
        : mode === "recall" && personTool ? [
          { tool: "contact_workspace", input: { operation: "search", query: personTool.email } },
          { tool: "contact_workspace", input: { operation: "read", person_id: personTool.personID, relationship_context_id: personTool.contextID } },
          { tool: "memory_review", input: { operation: "recall", scope: "person", person_id: personTool.personID,
            relationship_context_id: personTool.contextID } },
        ] : mode === "recall" ? [{ tool: "memory_review", input: { operation: "recall", scope: "self" } }] : [];
      resultTools = [];
      const script = new ScriptedAgentProvider(steps, results => {
        resultTools = results;
        const memoryResult = results.find(result => result.name === (mode === "search" ? "search_saved_memory" : "memory_review"));
        const value = memoryResult?.data as { items?: Array<{ id: string; display_text: string }> } | undefined;
        const returned = Array.isArray(value?.items) ? value.items : [];
        const found = mode === "self" ? delivery.find(item => item.id === selectedID)
          : returned.find(item => item.id === selectedID);
        return { outcome: "reply", title: "Synthetic runtime reply",
          body: mode === "neutral" ? independentReply : found?.display_text ?? "The requested saved Memory was not delivered." };
      });
      const answer = await script.run(input, invokeTool, signal);
      const hold = mode !== "neutral" ? nextHold : undefined;
      if (hold) {
        nextHold = undefined; hold.entered.resolve();
        // Intentionally ignore abort to exercise the real outer post-provider
        // fence. Finally always releases this owned synthetic callback.
        await hold.release.promise;
      }
      return answer;
    };
    try {
      // Actual password login has already happened in the frozen fixture.
      // Normal enrollment provides a second legitimate access generation; no
      // bearer/hash is read from SQL, printed, asserted or written to disk.
      const enrolled = await f.request({ method: "POST", url: "/v1/auth/persistent/enroll",
        payload: { renewal_secret: renewalSecret, client_kind: "web" } });
      expect(enrolled.statusCode).toBe(200);
      let access = enrolled.json<SessionResponse>().access_token;
      sidecar = await buildApp({ pool: f.pool, config: { databaseUrl: savedMemoryDatabase!, host: "127.0.0.1", port: 0,
        allowedOrigins: [], appleSignInAudiences: [], appleSignInEnabled: false,
        passwordAuthEnabled: true, passwordRegistrationEnabled: false, simulatedAuthEnabled: false,
        internalLabEnabled: false, retentionSweepIntervalMs: 60_000, sessionTtlSeconds: 3_600 },
      remoteChatProvider: f.provider, personResearchProvider: null, privateConversationProvider: null,
      labProviders: new Map(), labJobWorkerEnabled: false, conversationQueueWorkerEnabled: false,
      labCIVerifier: null, screenshotContact: null });
      await sidecar.ready();
      const app = sidecar;
      const authenticated = (token: string): Request => options => app.inject({ ...options,
        headers: { authorization: `Bearer ${token}` } }).then(value => value);
      const request: Request = options => authenticated(access)(options);
      const track = (pending: Promise<LightMyRequestResponse>) => {
        requests.add(pending);
        void pending.then(() => requests.delete(pending), () => requests.delete(pending));
        return pending;
      };
      const start = (body: UnscopedChatTaskRequest) => track(request({ method: "POST", url: "/v1/chat/unscoped-tasks", payload: body }));
      await operation({ f, control, request, post: start, start,
        configure: (value, selected, values = []) => { kind = value; selectedID = selected; terms = [...values]; personTool = undefined;
          f.provider.mode = value === "search" ? "discovery" : "recall"; },
        configureToolOnly: (value, memory) => { kind = value; selectedID = memory.itemID;
          terms = ["tool-only_%\\"]; personTool = { ...memory }; f.provider.mode = value === "search" ? "discovery" : "recall"; },
        acceptToolOnlyPerson: async () => {
          f.provider.mode = "neutral";
          const clientID = randomUUID(), label = `Runtime partner ${clientID.slice(0, 8)}`;
          const email = `runtime-partner-${clientID}@example.invalid`, now = new Date().toISOString();
          // Human-confirmed synthetic contact and stable handle use the real
          // governed intake owner, not INSERT/req.auth or a label guess.
          const capture: ResourceCaptureRequest = { contract_version: CONTRACT_VERSION, idempotency_key: randomUUID(), channel: "chat",
            purpose: "Explicit synthetic contact identity for the tool-only Memory regression.", captured_at: now, source_timezone: "UTC",
            person_scope: { status: "new_person", display_label: label, relationship_context: {
              status: "proposed", label: "Runtime notebook partner", purpose: "Synthetic notebook collaboration" },
            binding_basis: "The synthetic human explicitly selects this new contact and its email." },
            resource: { client_resource_id: clientID, kind: "contact_record", display_name: "Synthetic runtime contact card",
              media_type: "text/plain", observed_at: now, source_timezone: "UTC",
              retention: { requested_mode: "evidence_crop", source_scope: "reviewed_extracted_text" } },
            confirmed_identity_handles: [{ type: "email", value: email, source_client_resource_id: clientID }],
            fragments: [{ client_resource_id: clientID, kind: "contact_field", sequence: 0, text: email,
              locator: { kind: "contact_field", field: "email", source_record_version: "synthetic-runtime-v1" },
              attribution: { actor_kind: "recruiter", status: "confirmed" }, review_status: "reviewed",
              parser: { name: "synthetic-human-contact-entry", version: "1" } }] };
          const created = await request({ method: "POST", url: "/v1/resource-captures", payload: capture });
          expect(created.statusCode).toBe(201);
          const identity = created.json<ResourceCaptureResponse>().identity;
          expect(identity.status).toBe("bound");
          if (!identity.person_id || !identity.relationship_context_id) throw new Error("The actual synthetic contact did not bind its scope.");
          const personID = identity.person_id, contextID = identity.relationship_context_id;
          const text = `${label} prefers the synthetic tool-only_%\\ copper notebook.`;
          const source = await start({ idempotency_key: randomUUID(), objective: text });
          expect(source.statusCode).toBe(201);
          const sessionID = randomUUID(), saved = await f.saveAnswer(sessionID, text, source.json<UnscopedChatTaskResponse>());
          const messageID = saved.payload!.turns[0]!.id;
          const candidate: MemoryProposalCandidate = { scope: "person", operation: "add", statement_kind: "source_statement",
            display_text: text, subject_id: personID, relationship_context_id: null, speaker: "me", reporter: "me",
            valid_time: null, observed_time: null, time_status: "known", sensitivity: "normal", source_excerpt: text,
            source_locator: { kind: "message", session_id: sessionID, message_id: messageID },
            previous_memory_item_id: null, previous_revision: null, previous_text: null,
            reason: "The synthetic human accepts this contact statement, separate from private self bootstrap." };
          const stagedBody: MemoryProposalStageRequest = { idempotency_key: randomUUID(), surface: "chat", session_id: sessionID,
            source_message_id: messageID, source_task_id: null, person_id: personID, relationship_context_id: contextID,
            contact_decision: "existing", identity_authority: "human_selection", identity_clue: { type: "email", value: email }, new_contact: null,
            proposer: { kind: "human", name: "Synthetic tool-only acceptance", version: "1" }, items: [candidate] };
          const staged = await request({ method: "POST", url: "/v1/memory/proposals", payload: stagedBody });
          expect(staged.statusCode).toBe(201);
          const proposalID = staged.json<{ proposal: { proposal_id: string } }>().proposal.proposal_id;
          const opened = await request({ method: "POST", url: `/v1/memory/proposals/${proposalID}/reviews`,
            payload: { purpose: "chat", person_id: personID, relationship_context_id: contextID } });
          expect(opened.statusCode).toBe(200);
          const review = opened.json<MemoryReviewResponse>();
          if (!review.review_credential) throw new Error("The canonical tool-only Memory review omitted its credential.");
          const commit: MemoryCommitRequest = { idempotency_key: randomUUID(), expected_proposal_revision: review.review.proposal_revision,
            selected_item_ids: review.review.items.map(item => item.id), contact_decision: "existing", identity_authority: "human_selection",
            person_id: personID, relationship_context_id: contextID, edited_text: {}, item_decisions: {}, expected_item_versions: {},
            new_contact: null, reason: "Explicit synthetic human acceptance of the independently scoped tool statement." };
          const committed = await app.inject({ method: "POST", url: `/v1/memory/reviews/${review.review.review_scope_id}/commits`,
            headers: { authorization: `Bearer ${access}`, "x-memory-review-credential": review.review_credential }, payload: commit });
          expect(committed.statusCode).toBe(201);
          const ids = committed.json<MemoryCommitResponse>().receipt.created_item_ids;
          expect(ids).toHaveLength(1);
          const recalled = await request({ method: "GET", url: `/v1/memory/items?surface=people&person_id=${personID}&scope=person` });
          expect(recalled.statusCode).toBe(200);
          const item = recalled.json<MemoryRecallResponse>().items.find(value => value.id === ids[0]);
          expect(item).toEqual(expect.objectContaining({ display_text: text, scope: "person", subject_id: personID }));
          if (!item) throw new Error("The actual tool-only statement was not accepted by the current owner.");
          expect((await f.recall()).items.some(value => value.id === item.id)).toBe(false);
          return { itemID: item.id, version: item.version, text, personID, contextID, email };
        },
        holdNext: () => {
          if (nextHold) throw new Error("Only one synthetic provider barrier may be armed.");
          const h = { entered: deferred(), release: deferred() }; nextHold = h;
          releases.add(h.release.resolve);
          return { entered: () => bounded(h.entered.promise, 2_000), release: h.release.resolve };
        },
        calls: () => count, tools: () => resultTools, manifest: () => manifest, lastRunID: () => runID,
        delivered: () => delivery.map(item => ({ ...item })),
        current: async () => (await request({ method: "GET", url: "/v1/auth/session" })).statusCode,
        stamp: async id => {
          const row = (await control.query<RuntimeStamp>(`SELECT m.id::text AS memory_item_id,m.version AS item_version,
            l.epoch::text AS lineage_epoch,m.owner_user_id::text AS memory_owner_id,m.scope,
            CASE WHEN m.scope='self' THEN NULL::text ELSE m.subject_id::text END AS subject_id,
            m.relationship_context_id::text FROM memory_items m
            JOIN memory_item_lineage l ON l.account_id=m.account_id AND l.memory_item_id=m.id
            WHERE m.account_id=$1 AND m.id=$2 AND (m.scope<>'self' OR
              (m.owner_user_id=$3 AND m.relationship_context_id IS NULL AND EXISTS (
                SELECT 1 FROM subjects owner_subject WHERE owner_subject.account_id=m.account_id
                  AND owner_subject.id=m.subject_id AND owner_subject.status='active'
                  AND owner_subject.external_ref='workspace-owner:' || $3::text)))`,
          [f.auth.accountId, id, f.auth.userId])).rows[0];
          if (!row) throw new Error("The real accepted synthetic item has no lineage epoch.");
          return row;
        },
        shortenAndRotateLogin: async () => {
          const oldRequest = authenticated(access);
          const changed = await control.query(`UPDATE sessions SET expires_at=clock_timestamp()+interval '3 seconds'
            WHERE account_id=$1 AND user_id=$2 AND id=$3 AND revoked_at IS NULL RETURNING id`,
          [f.auth.accountId, f.auth.userId, f.auth.sessionId]);
          expect(changed.rowCount).toBe(1);
          const renewed = await app.inject({ method: "POST", url: "/v1/auth/persistent/renew", payload: {
            renewal_secret: renewalSecret, account_id: f.auth.accountId, user_id: f.auth.userId, session_id: f.auth.sessionId,
          } });
          expect(renewed.statusCode).toBe(200);
          access = renewed.json<SessionResponse>().access_token;
          expect((await oldRequest({ method: "GET", url: "/v1/auth/session" })).statusCode).toBe(200);
          expect((await request({ method: "GET", url: "/v1/auth/session" })).statusCode).toBe(200);
          return { oldRequest, oldPost: body => track(oldRequest({ method: "POST", url: "/v1/chat/unscoped-tasks", payload: body })),
            waitOriginalExpiry: async () => {
              const deadline = performance.now() + 4_000;
              while (performance.now() < deadline) {
                const row = (await control.query<{ expired: boolean }>(`SELECT previous_token_expires_at<=clock_timestamp() AS expired
                  FROM sessions WHERE account_id=$1 AND user_id=$2 AND id=$3`,
                [f.auth.accountId, f.auth.userId, f.auth.sessionId])).rows[0];
                if (row?.expired === true) return;
                await delay(25);
              }
              throw new Error("The real original accepted login deadline did not elapse within its fixed budget.");
            } };
        },
        reviewedUpdate: async (id, version, previous, replacement) => {
          f.provider.mode = "neutral";
          const source = await start({ idempotency_key: randomUUID(), objective: replacement });
          expect(source.statusCode).toBe(201);
          const sessionID = randomUUID();
          const saved = await f.saveAnswer(sessionID, replacement, source.json<UnscopedChatTaskResponse>());
          const messageID = saved.payload!.turns[0]!.id;
          const candidate: MemoryProposalCandidate = { scope: "self", operation: "update", statement_kind: "source_statement",
            display_text: replacement, subject_id: null, relationship_context_id: null, speaker: "me", reporter: "me",
            valid_time: null, observed_time: null, time_status: "known", sensitivity: "normal", source_excerpt: replacement,
            source_locator: { kind: "message", session_id: sessionID, message_id: messageID },
            previous_memory_item_id: id, previous_revision: version, previous_text: previous,
            reason: "The synthetic human replaces the earlier explicitly accepted statement." };
          const stagedBody: MemoryProposalStageRequest = { idempotency_key: randomUUID(), surface: "chat", session_id: sessionID,
            source_message_id: messageID, source_task_id: null, person_id: null, relationship_context_id: null,
            contact_decision: "none", identity_clue: null, new_contact: null,
            proposer: { kind: "human", name: "Synthetic runtime update", version: "1" }, items: [candidate] };
          const staged = await request({ method: "POST", url: "/v1/memory/proposals", payload: stagedBody });
          expect(staged.statusCode).toBe(201);
          const proposalID = staged.json<{ proposal: { proposal_id: string } }>().proposal.proposal_id;
          const opened = await request({ method: "POST", url: `/v1/memory/proposals/${proposalID}/reviews`,
            payload: { purpose: "chat", person_id: null, relationship_context_id: null } });
          expect(opened.statusCode).toBe(200);
          const review = opened.json<MemoryReviewResponse>();
          const item = review.review.items[0];
          expect(item?.operation).toBe("update");
          expect(item?.previous_memory_item_id).toBe(id);
          if (!item || !review.review_credential) throw new Error("The canonical synthetic update review is incomplete.");
          const commit: MemoryCommitRequest = { idempotency_key: randomUUID(), expected_proposal_revision: review.review.proposal_revision,
            selected_item_ids: [item.id], contact_decision: "none", edited_text: {}, item_decisions: {},
            expected_item_versions: { [item.id]: version }, new_contact: null, reason: "Explicit synthetic update for the ABA boundary." };
          const committed = await app.inject({ method: "POST", url: `/v1/memory/reviews/${review.review.review_scope_id}/commits`,
            headers: { authorization: `Bearer ${access}`, "x-memory-review-credential": review.review_credential }, payload: commit });
          expect(committed.statusCode).toBe(201);
          const commitID = committed.json<MemoryCommitResponse>().receipt.commit_id;
          const row = (await control.query<{ revision: number }>(`SELECT revision FROM memory_commits
            WHERE account_id=$1 AND id=$2 AND committed_by_user_id=$3`, [f.auth.accountId, commitID, f.auth.userId])).rows[0];
          if (!row) throw new Error("The actual synthetic update has no canonical commit.");
          return { commitID, revision: row.revision };
        },
      });
    } finally {
      for (const release of releases) release();
      await Promise.allSettled([...requests]);
      f.provider.run = originalRun;
      try { await sidecar?.close(); } finally { await control.end(); }
    }
  });
}
