import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  CONTRACT_VERSION,
  TalentSignalClient,
} from "@talent-signal/contracts";

import { prepareIOSPursuitProposalFixture } from "./prepareIOSPursuitProposalFixture.js";

const baseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:4317";
const artifactDir =
  process.env.EVALUATION_ARTIFACT_DIR ??
  fileURLToPath(
    new URL(
      "../../../../output/evaluation/2026-08-24-v1-prd-05",
      import.meta.url,
    ),
  );

function assertNoPersonRanking(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoPersonRanking);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const forbidden of ["score", "rank", "acceptance_probability"]) {
    assert.equal(
      Object.hasOwn(record, forbidden),
      false,
      `Workspace projection exposed forbidden person-ranking field ${forbidden}`,
    );
  }
  Object.values(record).forEach(assertNoPersonRanking);
}

async function main(): Promise<void> {
  const alpha = new TalentSignalClient(baseUrl);
  const beta = new TalentSignalClient(baseUrl);
  const alphaSession = await alpha.login({
    account_slug: "fixture-alpha",
    user_email: "recruiter@alpha.local",
    client_label: "pursuit-workspace-evaluation",
  });
  const betaSession = await beta.login({
    account_slug: "fixture-beta",
    user_email: "recruiter@beta.local",
    client_label: "pursuit-workspace-evaluation",
  });
  const existingProposals = await alpha.listPursuitProposals();
  const existingCanonical = existingProposals.proposals.find(
    (proposal) =>
      proposal.status === "needs_review" &&
      proposal.review_context.subject.display_label === "Leila Hartmann",
  );
  const fixture = existingCanonical
    ? {
        pursuit_id: existingCanonical.pursuit_id,
        person_id: existingCanonical.review_context.subject.person_id,
        proposal_id: existingCanonical.id,
      }
    : await prepareIOSPursuitProposalFixture(baseUrl);

  const [pursuits, people, proposals, betaPursuits, betaPeople, betaProposals] =
    await Promise.all([
      alpha.listPursuits(),
      alpha.listPeople(),
      alpha.listPursuitProposals(),
      beta.listPursuits(),
      beta.listPeople(),
      beta.listPursuitProposals(),
    ]);

  assert.equal(pursuits.contract_version, CONTRACT_VERSION);
  assert.equal(people.contract_version, CONTRACT_VERSION);
  assert.equal(proposals.contract_version, CONTRACT_VERSION);
  assert.equal(pursuits.workspace_id, alphaSession.account.id);
  assert.equal(proposals.workspace_id, alphaSession.account.id);
  assert.equal(betaPursuits.workspace_id, betaSession.account.id);
  assert.equal(betaProposals.workspace_id, betaSession.account.id);

  const canonicalPursuit = pursuits.pursuits.find(
    (item) => item.id === fixture.pursuit_id,
  );
  const canonicalPerson = people.people.find(
    (item) => item.id === fixture.person_id,
  );
  const canonicalProposal = proposals.proposals.find(
    (item) => item.id === fixture.proposal_id,
  );
  assert(canonicalPursuit);
  assert(canonicalPerson);
  assert(canonicalProposal);
  assert.equal(canonicalPerson.display_label, "Leila Hartmann");
  assert(
    canonicalPursuit.roles.some(
      (role) =>
        role.subject_ref.type === "person" &&
        role.subject_ref.id === fixture.person_id &&
        role.role_type === "candidate",
    ),
  );
  assert.equal(canonicalProposal.pursuit_id, fixture.pursuit_id);
  assert.equal(
    canonicalProposal.review_context.subject.display_label,
    canonicalPerson.display_label,
  );
  assert.equal(canonicalProposal.status, "needs_review");
  assert(canonicalProposal.items.length > 0);
  assert(
    canonicalProposal.items.every(
      (item) => item.evidence_refs.length > 0,
    ),
  );
  assert(
    pursuits.pursuits
      .flatMap((pursuit) => pursuit.actions)
      .every((action) => action.external_effects.length === 0),
  );
  assertNoPersonRanking({ pursuits, people, proposals });

  assert.equal(
    betaPursuits.pursuits.some((item) => item.id === fixture.pursuit_id),
    false,
  );
  assert.equal(
    betaPeople.people.some((item) => item.id === fixture.person_id),
    false,
  );
  assert.equal(
    betaProposals.proposals.some((item) => item.id === fixture.proposal_id),
    false,
  );

  const artifact = {
    schema_version: "talent-signal.v1-prd-05-runtime.1",
    artifact_id: "TS-V1-PRD-05-RUNTIME-01",
    generated_at: "2026-08-24T04:30:00.000+08:00",
    data_classification: "synthetic_only",
    contract_version: CONTRACT_VERSION,
    verdict: "pass",
    checks: {
      pursuit_people_proposal_parallel_read: true,
      authenticated_workspace_scope_matches: true,
      canonical_subject_label_resolved: true,
      cross_pursuit_person_identity_resolved: true,
      pending_proposal_visible_in_inbox_projection: true,
      proposal_evidence_refs_nonempty: true,
      beta_account_cannot_observe_alpha_fixture: true,
      internal_actions_have_no_external_effects: true,
      person_score_rank_and_acceptance_probability_absent: true,
    },
    readback: {
      workspace_id: alphaSession.account.id,
      pursuit_id: fixture.pursuit_id,
      person_id: fixture.person_id,
      proposal_id: fixture.proposal_id,
      person_display_label: canonicalPerson.display_label,
      pursuit_revision: canonicalPursuit.revision,
      proposal_base_revision: canonicalProposal.base_revision,
      proposal_status: canonicalProposal.status,
      alpha_counts: {
        pursuits: pursuits.pursuits.length,
        people: people.people.length,
        open_proposals: proposals.proposals.length,
      },
      beta_fixture_matches: {
        pursuits: 0,
        people: 0,
        proposals: 0,
      },
    },
    limitations: [
      "This uses synthetic loopback authentication and does not prove production authentication.",
      "This proves canonical retrieval and account isolation, not design-partner workflow value.",
      "No external write capability is present in this workspace slice.",
    ],
  };

  await mkdir(artifactDir, { recursive: true });
  await writeFile(
    `${artifactDir}/pursuit-workspace-runtime.json`,
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`${JSON.stringify(artifact, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Pursuit workspace evaluation failed: ${
      error instanceof Error ? error.stack ?? error.message : "unknown error"
    }\n`,
  );
  process.exitCode = 1;
});
