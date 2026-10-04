import "server-only";

/**
 * Private one-use Web handoff entry and the canonical capir test banner
 * source.
 *
 * - The exchange posts the one-use secret to the backend ONLY through the
 *   server-side trusted Web consumer key; no token ever appears in a URL.
 * - Before any session is installed, the exchanged session is read back
 *   against the canonical live operator-owned run (`GET /v1/capir/test-session`)
 *   and must match the exact account, user and username with state `ready`,
 *   a live expiry and the expected preset seed counts. Expired, rotated,
 *   revoked, replayed, malformed or foreign entries fail closed without any
 *   real-account fallback.
 * - The banner derives from the same canonical run readback for every login
 *   method (direct password login and private handoff alike); it is never
 *   inferred from a cookie, an account name or a client-side flag.
 */
import {
  CapirTestHandoffExchangeResponseSchema,
  CapirTestProvisioningClient,
  CapirTestRunSchema,
  TalentSignalClient,
  TalentSignalHttpError,
  type CapirTestRun,
  type SessionResponse,
} from "@talent-signal/contracts";

import { matchesTypeBox } from "@/lib/typebox-validation";
import {
  backendAuthBaseUrl,
  type BackendSessionClaims,
} from "@/lib/server/backendAuth";

const HANDOFF_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRESET_COUNTS = {
  daily: { contacts: 12, observations: 30, tasks: 4 },
  empty: { contacts: 0, observations: 0, tasks: 0 },
} as const;

export type CapirTestPresetId = keyof typeof PRESET_COUNTS;

export interface CapirTestBannerData {
  run: CapirTestRun;
  sessionState: "active" | "revoked";
  datasetState: "ready" | "error";
  counts: { contacts: number; observations: number; tasks: number };
  expectedCounts: { contacts: number; observations: number; tasks: number };
  expiresAt: string;
}

function fail(status: number, code: string, message: string): never {
  throw new TalentSignalHttpError(status, code, message, null);
}

export function presetExpectedCounts(preset: string) {
  return preset === "empty" ? { ...PRESET_COUNTS.empty } : { ...PRESET_COUNTS.daily };
}

/**
 * The exact configured Web origin of this deployment. Every private entry
 * exchange is bound to it; a mismatch is refused before any backend call.
 */
export function configuredCapirTestWebOrigin(): string {
  const configured = process.env.CAPIR_TEST_WEB_ORIGIN?.trim();
  if (!configured) {
    fail(503, "CAPIR_TEST_ENTRY_UNAVAILABLE", "Private test entry is not configured on this deployment.");
  }
  return configured;
}

export function assertTrustedWebOrigin(requestOrigin: string | null): void {
  const expected = configuredCapirTestWebOrigin();
  if (!requestOrigin || requestOrigin !== expected) {
    fail(403, "CAPIR_TEST_ORIGIN_DENIED", "This entry request does not come from the exact configured origin.");
  }
}

export function verifyCapirTestRun(
  value: unknown,
  identity: { accountId: string; userId: string; username: string | null },
  options: { requireCompleteDataset?: boolean } = {},
): { ok: boolean; run?: CapirTestRun; reason?: string } {
  if (!matchesTypeBox(CapirTestRunSchema, value)) {
    return { ok: false, reason: "the run projection does not match the capir-test.v1 contract" };
  }
  const run = value as CapirTestRun;
  const normalize = (handle: string) => handle.trim().toLowerCase();
  const expected = run.preset === "empty" ? PRESET_COUNTS.empty : PRESET_COUNTS.daily;
  const countsMatch =
    run.counts.contacts === expected.contacts &&
    run.counts.observations === expected.observations &&
    run.counts.tasks === expected.tasks;
  const digestValid = /^[a-f0-9]{64}$/.test(run.preset_digest);
  const active = run.state === "ready" && Date.parse(run.expires_at) > Date.now();
  const identityMatches =
    run.account_id === identity.accountId &&
    run.user_id === identity.userId &&
    normalize(run.username) === normalize(identity.username ?? "");
  if (!active) return { ok: false, reason: "the run is not a live ready run" };
  if (!identityMatches) return { ok: false, reason: "the run does not belong to this exact account and user" };
  if (options.requireCompleteDataset !== false && !countsMatch) {
    return { ok: false, reason: "the run dataset is partially seeded" };
  }
  if (!digestValid || !run.preset_version) {
    return { ok: false, reason: "the run preset provenance is missing" };
  }
  return { ok: true, run };
}

function safeHandoffFailure(error: unknown): never {
  if (error instanceof TalentSignalHttpError) {
    // Never print untrusted response bodies: only a typed status and a fixed
    // local message leave this boundary.
    fail(error.status, "CAPIR_TEST_HANDOFF_FAILED", "The one-use test handoff could not be exchanged.");
  }
  fail(502, "CAPIR_TEST_HANDOFF_FAILED", "The one-use test handoff could not be exchanged.");
}

/**
 * Private POST exchange of a one-use handoff secret. Returns the exact target
 * test session and its canonical run only after every verification holds:
 * the canonical readback run must match the requested nonsecret target run id,
 * the exchanged run id, and the exact account, user and username.
 */
export async function exchangeCapirTestHandoff(input: {
  handoffSecret: string;
  requestOrigin: string | null;
  expectedRunId?: string;
}): Promise<{ claims: BackendSessionClaims; run: CapirTestRun; entryPath: string; runId: string }> {
  assertTrustedWebOrigin(input.requestOrigin);
  if (!HANDOFF_SECRET_PATTERN.test(input.handoffSecret ?? "")) {
    fail(400, "CAPIR_TEST_HANDOFF_INVALID", "The handoff secret is malformed.");
  }
  if (input.expectedRunId !== undefined && !UUID_PATTERN.test(input.expectedRunId)) {
    fail(400, "CAPIR_TEST_HANDOFF_INVALID", "The expected run id is malformed.");
  }
  const webOrigin = configuredCapirTestWebOrigin();
  const client = new CapirTestProvisioningClient(backendAuthBaseUrl(), {
    backendOrigin: process.env.CAPIR_TEST_BACKEND_ORIGIN?.trim() || backendAuthBaseUrl(),
  });
  let exchanged;
  try {
    exchanged = await client.exchangeHandoff(process.env.CAPIR_TEST_WEB_CONSUMER_KEY?.trim() ?? "", {
      handoff_secret: input.handoffSecret,
      web_origin: webOrigin,
    });
  } catch (error) {
    return safeHandoffFailure(error);
  }
  if (!matchesTypeBox(CapirTestHandoffExchangeResponseSchema, exchanged)) {
    fail(502, "CAPIR_TEST_HANDOFF_INVALID", "The exchanged handoff did not match the capir-test.v1 contract.");
  }
  const session = exchanged.session as SessionResponse;

  // Canonical live identity readback before any cookie exists: the banner and
  // the installed session must agree on the exact run.
  const readback = new TalentSignalClient(backendAuthBaseUrl(), session.access_token);
  let runValue: unknown;
  try {
    runValue = await readback.currentCapirTestRun();
  } catch {
    fail(403, "CAPIR_TEST_ENTRY_DENIED", "This entry does not resolve to a live canonical test run.");
  }
  const identity = {
    accountId: session.account.id,
    userId: session.user.id,
    username: session.user.username,
  };
  const verified = verifyCapirTestRun(runValue, identity);
  const verifiedRun = verified.run;
  const targetMatches =
    verifiedRun !== undefined &&
    verifiedRun.id === exchanged.run_id &&
    (input.expectedRunId === undefined || verifiedRun.id === input.expectedRunId);
  if (!verified.ok || !verifiedRun || !targetMatches) {
    fail(403, "CAPIR_TEST_ENTRY_DENIED", "This entry does not resolve to the exact live canonical test run.");
  }
  return {
    claims: {
      backendAccessToken: session.access_token,
      backendAccountId: session.account.id,
      backendAccountName: session.account.name,
      backendAccountSlug: session.account.slug,
      backendExpiresAt: session.expires_at,
      backendRole: session.user.role,
      backendUserId: session.user.id,
      backendUsername: session.user.username,
    },
    run: verifiedRun,
    entryPath: exchanged.entry_path,
    runId: exchanged.run_id,
  };
}

/**
 * Clamp the private session cookie lifetime to the backend session and run
 * deadlines: no cookie authority survives its run.
 */
export function clampedSessionMaxAgeSeconds(input: {
  sessionExpiresAt: string;
  runExpiresAt: string;
  now?: number;
  ceilingSeconds?: number;
}): number {
  const now = input.now ?? Date.now();
  const ceiling = (input.ceilingSeconds ?? 60 * 60 * 8) * 1000;
  const remaining = Math.min(
    ceiling,
    Date.parse(input.sessionExpiresAt) - now,
    Date.parse(input.runExpiresAt) - now,
  );
  return Number.isFinite(remaining) ? Math.max(0, Math.floor(remaining / 1000)) : 0;
}

/**
 * Canonical banner source for any live session (direct password login and
 * private handoff alike). Returns null without fallback whenever the session
 * does not resolve to its exact live operator-owned run.
 */
export async function loadCapirTestBanner(
  claims: BackendSessionClaims,
): Promise<CapirTestBannerData | null> {
  const client = new TalentSignalClient(backendAuthBaseUrl(), claims.backendAccessToken);
  let runValue: unknown;
  try {
    runValue = await client.currentCapirTestRun();
  } catch {
    return null;
  }
  const verified = verifyCapirTestRun(
    runValue,
    {
      accountId: claims.backendAccountId,
      userId: claims.backendUserId,
      username: claims.backendUsername,
    },
    { requireCompleteDataset: false },
  );
  if (!verified.ok) return null;
  const run = verified.run;
  if (!run) return null;
  const expectedCounts = presetExpectedCounts(run.preset);
  const countsMatch =
    run.counts.contacts === expectedCounts.contacts &&
    run.counts.observations === expectedCounts.observations &&
    run.counts.tasks === expectedCounts.tasks;
  return {
    run,
    sessionState: "active",
    datasetState: countsMatch ? "ready" : "error",
    counts: { ...run.counts },
    expectedCounts,
    expiresAt: run.expires_at,
  };
}
