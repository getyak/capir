import { Type, type Static } from "@sinclair/typebox";

import { CONTRACT_VERSION } from "./constants.js";

/**
 * Weekly usage metadata for the signed-in account member.
 *
 * The count is metadata aggregated from retained product run records only:
 * unique admitted run identifiers in the current ISO week (Asia/Shanghai).
 * It exposes no run content and never claims to be a billing ledger or an
 * enforced quota.
 */
export const WEEKLY_USAGE_SCHEMA_VERSION = "workspace-weekly-usage.v1" as const;

/** The weekly window is defined in Asia/Shanghai (ISO week, Monday 00:00). */
export const WEEKLY_USAGE_TIMEZONE = "Asia/Shanghai" as const;

export const WeeklyUsageWindowSchema = Type.Object(
  {
    /** Inclusive start of the current ISO week in the display timezone. */
    start: Type.String(),
    /** Exclusive end of the current ISO week (next Monday 00:00). */
    end: Type.String(),
    timezone: Type.Literal(WEEKLY_USAGE_TIMEZONE),
  },
  { additionalProperties: false },
);

export const WeeklyUsageResponseSchema = Type.Object(
  {
    contract_version: Type.Literal(CONTRACT_VERSION),
    schema_version: Type.Literal(WEEKLY_USAGE_SCHEMA_VERSION),
    window: WeeklyUsageWindowSchema,
    /** Unique retained product run IDs recorded in the window. */
    count: Type.Integer({ minimum: 0 }),
    /** Configurable weekly reference allowance; a reference value, not a limit. */
    allowance: Type.Integer({ minimum: 1 }),
    computed_at: Type.String(),
  },
  { additionalProperties: false },
);

export type WeeklyUsageWindow = Static<typeof WeeklyUsageWindowSchema>;
export type WeeklyUsageResponse = Static<typeof WeeklyUsageResponseSchema>;
