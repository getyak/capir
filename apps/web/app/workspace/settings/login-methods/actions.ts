"use server";

import { createHash, randomUUID } from "node:crypto";

import { TalentSignalHttpError, type AccountSettings } from "@talent-signal/contracts";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { signIn } from "@/auth";
import {
  completeLoginMethodChange,
  readLoginMethodChangeResult,
  startLoginMethodChange,
} from "@/lib/server/loginMethods";
import { bindAppleNonce } from "@/lib/server/apple-session";
import { bindGoogleNonce } from "@/lib/server/google-session";
import {
  connectProviderFrom,
  continuityReturnTo,
  settingsLinkErrorTarget,
} from "@/lib/login-continuity";
import { authenticatedBackendClient, readBackendSessionClaims, readPrimaryBackendSessionClaims } from "@/lib/server/backendAuth";
import {
  LINK_COMPLETE_PATH,
  clearStagedAuth,
  flowExpiresAt,
  flowIsLive,
  readAuthOperation,
  recoveryOperationFor,
  renderedScopeFrom,
  renderedScopeMatchesOperation,
  sealAuthOperation,
  sealAuthRound,
  sessionFingerprint,
  type AuthOperation,
  type RenderedOperationScope,
  type StagedIntent,
} from "@/lib/server/stagedAuth";




/** Rendered scope AND live session must match before a bound attempt is used. */
async function stagedScopeMatches(
  operation: AuthOperation | null,
  scope: RenderedOperationScope | null,
): Promise<boolean> {
  return (
    renderedScopeMatchesOperation(operation, scope) &&
    (await stagedSessionMatches(operation))
  );
}

/**
 * Recoverable failure target for the connect chain: sealed operation hints
 * when available, sanitized form hints otherwise. Navigation only — the hints
 * never carry mutation authority.
 */
function failureTarget(
  form: FormData | null,
  sealed?: AuthOperation | null,
): string {
  const provider =
    (sealed?.intent === "link_provider"
      ? connectProviderFrom(sealed.targetProvider)
      : null) ?? connectProviderFrom(form?.get("targetProvider") ?? null);
  const returnTo =
    continuityReturnTo(sealed?.returnTo) ??
    continuityReturnTo(form?.get("returnTo") ?? null);
  return settingsLinkErrorTarget({ provider, returnTo });
}


/**
 * The complete rendered actor (account, user and both revisions) must match
 * the live request session before ANY mutation starts, and the same client
 * carries the operation to the backend. A stale form cannot mutate another
 * signed-in account even when passwords and revisions coincide.
 */
async function renderedActorMatchesLive(scope: RenderedOperationScope): Promise<boolean> {
  try {
    const claims = await readPrimaryBackendSessionClaims();
    const client = await authenticatedBackendClient();
    if (!claims || !client) return false;
    if (
      scope.accountId !== claims.backendAccountId ||
      scope.userId !== claims.backendUserId
    ) {
      return false;
    }
    const settings = await client.accountSettings();
    return (
      scope.accountRevision === settings.workspace.revision &&
      scope.userRevision === settings.user.revision
    );
  } catch {
    return false;
  }
}

export type LoginMethodActionState = {
  data?: AccountSettings;
  error?: string;
  saved?: boolean;
  passwordResult?: {
    ref: string;
    state: "editing" | "pending" | "applied" | "unknown" | "invalid";
  };
};

const failure = (error: unknown): LoginMethodActionState => {
  if (error instanceof TalentSignalHttpError) {
    if (error.status === 401) return { error: "登录已过期，请重新登录后继续。" };
    if (error.code === "STEP_UP_FAILED") return { error: "当前身份验证失败，请重试。" };
    if (error.code === "LAST_LOGIN_METHOD") return { error: "请先设置另一种登录方式，再解除这一个。" };
    if (error.code === "LOGIN_METHOD_CONFLICT") return { error: "这个提供方账号已连接到另一个 capri 账号，未做任何合并。" };
    if (error.code === "LOGIN_METHOD_EMAIL_CONFLICT") return { error: "这个提供方邮箱属于另一个账号，邮箱相同不会获得访问权限。" };
    if (error.code === "EMAIL_OWNERSHIP_UNRESOLVED") return { error: "这个邮箱存在历史冲突，请先通过核对流程解决，再设置密码。" };
    if (error.code === "CREDENTIAL_ATTEMPT_INVALID" || error.code === "CREDENTIAL_ATTEMPT_STALE") {
      return { error: "这次操作已过期或已变化。请刷新页面后重新开始。" };
    }
    return { error: "暂时无法确认这次更改的结果。请核对结果，再决定是否重新验证。" };
  }
  return { error: "网络不稳定，暂时无法确认更改是否生效。请恢复连接后核对结果，再决定是否重新验证。" };
};

/** Direct password-owner step-up: set or change the account password. */
export async function saveAccountPassword(
  _previous: LoginMethodActionState,
  form: FormData,
): Promise<LoginMethodActionState> {
  const currentPassword = String(form.get("currentPassword") ?? "");
  const newPassword = String(form.get("newPassword") ?? "");
  const hasPassword = form.get("hasPassword") === "true";
  const scope = renderedScopeFrom(form);
  if (newPassword.length < 8 || newPassword.length > 128) {
    return { error: "新密码至少 8 个字符。" };
  }
  if (!scope) return { error: "页面状态已过期。请刷新后重新开始。" };
  if (!(await renderedActorMatchesLive(scope))) {
    return { error: "登录账户已变化，这个表单已失效；当前账号没有被修改。请刷新后重新开始。" };
  }
  try {
    const attempt = await startLoginMethodChange({
      id: randomUUID(),
      intent: hasPassword ? "change_password" : "set_password",
      step_up: { kind: "password", password: currentPassword },
      expected_account_revision: scope.accountRevision,
      expected_user_revision: scope.userRevision,
    });
    const result = await completeLoginMethodChange({
      attempt_id: attempt.attempt_id,
      attempt_secret: attempt.attempt_secret,
      password: newPassword,
    });
    return { data: result.settings, saved: true };
  } catch (error) {
    return failure(error);
  }
}

/** Direct password-owner step-up: remove one sign-in method. */
export async function unlinkLoginMethod(
  _previous: LoginMethodActionState,
  form: FormData,
): Promise<LoginMethodActionState> {
  const provider = String(form.get("provider") ?? "");
  const currentPassword = String(form.get("currentPassword") ?? "");
  const scope = renderedScopeFrom(form);
  if (provider !== "apple" && provider !== "google" && provider !== "password") {
    return { error: "无法识别这个登录方式。" };
  }
  if (!scope) return { error: "页面状态已过期。请刷新后重新开始。" };
  if (!(await renderedActorMatchesLive(scope))) {
    return { error: "登录账户已变化，这个表单已失效；当前账号没有被修改。请刷新后重新开始。" };
  }
  try {
    const attempt = await startLoginMethodChange({
      id: randomUUID(),
      intent: "unlink_provider",
      provider,
      step_up: { kind: "password", password: currentPassword },
      expected_account_revision: scope.accountRevision,
      expected_user_revision: scope.userRevision,
    });
    const result = await completeLoginMethodChange({
      attempt_id: attempt.attempt_id,
      attempt_secret: attempt.attempt_secret,
    });
    return { data: result.settings, saved: true };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Start a staged operation for provider-only accounts (or OAuth linking):
 * reauthenticate with a currently linked provider first; the requested
 * credential change completes on the fixed same-origin route afterwards. The
 * new password, if any, is collected after reauthentication and never travels
 * through redirects, URLs, or cookies.
 */
export async function startProviderReauth(form: FormData): Promise<void> {
  const intent = String(form.get("intent") ?? "") as StagedIntent;
  const reauthProvider = String(form.get("reauthProvider") ?? "");
  const targetProvider = String(form.get("targetProvider") ?? "");
  const unlinkProvider = String(form.get("unlinkProvider") ?? "");
  if (
    (reauthProvider !== "apple" && reauthProvider !== "google") ||
    !["set_password", "change_password", "unlink_provider", "link_provider", "verify_identity", "verify_duplicate_identity"].includes(intent)
  ) {
    redirect(failureTarget(form));
  }
  try {
    const claims = await readPrimaryBackendSessionClaims();
    const client = await authenticatedBackendClient();
    if (!claims || !client) redirect(failureTarget(form));
    const settings = await client.accountSettings();
    const scope = renderedScopeFrom(form);
    if (
      !scope ||
      scope.accountId !== claims.backendAccountId ||
      scope.userId !== claims.backendUserId ||
      scope.accountRevision !== settings.workspace.revision ||
      scope.userRevision !== settings.user.revision
    ) {
      // The rendered authorization no longer matches live settings: a change
      // landed after the form was shown. Fail closed instead of widening it.
      redirect(failureTarget(form));
    }
    // The challenge label is fixed here by immutable purpose: recovery proofs
    // are consumed under the reconciliation label, account changes under the
    // account label. Consumption never reinterprets it.
    const clientLabel =
      intent === "verify_identity" || intent === "verify_duplicate_identity"
        ? "talent-signal-reconciliation"
        : "talent-signal-web";
    const challenge =
      reauthProvider === "google"
        ? await client.createGoogleLoginChallenge({ client_label: clientLabel })
        : await client.createAppleLoginChallenge({ client_label: clientLabel });
    const recoveryIntent = intent === "verify_identity" || intent === "verify_duplicate_identity";
    const stagedOperation: AuthOperation = recoveryIntent
      ? recoveryOperationFor(
          (await readAuthOperation())?.roleChallenges ? await readAuthOperation() : null,
          {
            intent: "verify_identity",
            reauthProvider: reauthProvider as "apple" | "google",
            reauthChallengeId: challenge.challenge_id,
            clientLabel,
            accountId: claims.backendAccountId,
            userId: claims.backendUserId,
            sessionFingerprint: sessionFingerprint(claims),
            accountRevision: scope.accountRevision,
            userRevision: scope.userRevision,
          },
          intent === "verify_identity" ? "current" : "duplicate",
          challenge.challenge_id,
        )
      : {
      ref: randomUUID(),
      intent,
      reauthProvider: reauthProvider as "apple" | "google",
      reauthChallengeId: challenge.challenge_id,
      clientLabel,
      accountId: claims.backendAccountId,
      userId: claims.backendUserId,
      sessionFingerprint: sessionFingerprint(claims),
      accountRevision: settings.workspace.revision,
      userRevision: settings.user.revision,
      step: "awaiting-reauth",
      createdAt: new Date().toISOString(),
      // GET-141: the original safe callback continues after a verified link;
      // only the sanitized same-origin target is sealed, never a token.
      ...(intent === "link_provider" && continuityReturnTo(form.get("returnTo"))
        ? { returnTo: continuityReturnTo(form.get("returnTo"))! }
        : {}),
      ...(intent === "link_provider" && (targetProvider === "apple" || targetProvider === "google")
        ? { targetProvider: targetProvider as "apple" | "google" }
        : {}),
      ...(intent === "unlink_provider" &&
      (unlinkProvider === "apple" || unlinkProvider === "google" || unlinkProvider === "password")
        ? { unlinkProvider: unlinkProvider as "apple" | "google" | "password" }
        : {}),
    };
    await sealAuthOperation(stagedOperation, reauthProvider === "apple");
    // The explicit sealed round names THIS role, provider, challenge and
    // purpose; the callback routes exactly this round.
    const roundRole: "current" | "duplicate" =
      intent === "verify_duplicate_identity" ? "duplicate" : "current";
    await sealAuthRound(
      {
        roundRef: randomUUID(),
        flowRef: stagedOperation.ref,
        role: roundRole,
        provider: reauthProvider as "apple" | "google",
        challengeId: challenge.challenge_id,
        purpose: "reauth",
        createdAt: stagedOperation.createdAt,
        expiresAt: flowExpiresAt(stagedOperation),
      },
      reauthProvider === "apple",
    );
    const url = await signIn(reauthProvider as "apple" | "google", {
      redirect: false,
      redirectTo: LINK_COMPLETE_PATH,
    });
    const nonce = createHash("sha256").update(challenge.nonce).digest("hex");
    redirect(
      reauthProvider === "google"
        ? await bindGoogleNonce(url, nonce)
        : await bindAppleNonce(url, nonce),
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
    const sealed = await readAuthOperation();
    await clearStagedAuth();
    redirect(failureTarget(form, sealed));
  }
}

/**
 * Seal the explicit TARGET round for one provider binding, shared by the
 * password-first and provider-first paths.
 */
async function sealTargetRound(input: {
  operationRef: string;
  provider: "apple" | "google";
  challengeId: string;
  createdAt: string;
  crossSite: boolean;
}): Promise<void> {
  await sealAuthRound(
    {
      roundRef: randomUUID(),
      flowRef: input.operationRef,
      role: "target",
      provider: input.provider,
      challengeId: input.challengeId,
      purpose: "target",
      createdAt: input.createdAt,
      expiresAt: flowExpiresAt({ createdAt: input.createdAt }),
    },
    input.crossSite,
  );
}

/**
 * The exact original session must still be the caller's session; a sibling
 * session on the same account can never consume the staged operation.
 */
async function stagedSessionMatches(operation: AuthOperation | null): Promise<boolean> {
  const claims = await readPrimaryBackendSessionClaims();
  return Boolean(
    operation &&
      claims &&
      sessionFingerprint(claims) === operation.sessionFingerprint,
  );
}

/**
 * Password-owner step-up followed by the NEW provider's own proof: the chain
 * is two distinct purposes, and the new password or provider token never
 * travels through redirects, URLs, or page state.
 */
export async function startPasswordStepUpLink(
  _previous: LoginMethodActionState,
  form: FormData,
): Promise<LoginMethodActionState> {
  const currentPassword = String(form.get("currentPassword") ?? "");
  const targetProvider = String(form.get("targetProvider") ?? "");
  const returnTo = continuityReturnTo(form.get("returnTo"));
  if (targetProvider !== "apple" && targetProvider !== "google") {
    redirect(failureTarget(form));
  }
  try {
    const claims = await readPrimaryBackendSessionClaims();
    const client = await authenticatedBackendClient();
    if (!claims || !client) redirect(failureTarget(form));
    const settings = await client.accountSettings();
    const scope = renderedScopeFrom(form);
    if (
      !scope ||
      scope.accountId !== claims.backendAccountId ||
      scope.userId !== claims.backendUserId ||
      scope.accountRevision !== settings.workspace.revision ||
      scope.userRevision !== settings.user.revision
    ) {
      redirect(failureTarget(form));
    }
    // Purpose one: prove the current identity with the account password.
    const attempt = await startLoginMethodChange({
      id: randomUUID(),
      intent: "link_provider",
      provider: targetProvider,
      step_up: { kind: "password", password: currentPassword },
      expected_account_revision: scope.accountRevision,
      expected_user_revision: scope.userRevision,
    });
    const challenge = attempt.provider_challenge;
    if (!challenge) redirect(failureTarget(form));
    // Purpose two: the new provider's proof, collected on its own round trip.
    const stagedOperationRef = randomUUID();
    const stagedOperationCreatedAt = new Date().toISOString();
    await sealAuthOperation(
      {
        ref: stagedOperationRef,
        intent: "link_provider",
        reauthProvider: targetProvider,
        reauthChallengeId: challenge.challenge_id,
        clientLabel: "talent-signal-web",
        targetProvider,
        accountId: claims.backendAccountId,
        userId: claims.backendUserId,
        sessionFingerprint: sessionFingerprint(claims),
        accountRevision: scope.accountRevision,
        userRevision: scope.userRevision,
        step: "awaiting-target",
        ...(returnTo ? { returnTo } : {}),
        attempt: {
          attempt_id: attempt.attempt_id,
          attempt_secret: attempt.attempt_secret,
          challenge_id: challenge.challenge_id,
          challenge_nonce: challenge.nonce,
        },
        createdAt: stagedOperationCreatedAt,
      },
      targetProvider === "apple",
    );
    // The explicit target round is sealed BEFORE signIn: the callback only
    // routes a sealed round. This is the same constructor continueTargetLink
    // uses, so password-first and provider-first binding share one path.
    await sealTargetRound({
      operationRef: stagedOperationRef,
      provider: targetProvider,
      challengeId: challenge.challenge_id,
      createdAt: stagedOperationCreatedAt,
      crossSite: targetProvider === "apple",
    });
    const url = await signIn(targetProvider, {
      redirect: false,
      redirectTo: LINK_COMPLETE_PATH,
    });
    const nonce = createHash("sha256").update(challenge.nonce).digest("hex");
    redirect(
      targetProvider === "google"
        ? await bindGoogleNonce(url, nonce)
        : await bindAppleNonce(url, nonce),
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
    const sealed = await readAuthOperation();
    await clearStagedAuth();
    redirect(failureTarget(form, sealed));
  }
}

/** Both primary and effective identities must still own the original session. */
async function stagedPasswordAuthority(
  operation: AuthOperation | null,
  scope: RenderedOperationScope | null,
): Promise<boolean> {
  if (!operation?.attempt || !flowIsLive(operation) ||
    (operation.intent !== "set_password" && operation.intent !== "change_password") ||
    !renderedScopeMatchesOperation(operation, scope)) return false;
  try {
    const primary = await readPrimaryBackendSessionClaims();
    const effective = await readBackendSessionClaims();
    return [primary, effective].every((claims) => Boolean(
      claims && claims.backendAccountId === operation.accountId &&
      claims.backendUserId === operation.userId &&
      sessionFingerprint(claims) === operation.sessionFingerprint,
    ));
  } catch {
    return false;
  }
}

/** Same imported action serves save and read-only check; previous UI is no authority. */
export async function completeStagedPassword(
  previous: LoginMethodActionState,
  form: FormData,
): Promise<LoginMethodActionState> {
  // Request metadata affects presentation only. All authority stays inside
  // the same bound operation check; fetch responses never navigate over B.
  const nativeSave = !(await headers()).has("next-action") &&
    (form.get("passwordMode") ?? "save") === "save";
  const result = await performStagedPassword(previous, form);
  const outcome = result.passwordResult;
  if (nativeSave && outcome &&
    (outcome.state === "applied" || outcome.state === "unknown" || outcome.state === "pending")) {
    // Framework redirect is outside the mutation catch. A received native
    // response becomes GET; total response loss still needs explicit recovery.
    redirect(`/workspace/settings/link-complete/password?result=${encodeURIComponent(outcome.ref)}`);
  }
  return result;
}

async function performStagedPassword(
  _previous: LoginMethodActionState,
  form: FormData,
): Promise<LoginMethodActionState> {
  const scope = renderedScopeFrom(form);
  // Echo only an opaque operation UUID, never arbitrary submitted text.
  const submittedRef = String(form.get("operationRef") ?? "");
  const ref = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(submittedRef)
    ? submittedRef : "";
  const state = (kind: NonNullable<LoginMethodActionState["passwordResult"]>["state"]): LoginMethodActionState => ({
    passwordResult: { ref, state: kind },
    ...(kind === "applied" ? { saved: true } : {}),
  });
  const invalid = () => state("invalid");
  const unknown = () => state("unknown");
  const operation = await readAuthOperation();
  if (!ref || !(await stagedPasswordAuthority(operation, scope)) || !operation?.attempt ||
    (operation.intent !== "set_password" && operation.intent !== "change_password")) return invalid();
  const attempt = operation.attempt;
  const mode = form.get("passwordMode") ?? "save";
  if (mode === "check") {
    try {
      const result = await readLoginMethodChangeResult({
        attempt_id: attempt.attempt_id, attempt_secret: attempt.attempt_secret,
        intent: operation.intent,
      });
      if (result.attempt_id !== attempt.attempt_id || result.intent !== operation.intent) return unknown();
      if (result.state === "applied") {
        if (result.account_id !== operation.accountId || result.user_id !== operation.userId ||
          result.revision_before !== operation.accountRevision ||
          result.revision_after !== operation.accountRevision + 1) return unknown();
        return state("applied");
      }
      if (result.state === "invalid") return invalid();
      if (result.state === "pending") return state("pending");
      return unknown();
    } catch {
      return unknown();
    }
  }
  if (mode !== "save") return invalid();
  const newPassword = String(form.get("newPassword") ?? "");
  if (newPassword.length < 8 || newPassword.length > 128) {
    // Only this correlated, pre-dispatch rejection can reopen the editor.
    return state("editing");
  }
  // Preserve the original bounded context. Late responses cannot clear B's
  // cookies or refresh A's lifetime; consumed grants remain one-use.
  try {
    const result = await completeLoginMethodChange({
      attempt_id: attempt.attempt_id, attempt_secret: attempt.attempt_secret,
      password: newPassword,
    });
    if (result.status !== "password_set" ||
      result.settings.workspace.id !== operation.accountId ||
      result.settings.user.id !== operation.userId ||
      result.settings.workspace.revision !== operation.accountRevision + 1) return unknown();
    return state("applied");
  } catch {
    return unknown();
  }
}

/** Finish a staged unlink directly after reauthentication. */
export async function completeStagedUnlink(form: FormData): Promise<void> {
  const operation = await readAuthOperation();
  const attempt = operation?.attempt;
  const scope = renderedScopeFrom(form);
  if (
    !operation ||
    !attempt ||
    operation.intent !== "unlink_provider" ||
    !(await stagedScopeMatches(operation, scope))
  ) {
    redirect("/workspace/settings?section=account&link=error");
  }
  try {
    await completeLoginMethodChange({
      attempt_id: attempt.attempt_id,
      attempt_secret: attempt.attempt_secret,
    });
    await clearStagedAuth();
  } catch {
    await clearStagedAuth();
    redirect("/workspace/settings?section=account&link=error");
  }
  // Next's success redirect throws control flow; it is not a failed mutation.
  redirect("/workspace/settings?section=account&link=done");
}

/**
 * Continue the staged linking operation with the NEW provider's own proof.
 * The nonce is bound to the credential attempt's provider challenge minted at
 * reauthentication; the attempt secret stays sealed server-side.
 */
export async function continueTargetLink(form: FormData): Promise<void> {
  const operation = await readAuthOperation();
  const attempt = operation?.attempt;
  const scope = renderedScopeFrom(form);
  if (
    !operation ||
    !attempt ||
    operation.step !== "awaiting-target" ||
    !operation.targetProvider ||
    !(await stagedScopeMatches(operation, scope))
  ) {
    redirect(failureTarget(form, operation));
  }
  try {
    await sealTargetRound({
      operationRef: operation.ref,
      provider: operation.targetProvider,
      challengeId: attempt.challenge_id,
      createdAt: operation.createdAt,
      crossSite: operation.targetProvider === "apple",
    });
    const url = await signIn(operation.targetProvider, {
      redirect: false,
      redirectTo: LINK_COMPLETE_PATH,
    });
    const nonce = createHash("sha256").update(attempt.challenge_nonce).digest("hex");
    redirect(
      operation.targetProvider === "google"
        ? await bindGoogleNonce(url, nonce)
        : await bindAppleNonce(url, nonce),
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      String((error as { digest?: unknown }).digest).startsWith("NEXT_REDIRECT")
    ) {
      throw error;
    }
    await clearStagedAuth();
    redirect(failureTarget(form, operation));
  }
}

/**
 * The DUPLICATE account's own provider proof for conflict recovery: its own
 * purpose, challenge and staged proof, distinct from the current identity's
 * step-up. The provider round trip never becomes an ordinary sign-in.
 */
export async function startDuplicateProof(form: FormData): Promise<void> {
  const provider = String(form.get("duplicateProvider") ?? "");
  const next = new FormData();
  next.set("intent", "verify_duplicate_identity");
  next.set("reauthProvider", provider);
  for (const field of ["accountId", "userId", "accountRevision", "userRevision"] as const) {
    next.set(field, String(form.get(field) ?? ""));
  }
  await startProviderReauth(next);
}
