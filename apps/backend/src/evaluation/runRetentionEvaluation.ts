import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  TalentSignalClient,
  TalentSignalHttpError,
  type CreateCaptureRequest,
  type SourceRetentionReceipt,
} from "@talent-signal/contracts";

const baseUrl = process.env.API_BASE_URL ?? "http://127.0.0.1:4317";
const outputPath = resolve(
  process.env.RETENTION_EVALUATION_OUTPUT ??
    "output/evaluation/round-3/retention/localhost-backend-retention.json",
);
const runId =
  process.env.RETENTION_EVALUATION_RUN_ID ??
  `retention-${randomUUID().slice(0, 8)}`;
const sourceText =
  "Synthetic retention evidence: reviewed selected text, no real candidate data.";

async function expectHttpError(
  operation: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  await assert.rejects(
    operation,
    (error: unknown) =>
      error instanceof TalentSignalHttpError &&
      error.status === status &&
      error.code === code,
  );
}

function captureRequest(
  name: string,
  retention: CreateCaptureRequest["source"]["retention"],
  kind: CreateCaptureRequest["source"]["kind"] = "transcript",
): CreateCaptureRequest {
  return {
    idempotency_key: `${runId}:${name}:capture`,
    source: {
      kind,
      captured_at: new Date().toISOString(),
      source_timezone: "UTC",
      purpose: "Synthetic XS-RETENTION-01 lifecycle evaluation",
      source_locator: `retention-evaluator:${runId}:${name}`,
      retention,
    },
    identity: {
      status: "unbound",
      reason: "Retention evaluation intentionally avoids candidate identity.",
    },
    messages: [
      {
        source_message_id: "synthetic-retention-message",
        sequence: 0,
        speaker: "unknown",
        text: sourceText,
      },
    ],
  };
}

async function completeReview(
  client: TalentSignalClient,
  captureId: string,
  name: string,
  withAssertion = false,
) {
  return client.submitAnalysis(captureId, {
    idempotency_key: `${runId}:${name}:analysis`,
    producer: {
      kind: "fixture_compiler",
      name: "source-retention-evaluator",
      version: CONTRACT_VERSION,
    },
    disposition: "no_action",
    assertions: withAssertion
      ? [
          {
            field: "availability",
            status: "proposed",
            value: "synthetic reviewed availability",
            evidence_message_id: "synthetic-retention-message",
            evidence_quote: sourceText,
            subject_kind: "unknown",
            temporal_relation: "new",
          },
        ]
      : [],
    action: null,
  });
}

function receiptSummary(receipt: SourceRetentionReceipt) {
  return {
    receipt_id: receipt.receipt_id,
    capture_id: receipt.capture_id,
    requested_policy: receipt.requested_policy,
    effective_policy: receipt.effective_policy,
    source_access: receipt.source_access,
    lifecycle: receipt.lifecycle,
    deletion_id: receipt.deletion_id,
    lineage: receipt.lineage,
  };
}

async function main(): Promise<void> {
  const recruiter = new TalentSignalClient(baseUrl);
  const otherAccount = new TalentSignalClient(baseUrl);
  await recruiter.login({
    account_slug: "fixture-alpha",
    user_email: "recruiter@alpha.local",
    client_label: "retention-evaluator",
  });
  await otherAccount.login({
    account_slug: "fixture-beta",
    user_email: "recruiter@beta.local",
    client_label: "retention-cross-account",
  });

  const multiMessageSelection = captureRequest("invalid-multi-selection", {
    requested_mode: "evidence_crop",
    source_scope: "reviewed_selected_text",
  });
  multiMessageSelection.messages.push({
    source_message_id: "synthetic-retention-message-2",
    sequence: 1,
    speaker: "unknown",
    text: "A second message must not fit a reviewed selection claim.",
  });
  await expectHttpError(
    recruiter.createCapture(multiMessageSelection),
    422,
    "SOURCE_SCOPE_PAYLOAD_MISMATCH",
  );

  const unsupportedSingleCrop = captureRequest(
    "unsupported-single-crop",
    {
      requested_mode: "evidence_crop",
      source_scope: "reviewed_evidence_crop",
    },
    "screenshot_metadata",
  );
  await expectHttpError(
    recruiter.createCapture(unsupportedSingleCrop),
    422,
    "SOURCE_SCOPE_PAYLOAD_MISMATCH",
  );

  const multiMessageCrop = {
    ...unsupportedSingleCrop,
    idempotency_key: `${runId}:invalid-multi-crop:capture`,
    source: {
      ...unsupportedSingleCrop.source,
      source_locator: `retention-evaluator:${runId}:invalid-multi-crop`,
    },
    messages: [...unsupportedSingleCrop.messages],
  };
  multiMessageCrop.messages.push({
    source_message_id: "synthetic-crop-message-2",
    sequence: 1,
    speaker: "unknown",
    text: "A second message must not fit one reviewed crop claim.",
  });
  await expectHttpError(
    recruiter.createCapture(multiMessageCrop),
    422,
    "SOURCE_SCOPE_PAYLOAD_MISMATCH",
  );

  const ephemeralRequest = captureRequest("ephemeral", {
    requested_mode: "ephemeral",
    source_scope: "reviewed_selected_text",
  });
  const ephemeral = await recruiter.createCapture(ephemeralRequest);
  const ephemeralBefore = await recruiter.getSourceRetentionReceipt(
    ephemeral.id,
  );
  assert.equal(ephemeralBefore.source_access.state, "available");
  const ephemeralAnalysis = await completeReview(
    recruiter,
    ephemeral.id,
    "ephemeral",
  );
  const ephemeralAfter = await recruiter.getSourceRetentionReceipt(
    ephemeral.id,
  );
  const ephemeralCapture = await recruiter.getCapture(ephemeral.id);
  assert.equal(ephemeralAfter.source_access.state, "purged");
  assert.equal(ephemeralAfter.source_access.reason, "review_completed");
  assert(ephemeralAfter.lifecycle.review_completed_at);
  assert(ephemeralAfter.lifecycle.source_purged_at);
  assert.equal(ephemeralCapture.messages[0]?.text, null);
  assert.equal(ephemeralCapture.messages[0]?.status, "purged");

  const duplicateEphemeral = await recruiter.createCapture(ephemeralRequest);
  const duplicateAnalysis = await completeReview(
    recruiter,
    ephemeral.id,
    "ephemeral",
  );
  assert.equal(duplicateEphemeral.id, ephemeral.id);
  assert.equal(duplicateEphemeral.messages[0]?.text, null);
  assert.equal(duplicateAnalysis.id, ephemeralAnalysis.id);

  await expectHttpError(
    otherAccount.getSourceRetentionReceipt(ephemeral.id),
    404,
    "RETENTION_RECEIPT_NOT_FOUND",
  );
  await expectHttpError(
    otherAccount.getSourceRetentionReceiptByLocator(
      ephemeralRequest.source.source_locator!,
    ),
    404,
    "RETENTION_RECEIPT_NOT_FOUND",
  );

  const deadline = new Date(Date.now() + 2_000);
  const cropRequest = captureRequest("evidence-crop", {
    requested_mode: "evidence_crop",
    source_scope: "reviewed_selected_text",
    requested_retention_until: deadline.toISOString(),
  });
  cropRequest.identity = {
    status: "bound",
    external_ref: `retention-subject:${runId}`,
    display_label: "Synthetic retention subject",
    assignment_ref: `retention-assignment:${runId}`,
    assignment_label: "Synthetic retention assignment",
    binding_basis: "Evaluator-owned synthetic identity.",
  };
  const crop = await recruiter.createCapture(cropRequest);
  const cropAnalysisBefore = await completeReview(
    recruiter,
    crop.id,
    "evidence-crop",
    true,
  );
  const cropBefore = await recruiter.getSourceRetentionReceipt(crop.id);
  const cropCaptureBefore = await recruiter.getCapture(crop.id);
  assert.equal(cropBefore.source_access.state, "available");
  assert.equal(cropBefore.effective_policy.retention_until, deadline.toISOString());
  assert.equal(cropCaptureBefore.messages.length, 1);
  assert.equal(cropCaptureBefore.messages[0]?.text, sourceText);

  await new Promise((resolveDelay) =>
    setTimeout(resolveDelay, Math.max(0, deadline.getTime() - Date.now() + 250)),
  );
  const cropAnalysisAfter = await completeReview(
    recruiter,
    crop.id,
    "evidence-crop",
    true,
  );
  const cropAfter = await recruiter.getSourceRetentionReceipt(crop.id);
  const cropCaptureAfter = await recruiter.getCapture(crop.id);
  assert.equal(cropAfter.source_access.state, "purged");
  assert.equal(cropAfter.source_access.reason, "retention_deadline_elapsed");
  assert.equal(cropCaptureAfter.messages[0]?.text, null);
  assert.equal(cropAnalysisBefore.assertions[0]?.evidence_quote, sourceText);
  assert.equal(cropAnalysisAfter.assertions[0]?.evidence_quote, null);
  assert.equal(
    cropAnalysisAfter.assertions[0]?.value,
    "synthetic reviewed availability",
  );

  const fullSource = await recruiter.createCapture(
    captureRequest(
      "full-source-fixture",
      {
        requested_mode: "full_source",
        source_scope: "full_reviewed_source",
      },
      "fixture",
    ),
  );
  await completeReview(recruiter, fullSource.id, "full-source-fixture");
  const fullSourceReceipt = await recruiter.getSourceRetentionReceipt(
    fullSource.id,
  );
  assert.equal(fullSourceReceipt.source_access.state, "available");
  assert(fullSourceReceipt.effective_policy.retention_until);

  await expectHttpError(
    recruiter.createCapture(
      captureRequest("unsupported-full-source", {
        requested_mode: "full_source",
        source_scope: "full_reviewed_source",
      }),
    ),
    422,
    "FULL_SOURCE_TRANSPORT_UNSUPPORTED",
  );

  await expectHttpError(
    recruiter.createCapture({
      ...ephemeralRequest,
      source: {
        ...ephemeralRequest.source,
        purpose: "Changed request must not reuse the same idempotency key.",
      },
    }),
    409,
    "IDEMPOTENCY_KEY_REUSED",
  );

  const deletionRequest = captureRequest("manual-deletion", {
    requested_mode: "evidence_crop",
    source_scope: "reviewed_selected_text",
  });
  const deletionCapture = await recruiter.createCapture(deletionRequest);
  await completeReview(recruiter, deletionCapture.id, "manual-deletion");
  const deletion = await recruiter.deleteCapture(deletionCapture.id, {
    idempotency_key: `${runId}:manual-deletion:delete`,
    reason: "Synthetic retention evaluator deletion.",
  });
  const deletedReceipt = await recruiter.getSourceRetentionReceipt(
    deletionCapture.id,
  );
  const deletionLineage = await recruiter.getDeletionLineage(
    deletion.deletion_id,
  );
  assert.equal(deletedReceipt.source_access.state, "deleted");
  assert.equal(deletedReceipt.deletion_id, deletion.deletion_id);
  assert(deletionLineage.lineage.length > 0);

  const result = {
    evidence_id: `TS-2026-08-05-${runId}`,
    artifact_contract_version: CONTRACT_VERSION,
    api_base_url: baseUrl,
    synthetic_data_only: true,
    accepted_modes: {
      ephemeral: {
        before: receiptSummary(ephemeralBefore),
        after_review_completion: receiptSummary(ephemeralAfter),
        source_text_after: ephemeralCapture.messages[0]?.text ?? null,
      },
      evidence_crop: {
        before_deadline: receiptSummary(cropBefore),
        source_count_before: cropCaptureBefore.messages.length,
        after_deadline: receiptSummary(cropAfter),
        source_text_after: cropCaptureAfter.messages[0]?.text ?? null,
        idempotent_proposal_quote_after:
          cropAnalysisAfter.assertions[0]?.evidence_quote ?? null,
        derived_proposal_value_after:
          cropAnalysisAfter.assertions[0]?.value ?? null,
      },
      full_source_fixture: receiptSummary(fullSourceReceipt),
    },
    unsupported: {
      multi_message_selected_text: {
        status: 422,
        code: "SOURCE_SCOPE_PAYLOAD_MISMATCH",
      },
      single_message_evidence_crop: {
        status: 422,
        code: "SOURCE_SCOPE_PAYLOAD_MISMATCH",
      },
      multi_message_evidence_crop: {
        status: 422,
        code: "SOURCE_SCOPE_PAYLOAD_MISMATCH",
      },
      transcript_full_source: {
        status: 422,
        code: "FULL_SOURCE_TRANSPORT_UNSUPPORTED",
      },
    },
    retry_and_duplicate: {
      same_capture_id: duplicateEphemeral.id === ephemeral.id,
      same_analysis_id: duplicateAnalysis.id === ephemeralAnalysis.id,
      source_restored: duplicateEphemeral.messages[0]?.text !== null,
      changed_request_code: "IDEMPOTENCY_KEY_REUSED",
    },
    cross_account: {
      receipt_by_id: "RETENTION_RECEIPT_NOT_FOUND",
      receipt_by_locator: "RETENTION_RECEIPT_NOT_FOUND",
    },
    manual_deletion: {
      receipt: receiptSummary(deletedReceipt),
      lineage_entries: deletionLineage.lineage.length,
    },
    boundaries: {
      external_writes: 0,
      candidate_contact: false,
      calendar_write: false,
      message_write: false,
      ats_write: false,
      crm_write: false,
    },
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  process.stdout.write(
    `Retention evaluation passed: ${ephemeral.id}, ${crop.id}, ${fullSource.id}.\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Retention evaluation failed: ${
      error instanceof Error ? error.message : "unknown error"
    }\n`,
  );
  process.exitCode = 1;
});
