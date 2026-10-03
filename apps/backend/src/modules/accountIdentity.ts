import { randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { ApiError } from "../lib/apiError.js";
import { sha256 } from "../lib/hash.js";

/**
 * Normalized-email ownership discipline for real accounts (ADR 0018).
 *
 * One shared trim/lowercase normalization rule is used by every provider.
 * Gmail dots, plus tags, and distinct domains are not collapsed and Apple relay
 * addresses are never rewritten. Provider identity remains
 * `(provider, verified issuer/subject)`; an email match is a collision to
 * resolve, never authority over an existing account.
 */

export type RealUserKind = "password_human" | "google_human" | "apple_human";
export const REAL_USER_KINDS: readonly RealUserKind[] = [
  "password_human",
  "google_human",
  "apple_human",
];

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type EmailProvenance = {
  /** e.g. "provider:google", "provider:apple", "password_signup". */
  source: string;
  verifiedAt: Date;
};

/**
 * Claim a VERIFIED secondary email for an existing canonical account/user
 * (ADR 0018, "Verified secondary emails"). The exact normalized address is
 * reserved under the same email lock and uniqueness arbitration as
 * registration: the same owner's existing claim is idempotent, while another
 * owner or an unresolved historical conflict fails closed. The primary email
 * is never changed and an unknown subject is never linked from an email.
 */
export async function reserveVerifiedEmail(
  client: PoolClient,
  email: string,
  owner: { accountId: string; userId: string },
  provenance: EmailProvenance,
  claimKind: "primary" | "secondary" = "secondary",
): Promise<"claimed" | "idempotent"> {
  const normalized = normalizeEmail(email);
  if (!normalized || normalized.length > 320) {
    throw new ApiError(400, "EMAIL_INVALID", "The email address is not valid.");
  }
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `account-email:${normalized}`,
  ]);
  const existing = await client.query<EmailReservation>(
    `SELECT normalized_email, state, account_id, user_id
     FROM account_email_reservations
     WHERE normalized_email = $1
     FOR UPDATE`,
    [normalized],
  );
  const reservation = existing.rows[0];
  if (reservation) {
    if (
      reservation.state === "owned" &&
      reservation.account_id === owner.accountId &&
      reservation.user_id === owner.userId
    ) {
      // Fill missing provenance once; an unchanged login must not invalidate
      // another device's prepared reconciliation by advancing the revision.
      await client.query(
        `UPDATE account_email_reservations
         SET verification_source = COALESCE(verification_source, $2),
             verified_at = COALESCE(verified_at, $3),
             revision = revision + 1,
             updated_at = now()
         WHERE normalized_email = $1
           AND (verification_source IS NULL OR verified_at IS NULL)`,
        [normalized, provenance.source, provenance.verifiedAt],
      );
      return "idempotent";
    }
    throw new EmailClaimConflict(
      reservation.state === "conflict" ? "conflict" : "owned",
      normalized,
    );
  }
  // No reservation row yet: a user row for that address belongs either to
  // this same owner (their primary email) or to someone else (never claim).
  const legacy = await client.query<{ id: string; account_id: string }>(
    `SELECT id, account_id FROM users WHERE lower(btrim(email)) = $1 LIMIT 2`,
    [normalized],
  );
  const sameOwner = legacy.rows.some(
    (row) =>
      row.id === owner.userId && row.account_id === owner.accountId,
  );
  if (legacy.rows.length > 0 && !sameOwner) {
    throw new EmailClaimConflict("legacy_owner", normalized);
  }
  const kind = sameOwner ? "primary" : claimKind;
  const claimed = await client.query(
    `INSERT INTO account_email_reservations(
       normalized_email, state, account_id, user_id,
       claim_kind, verification_source, verified_at
     ) VALUES ($1, 'owned', $2, $3, $4, $5, $6)
     ON CONFLICT (normalized_email) DO NOTHING`,
    [
      normalized,
      owner.accountId,
      owner.userId,
      kind,
      provenance.source,
      provenance.verifiedAt,
    ],
  );
  if (claimed.rowCount) return "claimed";
  // A concurrent claim won the insert; resolve under the same lock rules.
  const winner = await client.query<EmailReservation>(
    `SELECT normalized_email, state, account_id, user_id
     FROM account_email_reservations WHERE normalized_email = $1`,
    [normalized],
  );
  const row = winner.rows[0];
  if (
    row &&
    row.state === "owned" &&
    row.account_id === owner.accountId &&
    row.user_id === owner.userId
  ) {
    return "idempotent";
  }
  throw new EmailClaimConflict(row?.state === "conflict" ? "conflict" : "owned", normalized);
}

export type EmailReservation = {
  normalized_email: string;
  state: "owned" | "conflict";
  account_id: string | null;
  user_id: string | null;
};

export type EmailClaimConflictReason =
  | "owned"
  | "conflict"
  | "legacy_owner";

/** Raised when a normalized email cannot be claimed for a new account. */
export class EmailClaimConflict extends Error {
  constructor(
    readonly reason: EmailClaimConflictReason,
    readonly normalizedEmail: string,
  ) {
    super(`Email cannot be claimed for a new account (${reason}).`);
    this.name = "EmailClaimConflict";
  }
}

export async function readEmailReservation(
  client: Pick<Pool, "query"> | PoolClient,
  email: string,
): Promise<EmailReservation | null> {
  const result = await client.query<EmailReservation>(
    `SELECT normalized_email, state, account_id, user_id
     FROM account_email_reservations
     WHERE normalized_email = $1`,
    [normalizeEmail(email)],
  );
  return result.rows[0] ?? null;
}

/**
 * Claim the normalized email for exactly one real owner inside the caller's
 * transaction. The reservation primary key arbitrates concurrent password,
 * Google, and Apple registrations; the advisory lock serializes the legacy
 * `users` check with the claim so no ordering can create a second owner.
 */
export async function claimEmailReservation(
  client: PoolClient,
  email: string,
  owner: { accountId: string; userId: string },
): Promise<EmailReservation> {
  const normalized = normalizeEmail(email);
  if (!normalized || normalized.length > 320) {
    throw new ApiError(400, "EMAIL_INVALID", "The email address is not valid.");
  }
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `account-email:${normalized}`,
  ]);
  // Fixture and Lab identities keep their existing boundary: a synthetic row
  // still blocks a real claim (and vice versa) exactly as before this schema.
  const legacy = await client.query<{ id: string; kind: string }>(
    `SELECT id, kind FROM users WHERE lower(btrim(email)) = $1 LIMIT 1`,
    [normalized],
  );
  if (legacy.rows[0]) {
    throw new EmailClaimConflict("legacy_owner", normalized);
  }
  const claimed = await client.query<EmailReservation>(
    `INSERT INTO account_email_reservations(normalized_email, state, account_id, user_id)
     VALUES ($1, 'owned', $2, $3)
     ON CONFLICT (normalized_email) DO NOTHING
     RETURNING normalized_email, state, account_id, user_id`,
    [normalized, owner.accountId, owner.userId],
  );
  const reservation = claimed.rows[0];
  if (reservation) return reservation;
  const existing = await readEmailReservation(client, normalized);
  throw new EmailClaimConflict(
    existing?.state === "conflict" ? "conflict" : "owned",
    normalized,
  );
}

export function emailClaimConflictError(
  conflict: EmailClaimConflict,
  provider: "password" | "google" | "apple",
): ApiError {
  if (provider === "password") {
    // Public password signup never discloses whether an account exists.
    return new ApiError(
      409,
      "PASSWORD_ACCOUNT_EXISTS",
      "An account already uses that username or email.",
    );
  }
  return new ApiError(
    409,
    provider === "google"
      ? "GOOGLE_ACCOUNT_LINK_REQUIRED"
      : "APPLE_ACCOUNT_LINK_REQUIRED",
    "This email already has a workspace. Sign in with its existing method to preserve that account.",
  );
}

export type CreateRealIdentityInput = {
  accountId: string;
  userId: string;
  accountName: string;
  accountSlug: string;
  email: string;
  displayName: string;
  kind: RealUserKind;
  username?: string | null;
  emailVerifiedAt?: Date | null;
};

/**
 * Common transaction fence for governed writes (ADR 0018). Locks the existing
 * accounts row FOR SHARE, held through transaction commit, and verifies the
 * account is active. Reconciliation's FOR UPDATE therefore waits for this
 * write, and an already-retired account fails with ACCOUNT_RETIRED instead of
 * accepting late data.
 */
export async function assertAccountActive(
  client: Pick<Pool, "query"> | PoolClient,
  accountId: string,
): Promise<void> {
  const result = await client.query<{ retired_at: Date | null }>(
    `SELECT retired_at FROM accounts WHERE id = $1 FOR SHARE`,
    [accountId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ApiError(
      404,
      "ACCOUNT_NOT_FOUND",
      "This workspace account is not available.",
    );
  }
  if (row.retired_at !== null) {
    throw new ApiError(
      409,
      "ACCOUNT_RETIRED",
      "This account's sign-in methods were transferred to your canonical account. Nothing was written here.",
    );
  }
}

/**
 * Create the workspace, user, and normalized-email reservation of a new real
 * account in one transaction. The reservation insert and the users trigger
 * enforce the same uniqueness rule regardless of the registering provider.
 */
export async function createRealIdentity(
  client: PoolClient,
  input: CreateRealIdentityInput,
): Promise<void> {
  // The reservation claim arbitrates provider races; a conflict rolls the
  // whole transaction back before any account row can survive.
  await claimEmailReservation(client, input.email, {
    accountId: input.accountId,
    userId: input.userId,
  });
  await client.query(
    `INSERT INTO accounts(id, slug, name) VALUES ($1, $2, $3)`,
    [input.accountId, input.accountSlug, input.accountName],
  );
  await client.query(
    `INSERT INTO users(
       id, account_id, email, display_name, kind, username, email_verified_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.userId,
      input.accountId,
      normalizeEmail(input.email),
      input.displayName,
      input.kind,
      input.username ?? null,
      input.emailVerifiedAt ?? null,
    ],
  );
}

export type EmailOwnershipReport = {
  normalized_email: string;
  state: "owned" | "conflict" | "unreserved";
  reservation_count_hint: number;
};

/**
 * Authenticated recovery report for a historical same-email collision. It
 * explains the exact conflict to the affected owner and never merges or picks
 * an account automatically.
 */
export async function reportEmailOwnership(
  client: Pick<Pool, "query"> | PoolClient,
  email: string,
): Promise<EmailOwnershipReport> {
  const normalized = normalizeEmail(email);
  const reservation = await readEmailReservation(client, normalized);
  const owners = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM users
     WHERE lower(btrim(email)) = $1
       AND kind IN ('password_human', 'google_human', 'apple_human')`,
    [normalized],
  );
  return {
    normalized_email: normalized,
    state: reservation?.state ?? "unreserved",
    reservation_count_hint: Number(owners.rows[0]?.count ?? 0),
  };
}

/**
 * Baseline rows an "entirely empty duplicate" may still contain, validated
 * rather than ignored: exactly the expected sole user's login credentials and
 * login-management artifacts, the account's audit trail, and the system
 * harness generation baseline that every account owns. Anything else is
 * product data or unexplained association and blocks automatic transfer.
 */
export const EMPTY_DUPLICATE_IDENTITY_TABLES: ReadonlySet<string> = new Set([
  "account_access_events",
  "account_email_reservations",
  "account_reconciliation_requests",
  "credential_change_attempts",
]);

/** System-generated per-account baseline (one row per account, never user data). */
export const EMPTY_DUPLICATE_SYSTEM_TABLES: ReadonlySet<string> = new Set([
  "harness_source_generations",
]);
/** Tables whose rows must belong to the expected sole user (validated below). */
export const EMPTY_DUPLICATE_USER_BOUND_TABLES: ReadonlySet<string> = new Set([
  "auth_identities",
  "password_credentials",
  "account_access_events",
  "account_email_reservations",
  "account_reconciliation_requests",
  "credential_change_attempts",
  "desktop_browser_login_attempts",
  "retired_login_aliases",
  "sessions",
]);

/**
 * Tables whose `account_id` column is covered by a validated baseline row above
 * (or by the control-table checks). Every other `*_account_id` column in the
 * schema is indirect ownership and must reference zero rows.
 */
export const EMPTY_DUPLICATE_BASELINE_ACCOUNT_TABLES: ReadonlySet<string> = new Set([
  ...EMPTY_DUPLICATE_IDENTITY_TABLES,
  ...EMPTY_DUPLICATE_SYSTEM_TABLES,
  ...EMPTY_DUPLICATE_USER_BOUND_TABLES,
  "users",
  "sessions",
]);

export type AccountDataInventory = {
  account_id: string;
  expected_user_id: string;
  account_tables: Array<{
    table: string;
    rows: number;
    unexpected_rows: number;
    classification: "system_baseline" | "identity" | "product";
  }>;
  indirect_ownership: Array<{ table: string; column: string; rows: number }>;
  lab_workspace_links: Array<{ table: string; rows: number }>;
  control_tables: Array<{ table: string; rows: number; unexpected_rows: number }>;
  account_owner_user_id: string | null;
  unclassified_tables: string[];
  problems: string[];
  entirely_empty: boolean;
};

async function countRows(
  client: Pick<Pool, "query"> | PoolClient,
  table: string,
  accountId: string,
  column = "account_id",
): Promise<number> {
  const result = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM "${table}" WHERE "${column}" = $1`,
    [accountId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function countUserBoundRows(
  client: Pick<Pool, "query"> | PoolClient,
  table: string,
  accountId: string,
  expectedUserId: string,
  userColumn = "user_id",
): Promise<{ rows: number; unexpected: number }> {
  const result = await client.query<{ count: string; unexpected: string }>(
    `SELECT count(*)::text AS count,
            count(*) FILTER (WHERE "${userColumn}" IS DISTINCT FROM $2)::text AS unexpected
     FROM "${table}" WHERE account_id = $1`,
    [accountId, expectedUserId],
  );
  return {
    rows: Number(result.rows[0]?.count ?? 0),
    unexpected: Number(result.rows[0]?.unexpected ?? 0),
  };
}

/** User column per table for validated identity-baseline rows. */
const USER_COLUMNS: Record<string, string> = {
  auth_identities: "user_id",
  password_credentials: "user_id",
  account_access_events: "actor_user_id",
  account_email_reservations: "user_id",
  credential_change_attempts: "user_id",
  account_reconciliation_requests: "actor_user_id",
  desktop_browser_login_attempts: "user_id",
  retired_login_aliases: "user_id",
  sessions: "user_id",
};

export type ClassifyInventoryOptions = {
  /** The reconciliation request running this recheck; its own row is history
   * for every other operation but must not reject itself. */
  excludeReconciliationId?: string;
};

/**
 * Full classified account-data inventory for a duplicate account. Coverage is
 * complete by construction:
 * - every public table must be classified by the Lab manifest or the check
 *   fails closed;
 * - every account-scoped table is counted, not only People and sessions;
 * - baseline rows are validated against the expected sole user instead of
 *   being silently ignored (credentials must belong to exactly that user, and
 *   the system harness generation baseline may hold at most its one row);
 * - indirect ownership is swept through every `*_account_id` foreign key
 *   column, so differently named references (Lab workspace owner/target,
 *   retired-login canonical columns, reconciliation history) cannot hide;
 * - Lab workspace entries and media receipts are checked through their
 *   workspace links;
 * - `accounts.owner_user_id` must name the expected user or stay unset.
 *
 * Any extra user, product row, historical tombstone, association, or
 * unclassified table makes the account review-required. Nothing is deleted,
 * merged, or re-parented here.
 */
export async function classifyAccountDataInventory(
  client: Pick<Pool, "query"> | PoolClient,
  accountId: string,
  expectedUserId: string,
  options: ClassifyInventoryOptions = {},
): Promise<AccountDataInventory> {
  const problems: string[] = [];
  const manifest = await client.query<{ table_name: string; scope: string }>(
    `SELECT table_name, scope FROM lab_test_workspace_table_manifest`,
  );
  const classified = new Map(
    manifest.rows.map((row) => [row.table_name, row.scope]),
  );
  const tables = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  );
  const unclassified_tables = tables.rows
    .map((row) => row.table_name)
    .filter((name) => !classified.has(name))
    .sort();
  if (unclassified_tables.length) {
    problems.push(`unclassified_tables:${unclassified_tables.join(",")}`);
  }

  // The account and its expected sole personal user/membership baseline.
  const accountRow = await client.query<{ owner_user_id: string | null }>(
    `SELECT owner_user_id FROM accounts WHERE id = $1`,
    [accountId],
  );
  const account_owner_user_id = accountRow.rows[0]?.owner_user_id ?? null;
  if (!accountRow.rows[0]) problems.push("account_missing");
  if (account_owner_user_id && account_owner_user_id !== expectedUserId) {
    problems.push("unexpected_account_owner");
  }
  const usersRow = await client.query<{
    count: string;
    unexpected: string;
    kinds: string | null;
  }>(
    `SELECT count(*)::text AS count,
            count(*) FILTER (WHERE id IS DISTINCT FROM $2)::text AS unexpected,
            min(kind::text) AS kinds
     FROM users WHERE account_id = $1`,
    [accountId, expectedUserId],
  );
  const userCount = Number(usersRow.rows[0]?.count ?? 0);
  const unexpectedUsers = Number(usersRow.rows[0]?.unexpected ?? 0);
  if (userCount !== 1 || unexpectedUsers) {
    problems.push(`unexpected_users:${userCount}`);
  }
  const kind = usersRow.rows[0]?.kinds ?? null;
  if (kind && !REAL_USER_KINDS.includes(kind as RealUserKind)) {
    problems.push(`unexpected_user_kind:${kind}`);
  }

  const account_tables: AccountDataInventory["account_tables"] = [];
  for (const [name, scope] of [...classified.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (scope !== "account") continue;
    let rows: number;
    let unexpectedRows = 0;
    let classification: "system_baseline" | "identity" | "product";
    if (EMPTY_DUPLICATE_SYSTEM_TABLES.has(name)) {
      classification = "system_baseline";
      const baseline = await client.query<{ count: string; generation: string | null }>(
        `SELECT count(*)::text AS count, max(generation)::text AS generation
         FROM "${name}" WHERE account_id = $1`,
        [accountId],
      );
      rows = Number(baseline.rows[0]?.count ?? 0);
      const generation = Number(baseline.rows[0]?.generation ?? 0);
      // The baseline is exactly one untouched generation row. A bumped
      // generation records real source history and is not a baseline.
      if (rows !== 1 || generation !== 0) {
        unexpectedRows = rows;
        problems.push(`system_baseline_invalid:${name}:${rows}:${generation}`);
      }
    } else if (
      name === "retired_login_aliases" ||
      name === "account_reconciliation_requests"
    ) {
      // Login-retirement tombstones and reconciliation history are real
      // history for this account: never auto-transferred, provenance retained.
      classification = "identity";
      const counted = await countUserBoundRows(
        client,
        name,
        accountId,
        expectedUserId,
        USER_COLUMNS[name] ?? "user_id",
      );
      rows = counted.rows;
      unexpectedRows = counted.unexpected;
      if (unexpectedRows) problems.push(`foreign_identity_rows:${name}`);
      if (rows) problems.push(`${name}_history:${rows}`);
    } else if (
      EMPTY_DUPLICATE_IDENTITY_TABLES.has(name) ||
      EMPTY_DUPLICATE_USER_BOUND_TABLES.has(name)
    ) {
      classification = "identity";
      const counted = await countUserBoundRows(
        client,
        name,
        accountId,
        expectedUserId,
        USER_COLUMNS[name] ?? "user_id",
      );
      rows = counted.rows;
      unexpectedRows = counted.unexpected;
      if (unexpectedRows) problems.push(`foreign_identity_rows:${name}`);
    } else {
      classification = "product";
      rows = await countRows(client, name, accountId);
      if (rows) problems.push(`product_rows:${name}:${rows}`);
    }
    account_tables.push({
      table: name,
      rows,
      unexpected_rows: unexpectedRows,
      classification,
    });
  }

  const control_tables: AccountDataInventory["control_tables"] = [];
  for (const [name, userColumn] of [
    ["users", "id"],
    ["sessions", "user_id"],
  ] as const) {
    const counted = await countUserBoundRows(
      client,
      name,
      accountId,
      expectedUserId,
      userColumn,
    );
    control_tables.push({
      table: name,
      rows: counted.rows,
      unexpected_rows: counted.unexpected,
    });
    if (counted.unexpected) problems.push(`foreign_control_rows:${name}`);
  }

  // Indirect ownership: every foreign key-style account column anywhere in the
  // schema, excluding the validated baseline columns handled above.
  const indirectColumns = await client.query<{
    table_name: string;
    column_name: string;
  }>(
    `SELECT c.table_name, c.column_name
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
       AND c.column_name LIKE '%account_id'
     ORDER BY c.table_name, c.column_name`,
  );
  const indirect_ownership: AccountDataInventory["indirect_ownership"] = [];
  for (const column of indirectColumns.rows) {
    const baselineColumn =
      column.column_name === "account_id" &&
      EMPTY_DUPLICATE_BASELINE_ACCOUNT_TABLES.has(column.table_name);
    if (baselineColumn) continue;
    const rows = await countRows(
      client,
      column.table_name,
      accountId,
      column.column_name,
    );
    indirect_ownership.push({
      table: column.table_name,
      column: column.column_name,
      rows,
    });
    if (rows) {
      problems.push(
        `indirect_ownership:${column.table_name}.${column.column_name}:${rows}`,
      );
    }
  }

  // Coverage check: every table carrying a *_account_id column must carry the
  // retirement fence trigger, so unknown indirect ownership can never bypass
  // account retirement.
  const fenceCoverage = await client.query<{ table_name: string; fenced: string }>(
    `SELECT c.table_name,
            count(*) FILTER (
              WHERE g.tgname = 'account_retirement_fence'
                AND g.tgenabled IN ('O', 'A')
            )::text AS fenced
     FROM information_schema.columns c
     LEFT JOIN pg_trigger g
       ON g.tgrelid = to_regclass(format('%I.%I', 'public', c.table_name))
      AND NOT g.tgisinternal
     WHERE c.table_schema = 'public' AND c.column_name LIKE '%account_id'
       AND c.table_name <> 'accounts'
     GROUP BY c.table_name`,
  );
  for (const row of fenceCoverage.rows) {
    if (Number(row.fenced) < 1) {
      problems.push(`missing_retirement_fence:${row.table_name}`);
    }
  }
  if (options.excludeReconciliationId) {
    // The operation in progress cannot reject itself, while every other
    // reconciliation row stays visible in the inventory.
    const current = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM account_reconciliation_requests
       WHERE id = $1 AND duplicate_account_id = $2`,
      [options.excludeReconciliationId, accountId],
    );
    const selfRows = Number(current.rows[0]?.count ?? 0);
    if (selfRows) {
      const entry = indirect_ownership.find(
        (row) => row.table === "account_reconciliation_requests",
      );
      if (entry && entry.rows === selfRows) {
        entry.rows = 0;
        const index = problems.indexOf(
          `indirect_ownership:account_reconciliation_requests.duplicate_account_id:${selfRows}`,
        );
        if (index >= 0) problems.splice(index, 1);
      }
    }
  }

  // Lab workspace entries and media receipts are reached through their
  // workspace; any workspace row touching this account already failed the
  // indirect sweep, and the receipts stay visible in the reviewed inventory.
  const workspaceReceipts = await client.query<{
    workspaces: string;
    entries: string;
    media_writes: string;
  }>(
    `WITH linked AS (
       SELECT id FROM lab_test_workspaces
       WHERE owner_account_id = $1 OR target_account_id = $1
     )
     SELECT
       (SELECT count(*)::text FROM linked) AS workspaces,
       (SELECT count(*)::text FROM lab_test_workspace_entries e
         WHERE e.workspace_id IN (SELECT id FROM linked)) AS entries,
       (SELECT count(*)::text FROM lab_test_workspace_media_writes m
         WHERE m.workspace_id IN (SELECT id FROM linked)) AS media_writes`,
    [accountId],
  );
  const links = workspaceReceipts.rows[0];
  const lab_workspace_links: AccountDataInventory["lab_workspace_links"] = [
    { table: "lab_test_workspaces", rows: Number(links?.workspaces ?? 0) },
    { table: "lab_test_workspace_entries", rows: Number(links?.entries ?? 0) },
    {
      table: "lab_test_workspace_media_writes",
      rows: Number(links?.media_writes ?? 0),
    },
  ];
  if (Number(links?.workspaces ?? 0)) problems.push("lab_workspace_history");

  return {
    account_id: accountId,
    expected_user_id: expectedUserId,
    account_tables,
    indirect_ownership,
    lab_workspace_links,
    control_tables,
    account_owner_user_id,
    unclassified_tables,
    problems,
    entirely_empty: problems.length === 0,
  };
}

export function newAccountSlug(): string {
  return `personal-${randomUUID()}`;
}

export function providerSubjectHash(
  provider: "apple" | "google",
  issuer: string,
  subject: string,
): string {
  return sha256(`${issuer}:${subject}`);
}
