"use server";

import { randomUUID } from "node:crypto";

import {
  TalentSignalHttpError,
  type ReconciliationRecord,
  type StepUpProof,
} from "@talent-signal/contracts";
import {
  authenticatedBackendClient,
  readPrimaryBackendSessionClaims,
} from "@/lib/server/backendAuth";
import {
  flowIsLive,
  readAuthOperation,
  readAuthProof,
  renderedScopeFrom,
  sessionFingerprint,
  validateRecoveryProof,
} from "@/lib/server/stagedAuth";

export type ConflictRecoveryState = {
  record?: ReconciliationRecord;
  error?: string;
  /** Committed: the empty duplicate's login moved; readback verified. */
  committed?: boolean;
  /** Non-empty duplicate: protected review-required state, nothing moved. */
  protectedReview?: boolean;
};

const failure = (error: unknown): ConflictRecoveryState => {
  if (error instanceof TalentSignalHttpError) {
    if (error.code === "RECONCILIATION_PROOF_STALE") {
      return { error: "账号或凭据在验证后发生了变化。请重新开始核对；没有做任何转移。" };
    }
    if (error.code === "RECONCILIATION_PROOF_FAILED") {
      return { error: "另一个账户的凭据验证失败，请核对后重试。" };
    }
    if (error.code === "RECONCILIATION_PROOF_AMBIGUOUS") {
      return { error: "有多个密码登录符合，请使用另一个账户的用户名。" };
    }
    if (error.code === "STEP_UP_FAILED") return { error: "当前身份验证失败，请重试。" };
    if (error.code === "RECONCILIATION_REVIEW_REQUIRED") {
      return { error: "两个账户都保留着受治理的数据，需要单独的核对流程；没有合并或转移任何内容。", protectedReview: true };
    }
    if (error.code === "RECONCILIATION_NOT_EMPTY") {
      return { error: "这个账户不再为空；需要单独的核对流程；没有合并或转移任何内容。", protectedReview: true };
    }
    return { error: "暂时无法完成这次核对；没有做任何更改。" };
  }
  return { error: "网络不稳定，核对未生效。恢复连接后可以重试。" };
};

async function authorizedClient(form: FormData) {
  const scope = renderedScopeFrom(form);
  const claims = await readPrimaryBackendSessionClaims();
  const client = await authenticatedBackendClient();
  if (!scope || !claims || !client) return null;
  if (
    scope.accountId !== claims.backendAccountId ||
    scope.userId !== claims.backendUserId
  ) {
    return null;
  }
  return { scope, claims, client };
}

/**
 * Prepare one authenticated historical-duplicate reconciliation. Both
 * identities are freshly proven: the current account reauthenticates (password
 * or a staged linked-provider proof) and the duplicate account presents its
 * own credential. Only then does the readback show data categories and counts.
 */
export async function prepareConflictRecovery(
  _previous: ConflictRecoveryState,
  form: FormData,
): Promise<ConflictRecoveryState> {
  const authorized = await authorizedClient(form);
  if (!authorized) return { error: "登录状态已变化。请刷新后重新开始。" };
  const { scope, client } = authorized;

  const identifier = String(form.get("duplicateIdentifier") ?? "").trim();
  const duplicatePassword = String(form.get("duplicatePassword") ?? "");
  const currentPassword = String(form.get("currentPassword") ?? "");

  // Both identities are freshly proven and both proofs are distinct purposes.
  // One immutable recovery flow freezes the canonical actor, session
  // fingerprint, revisions and ABSOLUTE expiry; each role's proof must match
  // that flow's own frozen provider+challenge and be freshly staged. A stale
  // form (old operationRef), a switched session/revisions, tampering, or an
  // expired flow is rejected before any backend consumption.
  const operation = await readAuthOperation();
  const claims = await readPrimaryBackendSessionClaims();
  const renderedRef = String(form.get("operationRef") ?? "");
  // When either side consumes a staged provider proof, the rendered operation
  // ref is MANDATORY and must match the flow exactly. A stale tab rendered
  // without a ref can never consume another tab's proofs. Password/password
  // recovery may proceed with no staged flow at all.
  const renderedRefStale =
    renderedRef.length > 0 && (!operation || renderedRef !== operation.ref);
  const renderedRefMissing = renderedRef.length === 0;
  const flowUsable = Boolean(
    operation &&
      claims &&
      flowIsLive(operation) &&
      !renderedRefStale &&
      scope.accountId === operation.accountId &&
      scope.userId === operation.userId &&
      scope.accountRevision === operation.accountRevision &&
      scope.userRevision === operation.userRevision &&
      sessionFingerprint(claims) === operation.sessionFingerprint,
  );
  const asProviderProof = (staged: {
    provider: "apple" | "google";
    challengeId: string;
    identityToken: string;
  }) => ({
    kind: "provider" as const,
    provider: staged.provider,
    challenge_id: staged.challengeId,
    identity_token: staged.identityToken,
  });

  // Proofs are validated against the frozen role challenges. A form without
  // the exact rendered operationRef can never consume staged proofs, even
  // when those proofs are valid for another tab's flow.
  const currentProofAny = validateRecoveryProof({
    operation,
    proof: await readAuthProof("current"),
    role: "current",
  });
  const duplicateProofAny = validateRecoveryProof({
    operation,
    proof: await readAuthProof("duplicate"),
    role: "duplicate",
  });
  if (renderedRefMissing && (currentProofAny || duplicateProofAny)) {
    return { error: "登录状态已变化，这个表单已失效；没有做任何更改。请刷新后重新开始。" };
  }
  const currentStaged = flowUsable && !renderedRefMissing ? currentProofAny : null;
  const duplicateStaged = flowUsable && !renderedRefMissing ? duplicateProofAny : null;

  // Current-identity step-up: password, or the validated current-role proof.
  let stepUp: StepUpProof;
  if (currentPassword.length > 0) {
    stepUp = { kind: "password", password: currentPassword };
  } else if (currentStaged) {
    stepUp = asProviderProof(currentStaged);
  } else if (renderedRefStale) {
    // A stale form can never consume a newer flow.
    return { error: "登录状态已变化，这个表单已失效；没有做任何更改。请刷新后重新开始。" };
  } else {
    return { error: "请先验证当前身份：输入密码，或使用已绑定的登录方式验证。" };
  }

  // The duplicate account's own credential: its password, or its own validated
  // duplicate-role provider proof (a Google/Apple-only duplicate needs no
  // password).
  let duplicate:
    | { kind: "password"; identifier: string; password: string }
    | {
        kind: "provider";
        provider: "apple" | "google";
        challenge_id: string;
        identity_token: string;
      };
  if (duplicatePassword.length > 0 && identifier) {
    duplicate = { kind: "password", identifier, password: duplicatePassword };
  } else if (duplicateStaged) {
    duplicate = asProviderProof(duplicateStaged);
  } else {
    return {
      error: "请提供另一个账户的凭据：用户名和密码，或用它自己的登录方式验证。",
    };
  }

  try {
    const record = await client.prepareReconciliation({
      id: randomUUID(),
      proof: duplicate,
      step_up: stepUp,
      expected_account_revision: scope.accountRevision,
      expected_user_revision: scope.userRevision,
    });
    return {
      record,
      protectedReview: record.kind === "review_required",
    };
  } catch (error) {
    return failure(error);
  }
}

export async function confirmConflictRecovery(
  _previous: ConflictRecoveryState,
  form: FormData,
): Promise<ConflictRecoveryState> {
  const authorized = await authorizedClient(form);
  if (!authorized) return { error: "登录状态已变化。请刷新后重新开始。" };
  const id = String(form.get("reconciliationId") ?? "");
  if (!id) return { error: "缺少核对编号，请重新开始。" };
  try {
    const record = await authorized.client.confirmReconciliation(id, { id });
    return { record, committed: record.state === "committed" };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelConflictRecovery(
  _previous: ConflictRecoveryState,
  form: FormData,
): Promise<ConflictRecoveryState> {
  const authorized = await authorizedClient(form);
  if (!authorized) return { error: "登录状态已变化。请刷新后重新开始。" };
  const id = String(form.get("reconciliationId") ?? "");
  if (!id) return { error: "缺少核对编号，请重新开始。" };
  try {
    const record = await authorized.client.cancelReconciliation(id, { id });
    return { record };
  } catch (error) {
    return failure(error);
  }
}

/** Provider-only accounts: start the existing staged reauthentication flow. */
export async function startConflictProviderVerification(form: FormData): Promise<void> {
  const { startProviderReauth } = await import("../login-methods/actions");
  const next = new FormData();
  next.set("intent", "verify_identity");
  next.set("reauthProvider", String(form.get("reauthProvider") ?? ""));
  next.set("accountId", String(form.get("accountId") ?? ""));
  next.set("userId", String(form.get("userId") ?? ""));
  next.set("accountRevision", String(form.get("accountRevision") ?? ""));
  next.set("userRevision", String(form.get("userRevision") ?? ""));
  await startProviderReauth(next);
}
