import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONTRACT_VERSION,
  SIMULATED_CAPABILITY,
  TalentSignalClient,
  TalentSignalHttpError,
  type AnalysisProposalResponse,
  type ApprovalResponse,
  type CaptureResponse,
  type CreateCaptureRequest,
  type SimulatedEffectPreview,
  type SubmitAnalysisProposalRequest,
} from "@talent-signal/contracts";

type FixtureDisposition =
  | "propose_action"
  | "no_action"
  | "clarify"
  | "block";

interface FixtureAssertion {
  field:
    | "availability"
    | "competing_process"
    | "decision_deadline"
    | "relocation_requirement"
    | "work_mode_constraint"
    | "work_mode_preference";
  status: "proposed" | "ambiguous" | "superseded";
  value: string;
  evidence_message_id: string;
  evidence_quote: string;
}

interface FixtureAction {
  type: "prepare_question";
  owner: "recruiter";
  target: string;
  reason: string;
  due: string;
  evidence_message_ids: string[];
}

interface FixtureCase {
  id: string;
  title: string;
  context: {
    captured_at: string;
    source_timezone: string | null;
    candidate: string | null;
    assignment: string | null;
    candidate_options?: string[];
  };
  messages: Array<{
    id: string;
    speaker: "candidate" | "recruiter" | "hiring_manager" | "unknown";
    text: string;
  }>;
  expected: {
    disposition: FixtureDisposition;
    assertions: FixtureAssertion[];
    action: FixtureAction | null;
    must_not: string[];
  };
}

interface FixtureSuite {
  suite_id: string;
  version: string;
  cases: FixtureCase[];
}

interface ExpectedErrorRecord {
  name: string;
  expected_status: number;
  expected_code: string;
  actual_status: number;
  actual_code: string;
  passed: boolean;
}

interface PreparedFixture {
  capture: CaptureResponse;
  analysis: AnalysisProposalResponse;
}

const baseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:4317";
/** The legacy corpus lives in the private capir-evals repository (GET-134). */
function privateEvaluationPath(relative: string): string {
  const root = process.env.CAPIR_EVAL_REPO;
  if (!root || !isAbsolute(root)) {
    throw new Error(
      `CAPIR_EVAL_REPO must point at an absolute capir-evals checkout to run the corpus-backed legacy evaluator (needed for ${relative}); set FIXTURE_PATH explicitly or configure CAPIR_EVAL_REPO`,
    );
  }
  return resolve(root, relative);
}
const fixturePath =
  process.env.FIXTURE_PATH ?? privateEvaluationPath("evals/candidate-momentum-v1.json");
const artifactDir =
  process.env.EVALUATION_ARTIFACT_DIR ??
  fileURLToPath(
    new URL(
      "../../../../output/evaluation/overnight/backend",
      import.meta.url,
    ),
  );

const fixtureResults: Array<Record<string, unknown>> = [];
const failureMatrix: ExpectedErrorRecord[] = [];
const recoveryResults: Array<Record<string, unknown>> = [];
const walkthrough: Array<Record<string, unknown>> = [];
const preparedByCase = new Map<string, PreparedFixture>();

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function identityFor(testCase: FixtureCase): CreateCaptureRequest["identity"] {
  if (testCase.context.candidate && testCase.context.assignment) {
    return {
      status: "bound",
      external_ref: `fixture:person:${slug(testCase.context.candidate)}`,
      display_label: testCase.context.candidate,
      assignment_ref: `fixture:assignment:${slug(testCase.context.candidate)}:${slug(testCase.context.assignment)}`,
      assignment_label: testCase.context.assignment,
      binding_basis: "Explicit synthetic fixture context supplied by the evaluator.",
    };
  }
  if ((testCase.context.candidate_options?.length ?? 0) >= 2) {
    return {
      status: "ambiguous",
      options: (testCase.context.candidate_options ?? []).map(
        (option, index) => {
          const [displayLabel, assignmentLabel] = option.split(" — ");
          return {
            external_ref: `fixture:ambiguous:${index + 1}`,
            display_label: displayLabel ?? option,
            assignment_label: assignmentLabel ?? "Unknown assignment",
          };
        },
      ),
      reason: "The synthetic source does not bind one same-name candidate.",
    };
  }
  return {
    status: "unbound",
    reason: "The synthetic source has no sufficient identity binding.",
  };
}

function captureRequest(
  testCase: FixtureCase,
  keySuffix = "primary",
): CreateCaptureRequest {
  return {
    idempotency_key: `fixture:${testCase.id}:capture:${keySuffix}`,
    fixture_case_id: testCase.id,
    source: {
      kind: "fixture",
      captured_at: new Date(testCase.context.captured_at).toISOString(),
      source_timezone: testCase.context.source_timezone,
      purpose: "Synthetic candidate-momentum contract evaluation",
      source_locator: `evals/candidate-momentum-v1.json#${testCase.id}`,
      retention: {
        requested_mode: "full_source",
        source_scope: "full_reviewed_source",
      },
    },
    identity: identityFor(testCase),
    messages: testCase.messages.map((message, sequence) => ({
      source_message_id: message.id,
      sequence,
      speaker: message.speaker,
      text: message.text,
    })),
  };
}

function previewFor(
  key: string,
  action: FixtureAction,
  simulationBehavior: SimulatedEffectPreview["simulation_behavior"],
): SimulatedEffectPreview {
  return {
    simulated: true,
    capability: SIMULATED_CAPABILITY,
    adapter: "local_deterministic",
    target: {
      destination_key: `fixture:${slug(key)}:attention`,
      label: "Local simulated recruiter attention queue",
    },
    change: {
      kind: "create_attention",
      title: `Prepare question: ${action.target}`,
    },
    expected_destination_version: 0,
    simulation_behavior: simulationBehavior,
  };
}

function analysisRequest(
  testCase: FixtureCase,
  priorStateId?: string,
  simulationBehavior: SimulatedEffectPreview["simulation_behavior"] = "success",
  keySuffix = "primary",
): SubmitAnalysisProposalRequest {
  const assertions = testCase.expected.assertions.map((assertion) => ({
    field: assertion.field,
    status: assertion.status,
    value: assertion.value,
    evidence_message_id: assertion.evidence_message_id,
    evidence_quote: assertion.evidence_quote,
    subject_kind:
      testCase.id === "TS-ID-03"
        ? ("hiring_manager" as const)
        : ("candidate" as const),
    temporal_relation:
      assertion.status === "superseded"
        ? ("supersedes" as const)
        : ("new" as const),
    ...(assertion.status === "superseded" && priorStateId
      ? { supersedes_state_id: priorStateId }
      : {}),
  }));
  const action = testCase.expected.action
    ? {
        type: testCase.expected.action.type,
        owner: testCase.expected.action.owner,
        target: testCase.expected.action.target,
        reason: testCase.expected.action.reason,
        due: testCase.expected.action.due,
        evidence_message_ids: testCase.expected.action.evidence_message_ids,
        effect_preview: previewFor(
          `${testCase.id}:${keySuffix}`,
          testCase.expected.action,
          simulationBehavior,
        ),
      }
    : null;
  return {
    idempotency_key: `fixture:${testCase.id}:analysis:${keySuffix}`,
    producer: {
      kind: "fixture_compiler",
      name: "candidate-momentum-v1-evaluator",
      version: "2026-08-05.1",
    },
    disposition: testCase.expected.disposition,
    assertions,
    action,
  };
}

async function writeJson(name: string, value: unknown): Promise<void> {
  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    `${artifactDir}/${name}`,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

async function expectHttpError(
  name: string,
  operation: Promise<unknown>,
  expectedStatus: number,
  expectedCode: string,
): Promise<void> {
  try {
    await operation;
    assert.fail(`${name} unexpectedly succeeded.`);
  } catch (error) {
    assert(error instanceof TalentSignalHttpError, `${name} returned ${error}`);
    const record: ExpectedErrorRecord = {
      name,
      expected_status: expectedStatus,
      expected_code: expectedCode,
      actual_status: error.status,
      actual_code: error.code,
      passed: error.status === expectedStatus && error.code === expectedCode,
    };
    failureMatrix.push(record);
    assert.equal(error.status, expectedStatus, name);
    assert.equal(error.code, expectedCode, name);
  }
}

async function rawRequest(
  token: string,
  path: string,
  body: unknown,
): Promise<{ status: number; code: string }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as {
    error?: { code?: string };
  };
  return {
    status: response.status,
    code: payload.error?.code ?? "NONE",
  };
}

async function prepareFixture(
  client: TalentSignalClient,
  testCase: FixtureCase,
  priorStateId?: string,
): Promise<PreparedFixture> {
  const capture = await client.createCapture(captureRequest(testCase));
  const analysis = await client.submitAnalysis(
    capture.id,
    analysisRequest(testCase, priorStateId),
  );
  assert.equal(analysis.disposition, testCase.expected.disposition);
  assert.equal(analysis.assertions.length, testCase.expected.assertions.length);
  for (const [index, expected] of testCase.expected.assertions.entries()) {
    const actual = analysis.assertions[index];
    assert(actual);
    assert.equal(actual.field, expected.field);
    assert.equal(actual.status, expected.status);
    assert.equal(actual.value, expected.value);
    assert.equal(actual.evidence_quote, expected.evidence_quote);
    assert.equal(actual.review_status, "pending");
  }
  if (testCase.expected.action) {
    assert(analysis.action);
    assert.equal(analysis.action.type, "prepare_question");
    assert.equal(analysis.action.status, "proposed");
    assert.equal(analysis.action.simulated, true);
    assert.equal(
      analysis.action.exact_preview.capability,
      SIMULATED_CAPABILITY,
    );
    assert.equal(analysis.action.exact_preview.adapter, "local_deterministic");
  } else {
    assert.equal(analysis.action, null);
  }
  fixtureResults.push({
    case_id: testCase.id,
    disposition: analysis.disposition,
    identity_status: capture.identity_status,
    assertion_count: analysis.assertions.length,
    assertions_pending: analysis.assertions.every(
      (assertion) => assertion.review_status === "pending",
    ),
    action_type: analysis.action?.type ?? null,
    action_simulated: analysis.action?.simulated ?? null,
    evidence_references_valid: analysis.assertions.every((assertion) =>
      capture.messages.some(
        (message) => message.id === assertion.evidence_id,
      ),
    ),
    expected_must_not_count: testCase.expected.must_not.length,
    passed: true,
  });
  const prepared = { capture, analysis };
  preparedByCase.set(testCase.id, prepared);
  await writeJson("evaluation-progress.json", {
    status: "in_progress",
    completed_case_ids: fixtureResults.map((result) => result.case_id),
  });
  return prepared;
}

async function setupPriorState(
  recruiter: TalentSignalClient,
  core04: FixtureCase,
): Promise<{ stateId: string; assignmentId: string }> {
  const priorCase: FixtureCase = {
    ...core04,
    id: "TS-CORE-04-PRIOR",
    title: "Synthetic prior confirmed work-mode state",
    messages: [
      {
        id: "prior-m1",
        speaker: "candidate",
        text: "Remote is required.",
      },
    ],
    expected: {
      disposition: "no_action",
      assertions: [
        {
          field: "work_mode_constraint",
          status: "proposed",
          value: "Remote is required.",
          evidence_message_id: "prior-m1",
          evidence_quote: "Remote is required",
        },
      ],
      action: null,
      must_not: [],
    },
  };
  const capture = await recruiter.createCapture(
    captureRequest(priorCase, "prior"),
  );
  const analysis = await recruiter.submitAnalysis(
    capture.id,
    analysisRequest(priorCase, undefined, "success", "prior"),
  );
  const assertion = analysis.assertions[0];
  assert(assertion);
  const decision = await recruiter.decideAssertion(assertion.id, {
    idempotency_key: "fixture:TS-CORE-04:prior:confirm",
    expected_assertion_version: 1,
    decision: "confirm",
  });
  assert(decision.confirmed_state_id);
  assert(capture.assignment_id);
  return {
    stateId: decision.confirmed_state_id,
    assignmentId: capture.assignment_id,
  };
}

async function confirmAll(
  client: TalentSignalClient,
  analysis: AnalysisProposalResponse,
  prefix: string,
): Promise<string[]> {
  const stateIds: string[] = [];
  for (const [index, assertion] of analysis.assertions.entries()) {
    const decision = await client.decideAssertion(assertion.id, {
      idempotency_key: `${prefix}:confirm:${index}`,
      expected_assertion_version: assertion.version,
      decision: "confirm",
    });
    assert(decision.confirmed_state_id);
    stateIds.push(decision.confirmed_state_id);
  }
  return stateIds;
}

async function provisionExecutableScenario(
  recruiter: TalentSignalClient,
  reviewer: TalentSignalClient,
  scenario: string,
  behavior: SimulatedEffectPreview["simulation_behavior"],
): Promise<{
  capture: CaptureResponse;
  analysis: AnalysisProposalResponse;
  approval: ApprovalResponse;
}> {
  const testCase: FixtureCase = {
    id: `RECOVERY-${scenario}`,
    title: scenario,
    context: {
      captured_at: "2026-08-05T09:00:00+08:00",
      source_timezone: "Asia/Singapore",
      candidate: `Synthetic ${scenario}`,
      assignment: "Synthetic recovery assignment",
    },
    messages: [
      {
        id: "m1",
        speaker: "candidate",
        text: "Tuesday afternoon is available.",
      },
    ],
    expected: {
      disposition: "propose_action",
      assertions: [
        {
          field: "availability",
          status: "proposed",
          value: "Tuesday afternoon",
          evidence_message_id: "m1",
          evidence_quote: "Tuesday afternoon is available",
        },
      ],
      action: {
        type: "prepare_question",
        owner: "recruiter",
        target: `${scenario} exact confirmation`,
        reason: "Exercise one bounded recovery state.",
        due: "before scheduling",
        evidence_message_ids: ["m1"],
      },
      must_not: [],
    },
  };
  const capture = await recruiter.createCapture(
    captureRequest(testCase, scenario),
  );
  const analysis = await recruiter.submitAnalysis(
    capture.id,
    analysisRequest(testCase, undefined, behavior, scenario),
  );
  await confirmAll(recruiter, analysis, `recovery:${scenario}`);
  assert(analysis.action);
  const approval = await reviewer.approveAction(analysis.action.id, {
    idempotency_key: `recovery:${scenario}:approve`,
    expected_action_version: analysis.action.version,
    exact_preview: analysis.action.exact_preview,
  });
  return { capture, analysis, approval };
}

async function main(): Promise<void> {
  await mkdir(artifactDir, { recursive: true });
  await writeJson("evaluation-progress.json", {
    status: "starting",
    fixture_path: "evals/candidate-momentum-v1.json",
  });

  const suite = JSON.parse(await readFile(fixturePath, "utf8")) as FixtureSuite;
  assert.equal(suite.cases.length, 8);
  assert.equal(suite.suite_id, "talent-signal-candidate-momentum-v1");

  const recruiter = new TalentSignalClient(baseUrl);
  const recruiterSession = await recruiter.login({
    account_slug: "fixture-alpha",
    user_email: "recruiter@alpha.local",
    client_label: "evaluation-client-a",
  });
  const reviewer = new TalentSignalClient(baseUrl);
  const reviewerSession = await reviewer.login({
    account_slug: "fixture-alpha",
    user_email: "reviewer@alpha.local",
    client_label: "evaluation-client-b",
  });
  const beta = new TalentSignalClient(baseUrl);
  await beta.login({
    account_slug: "fixture-beta",
    user_email: "recruiter@beta.local",
    client_label: "cross-account-client",
  });

  const initialSync = await reviewer.sync(0);
  const core01 = suite.cases.find((testCase) => testCase.id === "TS-CORE-01");
  assert(core01);
  const corePrepared = await prepareFixture(recruiter, core01);
  assert(corePrepared.analysis.action);
  walkthrough.push({
    step: 1,
    actor: "evaluation-client-a",
    transition: "intentional capture",
    capture_id: corePrepared.capture.id,
    identity_status: corePrepared.capture.identity_status,
    evidence_count: corePrepared.capture.messages.length,
  });
  walkthrough.push({
    step: 2,
    actor: "fixture compiler",
    transition: "proposal without authority",
    disposition: corePrepared.analysis.disposition,
    assertion_statuses: corePrepared.analysis.assertions.map(
      (assertion) => assertion.review_status,
    ),
    action_status: corePrepared.analysis.action.status,
  });

  await expectHttpError(
    "model proposal cannot execute before human fact decisions",
    reviewer.approveAction(corePrepared.analysis.action.id, {
      idempotency_key: "core01:approve:before-facts",
      expected_action_version: 1,
      exact_preview: corePrepared.analysis.action.exact_preview,
    }),
    409,
    "FACT_REVIEW_INCOMPLETE",
  );
  const coreStateIds = await confirmAll(
    recruiter,
    corePrepared.analysis,
    "core01",
  );
  walkthrough.push({
    step: 3,
    actor: "evaluation-client-a",
    transition: "independent fact decisions",
    confirmed_state_ids: coreStateIds,
    confirmation_count: coreStateIds.length,
  });

  const clientBSync = await reviewer.sync(initialSync.next_cursor);
  assert(
    clientBSync.events.some(
      (event) =>
        event.event_type === "capture.submitted" &&
        event.entity_id === corePrepared.capture.id,
    ),
  );
  walkthrough.push({
    step: 4,
    actor: "evaluation-client-b",
    transition: "shared-authority synchronization",
    observed_event_types: clientBSync.events.map((event) => event.event_type),
    next_cursor: clientBSync.next_cursor,
  });

  const coreApproval = await reviewer.approveAction(
    corePrepared.analysis.action.id,
    {
      idempotency_key: "core01:approve:exact",
      expected_action_version: 1,
      exact_preview: corePrepared.analysis.action.exact_preview,
    },
  );
  walkthrough.push({
    step: 5,
    actor: "evaluation-client-b",
    transition: "exact version-bound action approval",
    approval_id: coreApproval.id,
    action_version: coreApproval.action_version,
    preview_digest: coreApproval.exact_preview_digest,
  });
  const coreExecutionRequest = {
    idempotency_key: "core01:execute:exact",
    approval_id: coreApproval.id,
    expected_action_version: 1,
  };
  const coreResult = await reviewer.executeAction(
    corePrepared.analysis.action.id,
    coreExecutionRequest,
  );
  assert.equal(coreResult.attempt_status, "verified");
  assert.equal(coreResult.simulated, true);
  assert.equal(coreResult.observation?.match_status, "matched");
  assert.equal(coreResult.outcome?.status, "verified");
  walkthrough.push({
    step: 6,
    actor: "local deterministic adapter",
    transition: "simulated effect and destination readback",
    attempt_id: coreResult.attempt_id,
    attempt_status: coreResult.attempt_status,
    simulated: coreResult.simulated,
    destination_match: coreResult.observation?.match_status,
    outcome_status: coreResult.outcome?.status,
  });
  const coreDuplicate = await reviewer.executeAction(
    corePrepared.analysis.action.id,
    coreExecutionRequest,
  );
  assert.equal(coreDuplicate.attempt_id, coreResult.attempt_id);
  assert.equal(coreDuplicate.reused, true);
  recoveryResults.push({
    scenario: "duplicate execution",
    passed: true,
    first_attempt_id: coreResult.attempt_id,
    duplicate_attempt_id: coreDuplicate.attempt_id,
    reused: coreDuplicate.reused,
  });

  const duplicateCapture = await recruiter.createCapture(captureRequest(core01));
  assert.equal(duplicateCapture.id, corePrepared.capture.id);
  await expectHttpError(
    "idempotency key rejects a changed capture request",
    recruiter.createCapture({
      ...captureRequest(core01),
      messages: [
        {
          source_message_id: "changed",
          sequence: 0,
          speaker: "candidate",
          text: "Changed synthetic request.",
        },
      ],
    }),
    409,
    "IDEMPOTENCY_KEY_REUSED",
  );

  await expectHttpError(
    "cross-account capture access is hidden",
    beta.getCapture(corePrepared.capture.id),
    404,
    "CAPTURE_NOT_FOUND",
  );
  const betaSync = await beta.sync(0);
  assert.equal(
    betaSync.events.some(
      (event) => event.entity_id === corePrepared.capture.id,
    ),
    false,
  );
  recoveryResults.push({
    scenario: "two-client synchronization and cross-account isolation",
    passed: true,
    shared_event_observed: true,
    beta_event_observed: false,
  });

  let core04Prior: { stateId: string; assignmentId: string } | undefined;
  let core04Active:
    | {
        testCase: FixtureCase;
        prepared: PreparedFixture;
        activeStateId: string;
      }
    | undefined;
  for (const testCase of suite.cases) {
    if (testCase.id === "TS-CORE-01") {
      continue;
    }
    if (testCase.id === "TS-CORE-04") {
      core04Prior = await setupPriorState(recruiter, testCase);
      const prepared = await prepareFixture(
        recruiter,
        testCase,
        core04Prior.stateId,
      );
      const states = await confirmAll(recruiter, prepared.analysis, "core04");
      assert.equal(states.length, 1);
      assert(prepared.capture.assignment_id);
      const temporal = await recruiter.getTemporalState(
        prepared.capture.assignment_id,
      );
      const oldState = temporal.states.find(
        (state) => state.id === core04Prior?.stateId,
      );
      const newState = temporal.states.find((state) => state.id === states[0]);
      assert.equal(oldState?.status, "superseded");
      assert.equal(newState?.status, "active");
      assert.equal(newState?.supersedes_state_id, core04Prior.stateId);
      core04Active = {
        testCase,
        prepared,
        activeStateId: states[0] as string,
      };
      recoveryResults.push({
        scenario: "conditional supersession",
        passed: true,
        prior_state_status: oldState?.status,
        current_state_status: newState?.status,
        lineage_preserved: newState?.supersedes_state_id === core04Prior.stateId,
      });
      continue;
    }
    await prepareFixture(recruiter, testCase);
  }
  assert.equal(fixtureResults.length, 8);
  assert(core04Active);

  const conflictCase: FixtureCase = {
    ...core04Active.testCase,
    id: "STATE-CONFLICT",
    title: "Synthetic unreviewed temporal conflict",
    messages: [
      {
        id: "conflict-m1",
        speaker: "candidate",
        text: "Remote is required again.",
      },
    ],
    expected: {
      disposition: "no_action",
      assertions: [
        {
          field: "work_mode_constraint",
          status: "proposed",
          value: "Remote is required again.",
          evidence_message_id: "conflict-m1",
          evidence_quote: "Remote is required again",
        },
      ],
      action: null,
      must_not: [],
    },
  };
  const conflictCapture = await recruiter.createCapture(
    captureRequest(conflictCase, "conflict"),
  );
  const conflictAnalysis = await recruiter.submitAnalysis(
    conflictCapture.id,
    analysisRequest(conflictCase, undefined, "success", "conflict"),
  );
  const conflictAssertion = conflictAnalysis.assertions[0];
  assert(conflictAssertion);
  await expectHttpError(
    "different active temporal value requires explicit supersession",
    recruiter.decideAssertion(conflictAssertion.id, {
      idempotency_key: "state:conflict:confirm",
      expected_assertion_version: 1,
      decision: "confirm",
    }),
    409,
    "STATE_CONFLICT_REQUIRES_SUPERSESSION",
  );

  const id03 = preparedByCase.get("TS-ID-03");
  assert(id03);
  const badSpeaker = await rawRequest(
    recruiterSession.access_token,
    `/v1/captures/${id03.capture.id}/analysis-proposals`,
    {
      idempotency_key: "speaker:misattribution",
      producer: {
        kind: "model",
        name: "adversarial-test",
        version: "1",
      },
      disposition: "no_action",
      assertions: [
        {
          field: "relocation_requirement",
          status: "proposed",
          value: "candidate will relocate",
          evidence_message_id: "m1",
          evidence_quote: "Forwarded from the hiring manager",
          subject_kind: "candidate",
          temporal_relation: "new",
        },
      ],
      action: null,
    },
  );
  failureMatrix.push({
    name: "forwarded recruiter message cannot become candidate assertion",
    expected_status: 422,
    expected_code: "SPEAKER_ATTRIBUTION_UNSUPPORTED",
    actual_status: badSpeaker.status,
    actual_code: badSpeaker.code,
    passed:
      badSpeaker.status === 422 &&
      badSpeaker.code === "SPEAKER_ATTRIBUTION_UNSUPPORTED",
  });
  assert.deepEqual(badSpeaker, {
    status: 422,
    code: "SPEAKER_ATTRIBUTION_UNSUPPORTED",
  });

  const bound = preparedByCase.get("TS-BOUND-01");
  assert(bound);
  const prohibited = await rawRequest(
    recruiterSession.access_token,
    `/v1/captures/${bound.capture.id}/analysis-proposals`,
    {
      idempotency_key: "prohibited:culture-fit",
      producer: {
        kind: "model",
        name: "adversarial-test",
        version: "1",
      },
      disposition: "propose_action",
      assertions: [
        {
          field: "availability",
          status: "proposed",
          value: "enjoyed speaking",
          evidence_message_id: "m1",
          evidence_quote: "enjoyed speaking",
          subject_kind: "candidate",
          temporal_relation: "new",
        },
      ],
      action: {
        type: "prepare_question",
        owner: "recruiter",
        target: "culture fit score",
        reason: "score candidate quality",
        due: "now",
        evidence_message_ids: ["m1"],
        effect_preview: previewFor(
          "prohibited",
          {
            type: "prepare_question",
            owner: "recruiter",
            target: "culture fit score",
            reason: "prohibited",
            due: "now",
            evidence_message_ids: ["m1"],
          },
          "success",
        ),
      },
    },
  );
  failureMatrix.push({
    name: "prohibited candidate scoring is rejected",
    expected_status: 422,
    expected_code: "PROHIBITED_INFERENCE",
    actual_status: prohibited.status,
    actual_code: prohibited.code,
    passed:
      prohibited.status === 422 &&
      prohibited.code === "PROHIBITED_INFERENCE",
  });
  assert.deepEqual(prohibited, {
    status: 422,
    code: "PROHIBITED_INFERENCE",
  });

  const failed = await provisionExecutableScenario(
    recruiter,
    reviewer,
    "failure-retry",
    "failure",
  );
  assert(failed.analysis.action);
  const failedResult = await reviewer.executeAction(failed.analysis.action.id, {
    idempotency_key: "recovery:failure:execute",
    approval_id: failed.approval.id,
    expected_action_version: 1,
  });
  assert.equal(failedResult.attempt_status, "failed");
  const retryPreview = {
    ...failed.analysis.action.exact_preview,
    simulation_behavior: "success" as const,
  };
  const revised = await recruiter.reviseAction(failed.analysis.action.id, {
    idempotency_key: "recovery:failure:revise",
    expected_action_version: 1,
    reason: "Retry after a deterministic pre-write failure.",
    exact_preview: retryPreview,
  });
  assert.equal(revised.version, 2);
  await expectHttpError(
    "revised action invalidates prior approval",
    reviewer.executeAction(failed.analysis.action.id, {
      idempotency_key: "recovery:failure:old-approval",
      approval_id: failed.approval.id,
      expected_action_version: 1,
    }),
    409,
    "ACTION_VERSION_CONFLICT",
  );
  const retryApproval = await reviewer.approveAction(
    failed.analysis.action.id,
    {
      idempotency_key: "recovery:failure:approve-v2",
      expected_action_version: 2,
      exact_preview: retryPreview,
    },
  );
  const retryResult = await reviewer.executeAction(
    failed.analysis.action.id,
    {
      idempotency_key: "recovery:failure:execute-v2",
      approval_id: retryApproval.id,
      expected_action_version: 2,
    },
  );
  assert.equal(retryResult.attempt_status, "verified");
  recoveryResults.push({
    scenario: "failed attempt revised and safely retried",
    passed: true,
    first_status: failedResult.attempt_status,
    revised_version: revised.version,
    retry_status: retryResult.attempt_status,
  });

  const reversalPreview = await reviewer.previewEffectReversal(
    retryResult.attempt_id,
  );
  assert.equal(reversalPreview.reversal_available, true);
  assert.deepEqual(reversalPreview.blockers, []);
  assert.equal(reversalPreview.expected_destination_version, 1);
  const reversalApproval = await reviewer.approveEffectReversal(
    retryResult.attempt_id,
    {
      idempotency_key: "recovery:effect-reversal:approve",
      expected_destination_version:
        reversalPreview.expected_destination_version,
      expected_preview_digest: reversalPreview.preview_digest,
      reason: "The recruiter no longer needs this simulated Today item.",
    },
  );
  const reversalApprovedWorkspace =
    await recruiter.getWorkspaceReviewByCapture(failed.capture.id);
  assert.equal(
    reversalApprovedWorkspace.latest_effect?.reversal?.status,
    "approved",
  );
  assert.equal(
    reversalApprovedWorkspace.latest_effect?.reversal?.latest_attempt,
    null,
  );
  const reversalResult = await reviewer.executeEffectReversal(
    retryResult.attempt_id,
    {
      idempotency_key: "recovery:effect-reversal:execute",
      approval_id: reversalApproval.id,
    },
  );
  assert.equal(reversalResult.attempt_status, "verified");
  assert.equal(
    reversalResult.observation?.match_status,
    "matched_absent",
  );
  const reversalReplay = await reviewer.executeEffectReversal(
    retryResult.attempt_id,
    {
      idempotency_key: "recovery:effect-reversal:execute",
      approval_id: reversalApproval.id,
    },
  );
  assert.equal(reversalReplay.reversal_attempt_id, reversalResult.reversal_attempt_id);
  assert.equal(reversalReplay.reused, true);
  const reversalWorkspace = await recruiter.getWorkspaceReviewByCapture(
    failed.capture.id,
  );
  assert.equal(
    reversalWorkspace.latest_effect?.reversal?.status,
    "verified",
  );
  assert.equal(
    reversalWorkspace.latest_effect?.reversal?.latest_attempt?.outcome
      ?.status,
    "verified",
  );
  const reversedPreview = await reviewer.previewEffectReversal(
    retryResult.attempt_id,
  );
  assert.equal(reversedPreview.reversal_available, false);
  assert(
    reversedPreview.blockers.some(
      (blocker) => blocker.code === "reversal_already_verified",
    ),
  );
  const reversalAudit = await reviewer.sync(0);
  assert(
    reversalAudit.events.some(
      (event) =>
        event.event_type === "effect_reversal.verified" &&
        event.entity_id === reversalResult.reversal_attempt_id,
    ),
  );
  await expectHttpError(
    "cross-account effect reversal preview is hidden",
    beta.previewEffectReversal(retryResult.attempt_id),
    404,
    "EFFECT_ATTEMPT_NOT_FOUND",
  );
  recoveryResults.push({
    scenario: "verified local effect reversed through separate approval and readback",
    passed: true,
    approval_changed_destination: false,
    reversal_status: reversalResult.attempt_status,
    destination_match: reversalResult.observation?.match_status,
    idempotent_replay: reversalReplay.reused,
    reload_status: reversalWorkspace.latest_effect?.reversal?.status,
    original_effect_preserved: reversalWorkspace.latest_effect?.attempt_id === retryResult.attempt_id,
  });

  const driftOriginal = await provisionExecutableScenario(
    recruiter,
    reviewer,
    "reversal-drift-original",
    "success",
  );
  assert(driftOriginal.analysis.action);
  const driftOriginalEffect = await reviewer.executeAction(
    driftOriginal.analysis.action.id,
    {
      idempotency_key: "recovery:reversal-drift:original-execute",
      approval_id: driftOriginal.approval.id,
      expected_action_version: 1,
    },
  );
  const driftReversalPreview = await reviewer.previewEffectReversal(
    driftOriginalEffect.attempt_id,
  );
  const driftReversalApproval = await reviewer.approveEffectReversal(
    driftOriginalEffect.attempt_id,
    {
      idempotency_key: "recovery:reversal-drift:approve",
      expected_destination_version:
        driftReversalPreview.expected_destination_version,
      expected_preview_digest: driftReversalPreview.preview_digest,
      reason: "Approve before a concurrent destination change.",
    },
  );
  const driftWriter = await provisionExecutableScenario(
    recruiter,
    reviewer,
    "reversal-drift-writer",
    "success",
  );
  assert(driftWriter.analysis.action);
  const driftWriterPreview: SimulatedEffectPreview = {
    ...driftWriter.analysis.action.exact_preview,
    target: driftOriginal.analysis.action.exact_preview.target,
    change: {
      kind: "create_attention",
      title: "A newer recruiter-owned attention item",
    },
    expected_destination_version: 1,
  };
  const driftWriterRevision = await recruiter.reviseAction(
    driftWriter.analysis.action.id,
    {
      idempotency_key: "recovery:reversal-drift:writer-revise",
      expected_action_version: 1,
      exact_preview: driftWriterPreview,
      reason: "Exercise destination drift after reversal approval.",
    },
  );
  const driftWriterApproval = await reviewer.approveAction(
    driftWriter.analysis.action.id,
    {
      idempotency_key: "recovery:reversal-drift:writer-approve-v2",
      expected_action_version: driftWriterRevision.version,
      exact_preview: driftWriterPreview,
    },
  );
  const driftWriterEffect = await reviewer.executeAction(
    driftWriter.analysis.action.id,
    {
      idempotency_key: "recovery:reversal-drift:writer-execute-v2",
      approval_id: driftWriterApproval.id,
      expected_action_version: driftWriterRevision.version,
    },
  );
  assert.equal(driftWriterEffect.attempt_status, "verified");
  const driftReversalResult = await reviewer.executeEffectReversal(
    driftOriginalEffect.attempt_id,
    {
      idempotency_key: "recovery:reversal-drift:execute",
      approval_id: driftReversalApproval.id,
    },
  );
  assert.equal(driftReversalResult.attempt_status, "failed");
  assert.equal(
    driftReversalResult.observation?.match_status,
    "still_present",
  );
  assert.equal(
    driftReversalResult.outcome?.summary,
    "The destination changed after reversal approval. Nothing was removed.",
  );
  const driftBlockedPreview = await reviewer.previewEffectReversal(
    driftOriginalEffect.attempt_id,
  );
  assert.equal(driftBlockedPreview.reversal_available, false);
  assert(
    driftBlockedPreview.blockers.some(
      (blocker) => blocker.code === "destination_changed",
    ),
  );
  recoveryResults.push({
    scenario: "destination drift invalidates reversal without deleting newer state",
    passed: true,
    reversal_status: driftReversalResult.attempt_status,
    destination_match: driftReversalResult.observation?.match_status,
    no_delete_summary: driftReversalResult.outcome?.summary,
    fresh_preview_blocked: !driftBlockedPreview.reversal_available,
  });

  const revokeReversal = await provisionExecutableScenario(
    recruiter,
    reviewer,
    "reversal-approval-revocation",
    "success",
  );
  assert(revokeReversal.analysis.action);
  const revokeReversalEffect = await reviewer.executeAction(
    revokeReversal.analysis.action.id,
    {
      idempotency_key: "recovery:reversal-revoke:forward-execute",
      approval_id: revokeReversal.approval.id,
      expected_action_version: 1,
    },
  );
  const revokeReversalPreview = await reviewer.previewEffectReversal(
    revokeReversalEffect.attempt_id,
  );
  const revokedReversalApproval = await reviewer.approveEffectReversal(
    revokeReversalEffect.attempt_id,
    {
      idempotency_key: "recovery:reversal-revoke:approve",
      expected_destination_version:
        revokeReversalPreview.expected_destination_version,
      expected_preview_digest: revokeReversalPreview.preview_digest,
      reason: "Exercise revocation before reversal execution.",
    },
  );
  await reviewer.revokeEffectReversalApproval(revokedReversalApproval.id, {
    idempotency_key: "recovery:reversal-revoke:revoke",
    reason: "Keep the item after all.",
  });
  await expectHttpError(
    "revoked effect reversal approval cannot execute",
    reviewer.executeEffectReversal(revokeReversalEffect.attempt_id, {
      idempotency_key: "recovery:reversal-revoke:execute",
      approval_id: revokedReversalApproval.id,
    }),
    409,
    "EFFECT_REVERSAL_APPROVAL_NOT_CURRENT",
  );
  recoveryResults.push({
    scenario: "revoked effect reversal approval preserves destination",
    passed: true,
    approval_status: "revoked",
    execution_blocked: true,
  });

  const timedOut = await provisionExecutableScenario(
    recruiter,
    reviewer,
    "timeout-after-write",
    "timeout_after_write",
  );
  assert(timedOut.analysis.action);
  const timeoutResult = await reviewer.executeAction(
    timedOut.analysis.action.id,
    {
      idempotency_key: "recovery:timeout-after:execute",
      approval_id: timedOut.approval.id,
      expected_action_version: 1,
    },
  );
  assert.equal(timeoutResult.attempt_status, "unknown");
  assert.equal(timeoutResult.observation, null);
  await expectHttpError(
    "unknown result blocks blind retry",
    reviewer.executeAction(timedOut.analysis.action.id, {
      idempotency_key: "recovery:timeout-after:blind-retry",
      approval_id: timedOut.approval.id,
      expected_action_version: 1,
    }),
    409,
    "RECONCILIATION_REQUIRED",
  );
  const reconciled = await reviewer.reconcileEffect(timeoutResult.attempt_id, {
    idempotency_key: "recovery:timeout-after:reconcile",
  });
  assert.equal(reconciled.attempt_status, "verified");
  assert.equal(reconciled.observation?.match_status, "matched");
  recoveryResults.push({
    scenario: "timeout after write reconciled by destination readback",
    passed: true,
    initial_status: timeoutResult.attempt_status,
    reconciled_status: reconciled.attempt_status,
    destination_match: reconciled.observation?.match_status,
  });

  const beforeTimeout = await provisionExecutableScenario(
    recruiter,
    reviewer,
    "timeout-before-write",
    "timeout_before_write",
  );
  assert(beforeTimeout.analysis.action);
  const beforeResult = await reviewer.executeAction(
    beforeTimeout.analysis.action.id,
    {
      idempotency_key: "recovery:timeout-before:execute",
      approval_id: beforeTimeout.approval.id,
      expected_action_version: 1,
    },
  );
  const beforeReconciled = await reviewer.reconcileEffect(
    beforeResult.attempt_id,
    { idempotency_key: "recovery:timeout-before:reconcile" },
  );
  assert.equal(beforeReconciled.attempt_status, "unknown");
  assert.equal(beforeReconciled.observation?.match_status, "unavailable");
  const beforeWorkspace = await recruiter.getWorkspaceReviewByCapture(
    beforeTimeout.capture.id,
  );
  assert.equal(
    beforeWorkspace.latest_effect?.observation?.match_status,
    "unavailable",
  );
  assert.equal(
    beforeWorkspace.latest_effect?.outcome?.summary,
    "Reconciliation could not observe the labeled local simulated destination.",
  );
  recoveryResults.push({
    scenario: "timeout before write remains truthfully unknown",
    passed: true,
    reconciled_status: beforeReconciled.attempt_status,
    destination_match: beforeReconciled.observation?.match_status,
    workspace_readback_match:
      beforeWorkspace.latest_effect?.observation?.match_status,
  });

  const revokedApproval = await provisionExecutableScenario(
    recruiter,
    reviewer,
    "approval-revocation",
    "success",
  );
  assert(revokedApproval.analysis.action);
  await reviewer.revokeApproval(revokedApproval.approval.id, {
    idempotency_key: "recovery:approval:revoke",
    reason: "Exercise execution-time revocation.",
  });
  await expectHttpError(
    "revoked approval cannot execute",
    reviewer.executeAction(revokedApproval.analysis.action.id, {
      idempotency_key: "recovery:approval:execute-revoked",
      approval_id: revokedApproval.approval.id,
      expected_action_version: 1,
    }),
    409,
    "APPROVAL_NOT_CURRENT",
  );

  const deletion = await provisionExecutableScenario(
    recruiter,
    reviewer,
    "deletion-lineage",
    "success",
  );
  assert(deletion.analysis.action);
  const deletionResult = await recruiter.deleteCapture(deletion.capture.id, {
    idempotency_key: "recovery:deletion:request",
    reason: "Synthetic lifecycle deletion check.",
  });
  assert(deletionResult.derivatives_deleted >= 5);
  await expectHttpError(
    "deleted capture retrieval is revoked",
    recruiter.getCapture(deletion.capture.id),
    410,
    "CAPTURE_DELETED",
  );
  await expectHttpError(
    "deleted source action cannot execute",
    reviewer.executeAction(deletion.analysis.action.id, {
      idempotency_key: "recovery:deletion:execute",
      approval_id: deletion.approval.id,
      expected_action_version: 1,
    }),
    410,
    "ACTION_DELETED",
  );
  const lineage = await recruiter.getDeletionLineage(
    deletionResult.deletion_id,
  );
  assert(
    lineage.lineage.some(
      (entry) =>
        entry.entity_type === "capture" &&
        entry.disposition === "access_revoked",
    ),
  );
  recoveryResults.push({
    scenario: "source deletion propagates with inspectable lineage",
    passed: true,
    derivatives_deleted: deletionResult.derivatives_deleted,
    lineage_entries: lineage.lineage.length,
  });
  assert(
    lineage.lineage.some(
      (entry) =>
        entry.entity_type === "confirmed_state" &&
        entry.disposition === "content_removed",
    ),
  );
  assert(
    lineage.lineage.some(
      (entry) =>
        entry.entity_type === "subject" &&
        entry.disposition === "content_removed",
    ),
  );
  assert(
    lineage.lineage.some(
      (entry) =>
        entry.entity_type === "assignment" &&
        entry.disposition === "content_removed",
    ),
  );
  await expectHttpError(
    "cross-account deletion lineage is hidden",
    beta.getDeletionLineage(deletionResult.deletion_id),
    404,
    "DELETION_NOT_FOUND",
  );

  const revokedCapability = await provisionExecutableScenario(
    recruiter,
    reviewer,
    "capability-revocation",
    "success",
  );
  assert(revokedCapability.analysis.action);
  await reviewer.revokeCapability({
    idempotency_key: "recovery:capability:revoke",
    capability: SIMULATED_CAPABILITY,
    reason: "Exercise fresh authorization checks at execution time.",
  });
  await expectHttpError(
    "revoked capability blocks a current exact approval",
    reviewer.executeAction(revokedCapability.analysis.action.id, {
      idempotency_key: "recovery:capability:execute",
      approval_id: revokedCapability.approval.id,
      expected_action_version: 1,
    }),
    403,
    "CAPABILITY_NOT_AUTHORIZED",
  );

  const openApiResponse = await fetch(`${baseUrl}/v1/openapi.json`);
  assert.equal(openApiResponse.status, 200);
  const openApi = (await openApiResponse.json()) as {
    info?: { version?: string };
    paths?: Record<string, unknown>;
  };
  assert.equal(openApi.info?.version, CONTRACT_VERSION);
  assert(openApi.paths?.["/v1/captures"]);
  assert(openApi.paths?.["/v1/actions/{id}/executions"]);
  assert(openApi.paths?.["/v1/effect-attempts/{id}/reversal"]);
  assert(openApi.paths?.["/v1/effect-attempts/{id}/reversal-approvals"]);
  assert(openApi.paths?.["/v1/effect-attempts/{id}/reversal-executions"]);
  assert.equal(
    JSON.stringify(openApi).includes("calendar.create"),
    false,
  );

  const sanitizedEvidence = {
    suite_id: suite.suite_id,
    fixture_version: suite.version,
    api_base_url: baseUrl,
    simulated_accounts: [
      recruiterSession.account.slug,
      reviewerSession.account.slug,
      "fixture-beta",
    ],
    session_tokens_recorded: false,
    all_fixture_cases_passed: fixtureResults.length === 8,
    ts_core_01_verified: coreResult.attempt_status === "verified",
    two_client_sync_observed: true,
    cross_account_isolation_observed: true,
    direct_external_writes: 0,
    local_simulated_effects_only: true,
    failure_checks_passed: failureMatrix.every((item) => item.passed),
  };
  await writeJson("fixture-results.json", {
    suite_id: suite.suite_id,
    fixture_version: suite.version,
    cases: fixtureResults,
  });
  await writeJson("failure-matrix.json", {
    checks: failureMatrix,
  });
  await writeJson("recovery-results.json", {
    checks: recoveryResults,
  });
  await writeJson("ts-core-01-walkthrough.json", {
    case_id: "TS-CORE-01",
    surface: "versioned localhost HTTP API",
    limitation: "The effect adapter and destination are deterministic simulations.",
    steps: walkthrough,
  });
  await writeJson("evaluation-summary.json", sanitizedEvidence);
  await writeJson("evaluation-progress.json", {
    status: "passed",
    completed_case_ids: fixtureResults.map((result) => result.case_id),
    failure_check_count: failureMatrix.length,
    recovery_check_count: recoveryResults.length,
  });

  process.stdout.write(
    `Backend evaluation passed: ${fixtureResults.length} fixtures and ${failureMatrix.length} failure-boundary checks.\n`,
  );
}

main().catch(async (error: unknown) => {
  await writeJson("evaluation-progress.json", {
    status: "failed",
    completed_case_ids: fixtureResults.map((result) => result.case_id),
    failure_check_count: failureMatrix.length,
    recovery_check_count: recoveryResults.length,
    error:
      error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: "UnknownError", message: "Unknown evaluation failure" },
  });
  process.stderr.write(
    `Backend evaluation failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
});
