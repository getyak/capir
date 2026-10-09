import { randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  type EvidenceFragmentInput,
  type EvidenceLocator,
  type PersonScopeIntent,
  type ResourceCaptureRequest,
  type ResourceCaptureResponse,
} from "@talent-signal/contracts";
import type { Pool, PoolClient } from "pg";

import { inTransaction } from "../database/pool.js";
import { assertAccountActive } from "./accountIdentity.js";
import { ApiError } from "../lib/apiError.js";
import { appendAudit } from "../lib/audit.js";
import { sha256 } from "../lib/hash.js";
import {
  claimIdempotency,
  completeIdempotency,
} from "../lib/idempotency.js";
import type { AuthContext } from "./auth.js";
import { confirmIdentityHandles } from "./identityHandles.js";
import { normalizeIdentityHandle } from "./identityResolution.js";
import {
  completeSourceReview,
  createSourceRetentionRecord,
  resolveSourceRetentionPolicy,
} from "./sourceRetention.js";

interface IdentityBinding {
  status: ResourceCaptureResponse["identity"]["status"];
  personId: string | null;
  relationshipContextId: string | null;
  resolutionCaseId: string | null;
  candidatePersonIds: string[];
  captureIdentityStatus: "bound" | "ambiguous" | "unbound";
}

interface ResourceRow {
  id: string;
  client_resource_id: string;
  resource_kind: ResourceCaptureResponse["resource"]["kind"];
  processing_state: ResourceCaptureResponse["resource"]["processing_state"];
  duplicate_of_resource_id: string | null;
  fragment_count: number;
}

interface CaptureIdentityRow {
  id: string;
  status: "active" | "deleted";
  subject_id: string | null;
  assignment_id: string | null;
  identity_status: "bound" | "ambiguous" | "unbound";
  created_at: Date;
  person_display_label: string | null;
  relationship_display_label: string | null;
}

export interface ResourceIntakeMutationResult {
  body: ResourceCaptureResponse;
  replayed: boolean;
  status: number;
}

const EXPECTED_FRAGMENT_KINDS: Record<
  ResourceCaptureRequest["resource"]["kind"],
  ReadonlySet<EvidenceFragmentInput["kind"]>
> = {
  conversation_screenshot: new Set(["message"]),
  conversation_transcript: new Set(["message"]),
  resume: new Set(["page_text", "document_text", "document_region"]),
  document: new Set(["page_text", "document_text", "document_region"]),
  public_url: new Set(["url_excerpt"]),
  personal_note: new Set(["note_revision"]),
  contact_record: new Set(["contact_field"]),
};

function invalidResource(code: string, message: string): never {
  throw new ApiError(422, code, message);
}

function isHttpsURL(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

export function validateResourceRequest(request: ResourceCaptureRequest): void {
  const { resource, fragments } = request;
  const confirmedIdentityHandles =
    request.confirmed_identity_handles ?? [];
  const reviewedPublicProfile = request.reviewed_public_profile;
  if (resource.payload_ref) {
    invalidResource(
      "RESOURCE_PAYLOAD_REFERENCE_UNSUPPORTED",
      "This intake stores governed evidence fragments, not an unverified raw-source pointer.",
    );
  }
  if (resource.retention.source_scope === "proposed_extracted_text") {
    if (resource.kind !== "conversation_screenshot" && !(["browser_extension", "web_upload"].includes(request.channel) && ["conversation_transcript", "document"].includes(resource.kind))) {
      invalidResource(
        "PROPOSED_EXTRACTION_SOURCE_INVALID",
        "Proposed extracted text requires an intentional screenshot or browser text capture.",
      );
    }
    if (
      fragments.some(
        (fragment) =>
          fragment.review_status !== "proposed" ||
          fragment.attribution.status === "confirmed",
      )
    ) {
      invalidResource(
        "PROPOSED_EXTRACTION_AUTHORITY_INVALID",
        "Machine-extracted screenshot text must remain proposed until a human reviews it.",
      );
    }
  }
  if (
    resource.discovered_from_client_resource_id &&
    !resource.discovered_from_resource_id
  ) {
    invalidResource(
      "DISCOVERY_PARENT_ID_REQUIRED",
      "Atomic intake requires the governed parent resource id when a source was discovered from another resource.",
    );
  }
  if (resource.retention.requested_mode === "full_source") {
    invalidResource(
      "FULL_SOURCE_TRANSPORT_UNSUPPORTED",
      "This endpoint does not persist raw file bytes and cannot claim full-source retention.",
    );
  }
  if (resource.retention.source_scope === "full_reviewed_source") {
    invalidResource(
      "FULL_SOURCE_SCOPE_UNSUPPORTED",
      "Use a reviewed selection or reviewed extraction scope for this intake.",
    );
  }
  if (
    confirmedIdentityHandles.length > 0 &&
    resource.kind !== "contact_record"
  ) {
    invalidResource(
      "IDENTITY_HANDLE_SOURCE_INVALID",
      "A confirmed identity clue must be submitted as a governed contact record.",
    );
  }
  if (
    confirmedIdentityHandles.length > 0 &&
    !["confirmed", "new_person"].includes(request.person_scope.status)
  ) {
    invalidResource(
      "IDENTITY_HANDLE_SCOPE_UNRESOLVED",
      "A confirmed identity clue requires an explicitly bound person.",
    );
  }
  if (reviewedPublicProfile) {
    if (resource.kind !== "contact_record") {
      invalidResource(
        "PUBLIC_PROFILE_SOURCE_INVALID",
        "A reviewed public profile must be submitted as a governed contact record.",
      );
    }
    if (!["confirmed", "new_person"].includes(request.person_scope.status)) {
      invalidResource(
        "PUBLIC_PROFILE_SCOPE_UNRESOLVED",
        "A reviewed public profile requires an explicitly bound person.",
      );
    }
    if (
      resource.source_locator !== reviewedPublicProfile.profile_url ||
      resource.content_hash !== reviewedPublicProfile.content_hash
    ) {
      invalidResource(
        "PUBLIC_PROFILE_PROVENANCE_MISMATCH",
        "The reviewed public profile must match the governed source URL and content hash.",
      );
    }
    if (!isHttpsURL(reviewedPublicProfile.profile_url)) {
      invalidResource(
        "PUBLIC_PROFILE_URL_INVALID",
        "A reviewed public profile requires an HTTPS provider URL.",
      );
    }
    if (
      reviewedPublicProfile.avatar_url &&
      !isHttpsURL(reviewedPublicProfile.avatar_url)
    ) {
      invalidResource(
        "PUBLIC_PROFILE_AVATAR_URL_INVALID",
        "A reviewed public avatar requires an HTTPS URL.",
      );
    }
    if (
      reviewedPublicProfile.provider_id === "tikhub" &&
      (reviewedPublicProfile.avatar_url || reviewedPublicProfile.use_avatar)
    ) {
      invalidResource(
        "PUBLIC_PROFILE_AVATAR_RIGHTS_UNAVAILABLE",
        "TikHub does not grant capri display or storage rights for source-platform avatars.",
      );
    }
    if (
      reviewedPublicProfile.avatar_url &&
      !reviewedPublicProfile.avatar_rights_basis
    ) {
      invalidResource(
        "PUBLIC_PROFILE_AVATAR_RIGHTS_REQUIRED",
        "A stored public avatar requires an explicit provider license or profile-owner consent basis.",
      );
    }
    if (
      reviewedPublicProfile.use_avatar &&
      !reviewedPublicProfile.avatar_url
    ) {
      invalidResource(
        "PUBLIC_PROFILE_AVATAR_MISSING",
        "A public avatar can be selected only when the reviewed source supplied it.",
      );
    }
  }
  const confirmedHandleKeys = new Set<string>();
  for (const handle of confirmedIdentityHandles) {
    if (
      handle.source_client_resource_id !== resource.client_resource_id
    ) {
      invalidResource(
        "IDENTITY_HANDLE_SOURCE_MISMATCH",
        "Every confirmed identity clue must name the governed contact record submitted in this intake.",
      );
    }
    const normalized = normalizeIdentityHandle(handle.type, handle.value);
    if (!normalized) {
      invalidResource(
        "IDENTITY_HANDLE_INVALID",
        `The supplied ${handle.type} identity clue is invalid.`,
      );
    }
    const key = `${handle.type}:${normalized}`;
    if (confirmedHandleKeys.has(key)) {
      invalidResource(
        "IDENTITY_HANDLE_DUPLICATED",
        "A confirmed identity clue may appear only once in one intake.",
      );
    }
    confirmedHandleKeys.add(key);
  }

  const sequences = [...fragments]
    .map((fragment) => fragment.sequence)
    .sort((left, right) => left - right);
  if (
    sequences.some((sequence, index) => sequence !== index)
  ) {
    invalidResource(
      "RESOURCE_FRAGMENT_SEQUENCE_INVALID",
      "Evidence fragments must use a unique contiguous sequence beginning at zero.",
    );
  }

  const expectedKinds = EXPECTED_FRAGMENT_KINDS[resource.kind];
  for (const fragment of fragments) {
    if (fragment.client_resource_id !== resource.client_resource_id) {
      invalidResource(
        "RESOURCE_FRAGMENT_BINDING_MISMATCH",
        "Every evidence fragment must name the resource submitted in this atomic intake.",
      );
    }
    if (fragment.kind !== fragment.locator.kind) {
      invalidResource(
        "RESOURCE_FRAGMENT_LOCATOR_MISMATCH",
        "The evidence fragment kind must match its typed locator.",
      );
    }
    if (!expectedKinds.has(fragment.kind)) {
      invalidResource(
        "RESOURCE_FRAGMENT_KIND_UNSUPPORTED",
        `A ${resource.kind} resource cannot contain ${fragment.kind} evidence.`,
      );
    }
  }

  if (resource.kind === "personal_note") {
    const invalidNote = fragments.find(
      (fragment) =>
        fragment.review_status !== "reviewed" ||
        fragment.attribution.actor_kind !== "recruiter" ||
        fragment.attribution.status !== "confirmed",
    );
    if (invalidNote) {
      invalidResource(
        "PERSONAL_NOTE_AUTHORITY_INVALID",
        "A personal note must be explicitly reviewed and attributed to the user; it is not testimony from the other person.",
      );
    }
  }
}

function evidenceBundleHash(
  request: ResourceCaptureRequest,
): string {
  return sha256(
    JSON.stringify({
      kind: request.resource.kind,
      fragments: request.fragments.map((fragment) => ({
        kind: fragment.kind,
        sequence: fragment.sequence,
        text: fragment.text,
        locator: fragment.locator,
      })),
    }),
  );
}

async function insertProposedContext(
  client: PoolClient,
  accountId: string,
  personId: string,
  captureId: string,
  context: Extract<
    PersonScopeIntent["relationship_context"],
    { status: "proposed" }
  >,
): Promise<string> {
  const relationshipContextId = randomUUID();
  await client.query(
    `INSERT INTO assignments(
       id, account_id, subject_id, external_ref, display_label, status
     )
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [
      relationshipContextId,
      accountId,
      personId,
      `resource-context:${captureId}`,
      context.label,
    ],
  );
  return relationshipContextId;
}

async function bindConfirmedIdentity(
  client: PoolClient,
  accountId: string,
  captureId: string,
  scope: Extract<
    PersonScopeIntent,
    { status: "confirmed" | "new_person" }
  >,
): Promise<IdentityBinding> {
  if (scope.status === "new_person") {
    const personId = randomUUID();
    await client.query(
      `INSERT INTO subjects(
         id, account_id, external_ref, display_label, status
       )
       VALUES ($1, $2, $3, $4, 'active')`,
      [
        personId,
        accountId,
        `resource-person:${captureId}`,
        scope.display_label,
      ],
    );
    const relationshipContextId = await insertProposedContext(
      client,
      accountId,
      personId,
      captureId,
      scope.relationship_context,
    );
    return {
      status: "bound",
      personId,
      relationshipContextId,
      resolutionCaseId: null,
      candidatePersonIds: [],
      captureIdentityStatus: "bound",
    };
  }

  const person = await client.query<{ id: string }>(
    `SELECT id
     FROM subjects
     WHERE account_id = $1
       AND id = $2
       AND status = 'active'
     FOR UPDATE`,
    [accountId, scope.person_id],
  );
  if (!person.rows[0]) {
    throw new ApiError(
      404,
      "PERSON_NOT_FOUND",
      "The selected person is unavailable in this account.",
    );
  }

  let relationshipContextId: string;
  if (scope.relationship_context.status === "existing") {
    const relationshipContext = await client.query<{ id: string }>(
      `SELECT id
       FROM assignments
       WHERE account_id = $1
         AND id = $2
         AND subject_id = $3
         AND status = 'active'
       FOR UPDATE`,
      [
        accountId,
        scope.relationship_context.relationship_context_id,
        scope.person_id,
      ],
    );
    if (!relationshipContext.rows[0]) {
      throw new ApiError(
        404,
        "RELATIONSHIP_CONTEXT_NOT_FOUND",
        "The selected relationship context does not belong to this person.",
      );
    }
    relationshipContextId = relationshipContext.rows[0].id;
  } else {
    relationshipContextId = await insertProposedContext(
      client,
      accountId,
      scope.person_id,
      captureId,
      scope.relationship_context,
    );
  }

  return {
    status: "bound",
    personId: scope.person_id,
    relationshipContextId,
    resolutionCaseId: null,
    candidatePersonIds: [],
    captureIdentityStatus: "bound",
  };
}

interface ExistingHandleCandidate {
  matchReasons: string[];
  personId: string;
  rank: number;
}

async function existingCandidatesFromHandles(
  client: PoolClient,
  accountId: string,
  scope: Extract<PersonScopeIntent, { status: "unresolved" }>,
): Promise<ExistingHandleCandidate[]> {
  const hashes = scope.handles.flatMap((handle) => {
    const normalized = normalizeIdentityHandle(handle.type, handle.value);
    return normalized
      ? [{ type: handle.type, hash: sha256(normalized) }]
      : [];
  });
  if (hashes.length === 0) {
    return [];
  }

  const candidates = new Map<
    string,
    ExistingHandleCandidate
  >();
  for (const handle of hashes) {
    const result = await client.query<{
      display_hint: string | null;
      handle_type: string;
      match_status: "confirmed" | "expired";
      subject_id: string;
      valid_until: Date | null;
    }>(
      `SELECT
         handles.subject_id,
         handles.handle_type,
         handles.display_hint,
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
       LEFT JOIN source_resources resources
         ON resources.account_id = handles.account_id
        AND resources.id = handles.source_resource_id
       LEFT JOIN source_retention_receipts receipts
         ON receipts.account_id = resources.account_id
        AND receipts.capture_id = resources.capture_id
       WHERE handles.account_id = $1
         AND handles.handle_type = $2
         AND handles.normalized_value_hash = $3
         AND handles.status IN ('confirmed', 'expired')
         AND (
           handles.source_resource_id IS NULL
           OR (
             receipts.authorization_state = 'authorized'
             AND (
               receipts.authorization_expires_at IS NULL
               OR receipts.authorization_expires_at > now()
             )
           )
         )`,
      [accountId, handle.type, handle.hash],
    );
    for (const row of result.rows) {
      const rank = row.match_status === "confirmed" ? 0 : 1;
      const displayHint =
        row.display_hint ??
        `masked ${row.handle_type.replaceAll("_", " ")}`;
      const reason =
        row.match_status === "confirmed"
          ? `Current confirmed ${row.handle_type.replaceAll("_", " ")} clue ${displayHint} from an authorized governed source.`
          : `Expired ${row.handle_type.replaceAll("_", " ")} clue ${displayHint}${
              row.valid_until
                ? ` reached its freshness deadline on ${row.valid_until.toISOString()}.`
                : " is no longer current."
            } A fresh governed source and explicit binding are required.`;
      const candidate = candidates.get(row.subject_id);
      if (!candidate) {
        candidates.set(row.subject_id, {
          matchReasons: [reason],
          personId: row.subject_id,
          rank,
        });
        continue;
      }
      candidate.rank = Math.min(candidate.rank, rank);
      if (!candidate.matchReasons.includes(reason)) {
        candidate.matchReasons.push(reason);
      }
    }
  }
  return [...candidates.values()].sort(
    (left, right) =>
      left.rank - right.rank ||
      left.personId.localeCompare(right.personId),
  );
}

async function createIdentityReview(
  client: PoolClient,
  accountId: string,
  captureId: string,
  scope: Exclude<
    PersonScopeIntent,
    { status: "confirmed" | "new_person" }
  >,
): Promise<IdentityBinding> {
  const handleCandidates =
    scope.status === "unresolved"
      ? await existingCandidatesFromHandles(
          client,
          accountId,
          scope,
        )
      : [];
  const handleMatchReasons = new Map(
    handleCandidates.map((candidate) => [
      candidate.personId,
      candidate.matchReasons,
    ]),
  );
  let candidatePersonIds =
    scope.status === "proposed"
      ? [scope.candidate_person_id]
      : scope.status === "candidates"
        ? scope.candidate_person_ids
        : handleCandidates.map((candidate) => candidate.personId);
  candidatePersonIds = [...new Set(candidatePersonIds)];

  if (candidatePersonIds.length > 0) {
    const ownedCandidates = await client.query<{ id: string }>(
      `SELECT id
       FROM subjects
       WHERE account_id = $1
         AND id = ANY($2::uuid[])
         AND status = 'active'`,
      [accountId, candidatePersonIds],
    );
    if (ownedCandidates.rows.length !== candidatePersonIds.length) {
      throw new ApiError(
        404,
        "IDENTITY_CANDIDATE_NOT_FOUND",
        "One or more proposed identity candidates are unavailable in this account.",
      );
    }
  }

  const resolutionCaseId = randomUUID();
  await client.query(
    `INSERT INTO identity_resolution_cases(
       id, account_id, capture_id, status, reason
     )
     VALUES ($1, $2, $3, 'pending', $4)`,
    [resolutionCaseId, accountId, captureId, scope.reason],
  );
  for (const [index, personId] of candidatePersonIds.entries()) {
    const matchReasons =
      scope.status === "proposed" &&
      personId === scope.candidate_person_id
        ? scope.match_reasons
        : handleMatchReasons.get(personId) ?? [scope.reason];
    await client.query(
      `INSERT INTO identity_resolution_candidates(
         id, account_id, case_id, subject_id, match_reasons,
         candidate_order
       )
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        randomUUID(),
        accountId,
        resolutionCaseId,
        personId,
        JSON.stringify(matchReasons),
        index,
      ],
    );
  }

  return {
    status:
      candidatePersonIds.length > 0 ? "needs_review" : "unresolved",
    personId: null,
    relationshipContextId: null,
    resolutionCaseId,
    candidatePersonIds,
    captureIdentityStatus:
      candidatePersonIds.length > 0 ? "ambiguous" : "unbound",
  };
}

function enrichLocator(
  fragment: EvidenceFragmentInput,
  auth: AuthContext,
): EvidenceLocator {
  if (fragment.locator.kind === "note_revision") {
    return {
      ...fragment.locator,
      author_user_id: auth.userId,
    };
  }
  return fragment.locator;
}

export async function loadResourceCapture(
  client: Pool | PoolClient,
  accountId: string,
  captureId: string,
): Promise<ResourceCaptureResponse> {
  const captureResult = await client.query<CaptureIdentityRow>(
    `SELECT
       id, status, subject_id, assignment_id, identity_status, created_at,
       (SELECT display_label FROM subjects WHERE account_id = captures.account_id AND id = captures.subject_id) AS person_display_label,
       (SELECT display_label FROM assignments WHERE account_id = captures.account_id AND id = captures.assignment_id) AS relationship_display_label
     FROM captures
     WHERE account_id = $1 AND id = $2`,
    [accountId, captureId],
  );
  const capture = captureResult.rows[0];
  if (!capture) {
    throw new ApiError(
      404,
      "RESOURCE_CAPTURE_NOT_FOUND",
      "The resource capture was not found.",
    );
  }
  if (capture.status === "deleted") {
    throw new ApiError(
      410,
      "RESOURCE_CAPTURE_DELETED",
      "The resource and governed derivatives have been deleted.",
    );
  }

  const [resourceResult, caseResult] = await Promise.all([
    client.query<ResourceRow>(
      `SELECT
         resources.id, resources.client_resource_id,
         resources.resource_kind, resources.processing_state,
         resources.duplicate_of_resource_id,
         COUNT(fragments.id)::integer AS fragment_count
       FROM source_resources resources
       JOIN evidence_fragments fragments
         ON fragments.account_id = resources.account_id
        AND fragments.resource_id = resources.id
        AND fragments.status = 'active'
       WHERE resources.account_id = $1
         AND resources.capture_id = $2
         AND resources.processing_state <> 'deleted'
       GROUP BY resources.id`,
      [accountId, captureId],
    ),
    client.query<{ id: string }>(
      `SELECT id
       FROM identity_resolution_cases
       WHERE account_id = $1
         AND capture_id = $2
         AND status = 'pending'
       LIMIT 1`,
      [accountId, captureId],
    ),
  ]);
  const resource = resourceResult.rows[0];
  if (!resource) {
    throw new ApiError(
      409,
      "RESOURCE_CAPTURE_INCOMPLETE",
      "The capture does not contain an active governed resource.",
    );
  }
  const resolutionCaseId = caseResult.rows[0]?.id ?? null;
  const candidates =
    resolutionCaseId === null
      ? []
      : (
          await client.query<{ subject_id: string }>(
            `SELECT subject_id
             FROM identity_resolution_candidates
             WHERE account_id = $1 AND case_id = $2
             ORDER BY candidate_order, id`,
            [accountId, resolutionCaseId],
          )
        ).rows.map((candidate) => candidate.subject_id);

  return {
    contract_version: CONTRACT_VERSION,
    capture_id: capture.id,
    identity: {
      status:
        capture.identity_status === "bound"
          ? "bound"
          : candidates.length > 0
            ? "needs_review"
            : "unresolved",
      person_id: capture.subject_id,
      relationship_context_id: capture.assignment_id,
      resolution_case_id: resolutionCaseId,
      candidate_person_ids: candidates,
      person_display_label: capture.person_display_label,
      relationship_display_label: capture.relationship_display_label,
    },
    resource: {
      id: resource.id,
      client_resource_id: resource.client_resource_id,
      kind: resource.resource_kind,
      processing_state: resource.processing_state,
      duplicate_of_resource_id: resource.duplicate_of_resource_id,
      fragment_count: resource.fragment_count,
    },
    created_at: capture.created_at.toISOString(),
  };
}

export async function createResourceCapture(
  pool: Pool,
  auth: AuthContext,
  request: ResourceCaptureRequest,
): Promise<ResourceIntakeMutationResult> {
  return inTransaction(pool, (client) => createResourceCaptureInTransaction(client, auth, request));
}

// Allows a governed task checkpoint and its exact evidence write to commit together.
export async function createResourceCaptureInTransaction(
  client: PoolClient,
  auth: AuthContext,
  request: ResourceCaptureRequest,
): Promise<ResourceIntakeMutationResult> {
  // Governed Person writes fence the account for the whole transaction.
  await assertAccountActive(client, auth.accountId);
  validateResourceRequest(request);
    const idempotency = await claimIdempotency(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "create_resource_capture",
      request.idempotency_key,
      request,
    );
    if (idempotency.replay) {
      const replayCaptureId =
        typeof idempotency.replay.body === "object" &&
        idempotency.replay.body !== null &&
        "capture_id" in idempotency.replay.body
          ? String(idempotency.replay.body.capture_id)
          : null;
      if (!replayCaptureId) {
        throw new ApiError(
          409,
          "IDEMPOTENCY_STATE_UNAVAILABLE",
          "The prior resource intake could not be resolved.",
        );
      }
      return {
        body: await loadResourceCapture(
          client,
          auth.accountId,
          replayCaptureId,
        ),
        replayed: true,
        status: idempotency.replay.status,
      };
    }

    const captureId = randomUUID();
    const submittedAt = new Date();
    const identity =
      request.person_scope.status === "confirmed" ||
      request.person_scope.status === "new_person"
        ? await bindConfirmedIdentity(
            client,
            auth.accountId,
            captureId,
            request.person_scope,
          )
        : {
            status: "unresolved" as const,
            personId: null,
            relationshipContextId: null,
            resolutionCaseId: null,
            candidatePersonIds: [],
            captureIdentityStatus: "unbound" as const,
          };
    const retentionPolicy = resolveSourceRetentionPolicy(
      request.resource.retention,
      submittedAt,
    );
    const resourceHash =
      request.resource.content_hash ?? evidenceBundleHash(request);
    const discoveredFromResourceId =
      request.resource.discovered_from_resource_id ?? null;
    let authorizationExpiresAt =
      request.resource.authorization_expires_at ?? null;
    if (discoveredFromResourceId) {
      if (
        request.person_scope.status !== "confirmed" ||
        request.person_scope.relationship_context.status !== "existing"
      ) {
        throw new ApiError(
          422,
          "DISCOVERY_PARENT_SCOPE_UNRESOLVED",
          "A derived source requires an explicitly confirmed existing person and relationship context.",
        );
      }
      const parent = await client.query<{
        id: string;
        subject_id: string | null;
        assignment_id: string | null;
        authorization_state: "authorized" | "revoked" | "expired";
        authorization_expires_at: Date | null;
      }>(
        `SELECT
           resources.id,
           captures.subject_id,
           captures.assignment_id,
           receipts.authorization_state,
           receipts.authorization_expires_at
         FROM source_resources resources
         JOIN captures
           ON captures.account_id = resources.account_id
          AND captures.id = resources.capture_id
         JOIN source_retention_receipts receipts
           ON receipts.account_id = captures.account_id
          AND receipts.capture_id = captures.id
         WHERE resources.account_id = $1
           AND resources.id = $2
           AND resources.processing_state <> 'deleted'
           AND captures.status = 'active'`,
        [auth.accountId, discoveredFromResourceId],
      );
      if (!parent.rows[0]) {
        throw new ApiError(
          404,
          "DISCOVERY_PARENT_NOT_FOUND",
          "The governed parent resource is unavailable in this account.",
        );
      }
      if (
        parent.rows[0].subject_id !== request.person_scope.person_id ||
        parent.rows[0].assignment_id !==
          request.person_scope.relationship_context
            .relationship_context_id
      ) {
        throw new ApiError(
          409,
          "DISCOVERY_PARENT_SCOPE_MISMATCH",
          "A derived source cannot cross a person or relationship context boundary.",
        );
      }
      if (
        parent.rows[0].authorization_state !== "authorized" ||
        (parent.rows[0].authorization_expires_at !== null &&
          parent.rows[0].authorization_expires_at <= submittedAt)
      ) {
        throw new ApiError(
          409,
          "DISCOVERY_PARENT_AUTHORIZATION_UNAVAILABLE",
          "A derived source cannot be created from revoked or expired evidence.",
        );
      }
      const parentAuthorizationExpiresAt =
        parent.rows[0].authorization_expires_at?.toISOString() ?? null;
      if (
        authorizationExpiresAt &&
        authorizationExpiresAt !== parentAuthorizationExpiresAt
      ) {
        throw new ApiError(
          422,
          "DISCOVERY_AUTHORIZATION_SCOPE_MISMATCH",
          "A derived source must inherit the parent source authorization deadline.",
        );
      }
      authorizationExpiresAt = parentAuthorizationExpiresAt;
    }

    await client.query(
      `INSERT INTO captures(
         id, account_id, created_by_user_id, subject_id, assignment_id,
         source_kind, source_metadata, identity_status, identity_context,
         purpose, retention_until, created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12
       )`,
      [
        captureId,
        auth.accountId,
        auth.userId,
        identity.personId,
        identity.relationshipContextId,
        request.resource.kind,
        {
          channel: request.channel,
          captured_at: request.captured_at,
          source_timezone: request.source_timezone,
          observed_at: request.resource.observed_at,
          source_locator: request.resource.source_locator ?? null,
          declared_content_hash: request.resource.content_hash ?? null,
        },
        identity.captureIdentityStatus,
        request.person_scope,
        request.purpose,
        retentionPolicy.retentionUntil,
        submittedAt,
      ],
    );
    if (identity.personId) {
      const touchedPerson = await client.query(
        `UPDATE subjects
         SET version = version + 1
         WHERE account_id = $1
           AND id = $2
           AND status = 'active'
         RETURNING id`,
        [auth.accountId, identity.personId],
      );
      if (touchedPerson.rowCount !== 1) {
        throw new ApiError(
          409,
          "PERSON_IDENTITY_CHANGED_DURING_INTAKE",
          "The selected person changed while this source was being attached.",
        );
      }
    }

    const resolvedIdentity =
      request.person_scope.status === "confirmed" ||
      request.person_scope.status === "new_person"
        ? identity
        : await createIdentityReview(
            client,
            auth.accountId,
            captureId,
            request.person_scope,
          );
    if (resolvedIdentity.captureIdentityStatus !== identity.captureIdentityStatus) {
      await client.query(
        `UPDATE captures
         SET identity_status = $3,
             updated_at = $4
         WHERE account_id = $1 AND id = $2`,
        [
          auth.accountId,
          captureId,
          resolvedIdentity.captureIdentityStatus,
          submittedAt,
        ],
      );
    }

    await createSourceRetentionRecord(client, {
      accountId: auth.accountId,
      captureId,
      sourceLocator: request.resource.source_locator ?? null,
      policy: retentionPolicy,
      submittedAt,
      authorizationExpiresAt,
      reviewCompletionEvent: "resource_intake_committed",
    });

    const duplicateResult = await client.query<{ id: string }>(
      `SELECT id
       FROM source_resources
       WHERE account_id = $1
         AND resource_kind = $2
         AND content_hash = $3
         AND processing_state <> 'deleted'
       ORDER BY created_at, id
       LIMIT 1`,
      [auth.accountId, request.resource.kind, resourceHash],
    );
    const duplicateOfResourceId = duplicateResult.rows[0]?.id ?? null;
    const anyProposedFragment = request.fragments.some(
      (fragment) => fragment.review_status === "proposed",
    );
    const processingState:
      | "needs_identity_review"
      | "needs_fact_review"
      | "ready" =
      resolvedIdentity.status !== "bound"
        ? "needs_identity_review"
        : anyProposedFragment
          ? "needs_fact_review"
          : "ready";
    const resourceId = randomUUID();
    await client.query(
      `INSERT INTO source_resources(
         id, account_id, capture_id, created_by_user_id, client_resource_id,
         resource_kind, input_channel, display_name, media_type, content_hash,
         source_locator, discovered_from_resource_id, observed_at,
         source_timezone, retention_scope, retention_until, processing_state,
         sensitivity, duplicate_of_resource_id
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
         $15, $16, $17, 'restricted', $18
       )`,
      [
        resourceId,
        auth.accountId,
        captureId,
        auth.userId,
        request.resource.client_resource_id,
        request.resource.kind,
        request.channel,
        request.resource.display_name,
        request.resource.media_type,
        resourceHash,
        request.resource.source_locator ?? null,
        discoveredFromResourceId,
        request.resource.observed_at,
        request.resource.source_timezone,
        retentionPolicy.sourceScope,
        retentionPolicy.retentionUntil,
        processingState,
        duplicateOfResourceId,
      ],
    );

    if (request.reviewed_public_profile) {
      const profile = request.reviewed_public_profile;
      await client.query(
        `INSERT INTO reviewed_person_public_profiles(
           account_id, subject_id, source_resource_id, confirmed_by_user_id,
           result_id, provider_id, platform, profile_url, display_name,
           handle, avatar_url, avatar_rights_basis, verified,
           match_basis, content_hash,
           retrieved_at, card_headline, use_avatar, confirmed_at, updated_at
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
           $14, $15, $16, $17, $18, $19, $19
         )
         ON CONFLICT (account_id, subject_id) DO UPDATE SET
           source_resource_id = EXCLUDED.source_resource_id,
           confirmed_by_user_id = EXCLUDED.confirmed_by_user_id,
           result_id = EXCLUDED.result_id,
           provider_id = EXCLUDED.provider_id,
           platform = EXCLUDED.platform,
           profile_url = EXCLUDED.profile_url,
           display_name = EXCLUDED.display_name,
           handle = EXCLUDED.handle,
           avatar_url = EXCLUDED.avatar_url,
           avatar_rights_basis = EXCLUDED.avatar_rights_basis,
           verified = EXCLUDED.verified,
           match_basis = EXCLUDED.match_basis,
           content_hash = EXCLUDED.content_hash,
           retrieved_at = EXCLUDED.retrieved_at,
           card_headline = EXCLUDED.card_headline,
           use_avatar = EXCLUDED.use_avatar,
           revision = reviewed_person_public_profiles.revision + 1,
           confirmed_at = EXCLUDED.confirmed_at,
           updated_at = EXCLUDED.updated_at
         WHERE EXCLUDED.retrieved_at >= reviewed_person_public_profiles.retrieved_at`,
        [
          auth.accountId,
          resolvedIdentity.personId,
          resourceId,
          auth.userId,
          profile.result_id,
          profile.provider_id,
          profile.platform,
          profile.profile_url,
          profile.display_name,
          profile.handle ?? null,
          profile.avatar_url ?? null,
          profile.avatar_rights_basis ?? null,
          profile.verified ?? null,
          profile.match_basis,
          profile.content_hash,
          profile.retrieved_at,
          profile.card_headline ?? null,
          profile.use_avatar,
          submittedAt,
        ],
      );
    }

    const identityHandlesConfirmed =
      request.confirmed_identity_handles &&
      request.confirmed_identity_handles.length > 0
        ? await confirmIdentityHandles(client, {
            accountId: auth.accountId,
            confirmedByUserId: auth.userId,
            handles: request.confirmed_identity_handles,
            personId: resolvedIdentity.personId as string,
            relationshipContextId:
              resolvedIdentity.relationshipContextId as string,
            sourceResourceId: resourceId,
          })
        : 0;

    for (const fragment of request.fragments) {
      await client.query(
        `INSERT INTO evidence_fragments(
           id, account_id, capture_id, resource_id, fragment_kind, sequence,
           text_content, content_hash, locator, attributed_actor,
           attribution_status, parser_name, parser_version, review_status
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
         )`,
        [
          randomUUID(),
          auth.accountId,
          captureId,
          resourceId,
          fragment.kind,
          fragment.sequence,
          fragment.text,
          sha256(fragment.text),
          enrichLocator(fragment, auth),
          fragment.attribution.actor_kind,
          fragment.attribution.status,
          fragment.parser.name,
          fragment.parser.version,
          fragment.review_status,
        ],
      );
    }

    await appendAudit(
      client,
      { accountId: auth.accountId, actorUserId: auth.userId },
      "resource.capture_submitted",
      "source_resource",
      resourceId,
      {
        capture_id: captureId,
        channel: request.channel,
        duplicate_of_resource_id: duplicateOfResourceId,
        fragment_count: request.fragments.length,
        identity_status: resolvedIdentity.status,
        identity_handles_confirmed: identityHandlesConfirmed,
        person_id: resolvedIdentity.personId,
        relationship_context_id:
          resolvedIdentity.relationshipContextId,
        resource_kind: request.resource.kind,
        source_scope: retentionPolicy.sourceScope,
      },
    );
    await completeSourceReview(
      client,
      auth,
      captureId,
      submittedAt,
      "resource_intake_committed",
    );

    const body = await loadResourceCapture(
      client,
      auth.accountId,
      captureId,
    );
    await completeIdempotency(client, idempotency, 201, {
      capture_id: captureId,
    });
    return { body, replayed: false, status: 201 };
}
