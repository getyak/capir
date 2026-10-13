import {
  CONTRACT_VERSION,
  normalizeIdentityHandle,
  parseIdentityHandleQuery,
  type IdentityHandleType,
  type PersonDirectoryIdentityMatch,
  type PersonDirectoryResponse,
  type PersonDetailResponse,
  type RelationshipContactPoint,
  type ReviewedContactBasicField,
  type RelationshipScope,
} from "@talent-signal/contracts";
import type { DatabaseClient } from "../database/pool.js";
import type { AuthContext } from "./auth.js";
import { ApiError } from "../lib/apiError.js";
import { sha256 } from "../lib/hash.js";

interface PersonDirectoryRow {
  id: string;
  display_label: string;
  context_count: number;
  capture_count: number;
  confirmed_identity_count: number;
  last_activity_at: Date;
  name_match: boolean;
  matched_handle_status: "confirmed" | "expired" | null;
  matched_handle_type: IdentityHandleType | null;
  matched_handle_hint: string | null;
  matched_handle_source_resource_id: string | null;
  matched_handle_valid_until: Date | null;
  profile_headline: string | null;
  profile_summary: string | null;
  profile_provenance_kind: "user_authored" | null;
  profile_authored_by_user_id: string | null;
  profile_revision: number | null;
  profile_updated_at: Date | null;
  public_profile_card_headline: string | null;
  public_profile_confirmed_by_user_id: string | null;
  public_profile_revision: number | null;
  public_profile_confirmed_at: Date | null;
  public_profile_url: string | null;
  public_profile_platform: string | null;
  public_profile_avatar_url: string | null;
  public_profile_use_avatar: boolean | null;
  public_profile_retrieved_at: Date | null;
  contexts: Array<{
    id: string;
    display_label: string;
    last_activity_at: string;
  }>;
}

/** One canonical parser shared by directory matching and the Memory host. */
export function peopleIdentityQuery(query: string) {
  const parsed = parseIdentityHandleQuery(query);
  const value = parsed && normalizeIdentityHandle(parsed.type, parsed.value);
  return parsed && value ? { type: parsed.type, value } : null;
}

async function queryPeople(
  pool: DatabaseClient,
  auth: AuthContext,
  query = "",
  includeConfirmedHandleMatch = false,
  exactPersonId: string | null = null,
): Promise<PersonDirectoryResponse> {
  const normalizedQuery = query.normalize("NFKC").trim().toLowerCase();
  const parsedHandle = includeConfirmedHandleMatch ? peopleIdentityQuery(query) : null;
  const normalizedHandle = parsedHandle?.value ?? null;
  const nameQuery = parsedHandle ? "" : normalizedQuery;
  const handleType = parsedHandle?.type ?? null;
  const handleHash = normalizedHandle ? sha256(normalizedHandle) : null;
  const result = await pool.query<PersonDirectoryRow>(
    `SELECT
       subjects.id,
       subjects.display_label,
       person_profiles.headline AS profile_headline,
       person_profiles.summary AS profile_summary,
       person_profiles.provenance_kind AS profile_provenance_kind,
       person_profiles.authored_by_user_id AS profile_authored_by_user_id,
       person_profiles.revision AS profile_revision,
       person_profiles.updated_at AS profile_updated_at,
       public_profiles.card_headline AS public_profile_card_headline,
       public_profiles.confirmed_by_user_id
         AS public_profile_confirmed_by_user_id,
       public_profiles.revision AS public_profile_revision,
       public_profiles.confirmed_at AS public_profile_confirmed_at,
       public_profiles.profile_url AS public_profile_url,
       public_profiles.platform AS public_profile_platform,
       public_profiles.avatar_url AS public_profile_avatar_url,
       public_profiles.use_avatar AS public_profile_use_avatar,
       public_profiles.retrieved_at AS public_profile_retrieved_at,
       ($2 <> '' AND lower(subjects.display_label) LIKE '%' || $2 || '%')
         AS name_match,
       matched_handle.handle_type AS matched_handle_type,
       matched_handle.match_status AS matched_handle_status,
       matched_handle.display_hint AS matched_handle_hint,
       matched_handle.source_resource_id
         AS matched_handle_source_resource_id,
       matched_handle.valid_until AS matched_handle_valid_until,
       (
         SELECT COUNT(*)::integer
         FROM assignments
         WHERE assignments.account_id = subjects.account_id
           AND assignments.subject_id = subjects.id
           AND assignments.status = 'active'
       ) AS context_count,
       (
         SELECT COUNT(*)::integer
         FROM captures
         WHERE captures.account_id = subjects.account_id
           AND captures.subject_id = subjects.id
           AND captures.status = 'active'
       ) AS capture_count,
       (
         SELECT COUNT(*)::integer
         FROM identity_handles confirmed_handles
         LEFT JOIN source_resources confirmed_resources
           ON confirmed_resources.account_id = confirmed_handles.account_id
          AND confirmed_resources.id = confirmed_handles.source_resource_id
         LEFT JOIN source_retention_receipts confirmed_receipts
           ON confirmed_receipts.account_id = confirmed_resources.account_id
          AND confirmed_receipts.capture_id = confirmed_resources.capture_id
         WHERE confirmed_handles.account_id = subjects.account_id
           AND confirmed_handles.subject_id = subjects.id
           AND confirmed_handles.status = 'confirmed'
           AND (
             confirmed_handles.valid_until IS NULL
             OR confirmed_handles.valid_until > now()
           )
           AND (
             confirmed_handles.source_resource_id IS NULL
             OR (
               confirmed_resources.processing_state <> 'deleted'
               AND confirmed_resources.deleted_at IS NULL
               AND (confirmed_resources.retention_until IS NULL OR confirmed_resources.retention_until > now())
               AND confirmed_receipts.source_access_state <> 'deleted'
               AND (confirmed_receipts.retention_until IS NULL OR confirmed_receipts.retention_until > now())
               AND confirmed_receipts.authorization_state = 'authorized'
               AND (
                 confirmed_receipts.authorization_expires_at IS NULL
                 OR confirmed_receipts.authorization_expires_at > now()
               )
             )
           )
       ) AS confirmed_identity_count,
       COALESCE(
         (
           SELECT MAX(captures.created_at)
           FROM captures
           WHERE captures.account_id = subjects.account_id
             AND captures.subject_id = subjects.id
             AND captures.status = 'active'
         ),
         subjects.created_at
       ) AS last_activity_at,
       COALESCE(
         (
           SELECT jsonb_agg(
             jsonb_build_object(
               'id', contexts.id,
               'display_label', contexts.display_label,
               'last_activity_at', contexts.last_activity_at
             )
             ORDER BY contexts.last_activity_at DESC, contexts.id
           )
           FROM (
             SELECT
               assignments.id,
               assignments.display_label,
               COALESCE(MAX(captures.created_at), assignments.created_at)
                 AS last_activity_at
             FROM assignments
             LEFT JOIN captures
               ON captures.account_id = assignments.account_id
              AND captures.assignment_id = assignments.id
              AND captures.status = 'active'
             WHERE assignments.account_id = subjects.account_id
               AND assignments.subject_id = subjects.id
               AND assignments.status = 'active'
             GROUP BY assignments.id
             ORDER BY last_activity_at DESC, assignments.id
             LIMIT 20
           ) contexts
         ),
         '[]'::jsonb
       ) AS contexts
     FROM subjects
     LEFT JOIN person_profiles
       ON person_profiles.account_id = subjects.account_id
      AND person_profiles.subject_id = subjects.id
     LEFT JOIN LATERAL (
       SELECT profiles.*
       FROM reviewed_person_public_profiles profiles
       JOIN source_resources profile_resources
         ON profile_resources.account_id = profiles.account_id
        AND profile_resources.id = profiles.source_resource_id
        AND profile_resources.processing_state <> 'deleted'
        AND profile_resources.deleted_at IS NULL
        AND (profile_resources.retention_until IS NULL OR profile_resources.retention_until > now())
       JOIN captures profile_captures
         ON profile_captures.account_id = profile_resources.account_id
        AND profile_captures.id = profile_resources.capture_id
        AND profile_captures.subject_id = subjects.id
        AND profile_captures.status = 'active'
        AND profile_captures.identity_status = 'bound'
       LEFT JOIN assignments profile_assignments
         ON profile_assignments.account_id = profile_captures.account_id
        AND profile_assignments.id = profile_captures.assignment_id
        AND profile_assignments.subject_id = subjects.id
        AND profile_assignments.status = 'active'
       JOIN source_retention_receipts profile_receipts
         ON profile_receipts.account_id = profile_resources.account_id
        AND profile_receipts.capture_id = profile_resources.capture_id
        AND profile_receipts.authorization_state = 'authorized'
        AND profile_receipts.source_access_state <> 'deleted'
        AND (profile_receipts.retention_until IS NULL OR profile_receipts.retention_until > now())
        AND (
          profile_receipts.authorization_expires_at IS NULL
          OR profile_receipts.authorization_expires_at > now()
        )
       WHERE profiles.account_id = subjects.account_id
         AND profiles.subject_id = subjects.id
         AND (profile_captures.assignment_id IS NULL OR profile_assignments.id IS NOT NULL)
       LIMIT 1
     ) public_profiles ON true
     LEFT JOIN LATERAL (
       SELECT
         handles.handle_type,
         handles.display_hint,
         handles.source_resource_id,
         handles.valid_until,
         CASE
           WHEN handles.status = 'confirmed'
             AND (
               handles.valid_until IS NULL
               OR handles.valid_until > now()
             )
             THEN 'confirmed'
           ELSE 'expired'
         END AS match_status
       FROM identity_handles handles
       LEFT JOIN source_resources handle_resources
         ON handle_resources.account_id = handles.account_id
        AND handle_resources.id = handles.source_resource_id
       LEFT JOIN source_retention_receipts handle_receipts
         ON handle_receipts.account_id = handle_resources.account_id
        AND handle_receipts.capture_id = handle_resources.capture_id
       WHERE handles.account_id = subjects.account_id
         AND handles.subject_id = subjects.id
         AND handles.status IN ('confirmed', 'expired')
         AND $3::text IS NOT NULL
         AND handles.handle_type = $3
         AND handles.normalized_value_hash = $4
         AND (
           handles.source_resource_id IS NULL
           OR (
             handle_resources.processing_state <> 'deleted'
             AND handle_resources.deleted_at IS NULL
             AND (handle_resources.retention_until IS NULL OR handle_resources.retention_until > now())
             AND handle_receipts.source_access_state <> 'deleted'
             AND (handle_receipts.retention_until IS NULL OR handle_receipts.retention_until > now())
             AND handle_receipts.authorization_state = 'authorized'
             AND (
               handle_receipts.authorization_expires_at IS NULL
               OR handle_receipts.authorization_expires_at > now()
             )
           )
         )
       ORDER BY
         CASE
           WHEN handles.status = 'confirmed'
             AND (
               handles.valid_until IS NULL
               OR handles.valid_until > now()
             )
             THEN 0
           ELSE 1
         END,
         handles.valid_until DESC NULLS LAST,
         handles.created_at DESC,
         handles.id
       LIMIT 1
     ) matched_handle ON true
     WHERE subjects.account_id = $1
       AND subjects.status = 'active'
       AND ($5::uuid IS NULL OR subjects.id = $5)
       AND (
         ($2 = '' AND $3::text IS NULL)
         OR (
           $2 <> ''
           AND lower(subjects.display_label) LIKE '%' || $2 || '%'
         )
         OR matched_handle.handle_type IS NOT NULL
       )
     ORDER BY
       CASE matched_handle.match_status
         WHEN 'confirmed' THEN 0
         WHEN 'expired' THEN 1
         ELSE 2
       END,
       last_activity_at DESC,
       subjects.id
     LIMIT 200`,
    [auth.accountId, nameQuery, handleType, handleHash, exactPersonId],
  );

  return {
    contract_version: CONTRACT_VERSION,
    people: result.rows.map((person) => {
      const identityMatches: PersonDirectoryIdentityMatch[] = [];
      if (person.name_match) {
        identityMatches.push({ kind: "name" });
      }
      if (
        person.matched_handle_type &&
        person.matched_handle_status === "confirmed"
      ) {
        identityMatches.push({
          kind: "confirmed_handle",
          handle_type: person.matched_handle_type,
          display_hint:
            person.matched_handle_hint ??
            `Confirmed ${person.matched_handle_type}`,
          source_resource_id:
            person.matched_handle_source_resource_id,
        });
      } else if (
        person.matched_handle_type &&
        person.matched_handle_status === "expired" &&
        person.matched_handle_valid_until
      ) {
        identityMatches.push({
          kind: "expired_handle",
          handle_type: person.matched_handle_type,
          display_hint:
            person.matched_handle_hint ??
            `Expired ${person.matched_handle_type}`,
          source_resource_id:
            person.matched_handle_source_resource_id,
          expired_at:
            person.matched_handle_valid_until.toISOString(),
        });
      }
      return {
        id: person.id,
        display_label: person.display_label,
        context_count: person.context_count,
        capture_count: person.capture_count,
        confirmed_identity_count: person.confirmed_identity_count,
        last_activity_at: person.last_activity_at.toISOString(),
        profile:
          person.profile_headline &&
          person.profile_summary &&
          person.profile_provenance_kind &&
          person.profile_authored_by_user_id &&
          person.profile_revision &&
          person.profile_updated_at
            ? {
                headline: person.profile_headline,
                summary: person.profile_summary,
                provenance_kind: person.profile_provenance_kind,
                authored_by_user_id: person.profile_authored_by_user_id,
                revision: person.profile_revision,
                updated_at: person.profile_updated_at.toISOString(),
              }
            : person.public_profile_card_headline &&
                person.public_profile_confirmed_by_user_id &&
                person.public_profile_revision &&
                person.public_profile_confirmed_at &&
                person.public_profile_url &&
                person.public_profile_platform &&
                person.public_profile_retrieved_at
              ? {
                  headline: person.public_profile_card_headline,
                  summary: person.public_profile_card_headline,
                  provenance_kind: "reviewed_public_source" as const,
                  authored_by_user_id:
                    person.public_profile_confirmed_by_user_id,
                  source_profile_url: person.public_profile_url,
                  source_platform: person.public_profile_platform,
                  revision: person.public_profile_revision,
                  updated_at:
                    person.public_profile_confirmed_at.toISOString(),
                }
              : null,
        avatar:
          person.public_profile_use_avatar &&
          person.public_profile_avatar_url &&
          person.public_profile_url &&
          person.public_profile_platform &&
          person.public_profile_retrieved_at &&
          person.public_profile_confirmed_at
            ? {
                url: person.public_profile_avatar_url,
                source_profile_url: person.public_profile_url,
                source_platform: person.public_profile_platform,
                retrieved_at: person.public_profile_retrieved_at.toISOString(),
                confirmed_at: person.public_profile_confirmed_at.toISOString(),
              }
            : null,
        contexts: person.contexts.map((context) => ({
          id: context.id,
          display_label: context.display_label,
          last_activity_at: new Date(
            context.last_activity_at,
          ).toISOString(),
        })),
        identity_matches: identityMatches,
      };
    }),
  };
}

export async function listPeople(
  pool: DatabaseClient,
  auth: AuthContext,
  query = "",
): Promise<PersonDirectoryResponse> {
  return queryPeople(pool, auth, query, false);
}

export async function searchPeople(
  pool: DatabaseClient,
  auth: AuthContext,
  query: string,
): Promise<PersonDirectoryResponse> {
  return queryPeople(pool, auth, query, true);
}

// Structured fields have explicit typed authority. Identity values stay in the
// governed masked contact-points projection, never in a raw-field fallback.
const BASIC_CONTACT_FIELDS = ["display_name", "name", "company", "job_title", "location"];

export async function getPerson(
  pool: DatabaseClient,
  auth: AuthContext,
  personId: string,
): Promise<PersonDetailResponse> {
  // Apply identity/account/status before the directory's limit so older people
  // remain addressable regardless of their position in the recent directory.
  const directory = await queryPeople(pool, auth, "", false, personId);
  const person = directory.people[0];
  if (!person) {
    throw new ApiError(404, "PERSON_NOT_FOUND", "The active person was not found.");
  }

  // Raw transport may already be purged after review while these explicitly
  // reviewed fragments remain retained. Raw purge alone is not revocation;
  // deletion, authorization and retention deadlines still fence every read.
  const [fields, points] = await Promise.all([
    pool.query<Omit<ReviewedContactBasicField, "observed_at"> & { observed_at: Date }>(
      `SELECT fragments.locator ->> 'field' AS field,
         fragments.text_content AS value,
         fragments.id AS evidence_fragment_id,
         captures.id AS capture_id,
         resources.id AS source_resource_id,
         resources.observed_at,
         captures.assignment_id AS relationship_context_id,
         resources.display_name AS source_label
       FROM evidence_fragments fragments
       JOIN source_resources resources
         ON resources.account_id = fragments.account_id
        AND resources.id = fragments.resource_id
        AND resources.capture_id = fragments.capture_id
       JOIN captures
         ON captures.account_id = resources.account_id
        AND captures.id = resources.capture_id
       JOIN subjects
         ON subjects.account_id = captures.account_id
        AND subjects.id = captures.subject_id
        AND subjects.status = 'active'
       LEFT JOIN assignments
         ON assignments.account_id = captures.account_id
        AND assignments.id = captures.assignment_id
        AND assignments.subject_id = subjects.id
        AND assignments.status = 'active'
       JOIN source_retention_receipts receipts
         ON receipts.account_id = captures.account_id
        AND receipts.capture_id = captures.id
       WHERE subjects.account_id = $1
         AND subjects.id = $2
         AND captures.status = 'active'
         AND captures.identity_status = 'bound'
         AND (captures.assignment_id IS NULL OR assignments.id IS NOT NULL)
         AND resources.resource_kind = 'contact_record'
         AND resources.processing_state <> 'deleted'
         AND resources.deleted_at IS NULL
         AND (resources.retention_until IS NULL OR resources.retention_until > now())
         AND receipts.source_access_state <> 'deleted'
         AND receipts.authorization_state = 'authorized'
         AND (receipts.authorization_expires_at IS NULL OR receipts.authorization_expires_at > now())
         AND (receipts.retention_until IS NULL OR receipts.retention_until > now())
         AND fragments.status = 'active'
         AND fragments.deleted_at IS NULL
         AND fragments.review_status = 'reviewed'
         AND fragments.attributed_actor = 'recruiter'
         AND fragments.attribution_status = 'confirmed'
         AND fragments.fragment_kind = 'contact_field'
         AND fragments.locator ->> 'kind' = 'contact_field'
         AND fragments.locator ->> 'field' = ANY($3::text[])
         AND NULLIF(btrim(fragments.text_content), '') IS NOT NULL
       ORDER BY fragments.locator ->> 'field', resources.observed_at DESC, fragments.id`,
      [auth.accountId, personId, BASIC_CONTACT_FIELDS],
    ),
    pool.query<Omit<RelationshipContactPoint, "valid_from" | "valid_until"> & {
      valid_from: Date; valid_until: Date | null;
    }>(
      `SELECT handles.id, handles.handle_type AS type, handles.display_hint,
         resources.id AS source_resource_id,
         resources.display_name AS source_display_name,
         handles.valid_from, handles.valid_until
       FROM identity_handles handles
       JOIN subjects
         ON subjects.account_id = handles.account_id
        AND subjects.id = handles.subject_id
        AND subjects.status = 'active'
       JOIN source_resources resources
         ON resources.account_id = handles.account_id
        AND resources.id = handles.source_resource_id
       JOIN captures
         ON captures.account_id = resources.account_id
        AND captures.id = resources.capture_id
        AND captures.subject_id = subjects.id
       LEFT JOIN assignments
         ON assignments.account_id = captures.account_id
        AND assignments.id = captures.assignment_id
        AND assignments.subject_id = subjects.id
        AND assignments.status = 'active'
       JOIN source_retention_receipts receipts
         ON receipts.account_id = captures.account_id
        AND receipts.capture_id = captures.id
       WHERE subjects.account_id = $1
         AND subjects.id = $2
         AND handles.status = 'confirmed'
         AND handles.deleted_at IS NULL
         AND handles.confirmed_by_user_id IS NOT NULL
         AND handles.display_hint IS NOT NULL
         AND handles.valid_from <= now()
         AND (handles.valid_until IS NULL OR handles.valid_until > now())
         AND captures.status = 'active'
         AND captures.identity_status = 'bound'
         AND (captures.assignment_id IS NULL OR assignments.id IS NOT NULL)
         AND resources.processing_state <> 'deleted'
         AND resources.deleted_at IS NULL
         AND (resources.retention_until IS NULL OR resources.retention_until > now())
         AND receipts.source_access_state <> 'deleted'
         AND receipts.authorization_state = 'authorized'
         AND (receipts.authorization_expires_at IS NULL OR receipts.authorization_expires_at > now())
         AND (receipts.retention_until IS NULL OR receipts.retention_until > now())
       ORDER BY handles.handle_type, handles.created_at, handles.id
       LIMIT 20`,
      [auth.accountId, personId],
    ),
  ]);

  return {
    contract_version: CONTRACT_VERSION,
    person,
    // Preserve all reviewed rows, including conflicting values. Time ordering
    // is presentation only and grants no row authority as the current value.
    basic_fields: fields.rows.map((field) => ({ ...field, observed_at: field.observed_at.toISOString() })),
    contact_points: points.rows.map((point) => ({
      ...point,
      valid_from: point.valid_from.toISOString(),
      valid_until: point.valid_until?.toISOString() ?? null,
    })),
  };
}

export async function getRelationshipScope(
  pool: DatabaseClient,
  auth: AuthContext,
  personId: string,
  relationshipContextId: string,
): Promise<RelationshipScope> {
  const result = await pool.query<{
    person_id: string;
    person_label: string;
    profile_headline: string | null;
    profile_summary: string | null;
    profile_provenance_kind: "user_authored" | null;
    profile_authored_by_user_id: string | null;
    profile_revision: number | null;
    profile_updated_at: Date | null;
    contact_points: Array<{
      id: string;
      type: IdentityHandleType;
      display_hint: string;
      source_resource_id: string | null;
      source_display_name: string | null;
      valid_from: string;
      valid_until: string | null;
    }>;
    context_id: string;
    context_label: string;
  }>(
    `SELECT
       subjects.id AS person_id,
       subjects.display_label AS person_label,
       person_profiles.headline AS profile_headline,
       person_profiles.summary AS profile_summary,
       person_profiles.provenance_kind AS profile_provenance_kind,
       person_profiles.authored_by_user_id AS profile_authored_by_user_id,
       person_profiles.revision AS profile_revision,
       person_profiles.updated_at AS profile_updated_at,
       assignments.id AS context_id,
       assignments.display_label AS context_label,
       COALESCE(
         (
           SELECT jsonb_agg(
             jsonb_build_object(
               'id', current_handles.id,
               'type', current_handles.handle_type,
               'display_hint', current_handles.display_hint,
               'source_resource_id', current_handles.source_resource_id,
               'source_display_name', current_handles.source_display_name,
               'valid_from', current_handles.valid_from,
               'valid_until', current_handles.valid_until
             )
             ORDER BY current_handles.handle_type, current_handles.created_at,
               current_handles.id
           )
           FROM (
             SELECT
               handles.id,
               handles.handle_type,
               handles.display_hint,
               handles.source_resource_id,
               resources.display_name AS source_display_name,
               handles.valid_from,
               handles.valid_until,
               handles.created_at
             FROM identity_handles handles
             LEFT JOIN source_resources resources
               ON resources.account_id = handles.account_id
              AND resources.id = handles.source_resource_id
              AND resources.processing_state <> 'deleted'
             LEFT JOIN source_retention_receipts receipts
               ON receipts.account_id = resources.account_id
              AND receipts.capture_id = resources.capture_id
             WHERE handles.account_id = subjects.account_id
               AND handles.subject_id = subjects.id
               AND handles.status = 'confirmed'
               AND handles.display_hint IS NOT NULL
               AND handles.source_resource_id IS NOT NULL
               AND (
                 handles.valid_until IS NULL
                 OR handles.valid_until > now()
               )
               AND resources.id IS NOT NULL
               AND receipts.authorization_state = 'authorized'
               AND (
                 receipts.authorization_expires_at IS NULL
                 OR receipts.authorization_expires_at > now()
               )
             ORDER BY handles.handle_type, handles.created_at, handles.id
             LIMIT 20
           ) current_handles
         ),
         '[]'::jsonb
       ) AS contact_points
     FROM subjects
     JOIN assignments
       ON assignments.account_id = subjects.account_id
      AND assignments.subject_id = subjects.id
     LEFT JOIN person_profiles
       ON person_profiles.account_id = subjects.account_id
      AND person_profiles.subject_id = subjects.id
     WHERE subjects.account_id = $1
       AND subjects.id = $2
       AND assignments.id = $3
       AND subjects.status = 'active'
       AND assignments.status = 'active'`,
    [auth.accountId, personId, relationshipContextId],
  );
  const scope = result.rows[0];
  if (!scope) {
    const merged = await pool.query<{
      merged_into_subject_id: string;
    }>(
      `SELECT subjects.merged_into_subject_id
       FROM subjects
       JOIN assignments
         ON assignments.account_id = subjects.account_id
        AND assignments.id = $3
        AND assignments.subject_id = subjects.merged_into_subject_id
        AND assignments.status = 'active'
       WHERE subjects.account_id = $1
         AND subjects.id = $2
         AND subjects.status = 'merged'
         AND subjects.merged_into_subject_id IS NOT NULL`,
      [auth.accountId, personId, relationshipContextId],
    );
    const destination = merged.rows[0]?.merged_into_subject_id;
    if (destination) {
      throw new ApiError(
        409,
        "PERSON_MERGED",
        "This person page was merged into the retained person.",
        {
          merged_into_person_id: destination,
          relationship_context_id: relationshipContextId,
        },
      );
    }
    throw new ApiError(
      404,
      "RELATIONSHIP_CONTEXT_NOT_FOUND",
      "The active person and relationship context were not found together.",
    );
  }
  return {
    contract_version: CONTRACT_VERSION,
    person: {
      id: scope.person_id,
      display_label: scope.person_label,
      profile:
        scope.profile_headline &&
        scope.profile_summary &&
        scope.profile_provenance_kind &&
        scope.profile_authored_by_user_id &&
        scope.profile_revision &&
        scope.profile_updated_at
          ? {
              headline: scope.profile_headline,
              summary: scope.profile_summary,
              provenance_kind: scope.profile_provenance_kind,
              authored_by_user_id: scope.profile_authored_by_user_id,
              revision: scope.profile_revision,
              updated_at: scope.profile_updated_at.toISOString(),
            }
          : null,
      contact_points: (scope.contact_points ?? []).map((point) => ({
        id: point.id,
        type: point.type,
        display_hint: point.display_hint,
        source_resource_id: point.source_resource_id,
        source_display_name: point.source_display_name,
        valid_from: new Date(point.valid_from).toISOString(),
        valid_until: point.valid_until
          ? new Date(point.valid_until).toISOString()
          : null,
      })),
    },
    relationship_context: {
      id: scope.context_id,
      display_label: scope.context_label,
    },
  };
}
