import "server-only";

import { createHash } from "node:crypto";

import { cookies, headers } from "next/headers";
import { decode, encode } from "next-auth/jwt";

import { authCookieSecure } from "@/lib/auth-cookie-policy";
import { authSecret } from "@/lib/server/backendAuth";

/**
 * Bounded staged authentication operations (ADR 0018, "Web reauthentication
 * without a password").
 *
 * A provider-only account reauthenticates with a currently linked provider,
 * then completes the requested credential operation on a fixed same-origin
 * route where the ordinary session is available again. Apple returns by
 * cross-site form POST, so the transient operation cookie is deliberately
 * `Secure; SameSite=None` there while the long-lived session cookie keeps its
 * existing policy. Proofs are staged sealed and one-use; only opaque
 * references ever appear in URLs, and no raw token or credential enters page
 * state. A missing, stale, cancelled or wrong-purpose attempt fails closed and
 * never falls through to ordinary login.
 */

export const AUTH_OPERATION_COOKIE = "talent-signal.auth-operation";
export const AUTH_PROOF_COOKIE = "talent-signal.auth-proof";
/** Independent slot for the DUPLICATE account's recovery proof. */
export const AUTH_DUP_PROOF_COOKIE = "talent-signal.auth-duplicate-proof";
/**
 * The EXPLICIT active OAuth round. A round names exactly one role, provider,
 * challenge and purpose; the callback routes the round it validates and never
 * guesses from provider equality or slot emptiness.
 */
export const AUTH_ROUND_COOKIE = "talent-signal.auth-round";
export const LINK_COMPLETE_PATH = "/workspace/settings/link-complete";
export const AUTH_OPERATION_TTL_SECONDS = 600;
export const AUTH_PROOF_TTL_SECONDS = 300;

export type StagedIntent =
  | "set_password"
  | "change_password"
  | "unlink_provider"
  | "link_provider"
  // Pure current-identity reauthentication whose staged proof is consumed by
  // the authenticated conflict-recovery flow (provider-only accounts).
  | "verify_identity"
  // The DUPLICATE account's own provider proof for conflict recovery; it is a
  // distinct purpose from the current identity's step-up.
  | "verify_duplicate_identity";

export type AuthOperation = {
  ref: string;
  intent: StagedIntent;
  /** Provider that will prove the CURRENT identity (linked today). */
  reauthProvider: "apple" | "google";
  /** Backend challenge bound to the reauthentication OAuth round trip. */
  reauthChallengeId: string;
  /**
   * Immutable purpose label for the backend challenge. Recovery proofs are
   * consumed under `talent-signal-reconciliation`; account credential changes
   * use `talent-signal-web`. The label is fixed at creation and never inferred
   * at consumption.
   */
  clientLabel: string;
  /** Provider being connected, for link_provider only. */
  targetProvider?: "apple" | "google";
  /** Provider being removed, for unlink_provider only. */
  unlinkProvider?: "apple" | "google" | "password";
  accountId: string;
  userId: string;
  /** One-way fingerprint of the original backend session token. */
  sessionFingerprint: string;
  accountRevision: number;
  userRevision: number;
  step: "awaiting-reauth" | "awaiting-target";
  /**
   * Recovery role challenges: the current identity and the duplicate identity
   * each keep their own challenge/nonce. A second round never overwrites the
   * first role's authority.
   */
  roleChallenges?: {
    current?: { provider: "apple" | "google"; challengeId: string };
    duplicate?: { provider: "apple" | "google"; challengeId: string };
  };
  /** Sealed backend attempt minted after reauthentication (server only). */
  attempt?: {
    attempt_id: string;
    attempt_secret: string;
    challenge_id: string;
    challenge_nonce: string;
  };
  /**
   * Optional same-origin navigation hint (GET-141): where the user may
   * continue after this operation completes. Minimal navigation state only;
   * never a token, never authority. Sanitized at seal and at use.
   */
  returnTo?: string;
  createdAt: string;
};

export type StagedProof = {
  ref: string;
  /** The round this proof completed (never inferred later). */
  roundRef?: string;
  purpose: "reauth" | "target";
  provider: "apple" | "google";
  challengeId: string;
  identityToken: string;
  stagedAt: string;
};

export type StagedRoundRole = "current" | "duplicate" | "target";

export type AuthRound = {
  roundRef: string;
  flowRef: string;
  role: StagedRoundRole;
  provider: "apple" | "google";
  challengeId: string;
  purpose: "reauth" | "target";
  createdAt: string;
  /** Absolute expiry: never extended by a later round or seal. */
  expiresAt: string;
};

/** Absolute flow expiry: the frozen creation time plus the fixed TTL. */
export function flowExpiresAt(operation: Pick<AuthOperation, "createdAt">): string {
  return new Date(
    Date.parse(operation.createdAt) + AUTH_OPERATION_TTL_SECONDS * 1000,
  ).toISOString();
}

export function flowIsLive(
  operation: Pick<AuthOperation, "createdAt"> | null,
  now = Date.now(),
): boolean {
  if (!operation) return false;
  const created = Date.parse(operation.createdAt);
  return Number.isFinite(created) && created + AUTH_OPERATION_TTL_SECONDS * 1000 > now;
}

/** Cookie lifetime is only the REMAINING flow TTL. */
function remainingFlowSeconds(createdAt: string, now = Date.now()): number {
  return Math.max(
    1,
    Math.floor((Date.parse(createdAt) + AUTH_OPERATION_TTL_SECONDS * 1000 - now) / 1000),
  );
}

export type ProviderReturnDecision =
  | { kind: "stage"; operation: AuthOperation }
  | { kind: "ordinary" }
  | { kind: "fail-closed" };

/**
 * Pure policy for an OAuth provider return. An operation that is present must
 * match the returning provider and its current step; a return addressed to the
 * completion route without a live operation fails closed instead of silently
 * signing in or creating an account.
 */
export function resolveProviderReturn(input: {
  operation: AuthOperation | null;
  round: AuthRound | null;
  provider: "apple" | "google";
  callbackPath: string | null;
  now?: number;
}): ProviderReturnDecision {
  const now = input.now ?? Date.parse(new Date().toISOString());
  const addressedToCompletion = input.callbackPath === LINK_COMPLETE_PATH;
  const operation = input.operation;
  const round = input.round;
  if (!operation) {
    return addressedToCompletion || round ? { kind: "fail-closed" } : { kind: "ordinary" };
  }
  if (!flowIsLive(operation, now)) {
    return { kind: "fail-closed" };
  }
  // The explicit round is the only authority for this return: it names the
  // role, provider, challenge and purpose. A missing, foreign, expired or
  // wrong-provider round fails closed instead of guessing.
  if (
    !round ||
    round.flowRef !== operation.ref ||
    round.provider !== input.provider ||
    !Number.isFinite(Date.parse(round.expiresAt)) ||
    Date.parse(round.expiresAt) <= now
  ) {
    return { kind: "fail-closed" };
  }
  return { kind: "stage", operation };
}

/**
 * Recovery proofs are validated against the FLOW's own frozen role challenges
 * (both rounds' provider+challenge survive the flow), the absolute flow
 * lifetime, and proof age. The active-round cookie may already describe the
 * other role's round; a proof is never re-derived from it.
 */
export function validateRecoveryProof(
  input: {
    operation: AuthOperation | null;
    proof: StagedProof | null;
    role: "current" | "duplicate";
    now?: number;
  },
): StagedProof | null {
  const now = input.now ?? Date.parse(new Date().toISOString());
  const { operation, proof } = input;
  if (!operation || !proof || !flowIsLive(operation, now)) return null;
  const expected = operation.roleChallenges?.[input.role];
  if (
    !expected ||
    proof.ref !== operation.ref ||
    proof.purpose !== "reauth" ||
    proof.provider !== expected.provider ||
    proof.challengeId !== expected.challengeId ||
    !proof.roundRef
  ) {
    return null;
  }
  const stagedAt = Date.parse(proof.stagedAt);
  if (
    !Number.isFinite(stagedAt) ||
    stagedAt > now + 5_000 ||
    now - stagedAt > AUTH_PROOF_TTL_SECONDS * 1_000
  ) {
    return null;
  }
  return proof;
}

export type RoundValidation = {
  operation: AuthOperation;
  round: AuthRound;
};

/**
 * A staged proof may only be consumed with the exact round that produced it:
 * same round ref, flow ref, role, provider, challenge and purpose, freshly
 * staged and inside the frozen flow lifetime. Tampering any of these is
 * rejected before any backend consumption.
 */
export function validateStagedProof(
  input: {
    operation: AuthOperation | null;
    round: AuthRound | null;
    proof: StagedProof | null;
    role: StagedRoundRole;
    now?: number;
  },
): RoundValidation | null {
  const now = input.now ?? Date.parse(new Date().toISOString());
  const { operation, round, proof } = input;
  if (!operation || !round || !proof) return null;
  if (
    !flowIsLive(operation, now) ||
    round.flowRef !== operation.ref ||
    proof.ref !== operation.ref ||
    proof.roundRef !== round.roundRef ||
    proof.provider !== round.provider ||
    proof.challengeId !== round.challengeId ||
    proof.purpose !== round.purpose
  ) {
    return null;
  }
  if (input.role !== round.role) return null;
  const stagedAt = Date.parse(proof.stagedAt);
  if (
    !Number.isFinite(stagedAt) ||
    stagedAt > now + 5_000 ||
    now - stagedAt > AUTH_PROOF_TTL_SECONDS * 1_000
  ) {
    return null;
  }
  return { operation, round };
}

export function sealedCookieOptions(crossSite: boolean) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: (crossSite ? "none" : "lax") as "none" | "lax",
    secure: crossSite ? true : authCookieSecure(),
    maxAge: AUTH_OPERATION_TTL_SECONDS,
  };
}

export async function sealAuthOperation(
  operation: AuthOperation,
  crossSite: boolean,
): Promise<void> {
  const ttl = remainingFlowSeconds(operation.createdAt);
  const value = await encode({
    secret: authSecret(),
    salt: AUTH_OPERATION_COOKIE,
    maxAge: ttl,
    token: operation,
  });
  (await cookies()).set(AUTH_OPERATION_COOKIE, value, {
    ...sealedCookieOptions(crossSite),
    maxAge: ttl,
  });
}

/** Seal the explicit active OAuth round for exactly one role/purpose. */
export async function sealAuthRound(round: AuthRound, crossSite: boolean): Promise<void> {
  const ttl = remainingFlowSeconds(round.createdAt);
  const value = await encode({
    secret: authSecret(),
    salt: AUTH_ROUND_COOKIE,
    maxAge: ttl,
    token: round,
  });
  (await cookies()).set(AUTH_ROUND_COOKIE, value, {
    ...sealedCookieOptions(crossSite),
    maxAge: ttl,
  });
}

export async function readAuthRound(): Promise<AuthRound | null> {
  const jar = await cookies();
  const value = jar.get(AUTH_ROUND_COOKIE)?.value;
  try {
    const round = value
      ? await decode({ token: value, secret: authSecret(), salt: AUTH_ROUND_COOKIE })
      : null;
    if (!round || typeof round.roundRef !== "string" || typeof round.flowRef !== "string") {
      return null;
    }
    return round as unknown as AuthRound;
  } catch {
    return null;
  }
}

export async function clearAuthRound(): Promise<void> {
  (await cookies()).delete(AUTH_ROUND_COOKIE);
}

export async function readAuthOperation(): Promise<AuthOperation | null> {
  const jar = await cookies();
  const value = jar.get(AUTH_OPERATION_COOKIE)?.value;
  try {
    const operation = value
      ? await decode({ token: value, secret: authSecret(), salt: AUTH_OPERATION_COOKIE })
      : null;
    if (!operation || typeof operation.ref !== "string") return null;
    return operation as unknown as AuthOperation;
  } catch {
    return null;
  }
}

/**
 * Stage one provider proof after the callback. The proof cookie is set in the
 * (possibly cross-site POST) response but only ever sent on later same-site
 * top-level navigations, where the ordinary session is available again.
 */
export type StagedProofRole = "current" | "duplicate";

function proofCookie(role: StagedProofRole): string {
  return role === "duplicate" ? AUTH_DUP_PROOF_COOKIE : AUTH_PROOF_COOKIE;
}

/**
 * Stage one provider proof into its own role slot. Current-identity and
 * duplicate-identity proofs are independent: one round never replaces the
 * other's authority.
 */
export async function sealAuthProof(
  proof: StagedProof,
  role: StagedProofRole = "current",
): Promise<void> {
  const name = proofCookie(role);
  const value = await encode({
    secret: authSecret(),
    salt: name,
    maxAge: AUTH_PROOF_TTL_SECONDS,
    token: proof,
  });
  (await cookies()).set(name, value, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: authCookieSecure(),
    maxAge: AUTH_PROOF_TTL_SECONDS,
  });
}

export async function readAuthProof(
  role: StagedProofRole = "current",
): Promise<StagedProof | null> {
  const jar = await cookies();
  const name = proofCookie(role);
  const value = jar.get(name)?.value;
  try {
    const proof = value
      ? await decode({ token: value, secret: authSecret(), salt: name })
      : null;
    if (!proof || typeof proof.ref !== "string") return null;
    return proof as unknown as StagedProof;
  } catch {
    // Tampered or cross-slot sealed bytes fail closed.
    return null;
  }
}

export async function clearStagedAuth(): Promise<void> {
  const jar = await cookies();
  jar.delete(AUTH_OPERATION_COOKIE);
  jar.delete(AUTH_PROOF_COOKIE);
  jar.delete(AUTH_DUP_PROOF_COOKIE);
  jar.delete(AUTH_ROUND_COOKIE);
}

/** The callback target sealed by Auth.js, used to detect operation returns. */
export async function readCallbackPath(): Promise<string | null> {
  const jar = await cookies();
  const value =
    jar.get("talent-signal.callback-url")?.value ??
    jar.get("authjs.callback-url")?.value;
  if (!value) return null;
  try {
    const url = new URL(value, "http://localhost");
    return url.pathname;
  } catch {
    return null;
  }
}

export async function requestIsCrossSiteAppleReturn(): Promise<boolean> {
  const requestHeaders = await headers();
  return (requestHeaders.get("origin") ?? "") === "https://appleid.apple.com";
}

export type RenderedOperationScope = {
  operationRef?: string;
  accountId: string;
  userId: string;
  accountRevision: number;
  userRevision: number;
};

/**
 * Non-secret rendered scope carried by forms: the account/user IDs and
 * revisions the form was rendered for, and for staged forms the operation ref.
 * Server-only secrets never enter form fields.
 */
/**
 * A recovery round trip reuses the ONE immutable recovery operation for its
 * scope: same ref, actor, session fingerprint, revisions and expiry. The
 * second proof round can never refresh the first authority.
 */
export function recoveryOperationFor(
  existing: AuthOperation | null,
  input: Omit<AuthOperation, "ref" | "createdAt" | "roleChallenges" | "step">,
  role: "current" | "duplicate",
  challengeId: string,
  now = new Date().toISOString(),
): AuthOperation {
  const frozen =
    existing &&
    existing.ref &&
    existing.roleChallenges &&
    existing.accountId === input.accountId &&
    existing.userId === input.userId &&
    existing.sessionFingerprint === input.sessionFingerprint &&
    Date.parse(existing.createdAt) + AUTH_OPERATION_TTL_SECONDS * 1000 > Date.parse(now)
      ? existing
      : null;
  const base: AuthOperation = frozen ?? {
    ...input,
    step: "awaiting-reauth",
    roleChallenges: {},
    ref: input.sessionFingerprint.slice(0, 8) + "-" + now.slice(0, 10) + "-" + Math.random().toString(16).slice(2, 10),
    createdAt: now,
  };
  return {
    ...base,
    step: "awaiting-reauth",
    roleChallenges: {
      ...(base.roleChallenges ?? {}),
      [role]: { provider: input.reauthProvider, challengeId },
    },
  };
}

export function renderedScopeFrom(form: FormData): RenderedOperationScope | null {
  const accountId = String(form.get("accountId") ?? "");
  const userId = String(form.get("userId") ?? "");
  const accountRevision = Number(form.get("accountRevision"));
  const userRevision = Number(form.get("userRevision"));
  const operationRef = String(form.get("operationRef") ?? "") || undefined;
  if (
    !accountId ||
    !userId ||
    !Number.isInteger(accountRevision) ||
    !Number.isInteger(userRevision) ||
    accountRevision < 1 ||
    userRevision < 1
  ) {
    return null;
  }
  return { operationRef, accountId, userId, accountRevision, userRevision };
}

/**
 * A stale form can never target a newer operation or another account: the
 * rendered scope must match the sealed operation exactly (ref, account, user
 * and the revisions the authorization was rendered against).
 */
export function renderedScopeMatchesOperation(
  operation: AuthOperation | null,
  scope: RenderedOperationScope | null,
): boolean {
  if (!operation || !scope) return false;
  if (scope.operationRef !== operation.ref) return false;
  return (
    scope.accountId === operation.accountId &&
    scope.userId === operation.userId &&
    scope.accountRevision === operation.accountRevision &&
    scope.userRevision === operation.userRevision
  );
}

/**
 * One-way session fingerprint: the exact original session must still be the
 * caller's session at every stage, without any raw bearer token appearing in
 * URLs or page state.
 */
export function sessionFingerprint(backendAccessToken: string): string {
  return createHash("sha256").update(backendAccessToken).digest("hex");
}

/** Small opaque reference for URLs; never contains a token or credential. */
export function operationReference(operation: AuthOperation): string {
  return operation.ref;
}
