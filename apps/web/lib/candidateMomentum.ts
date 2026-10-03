/**
 * Candidate-momentum review contract for the workspace review surfaces.
 *
 * The eight-case evaluation corpus (messages and expected oracles) has exactly
 * one authoritative private home: the getyak/capir-evals repository (GET-134).
 * The public product ships no corpus payload. This module keeps only the frozen
 * contract types, the case-id registry, and strict comparison logic that takes
 * an explicit reference dataset. Nothing here loads external evidence.
 */

export type CandidateMomentumDisposition =
  | "block"
  | "clarify"
  | "no_action"
  | "propose_action";

export type AssertionProposalStatus =
  | "ambiguous"
  | "proposed"
  | "superseded";

export type CandidateMomentumAssertion = {
  evidence_message_id: string;
  evidence_quote: string;
  field: string;
  status: AssertionProposalStatus;
  value: string;
};

export type CandidateMomentumAction = {
  due: string;
  evidence_message_ids: string[];
  owner: "recruiter";
  reason: string;
  target: string;
  type: "prepare_question";
};

export type CandidateMomentumMessageSpeaker =
  | "candidate"
  | "hiring_manager"
  | "recruiter"
  | "unknown";

export type CandidateMomentumCase = {
  context: {
    assignment: string | null;
    candidate: string | null;
    candidate_options?: string[];
    captured_at: string;
    notes?: string;
    prior_state?: Record<string, string>;
    requested_output?: string;
    source_timezone: string | null;
  };
  expected: {
    action: CandidateMomentumAction | null;
    assertions: CandidateMomentumAssertion[];
    disposition: CandidateMomentumDisposition;
    must_not: string[];
  };
  id:
    | "TS-ACT-01"
    | "TS-BOUND-01"
    | "TS-CORE-01"
    | "TS-CORE-02"
    | "TS-CORE-03"
    | "TS-CORE-04"
    | "TS-ID-01"
    | "TS-ID-03";
  messages: Array<{
    id: string;
    speaker: CandidateMomentumMessageSpeaker;
    text: string;
  }>;
  title: string;
};

export type CandidateMomentumDataset = {
  cases: CandidateMomentumCase[];
  data_mode: "fixture" | "synchronized";
  purpose: string;
  suite_id: "talent-signal-candidate-momentum-v1";
  version: "2026-08-05.1";
};

export type WorkspaceDataSource = {
  detail: string;
  kind: "fixture-local" | "synchronized-local" | "unavailable";
  label: string;
};

/** Frozen suite identity. Kept for contract compatibility only. */
export const CANDIDATE_MOMENTUM_SUITE_ID =
  "talent-signal-candidate-momentum-v1";
export const CANDIDATE_MOMENTUM_VERSION = "2026-08-05.1";

/**
 * The frozen case-id registry. IDs alone may remain in the public product so
 * downstream contracts keep compiling; case payloads and oracles live only in
 * the private evaluation repository.
 */
export const CANDIDATE_MOMENTUM_CASE_IDS = [
  "TS-CORE-01",
  "TS-CORE-02",
  "TS-CORE-03",
  "TS-CORE-04",
  "TS-ID-01",
  "TS-ID-03",
  "TS-ACT-01",
  "TS-BOUND-01",
] as const satisfies readonly CandidateMomentumCase["id"][];

const requiredCaseIds: ReadonlySet<string> = new Set(CANDIDATE_MOMENTUM_CASE_IDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

const dispositions: ReadonlySet<string> = new Set([
  "block",
  "clarify",
  "no_action",
  "propose_action",
]);

const assertionStatuses: ReadonlySet<string> = new Set([
  "ambiguous",
  "proposed",
  "superseded",
]);

const speakers: ReadonlySet<string> = new Set([
  "candidate",
  "hiring_manager",
  "recruiter",
  "unknown",
]);

function isCandidateMomentumAssertionShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.field === "string" &&
    value.field.length > 0 &&
    assertionStatuses.has(String(value.status)) &&
    typeof value.value === "string" &&
    typeof value.evidence_message_id === "string" &&
    typeof value.evidence_quote === "string"
  );
}

function isCandidateMomentumActionShape(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === "prepare_question" &&
    value.owner === "recruiter" &&
    typeof value.target === "string" &&
    typeof value.reason === "string" &&
    typeof value.due === "string" &&
    Array.isArray(value.evidence_message_ids) &&
    value.evidence_message_ids.every((id) => typeof id === "string")
  );
}

function isCandidateMomentumCaseShape(value: unknown): boolean {
  if (!isRecord(value) || typeof value.title !== "string") {
    return false;
  }
  if (!requiredCaseIds.has(String(value.id))) {
    return false;
  }
  const context = value.context;
  if (
    !isRecord(context) ||
    typeof context.captured_at !== "string" ||
    !isStringOrNull(context.source_timezone) ||
    !isStringOrNull(context.candidate) ||
    !isStringOrNull(context.assignment)
  ) {
    return false;
  }
  if (
    context.candidate_options !== undefined &&
    (!Array.isArray(context.candidate_options) ||
      context.candidate_options.some((item) => typeof item !== "string"))
  ) {
    return false;
  }
  if ([context.notes, context.requested_output].some(value => value != null && typeof value !== "string")
    || (context.prior_state != null && (!isRecord(context.prior_state)
      || Object.values(context.prior_state).some(value => typeof value !== "string")))) {
    return false;
  }
  if (!Array.isArray(value.messages) || value.messages.length === 0) {
    return false;
  }
  for (const message of value.messages) {
    if (
      !isRecord(message) ||
      typeof message.id !== "string" ||
      !speakers.has(String(message.speaker)) ||
      typeof message.text !== "string"
    ) {
      return false;
    }
  }
  const expected = value.expected;
  if (!isRecord(expected) || !dispositions.has(String(expected.disposition))) {
    return false;
  }
  if (
    !Array.isArray(expected.assertions) ||
    !expected.assertions.every(isCandidateMomentumAssertionShape) ||
    !Array.isArray(expected.must_not) ||
    expected.must_not.some((item) => typeof item !== "string")
  ) {
    return false;
  }
  const hasAction = expected.action !== null;
  if (hasAction !== (expected.disposition === "propose_action")) {
    return false;
  }
  if (hasAction && !isCandidateMomentumActionShape(expected.action)) {
    return false;
  }
  if (expected.disposition === "block" && expected.assertions.length > 0) {
    return false;
  }
  const messages = new Map((value.messages as Array<{id: string; text: string}>).map(message => [message.id, message.text]));
  if (messages.size !== value.messages.length || (expected.assertions as CandidateMomentumAssertion[]).some(assertion =>
    !assertion.evidence_quote || !messages.get(assertion.evidence_message_id)?.includes(assertion.evidence_quote))) {
    return false;
  }
  const action = expected.action as CandidateMomentumAction | null;
  if (action && (!action.evidence_message_ids.length
    || action.evidence_message_ids.some(id => !messages.has(id)))) return false;
  return true;
}

/**
 * Structural gate for a candidate-momentum dataset. It checks the frozen suite
 * identity, the case-id registry, and case shapes; it never compares case
 * payloads. Frozen-contract payload comparison needs an explicit reference and
 * lives in `isCandidateMomentumDataset`.
 *
 * `data_mode` is accepted as an explicit label; a dataset without the label is
 * always treated as `fixture` and never as `synchronized`.
 */
export function parseCandidateMomentumDataset(
  value: unknown,
): CandidateMomentumDataset | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    value.suite_id !== CANDIDATE_MOMENTUM_SUITE_ID ||
    value.version !== CANDIDATE_MOMENTUM_VERSION ||
    (value.data_mode !== undefined &&
      value.data_mode !== "fixture" &&
      value.data_mode !== "synchronized")
  ) {
    return null;
  }
  if (!Array.isArray(value.cases) || value.cases.length !== requiredCaseIds.size) {
    return null;
  }
  const ids = new Set(
    value.cases.map((item) =>
      isRecord(item) ? String(item.id) : "",
    ),
  );
  if (
    ids.size !== requiredCaseIds.size ||
    ![...requiredCaseIds].every((id) => ids.has(id))
  ) {
    return null;
  }
  if (!value.cases.every(isCandidateMomentumCaseShape)) {
    return null;
  }
  return {
    cases: value.cases as CandidateMomentumCase[],
    data_mode: value.data_mode === "synchronized" ? "synchronized" : "fixture",
    purpose: typeof value.purpose === "string" ? value.purpose : "",
    suite_id: CANDIDATE_MOMENTUM_SUITE_ID,
    version: CANDIDATE_MOMENTUM_VERSION,
  };
}

function hasFrozenCaseContract(
  value: unknown,
  frozenCase: CandidateMomentumCase,
) {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.id === frozenCase.id &&
    value.title === frozenCase.title &&
    JSON.stringify(value.context) === JSON.stringify(frozenCase.context) &&
    JSON.stringify(value.messages) === JSON.stringify(frozenCase.messages) &&
    JSON.stringify(value.expected) === JSON.stringify(frozenCase.expected)
  );
}

/**
 * Strict frozen-contract comparison against an explicit reference dataset. The
 * public product ships no default reference: callers must pass the dataset they
 * trust (for example one loaded from the configured private evaluation
 * repository). A dataset whose cases deviate from the reference never passes.
 */
export function isCandidateMomentumDataset(
  value: unknown,
  reference: CandidateMomentumDataset,
): value is CandidateMomentumDataset {
  if (!isRecord(value) || reference.cases.length === 0) {
    return false;
  }

  const candidate = value as Partial<CandidateMomentumDataset>;
  if (
    candidate.suite_id !== reference.suite_id ||
    candidate.version !== reference.version ||
    (candidate.data_mode !== "fixture" &&
      candidate.data_mode !== "synchronized") ||
    !Array.isArray(candidate.cases) ||
    candidate.cases.length !== reference.cases.length
  ) {
    return false;
  }

  const ids = new Set(
    candidate.cases.flatMap((item) =>
      item && typeof item === "object" && "id" in item
        ? [String(item.id)]
        : [],
    ),
  );

  return (
    ids.size === reference.cases.length &&
    reference.cases.every((frozenCase) =>
      candidate.cases?.some((item) => hasFrozenCaseContract(item, frozenCase)),
    )
  );
}

export function getCaseEvidence(
  fixtureCase: CandidateMomentumCase,
  messageId: string,
) {
  return fixtureCase.messages.find((message) => message.id === messageId);
}

export function getCaseIdentityLabel(fixtureCase: CandidateMomentumCase) {
  return fixtureCase.context.candidate ?? "身份未解决";
}

export function getDispositionLabel(
  disposition: CandidateMomentumDisposition,
) {
  const labels: Record<CandidateMomentumDisposition, string> = {
    block: "已阻止",
    clarify: "需要澄清",
    no_action: "无需行动",
    propose_action: "已提议行动",
  };
  return labels[disposition];
}

const speakerLabels = {
  candidate: "候选人",
  hiring_manager: "用人经理",
  recruiter: "招聘顾问",
  unknown: "未识别发言人",
} as const;

const actionTypeLabels = {
  prepare_question: "准备问题",
} as const;

const actionOwnerLabels = {
  recruiter: "招聘顾问",
} as const;

export function getSpeakerLabel(
  speaker: CandidateMomentumCase["messages"][number]["speaker"],
) {
  return speakerLabels[speaker];
}

export function getActionTypeLabel(
  type: CandidateMomentumAction["type"],
) {
  return actionTypeLabels[type];
}

export function getActionOwnerLabel(
  owner: CandidateMomentumAction["owner"],
) {
  return actionOwnerLabels[owner];
}

/**
 * The corpus-derived localization table was removed with the public corpus
 * (GET-134). Generated copy renders verbatim; evidence text is never rewritten
 * here. Private localization, if any, restores from the private repository.
 */
export function localizeGeneratedCopy(value: string) {
  return value;
}

export function getFieldLabel(field: string) {
  const labels: Record<string, string> = {
    availability: "可用时间",
    competing_process: "竞争流程",
    decision_deadline: "决定截止时间",
    relocation_requirement: "搬迁要求",
    work_mode_constraint: "工作模式限制",
    work_mode_preference: "工作模式偏好",
  };
  return labels[field] ?? field.replaceAll("_", " ");
}
