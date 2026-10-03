import type {
  MemoryAdmission,
  MemoryContactDecision,
  MemoryContactStatus,
  MemoryDecision,
  MemoryJudgment,
  MemoryOperation,
  MemoryProposalCandidate,
  MemoryRelationshipKind,
  MemoryScope,
  MemorySourceLocator,
  MemorySubjectKind,
  MemorySurface,
  MemoryTimeStatus,
} from "@talent-signal/contracts";

/**
 * Pure GET-40 Memory review policy. No database, model, or I/O. The backend
 * domain and unit tests share these rules so admission, dependence, default
 * selection, restricted visibility, and judgment cannot drift.
 */

export const MEMORY_PROPOSAL_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const MEMORY_REVIEW_SCOPE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type MemoryAllowedScope =
  | "all"
  | "person_relationship"
  | "relationship";

export function allowedScopeForSurface(surface: MemorySurface): MemoryAllowedScope {
  if (surface === "chat") return "all";
  if (surface === "people") return "person_relationship";
  return "relationship";
}

/** Private self memory is never visible on a business surface. */
export function surfaceAllowsScope(
  surface: MemorySurface,
  scope: MemoryScope,
): boolean {
  if (scope === "self") return surface === "chat";
  if (scope === "person") return surface === "chat" || surface === "people";
  return true;
}

export function normalizeMemoryText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

export function isExactDuplicate(
  displayText: string,
  existing: readonly string[],
): boolean {
  const normalized = normalizeMemoryText(displayText);
  return normalized.length > 0
    && existing.some((value) => normalizeMemoryText(value) === normalized);
}

/** One sentence must stand alone without the rest of the card. */
export function isIndependentlyUnderstandable(displayText: string): boolean {
  const value = displayText.normalize("NFKC").trim();
  if (value.length < 2 || value.length > 1_000) return false;
  if (/[\r\n]/u.test(value)) return false;
  if (/^(?:他|她|它|他们|她们|这个|那个|这|那|其|此|he|she|it|they|this|that)\b/iu.test(value)
    && value.replace(/[\p{P}\p{Z}]/gu, "").length <= 4) {
    return false;
  }
  return true;
}

const PROHIBITED_PERSON_PATTERNS: readonly RegExp[] = [
  /性格|人格|心理|情绪稳定|情商|抗压|忠诚|不信任|靠谱|不靠谱|动机|价值观|文化契合|文化匹配/iu,
  /适合|匹配度|契合度|评分|打分|排名|优先级最高|acceptance|personality|culture\s*fit|fit\s*score|trustworthy|reliable\s+person|unreliable|emotionally\s+difficult|\bmotivat(?:e|ion)\b|mental\s+state/iu,
  /\b(?:he|she|they)\s+(?:is|are)\s+(?:a\s+)?(?:narcissist|liar|unreliable|emotional|difficult|needy)/iu,
];

/**
 * A contact's personality, mental state, motive, quality, or acceptance cannot
 * become ordinary memory from one message or screenshot.
 */
export function describesProhibitedPersonInference(displayText: string): boolean {
  const value = displayText.normalize("NFKC");
  return PROHIBITED_PERSON_PATTERNS.some((pattern) => pattern.test(value));
}

export interface MemoryDependence {
  scope: MemoryScope;
  subjectKind: MemorySubjectKind;
  subjectId: string | null;
  relationshipKind: MemoryRelationshipKind;
  relationshipContextId: string | null;
}

export interface DependenceCheck {
  ok: boolean;
  judgment: MemoryJudgment | null;
  reason: string | null;
}

/**
 * Explicit dependence. A self sentence that names a contact or relationship is
 * preserved as a misclassification, never silently stripped.
 */
export function checkMemoryDependence(
  dependence: MemoryDependence,
): DependenceCheck {
  const { scope, subjectKind, subjectId, relationshipKind, relationshipContextId } = dependence;
  if (scope === "self") {
    const cleanSelf =
      subjectKind === "owner_self"
      && subjectId === null
      && relationshipKind === "none"
      && relationshipContextId === null;
    return cleanSelf
      ? { ok: true, judgment: null, reason: null }
      : {
          ok: false,
          judgment: "self_scope_escape",
          reason: "This sentence depends on a contact or relationship and is not a private self memory.",
        };
  }
  if (subjectKind !== "resolved_subject" && subjectKind !== "proposal_target") {
    return {
      ok: false,
      judgment: "ambiguous_attribution",
      reason: "The statement's subject dependence is not explicit.",
    };
  }
  if (subjectKind === "resolved_subject" && !subjectId) {
    return {
      ok: false,
      judgment: "ambiguous_attribution",
      reason: "A resolved subject dependence needs the exact contact.",
    };
  }
  if (scope === "person") {
    return relationshipKind === "none"
      ? { ok: true, judgment: null, reason: null }
      : {
          ok: false,
          judgment: "ambiguous_attribution",
          reason: "A person memory cannot depend on a relationship context.",
        };
  }
  if (relationshipKind === "none") {
    return {
      ok: false,
      judgment: "ambiguous_attribution",
      reason: "A relationship memory needs an explicit relationship dependence.",
    };
  }
  if (relationshipKind === "resolved_context" && !relationshipContextId) {
    return {
      ok: false,
      judgment: "ambiguous_attribution",
      reason: "A resolved relationship dependence needs the exact context.",
    };
  }
  return { ok: true, judgment: null, reason: null };
}

export function isAdmittedLocator(
  locator: MemorySourceLocator,
  admittedArtifactIds: readonly string[],
): boolean {
  if (locator.kind === "image_region") {
    return admittedArtifactIds.includes(locator.artifact_id);
  }
  return true;
}

export function isGroundedExcerpt(
  excerpt: string,
  sourceText: string | null,
): boolean {
  const value = excerpt.normalize("NFKC");
  if (!value.trim()) return false;
  if (sourceText === null) return false;
  return sourceText.normalize("NFKC").includes(value);
}

export interface AdmissionResult {
  status: MemoryAdmission;
  judgment: MemoryJudgment;
  reason: string;
}

export interface AdmissionContext {
  /** Host-verified admitted text, or null when no text source is admitted. */
  sourceText: string | null;
  admittedArtifactIds: readonly string[];
  existingDisplayTexts: readonly string[];
  dependence: MemoryDependence;
  /** Whether an update/contest target resolved to a current version. */
  previousTargetStatus: "not_requested" | "valid" | "stale";
  /**
   * Current main contact labels/clues. A self item whose text names one of
   * these must not stay an independent self memory.
   */
  contactReferences?: readonly string[];
}

function referencesContact(
  text: string,
  references: readonly string[],
): boolean {
  const normalized = text.normalize("NFKC");
  return references.some((reference) => {
    const value = reference.normalize("NFKC").trim();
    return value.length >= 2 && normalized.includes(value);
  });
}

export function classifyMemoryAdmission(
  candidate: MemoryProposalCandidate,
  context: AdmissionContext,
): AdmissionResult {
  const dependence = checkMemoryDependence(context.dependence);
  if (!dependence.ok) {
    return {
      status: dependence.judgment === "self_scope_escape" ? "needs_judgment" : "ineligible",
      judgment: dependence.judgment ?? "ambiguous_attribution",
      reason: dependence.reason ?? "The statement dependence is invalid.",
    };
  }
  if (!isIndependentlyUnderstandable(candidate.display_text)) {
    return {
      status: "ineligible",
      judgment: "ordinary",
      reason: "The sentence must be understood on its own without the rest of the card.",
    };
  }
  if (!isAdmittedLocator(candidate.source_locator, context.admittedArtifactIds)) {
    return {
      status: "ineligible",
      judgment: "ordinary",
      reason: "The source locator names an artifact that was not admitted in this task.",
    };
  }
  const isImageLocator = candidate.source_locator.kind === "image_region";
  if (!isImageLocator && !isGroundedExcerpt(candidate.source_excerpt, context.sourceText)) {
    return {
      status: "ineligible",
      judgment: "ordinary",
      reason: "The supporting excerpt is not present in the admitted source.",
    };
  }
  if (isImageLocator && !candidate.source_excerpt.trim()) {
    return {
      status: "ineligible",
      judgment: "ordinary",
      reason: "An image-derived statement still needs a short exact excerpt.",
    };
  }
  const isUserOwnStatement =
    candidate.scope === "self"
    && (candidate.statement_kind === "user_opinion" || candidate.statement_kind === "fact");
  // A model declaration is not proof: a self sentence that names the current
  // main contact must not be saved as an independent self memory.
  if (
    candidate.scope === "self"
    && context.dependence.subjectKind === "owner_self"
    && referencesContact(candidate.display_text, context.contactReferences ?? [])
  ) {
    return {
      status: "needs_judgment",
      judgment: "self_scope_escape",
      reason:
        "This self-classified sentence names the current contact and must be bound or reclassified.",
    };
  }
  if (
    candidate.scope !== "self"
    && describesProhibitedPersonInference(candidate.display_text)
  ) {
    return {
      status: "ineligible",
      judgment: "ordinary",
      reason: "A person's trait, motive, quality, or acceptance is not ordinary memory.",
    };
  }
  if (candidate.scope === "self" && describesProhibitedPersonInference(candidate.display_text) && !isUserOwnStatement) {
    return {
      status: "ineligible",
      judgment: "ordinary",
      reason: "An inferred trait cannot become a user-owned memory.",
    };
  }
  if (isExactDuplicate(candidate.display_text, context.existingDisplayTexts)) {
    return {
      status: "ineligible",
      judgment: "ordinary",
      reason: "An equivalent accepted memory already exists; no new evidence is added.",
    };
  }
  if (context.previousTargetStatus === "stale") {
    return {
      status: "needs_judgment",
      judgment: "stale_target",
      reason: "The previous memory changed after this candidate was prepared; re-read and re-propose it.",
    };
  }
  if (candidate.operation === "contest") {
    return {
      status: "needs_judgment",
      judgment: "conflict",
      reason: "Conflicting statements are never default-selected and never silently overwrite.",
    };
  }
  if (candidate.sensitivity === "sensitive") {
    return {
      status: "needs_judgment",
      judgment: "sensitive",
      reason: "Sensitive content needs an explicit user decision.",
    };
  }
  if (candidate.reporter && !candidate.speaker) {
    return {
      status: "needs_judgment",
      judgment: "ambiguous_attribution",
      reason: "The original speaker is unknown; attribution needs review.",
    };
  }
  return {
    status: "eligible",
    judgment: "ordinary",
    reason: "Eligible for a default-selected memory.",
  };
}

export type MemoryTemporalRelation =
  | "new"
  | "update"
  | "conflict"
  | "separate"
  | "no_change";

export interface PreviousMemory {
  displayText: string;
  timeStatus: MemoryTimeStatus;
}

/**
 * Future plans and current facts are different statements, not conflicts. A
 * real same-time contradiction is a conflict and never default-overwrites.
 */
export function classifyTemporalRelation(
  previous: PreviousMemory | null,
  candidate: Pick<
    MemoryProposalCandidate,
    "display_text" | "time_status" | "valid_time" | "operation"
  >,
): MemoryTemporalRelation {
  if (!previous) return "new";
  if (
    normalizeMemoryText(previous.displayText)
    === normalizeMemoryText(candidate.display_text)
  ) {
    return "no_change";
  }
  if (previous.timeStatus === "future" && candidate.time_status !== "future") {
    // A plan can be superseded only by new evidence of completion/change.
    return "update";
  }
  if (previous.timeStatus !== "future" && candidate.time_status === "future") {
    // A new future plan is temporally distinct from a current fact. It is a
    // separate statement, never a destructive replacement of the fact.
    return "separate";
  }
  if (previous.timeStatus === "future" && candidate.time_status === "future") {
    return "update";
  }
  if (
    candidate.operation === "contest"
    || (previous.timeStatus === candidate.time_status
      && candidate.valid_time !== null
      && candidate.time_status === "known")
  ) {
    return "conflict";
  }
  return "update";
}

export function defaultSelectionForChange(
  admission: MemoryAdmission,
  relation: MemoryTemporalRelation,
  operation: MemoryOperation,
): boolean {
  if (admission !== "eligible") return false;
  if (relation === "no_change") return false;
  if (relation === "conflict" || operation === "contest") return false;
  return true;
}

export function decisionWritesNewItem(decision: MemoryDecision): boolean {
  return decision === "accept" || decision === "accept_new" || decision === "retain_conflict";
}

export interface SelectionCandidate {
  id: string;
  scope: MemoryScope;
  subject_kind: MemorySubjectKind;
  subject_id: string | null;
  relationship_kind: MemoryRelationshipKind;
  relationship_context_id: string | null;
  admission_status: MemoryAdmission;
  judgment_kind: MemoryJudgment;
  status: "pending" | "committed" | "skipped";
  added_revision: number;
}

export interface SelectionValidationInput {
  frozenRevision: number;
  surface: MemorySurface;
  contactDecision: MemoryContactDecision;
  contactStatus: MemoryContactStatus;
  selectedItemIds: readonly string[];
  itemDecisions: Readonly<Record<string, MemoryDecision>>;
  items: readonly SelectionCandidate[];
}

export type SelectionValidation<T extends SelectionCandidate = SelectionCandidate> =
  | { ok: true; selected: readonly T[] }
  | { ok: false; code: string; message: string; itemId?: string };

/**
 * Server-side re-validation of a commit selection. The client cannot widen the
 * frozen revision, submit hidden scopes, smuggle contact content behind a
 * skipped contact, or accept a judgment item without an explicit decision.
 */
export function validateMemorySelection<T extends SelectionCandidate>(
  input: Omit<SelectionValidationInput, "items"> & { items: readonly T[] },
): SelectionValidation<T> {
  const unique = new Set(input.selectedItemIds);
  if (unique.size !== input.selectedItemIds.length) {
    return {
      ok: false,
      code: "MEMORY_SELECTION_DUPLICATE",
      message: "The same review item was selected more than once.",
    };
  }
  const visible = new Map(
    input.items
      .filter(
        (item) =>
          item.added_revision <= input.frozenRevision
          && item.status === "pending"
          && surfaceAllowsScope(input.surface, item.scope),
      )
      .map((item) => [item.id, item] as const),
  );
  const selected: T[] = [];
  for (const itemId of input.selectedItemIds) {
    const item = visible.get(itemId);
    if (!item) {
      return {
        ok: false,
        code: "MEMORY_ITEM_NOT_IN_FROZEN_REVIEW",
        message: "A selected item is not visible in this frozen review revision.",
        itemId,
      };
    }
    if (item.judgment_kind === "self_scope_escape") {
      return {
        ok: false,
        code: "MEMORY_SELF_SCOPE_ESCAPE",
        message: "A contact-dependent sentence cannot be saved as a private self memory.",
        itemId,
      };
    }
    if (item.judgment_kind === "stale_target") {
      return {
        ok: false,
        code: "MEMORY_TARGET_REVISION_STALE",
        message: "The previous memory changed; re-read and re-propose this item.",
        itemId,
      };
    }
    const decision = input.itemDecisions[itemId] ?? (item.admission_status === "eligible" ? "accept" : undefined);
    if (!decision || decision === "skip") {
      return {
        ok: false,
        code: "MEMORY_DECISION_REQUIRED",
        message: "Every selected item needs an explicit non-skip decision.",
        itemId,
      };
    }
    if (item.admission_status === "eligible") {
      if (decision !== "accept") {
        return {
          ok: false,
          code: "MEMORY_DECISION_INVALID",
          message: "An ordinary eligible change only accepts the default decision.",
          itemId,
        };
      }
    } else if (item.judgment_kind === "conflict") {
      if (decision !== "accept_new" && decision !== "keep_old" && decision !== "retain_conflict") {
        return {
          ok: false,
          code: "MEMORY_CONFLICT_DECISION_REQUIRED",
          message: "A conflict needs keep_old, accept_new, or retain_conflict.",
          itemId,
        };
      }
    } else if (item.judgment_kind === "sensitive" || item.judgment_kind === "ambiguous_attribution") {
      if (decision !== "accept") {
        return {
          ok: false,
          code: "MEMORY_DECISION_INVALID",
          message: "This judgment item accepts only an explicit accept or skip.",
          itemId,
        };
      }
    } else {
      return {
        ok: false,
        code: "MEMORY_ITEM_NOT_ELIGIBLE",
        message: "An ineligible item cannot be submitted.",
        itemId,
      };
    }
    if (input.contactDecision === "none" && item.scope !== "self") {
      return {
        ok: false,
        code: "MEMORY_CONTACT_REQUIRED",
        message: "Person and relationship memory cannot be saved when the contact is skipped.",
        itemId,
      };
    }
    if (item.scope !== "self") {
      if (
        input.contactDecision === "existing"
        && item.subject_kind !== "resolved_subject"
        && item.subject_kind !== "proposal_target"
      ) {
        return {
          ok: false,
          code: "MEMORY_CONTACT_BINDING_MISMATCH",
          message: "This item cannot bind to the selected existing contact.",
          itemId,
        };
      }
      if (input.contactDecision === "new" && item.subject_kind !== "proposal_target") {
        return {
          ok: false,
          code: "MEMORY_CONTACT_BINDING_MISMATCH",
          message: "This item belongs to an existing contact and cannot move to a new one.",
          itemId,
        };
      }
      if (item.scope === "relationship") {
        if (
          input.contactDecision === "new"
          && item.relationship_kind !== "proposal_target_context"
        ) {
          return {
            ok: false,
            code: "MEMORY_CONTACT_BINDING_MISMATCH",
            message: "A new contact's relationship item needs a draft relationship label.",
            itemId,
          };
        }
        if (item.relationship_kind === "none") {
          return {
            ok: false,
            code: "MEMORY_SCOPE_DEPENDENCE_INVALID",
            message: "A relationship item needs an explicit relationship dependence.",
            itemId,
          };
        }
      }
    }
    selected.push(item);
  }
  if (
    input.contactStatus === "ambiguous"
    && input.contactDecision !== "none"
    && selected.some((item) => item.scope !== "self")
  ) {
    return {
      ok: false,
      code: "MEMORY_IDENTITY_AMBIGUOUS",
      message: "Resolve or skip the ambiguous contact before saving person or relationship memory.",
    };
  }
  return { ok: true, selected };
}

/**
 * Any changed display text is conservatively user-edited. Containment of the
 * old text cannot prove the new claim is source-supported.
 */
export function editedTextIsUserAugmented(
  originalText: string,
  editedText: string | null,
): boolean {
  if (!editedText) return false;
  return (
    normalizeMemoryText(originalText) !== normalizeMemoryText(editedText)
  );
}

export function evidenceIsAvailable(input: {
  itemStatus: "active" | "superseded" | "invalidated" | "deleted";
  evidenceStatus: "active" | "revoked";
  sourceDeleted: boolean;
  authorizationRevoked: boolean;
}): boolean {
  return input.itemStatus === "active"
    && input.evidenceStatus === "active"
    && !input.sourceDeleted
    && !input.authorizationRevoked;
}

export function undoIsCompensable(input: {
  itemStatus: "active" | "superseded" | "invalidated" | "deleted";
  itemVersion: number;
  latestVersion: number;
  laterCommitTouchesItem: boolean;
}): { safe: boolean; reason: string | null } {
  if (input.laterCommitTouchesItem || input.latestVersion > input.itemVersion) {
    return {
      safe: false,
      reason: "A later accepted version must not be overwritten by undo.",
    };
  }
  if (input.itemStatus === "deleted") {
    return { safe: false, reason: "The memory was already deleted." };
  }
  return { safe: true, reason: null };
}

/** A newly created contact may only be reclaimed when nothing later depends on it. */
export function contactReclaimIsSafe(input: {
  laterSourceCount: number;
  laterMemoryItemCount: number;
  laterAssignmentCount: number;
  laterHandleCount?: number;
  laterProfileCount?: number;
  laterManifestCount?: number;
  pendingProposalCount?: number;
}): boolean {
  return input.laterSourceCount === 0
    && input.laterMemoryItemCount === 0
    && input.laterAssignmentCount === 0
    && (input.laterHandleCount ?? 0) === 0
    && (input.laterProfileCount ?? 0) === 0
    && (input.laterManifestCount ?? 0) === 0
    && (input.pendingProposalCount ?? 0) === 0;
}
