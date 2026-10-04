import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { ScriptedAgentProvider } from "@talent-signal/agent";
import {
  CONTRACT_VERSION,
  TalentSignalClient,
  TalentSignalHttpError,
  type ResourceCaptureRequest,
} from "@talent-signal/contracts";
import { Pool } from "pg";

import type { AuthContext } from "../modules/auth.js";
import {
  createPursuitAgentTask,
  getAgentTask,
  getAgentTaskEvents,
  recoverGovernedAgentTasks,
  resolveAgentDecisionBundle,
} from "../modules/agentTasks.js";

const baseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:4317";
const databaseUrl =
  process.env.EVALUATION_DATABASE_URL ??
  `postgresql://talent_signal_local:talent_signal_local_only@127.0.0.1:${process.env.POSTGRES_PORT ?? "55432"}/talent_signal_local`;
const artifactDir =
  process.env.EVALUATION_ARTIFACT_DIR ??
  fileURLToPath(
    new URL(
      "../../../../output/evaluation/2026-08-30-governed-agent-task",
      import.meta.url,
    ),
  );

function captureRequest(fixtureID: string): ResourceCaptureRequest {
  const clientResourceID = `governed-task-eval:${fixtureID}`;
  return {
    contract_version: CONTRACT_VERSION,
    idempotency_key: `${fixtureID}:capture`,
    channel: "ios_share",
    purpose: "Synthetic governed briefing Task evaluation",
    captured_at: "2026-08-30T09:00:00.000Z",
    source_timezone: "Asia/Shanghai",
    person_scope: {
      status: "new_person",
      display_label: `Synthetic briefing subject ${fixtureID.slice(0, 8)}`,
      relationship_context: {
        status: "proposed",
        label: "Synthetic governed Task evaluation",
        purpose: "Prove durable, review-only briefing behavior",
        role: "Candidate",
      },
      binding_basis: "The evaluator explicitly creates a synthetic Person.",
    },
    resource: {
      client_resource_id: clientResourceID,
      kind: "conversation_transcript",
      display_name: "Synthetic reviewed pre-call evidence",
      media_type: "text/plain",
      observed_at: "2026-08-30T09:00:00.000Z",
      source_timezone: "Asia/Shanghai",
      source_locator: `synthetic:governed-task:${fixtureID}`,
      retention: {
        requested_mode: "ephemeral",
        source_scope: "reviewed_selected_text",
      },
    },
    fragments: [
      {
        client_resource_id: clientResourceID,
        kind: "message",
        sequence: 0,
        text: "I can speak next Thursday afternoon; the location constraint is still unresolved.",
        locator: {
          kind: "message",
          source_message_id: `${fixtureID}:m1`,
          sequence: 0,
          speaker_side: "left",
        },
        attribution: { actor_kind: "candidate", status: "confirmed" },
        review_status: "reviewed",
        parser: { name: "synthetic-governed-task-evaluator", version: "1.0.0" },
      },
    ],
  };
}

async function waitForTerminal(
  pool: Pool,
  auth: AuthContext,
  taskID: string,
) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await getAgentTask(pool, auth, taskID);
    if (response.task.status !== "active") return response.task;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail("The governed Task did not reach a durable terminal state.");
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  const alpha = new TalentSignalClient(baseUrl);
  const beta = new TalentSignalClient(baseUrl);
  try {
    const session = await alpha.login({
      account_slug: "fixture-alpha",
      user_email: "recruiter@alpha.local",
      client_label: "governed-agent-task-evaluation",
    });
    await beta.login({
      account_slug: "fixture-beta",
      user_email: "recruiter@beta.local",
      client_label: "governed-agent-task-evaluation",
    });
    const auth: AuthContext = {
      accountId: session.account.id,
      accountSlug: session.account.slug,
      userId: session.user.id,
      userEmail: session.user.email,
      userKind: "simulated_human",
      sessionId: randomUUID(),
    };
    const fixtureID = randomUUID();
    const capture = await alpha.createResourceCapture(captureRequest(fixtureID));
    assert(capture.identity.person_id);
    const resource = await alpha.getRelationshipResource(capture.resource.id);
    const evidence = resource.fragments[0];
    assert(evidence);
    const pursuit = await alpha.createPursuit({
      idempotency_key: `${fixtureID}:pursuit`,
      type: "recruiting",
      title: "Synthetic governed briefing Pursuit",
      target_outcome: "mutual_final_decision",
      target_date: "2026-10-30",
      status: "active",
      milestone: "shortlist_review",
      roles: [
        {
          subject_ref: { type: "person", id: capture.identity.person_id },
          role_type: "candidate",
          status: "active",
          confidence: "confirmed",
          basis_kind: "evidence_supported",
          evidence_refs: [evidence.id],
        },
      ],
    });
    const request = {
      contract_version: CONTRACT_VERSION,
      idempotency_key: `${fixtureID}:task`,
      expected_revision: pursuit.pursuit.revision,
      kind: "pre_call_briefing" as const,
      objective: "Prepare one grounded pre-call briefing without external effects.",
      capture_id: capture.capture_id,
      evidence_refs: [evidence.id],
      permission_ceiling: [
        "read_pursuit",
        "read_evidence",
        "create_briefing_artifact",
        "stage_pursuit_proposal",
        "record_no_action",
      ] as const,
    };
    const provider = new ScriptedAgentProvider(
      [
        { tool: "read_pursuit", input: {} },
        { tool: "read_evidence", input: { evidence_refs: [evidence.id] } },
      ],
      () => ({
        outcome: "no_action",
        reason_code: "NO_MATERIAL_CHANGE",
        reason: "The reviewed evidence supports a briefing but no canonical change.",
        missing_evidence_refs: [],
      }),
    );
    const accepted = await createPursuitAgentTask(pool, auth, pursuit.pursuit.id, request, {
      provider,
      schedule: false,
    });
    assert.equal(accepted.body.task.status, "active");
    assert.deepEqual(accepted.body.task.external_effects, []);
    const replay = await createPursuitAgentTask(pool, auth, pursuit.pursuit.id, request, {
      provider,
      schedule: false,
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.body.task.id, accepted.body.task.id);

    const recovery = await recoverGovernedAgentTasks(pool, provider);
    assert(recovery.scheduled >= 1);
    const terminal = await waitForTerminal(pool, auth, accepted.body.task.id);
    assert.equal(terminal.status, "no_action");
    assert.equal(terminal.task_revision, 2);
    assert(terminal.artifact);
    assert.equal(terminal.artifact.authority, "non_canonical");
    assert.equal(terminal.artifact.what_changed[0]?.evidence_refs[0], evidence.id);
    assert.deepEqual(terminal.external_effects, []);
    const events = await getAgentTaskEvents(pool, auth, terminal.id, 0);
    assert.deepEqual(
      events.events.map((event) => event.task_sequence),
      events.events.map((_, index) => index + 1),
    );
    assert(events.events.some((event) => event.name === "checkpoint.saved"));
    assert(events.events.some((event) => event.name === "artifact.ready"));
    assert(events.events.some((event) => event.name === "run.no_action"));
    assert(events.events.every((event) => !JSON.stringify(event.public_payload).includes("next Thursday")));

    const proposalProvider = new ScriptedAgentProvider(
      [
        { tool: "read_pursuit", input: {} },
        { tool: "read_evidence", input: { evidence_refs: [evidence.id] } },
        {
          tool: "stage_pursuit_proposal",
          input: {
            summary: "One operational scheduling dependency may need review.",
            items: [
              {
                item_key: "operational_gap:scheduling_constraint",
                basis_kind: "evidence_supported",
                epistemic_status: "inference",
                evidence_refs: [evidence.id],
                reason: "UNTRUSTED MODEL FREE TEXT",
                effect_summary: "UNTRUSTED MODEL EFFECT TEXT",
                change_kind: "add_gap",
                proposed_value: {
                  title: "Candidate should be rejected",
                  basis_summary: "Candidate is not a fit",
                  close_condition: "Advance only if quality improves",
                },
              },
            ],
          },
        },
      ],
      (results) => ({
        outcome: "proposal",
        candidate_fingerprint: results.at(-1)?.candidateFingerprint,
      }),
    );
    const proposed = await createPursuitAgentTask(
      pool,
      auth,
      pursuit.pursuit.id,
      {
        ...request,
        idempotency_key: `${fixtureID}:operational-task`,
        objective: "Stage one enumerated operational dependency or record no action.",
      },
      { provider: proposalProvider, schedule: false },
    );
    await recoverGovernedAgentTasks(pool, proposalProvider);
    const waiting = await waitForTerminal(pool, auth, proposed.body.task.id);
    assert.equal(waiting.status, "waiting_for_domain_decision");
    assert(waiting.decision_bundle);
    assert.equal(waiting.decision_bundle.items.length, 1);
    const staged = await alpha.getPursuitProposal(waiting.decision_bundle.proposal_id!);
    assert.equal(staged.proposal.items[0]?.change_kind, "add_gap");
    assert.equal(
      (staged.proposal.items[0]?.proposed_value as { title: string }).title,
      "Scheduling constraint unresolved",
    );
    assert(!JSON.stringify(staged.proposal).includes("Candidate should be rejected"));
    const suspendedRun = await pool.query<{ status: string }>(
      `SELECT status FROM agent_task_runs
       WHERE account_id = $1 AND task_id = $2
       ORDER BY attempt DESC LIMIT 1`,
      [auth.accountId, waiting.id],
    );
    assert.equal(suspendedRun.rows[0]?.status, "suspended");
    await assert.rejects(
      () =>
        alpha.reviewPursuitProposal(waiting.decision_bundle!.proposal_id!, {
          operation_id: randomUUID(),
          idempotency_key: `${fixtureID}:forbidden-direct-review`,
          base_revision: pursuit.pursuit.revision,
          reason: "A correlated Proposal must use its Agent Decision Bundle.",
          decisions: staged.proposal.items.map((item) => ({
            item_id: item.id,
            decision: "confirm" as const,
          })),
        }),
      (error: unknown) =>
        error instanceof TalentSignalHttpError &&
        error.code === "AGENT_DECISION_BUNDLE_REQUIRED",
    );
    const resolved = await resolveAgentDecisionBundle(
      pool,
      auth,
      waiting.decision_bundle.id,
      {
        operation_id: randomUUID(),
        idempotency_key: `${fixtureID}:resolve-operational-task`,
        expected_task_revision: waiting.task_revision,
        expected_bundle_revision: waiting.decision_bundle.bundle_revision,
        base_revision: pursuit.pursuit.revision,
        reason: "Synthetic recruiter accepts this operational gap only.",
        decisions: [
          {
            item_id: waiting.decision_bundle.items[0]!.id,
            decision: "accept",
          },
        ],
      },
    );
    assert.equal(resolved.body.task.status, "completed");
    assert.equal(resolved.body.task.decision_bundle?.status, "resolved");
    assert(resolved.body.task.decision_bundle?.items[0]?.domain_receipt_ref);
    assert.deepEqual(resolved.body.task.external_effects, []);
    const completedRun = await pool.query<{ status: string }>(
      `SELECT status FROM agent_task_runs
       WHERE account_id = $1 AND task_id = $2
       ORDER BY attempt DESC LIMIT 1`,
      [auth.accountId, waiting.id],
    );
    assert.equal(completedRun.rows[0]?.status, "completed");
    const afterDecision = await alpha.getPursuit(pursuit.pursuit.id);
    assert(
      afterDecision.pursuit.gaps.some(
        (gap) => gap.title === "Scheduling constraint unresolved",
      ),
    );

    const prohibitedProvider = new ScriptedAgentProvider(
      [
        {
          tool: "stage_pursuit_proposal",
          input: {
            summary: "Attempt a prohibited candidate judgment.",
            items: [
              {
                item_key: "recommend_reject",
                basis_kind: "evidence_supported",
                epistemic_status: "inference",
                evidence_refs: [evidence.id],
                reason: "The candidate lacks a required skill.",
                effect_summary: "Would reject the candidate.",
                change_kind: "set_milestone",
                proposed_value: "rejected",
              },
            ],
          },
        },
      ],
      (results) => ({
        outcome: "proposal",
        candidate_fingerprint: results.at(-1)?.candidateFingerprint,
      }),
    );
    const prohibited = await createPursuitAgentTask(
      pool,
      auth,
      pursuit.pursuit.id,
      {
        ...request,
        idempotency_key: `${fixtureID}:prohibited-task`,
        expected_revision: afterDecision.pursuit.revision,
        objective: "Attempt a prohibited person assessment for boundary evaluation.",
      },
      { provider: prohibitedProvider, schedule: false },
    );
    await recoverGovernedAgentTasks(pool, prohibitedProvider);
    const denied = await waitForTerminal(pool, auth, prohibited.body.task.id);
    assert.equal(denied.status, "failed");
    assert.equal(denied.decision_bundle, null);
    assert.equal(denied.artifact, null);
    assert.deepEqual(denied.external_effects, []);

    let crossWorkspaceHidden = false;
    try {
      await beta.getAgentTask(terminal.id);
    } catch (error) {
      assert(error instanceof TalentSignalHttpError);
      assert.equal(error.status, 404);
      crossWorkspaceHidden = true;
    }
    assert.equal(crossWorkspaceHidden, true);

    await alpha.deleteCapture(capture.capture_id, {
      idempotency_key: `${fixtureID}:delete-capture`,
      reason: "Prove source deletion propagates to future artifact readback.",
    });
    const redacted = await getAgentTask(pool, auth, terminal.id);
    assert.equal(redacted.task.artifact?.status, "redacted");
    assert.deepEqual(redacted.task.artifact?.what_changed, []);
    assert.equal(redacted.task.artifact?.title, "[source deleted]");
    assert.equal(redacted.task.artifact?.next_move.kind, "no_action");
    assert(
      redacted.task.artifact?.limitations.some((limitation) =>
        limitation.includes("no current authority"),
      ),
    );

    const evidenceResult = {
      evidence_id: "TS-GOVERNED-AGENT-TASK-RUNTIME-01",
      contract_version: CONTRACT_VERSION,
      environment: "fresh synthetic PostgreSQL account-scoped backend",
      results: {
        idempotent_task_acceptance: "pass",
        durable_recovery_scheduling: "pass",
        checkpoint_and_task_local_sequence: "pass",
        grounded_non_canonical_artifact: "pass",
        public_event_payload_minimization: "pass",
        cross_workspace_read: "not_found",
        source_deletion_propagation: "redacted_and_no_current_authority",
        operational_proposal_normalization: "pass",
        waiting_run_releases_lease: "suspended",
        correlated_direct_review: "denied",
        exact_bundle_to_domain_receipt: "pass",
        employment_recommendation_write: "denied",
        external_effects: [],
      },
      task: {
        id: terminal.id,
        status: terminal.status,
        revision: terminal.task_revision,
        event_count: events.events.length,
        latest_sequence: events.latest_sequence,
      },
      limitations: [
        "This proves the pre-call briefing and one exact operational Proposal decision path, not clarification, iOS rendering, or a production connector.",
        "All identities and content are synthetic; no external effect capability is present.",
      ],
    };
    await mkdir(artifactDir, { recursive: true });
    await writeFile(
      `${artifactDir}/governed-agent-task-runtime.json`,
      `${JSON.stringify(evidenceResult, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(`${JSON.stringify(evidenceResult, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

await main();
