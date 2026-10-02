import { randomUUID } from "node:crypto";

import {
  maskIdentityHandle,
  normalizeIdentityHandle,
  type IdentityHandleHint,
  type IdentityHandleType,
} from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";

import { inTransaction } from "../database/pool.js";
import { ApiError } from "../lib/apiError.js";
import { appendAudit } from "../lib/audit.js";
import { sha256 } from "../lib/hash.js";

type IdentityHandleStatus =
  | "proposed"
  | "confirmed"
  | "expired"
  | "revoked"
  | "deleted";

type IdentityValidityBasis =
  | "policy_default"
  | "human_override"
  | "legacy_migration";

interface IdentityHandleRow {
  account_id: string;
  id: string;
  subject_id: string;
  handle_type: IdentityHandleType;
  display_hint: string | null;
  source_resource_id: string | null;
  status: IdentityHandleStatus;
  valid_from: Date;
  valid_until: Date | null;
  freshness_policy_version: string;
  validity_basis: IdentityValidityBasis;
  validity_override_reason: string | null;
  relationship_context_id?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

interface FreshnessPolicy {
  defaultValidityDays: Record<IdentityHandleType, number>;
  maxOverrideDays: number;
  version: string;
}

interface FreshnessPolicyRow {
  max_override_days: number;
  policy_document: unknown;
  version: string;
}

function policyDocument(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return typeof parsed === "object" && parsed !== null
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

async function loadFreshnessPolicy(
  client: PoolClient,
  at: Date,
): Promise<FreshnessPolicy> {
  const result = await client.query<FreshnessPolicyRow>(
    `SELECT version, policy_document, max_override_days
     FROM identity_handle_freshness_policies
     WHERE effective_from <= $1
       AND (effective_until IS NULL OR effective_until > $1)
     ORDER BY effective_from DESC, version DESC
     LIMIT 1`,
    [at],
  );
  const row = result.rows[0];
  const document = policyDocument(row?.policy_document);
  const defaults = policyDocument(
    document?.default_validity_days,
  );
  const handleTypes: IdentityHandleType[] = [
    "email",
    "phone",
    "wechat",
    "linkedin_url",
    "public_profile_url",
    "source_native_id",
  ];
  if (
    !row ||
    !defaults ||
    !Number.isInteger(row.max_override_days) ||
    row.max_override_days <= 0 ||
    handleTypes.some((type) => {
      const days = defaults[type];
      return (
        typeof days !== "number" ||
        !Number.isInteger(days) ||
        days <= 0 ||
        days > row.max_override_days
      );
    })
  ) {
    throw new ApiError(
      503,
      "IDENTITY_FRESHNESS_POLICY_UNAVAILABLE",
      "No valid identity freshness policy is available for this confirmation time.",
    );
  }
  return {
    defaultValidityDays:
      defaults as Record<IdentityHandleType, number>,
    maxOverrideDays: row.max_override_days,
    version: row.version,
  };
}

function validityFor(
  handle: IdentityHandleHint,
  confirmedAt: Date,
  policy: FreshnessPolicy,
): {
  basis: Exclude<IdentityValidityBasis, "legacy_migration">;
  overrideReason: string | null;
  policyVersion: string;
  validUntil: Date;
} {
  const overrideReason =
    handle.validity_override_reason?.trim() || null;
  if (handle.valid_until && !overrideReason) {
    throw new ApiError(
      422,
      "IDENTITY_HANDLE_VALIDITY_OVERRIDE_REASON_REQUIRED",
      "A custom identity review deadline requires a visible human review reason.",
    );
  }
  if (!handle.valid_until && overrideReason) {
    throw new ApiError(
      422,
      "IDENTITY_HANDLE_VALIDITY_OVERRIDE_WITHOUT_DEADLINE",
      "An identity review override reason requires a custom deadline.",
    );
  }
  const basis = handle.valid_until
    ? "human_override"
    : "policy_default";
  const validUntil = new Date(
    handle.valid_until ??
      confirmedAt.getTime() +
        policy.defaultValidityDays[handle.type] * DAY_MS,
  );
  if (
    !Number.isFinite(validUntil.getTime()) ||
    validUntil <= confirmedAt ||
    validUntil.getTime() - confirmedAt.getTime() >
      policy.maxOverrideDays * DAY_MS
  ) {
    throw new ApiError(
      422,
      "IDENTITY_HANDLE_VALIDITY_INVALID",
      `A confirmed identity clue must be reviewed again within ${policy.maxOverrideDays} days and cannot already be expired.`,
    );
  }
  return {
    basis,
    overrideReason,
    policyVersion: policy.version,
    validUntil,
  };
}

async function recordLifecycleEvent(
  client: PoolClient,
  input: {
    accountId: string;
    actorKind: "human" | "system";
    actorUserId: string | null;
    eventType: "confirmed" | "reconfirmed" | "expired";
    handleId: string;
    personId: string;
    priorStatus: IdentityHandleStatus | null;
    reason: string;
    sourceResourceId: string | null;
    status: IdentityHandleStatus;
    validFrom: Date;
    validUntil: Date | null;
    freshnessPolicyVersion: string;
    validityBasis: IdentityValidityBasis;
    validityOverrideReason: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO identity_handle_lifecycle_events(
       id, account_id, identity_handle_id, subject_id,
       source_resource_id, actor_user_id, actor_kind, event_type,
       prior_status, status, reason, valid_from, valid_until,
       freshness_policy_version, validity_basis, validity_override_reason
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
       $14, $15, $16
     )`,
    [
      randomUUID(),
      input.accountId,
      input.handleId,
      input.personId,
      input.sourceResourceId,
      input.actorUserId,
      input.actorKind,
      input.eventType,
      input.priorStatus,
      input.status,
      input.reason,
      input.validFrom,
      input.validUntil,
      input.freshnessPolicyVersion,
      input.validityBasis,
      input.validityOverrideReason,
    ],
  );
}

async function expireHandle(
  client: PoolClient,
  input: {
    accountId: string;
    expiredAt: Date;
    handle: IdentityHandleRow;
  },
): Promise<boolean> {
  const expired = await client.query<{ id: string }>(
    `UPDATE identity_handles
     SET status = 'expired',
         version = version + 1,
         updated_at = $3
     WHERE account_id = $1
       AND id = $2
       AND status = 'confirmed'
       AND valid_until IS NOT NULL
       AND valid_until <= $3
     RETURNING id`,
    [input.accountId, input.handle.id, input.expiredAt],
  );
  if (!expired.rows[0]) {
    return false;
  }
  await recordLifecycleEvent(client, {
    accountId: input.accountId,
    actorKind: "system",
    actorUserId: null,
    eventType: "expired",
    handleId: input.handle.id,
    personId: input.handle.subject_id,
    priorStatus: "confirmed",
    reason:
      "The confirmed identity clue reached its independent freshness deadline.",
    sourceResourceId: input.handle.source_resource_id,
    status: "expired",
    validFrom: input.handle.valid_from,
    validUntil: input.handle.valid_until,
    freshnessPolicyVersion:
      input.handle.freshness_policy_version,
    validityBasis: input.handle.validity_basis,
    validityOverrideReason:
      input.handle.validity_override_reason,
  });
  await appendAudit(
    client,
    { accountId: input.accountId, actorUserId: null },
    "identity.handle_expired",
    "identity_handle",
    input.handle.id,
    {
      display_hint: input.handle.display_hint,
      handle_type: input.handle.handle_type,
      person_id: input.handle.subject_id,
      relationship_context_id:
        input.handle.relationship_context_id ?? null,
      source_resource_id: input.handle.source_resource_id,
      valid_until: input.handle.valid_until?.toISOString() ?? null,
      freshness_policy_version:
        input.handle.freshness_policy_version,
      validity_basis: input.handle.validity_basis,
      validity_override_reason:
        input.handle.validity_override_reason,
    },
  );
  return true;
}

export async function sweepDueIdentityHandles(
  pool: Pool,
  now = new Date(),
): Promise<string[]> {
  return inTransaction(pool, async (client) => {
    const due = await client.query<IdentityHandleRow>(
      `SELECT
         handles.account_id,
         handles.id,
         handles.subject_id,
         handles.handle_type,
         handles.display_hint,
         handles.source_resource_id,
         handles.status,
         handles.valid_from,
         handles.valid_until,
         handles.freshness_policy_version,
         handles.validity_basis,
         handles.validity_override_reason,
         captures.assignment_id AS relationship_context_id
       FROM identity_handles handles
       LEFT JOIN source_resources resources
         ON resources.account_id = handles.account_id
        AND resources.id = handles.source_resource_id
       LEFT JOIN captures
         ON captures.account_id = resources.account_id
        AND captures.id = resources.capture_id
       WHERE handles.status = 'confirmed'
         AND handles.valid_until IS NOT NULL
         AND handles.valid_until <= $1
       ORDER BY handles.valid_until, handles.id
       LIMIT 500
       FOR UPDATE OF handles SKIP LOCKED`,
      [now],
    );
    const expiredIds: string[] = [];
    for (const handle of due.rows) {
      if (
        await expireHandle(client, {
          accountId: handle.account_id,
          expiredAt: now,
          handle,
        })
      ) {
        expiredIds.push(handle.id);
      }
    }
    return expiredIds;
  });
}

export async function confirmIdentityHandles(
  client: PoolClient,
  input: {
    accountId: string;
    confirmedAt?: Date;
    confirmedByUserId: string;
    handles: IdentityHandleHint[];
    personId: string;
    relationshipContextId: string;
    sourceResourceId: string;
  },
): Promise<number> {
  let confirmed = 0;
  const seen = new Set<string>();
  const confirmedAt = input.confirmedAt ?? new Date();
  const freshnessPolicy = await loadFreshnessPolicy(
    client,
    confirmedAt,
  );
  for (const handle of input.handles) {
    const normalized = normalizeIdentityHandle(handle.type, handle.value);
    const displayHint = maskIdentityHandle(handle.type, handle.value);
    if (!normalized || !displayHint) {
      throw new ApiError(
        422,
        "IDENTITY_HANDLE_INVALID",
        `The supplied ${handle.type} identity clue is invalid.`,
      );
    }
    const validity = validityFor(
      handle,
      confirmedAt,
      freshnessPolicy,
    );
    const valueHash = sha256(normalized);
    const key = `${handle.type}:${valueHash}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const existing = await client.query<IdentityHandleRow>(
      `SELECT
         account_id, id, subject_id, handle_type, display_hint,
         source_resource_id, status, valid_from, valid_until,
         freshness_policy_version, validity_basis,
         validity_override_reason
       FROM identity_handles
       WHERE account_id = $1
         AND handle_type = $2
         AND normalized_value_hash = $3
         AND status <> 'deleted'
       ORDER BY
         CASE WHEN status = 'confirmed' THEN 0 ELSE 1 END,
         CASE WHEN subject_id = $4 THEN 0 ELSE 1 END,
         updated_at DESC,
         id
       FOR UPDATE`,
      [input.accountId, handle.type, valueHash, input.personId],
    );
    for (const row of existing.rows) {
      if (
        row.status === "confirmed" &&
        row.valid_until &&
        row.valid_until <= confirmedAt
      ) {
        await expireHandle(client, {
          accountId: input.accountId,
          expiredAt: confirmedAt,
          handle: row,
        });
        row.status = "expired";
      }
    }
    const activeOwner = existing.rows.find(
      (row) => row.status === "confirmed",
    );
    if (activeOwner && activeOwner.subject_id !== input.personId) {
      throw new ApiError(
        409,
        "IDENTITY_HANDLE_CONFIRMED_ELSEWHERE",
        `This confirmed ${handle.type} identity clue already belongs to another person in this account.`,
        { handle_type: handle.type },
      );
    }
    if (
      activeOwner &&
      activeOwner.subject_id === input.personId &&
      activeOwner.source_resource_id === input.sourceResourceId
    ) {
      continue;
    }

    const reusable = existing.rows.find(
      (row) =>
        row.subject_id === input.personId &&
        row.status !== "confirmed",
    );
    const eventType = reusable || activeOwner
      ? "reconfirmed"
      : "confirmed";
    const handleId = reusable?.id ?? activeOwner?.id ?? randomUUID();
    const priorStatus = reusable?.status ?? activeOwner?.status ?? null;
    if (reusable || activeOwner) {
      await client.query(
        `UPDATE identity_handles
         SET status = 'confirmed',
             source_resource_id = $3,
             display_hint = $4,
             confirmed_by_user_id = $5,
             valid_from = $6,
             valid_until = $7,
             freshness_policy_version = $8,
             validity_basis = $9,
             validity_override_reason = $10,
             deleted_at = NULL,
             version = version + 1,
             updated_at = $6
         WHERE account_id = $1 AND id = $2`,
        [
          input.accountId,
          handleId,
          input.sourceResourceId,
          displayHint,
          input.confirmedByUserId,
          confirmedAt,
          validity.validUntil,
          validity.policyVersion,
          validity.basis,
          validity.overrideReason,
        ],
      );
    } else {
      await client.query(
        `INSERT INTO identity_handles(
           id, account_id, subject_id, handle_type,
           normalized_value_hash, display_hint, source_resource_id,
           status, valid_from, valid_until, confirmed_by_user_id,
           freshness_policy_version, validity_basis,
           validity_override_reason
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, 'confirmed', $8, $9, $10,
           $11, $12, $13
         )`,
        [
          handleId,
          input.accountId,
          input.personId,
          handle.type,
          valueHash,
          displayHint,
          input.sourceResourceId,
          confirmedAt,
          validity.validUntil,
          input.confirmedByUserId,
          validity.policyVersion,
          validity.basis,
          validity.overrideReason,
        ],
      );
    }
    await recordLifecycleEvent(client, {
      accountId: input.accountId,
      actorKind: "human",
      actorUserId: input.confirmedByUserId,
      eventType,
      handleId,
      personId: input.personId,
      priorStatus,
      reason:
        eventType === "confirmed"
          ? "The user confirmed a source-linked identity clue."
          : "The user supplied a fresh governed source and reconfirmed this identity clue.",
      sourceResourceId: input.sourceResourceId,
      status: "confirmed",
      validFrom: confirmedAt,
      validUntil: validity.validUntil,
      freshnessPolicyVersion: validity.policyVersion,
      validityBasis: validity.basis,
      validityOverrideReason: validity.overrideReason,
    });
    await appendAudit(
      client,
      {
        accountId: input.accountId,
        actorUserId: input.confirmedByUserId,
      },
      eventType === "confirmed"
        ? "identity.handle_confirmed"
        : "identity.handle_reconfirmed",
      "identity_handle",
      handleId,
      {
        display_hint: displayHint,
        handle_type: handle.type,
        person_id: input.personId,
        relationship_context_id: input.relationshipContextId,
        source_resource_id: input.sourceResourceId,
        valid_until: validity.validUntil.toISOString(),
        freshness_policy_version: validity.policyVersion,
        validity_basis: validity.basis,
        validity_override_reason: validity.overrideReason,
      },
    );
    confirmed += 1;
  }
  return confirmed;
}
