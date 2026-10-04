import { randomUUID } from "node:crypto";
import { CONTRACT_VERSION } from "@talent-signal/contracts";
import type { PoolClient } from "pg";
import { digestValue } from "../lib/hash.js";
import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import { createResourceCaptureInTransaction } from "./resourceIntake.js";

/**
 * Versioned synthetic product data for internal test accounts (Task 1).
 *
 * Adapted from the reviewed scenario source (frozen revision 4cc57bf3): the
 * authored daily preset seeds 12 fictional contacts, 30 observations and 4
 * tasks through the real resource-intake path. Seeding dispatches no model
 * call, email delivery or OAuth request. Every name, profile and observation
 * is explicitly synthetic and carries no assessment of a real person.
 */

const names = [
  "陈夏",
  "林舟",
  "周宁",
  "许棠",
  "方远",
  "沈禾",
  "程悦",
  "顾川",
  "苏晴",
  "梁月",
  "陆星",
  "江岚",
];
const roles = [
  "Product designer",
  "Frontend engineer",
  "Customer partner",
  "Operations lead",
];
const observations = [
  "Shared a mobile prototype and asked for usability feedback.",
  "Discussed a possible collaboration; no commitment was made.",
  "Recorded a reminder to send the next prototype on Friday.",
];
const taskTitles = [
  "Send mobile prototype",
  "Schedule usability review",
  "Review partner questions",
  "Record next milestone",
];
const dailyDefinition = {
  tasks_titles: taskTitles,
  context_label: "Synthetic collaboration",
  profile_summary_suffix:
    "is a fictional contact for product navigation testing. This authored profile is synthetic and carries no assessment of a real person.",
  observation_prefix: "Synthetic authored observation:",
  resource_kind: "personal_note",
  review_status: "reviewed",
  attribution_actor: "recruiter",
  milestone: "Prototype review",
  pursuit_title: "Synthetic product collaboration",
  target_outcome: "Collect prototype feedback",
  target_date: "2026-10-16",
  retention_mode: "evidence_crop",
  version: "1",
  reference_time: "2026-10-01T08:00:00.000Z",
  timezone: "Asia/Shanghai",
  names,
  roles,
  observations,
  interactions: 30,
  tasks: 4,
  media: [],
};

export const capirTestPresets = [
  {
    id: "daily" as const,
    version: "1" as const,
    digest: digestValue(dailyDefinition),
  },
  {
    id: "empty" as const,
    version: "1" as const,
    digest: digestValue({
      version: "1",
      people: [],
      interactions: [],
      tasks: [],
      media: [],
    }),
  },
];

export const CAPIR_TEST_DAILY_COUNTS = {
  contacts: 12,
  observations: 30,
  tasks: 4,
} as const;

export function capirTestPreset(id: "daily" | "empty") {
  return capirTestPresets.find((preset) => preset.id === id) ?? null;
}

export async function loadCapirTestScenario(
  client: PoolClient,
  auth: AuthContext,
  preset: "daily" | "empty",
): Promise<void> {
  if (preset === "empty") return;
  const people: Array<{ id: string; context: string }> = [];
  for (let i = 0; i < names.length; i++) {
    const id = randomUUID();
    const context = randomUUID();
    people.push({ id, context });
    await client.query(
      "INSERT INTO subjects(id,account_id,external_ref,display_label) VALUES($1,$2,$3,$4)",
      [id, auth.accountId, `capir:daily:person:${i + 1}`, names[i]],
    );
    await client.query(
      "INSERT INTO assignments(id,account_id,subject_id,external_ref,display_label) VALUES($1,$2,$3,$4,$5)",
      [
        context,
        auth.accountId,
        id,
        `capir:daily:relationship:${i + 1}`,
        dailyDefinition.context_label,
      ],
    );
    await client.query(
      `INSERT INTO person_profiles(account_id,subject_id,headline,summary,provenance_kind,authored_by_user_id) VALUES($1,$2,$3,$4,'user_authored',$5)`,
      [
        auth.accountId,
        id,
        roles[i % roles.length],
        `${names[i]} ${dailyDefinition.profile_summary_suffix}`,
        auth.userId,
      ],
    );
  }
  for (let i = 0; i < 30; i++) {
    const person = people[i % people.length]!;
    const logical = `capir:daily:observation:${i + 1}`;
    const observed = new Date(
      Date.parse(dailyDefinition.reference_time) - (30 - i) * 86400000,
    ).toISOString();
    await createResourceCaptureInTransaction(client, auth, {
      contract_version: CONTRACT_VERSION,
      idempotency_key: logical,
      channel: "web_upload",
      purpose: "Synthetic relationship observation for product testing",
      captured_at: observed,
      source_timezone: "Asia/Shanghai",
      person_scope: {
        status: "confirmed",
        person_id: person.id,
        relationship_context: {
          status: "existing",
          relationship_context_id: person.context,
        },
        binding_basis:
          "Versioned synthetic scenario explicitly binds this fictional contact.",
      },
      resource: {
        client_resource_id: logical,
        kind: "personal_note",
        display_name: `Synthetic observation ${i + 1}`,
        media_type: "text/plain",
        observed_at: observed,
        source_timezone: "Asia/Shanghai",
        retention: {
          requested_mode: "evidence_crop",
          source_scope: "reviewed_selected_text",
        },
      },
      fragments: [
        {
          client_resource_id: logical,
          kind: "note_revision",
          sequence: 0,
          text: `${dailyDefinition.observation_prefix} ${observations[i % observations.length]}`,
          locator: { kind: "note_revision", revision: 1 },
          attribution: { actor_kind: "recruiter", status: "confirmed" },
          review_status: "reviewed",
          parser: { name: "capir-synthetic-scenario", version: "1" },
        },
      ],
    });
  }
  const pursuit = randomUUID();
  await client.query(
    `INSERT INTO pursuits(id,account_id,pursuit_type,title,target_outcome,target_date,status,milestone,created_by_user_id,updated_by_user_id,milestone_authority_user_id,milestone_authority_at) VALUES($1,$2,'sales','Synthetic product collaboration','Collect prototype feedback','2026-10-16','active','Prototype review',$3,$3,$3,now())`,
    [pursuit, auth.accountId, auth.userId],
  );
  for (let i = 0; i < 4; i++) {
    await client.query(
      `INSERT INTO pursuit_actions(id,account_id,pursuit_id,title,owner_user_id,status,due_at,created_by_user_id,display_order) VALUES($1,$2,$3,$4,$5,'scheduled',$6,$5,$7)`,
      [
        randomUUID(),
        auth.accountId,
        pursuit,
        `Synthetic task ${i + 1}: ${taskTitles[i]}`,
        auth.userId,
        new Date(
          Date.parse(dailyDefinition.reference_time) + (i + 1) * 86400000,
        ),
        i,
      ],
    );
  }
}

/**
 * Readback of the persisted manifest. A partially seeded account is never
 * `ready`: creation fails unless every expected row is present and no extra
 * product row exists.
 */
export async function verifyCapirTestScenario(
  client: PoolClient,
  accountId: string,
  preset: "daily" | "empty",
): Promise<{ contacts: number; observations: number; tasks: number }> {
  const expected =
    preset === "daily"
      ? CAPIR_TEST_DAILY_COUNTS
      : { contacts: 0, observations: 0, tasks: 0 };
  const row = (
    await client.query<{
      people: string;
      resources: string;
      contexts: string;
      profiles: string;
      reviewed_observations: string;
      tasks: string;
      role: string;
    }>(
      `SELECT (SELECT count(*) FROM subjects WHERE account_id=$1) AS people,
              (SELECT count(*) FROM source_resources WHERE account_id=$1) AS resources,
              (SELECT count(*) FROM assignments WHERE account_id=$1) AS contexts,
              (SELECT count(*) FROM person_profiles WHERE account_id=$1) AS profiles,
              (SELECT count(*) FROM evidence_fragments WHERE account_id=$1 AND review_status='reviewed' AND attribution_status='confirmed' AND attributed_actor='recruiter' AND parser_name='capir-synthetic-scenario') AS reviewed_observations,
              (SELECT count(*) FROM pursuit_actions WHERE account_id=$1) AS tasks,
              (SELECT account_role FROM users WHERE account_id=$1 AND kind='lab_human') AS role`,
      [accountId],
    )
  ).rows[0]!;
  const counts = {
    contacts: Number(row.people),
    observations: Number(row.reviewed_observations),
    tasks: Number(row.tasks),
  };
  if (
    row.role !== "member" ||
    counts.contacts !== expected.contacts ||
    Number(row.resources) !== expected.observations ||
    Number(row.contexts) !== expected.contacts ||
    Number(row.profiles) !== expected.contacts ||
    counts.observations !== expected.observations ||
    counts.tasks !== expected.tasks
  ) {
    throw new ApiError(
      503,
      "CAPIR_TEST_SCENARIO_READBACK_FAILED",
      "Synthetic scenario data and member role did not match the persisted manifest.",
    );
  }
  return counts;
}
