import { describe, expect, it } from "vitest";
import { skippedVisibleItemIds } from "./memoryReviewCommit.js";

import {
  checkMemoryDependence,
  classifyMemoryAdmission,
  classifyTemporalRelation,
  contactReclaimIsSafe,
  decisionWritesNewItem,
  defaultSelectionForChange,
  describesProhibitedPersonInference,
  editedTextIsUserAugmented,
  evidenceIsAvailable,
  isExactDuplicate,
  isGroundedExcerpt,
  surfaceAllowsScope,
  validateMemorySelection,
  undoIsCompensable,
  type MemoryDependence,
  type SelectionCandidate,
} from "./memoryReviewPolicy.js";

const ownerSelf: MemoryDependence = {
  scope: "self",
  subjectKind: "owner_self",
  subjectId: null,
  relationshipKind: "none",
  relationshipContextId: null,
};

function item(overrides: Partial<SelectionCandidate>): SelectionCandidate {
  return {
    id: crypto.randomUUID(),
    scope: "person",
    subject_kind: "resolved_subject",
    subject_id: "p1",
    relationship_kind: "none",
    relationship_context_id: null,
    admission_status: "eligible",
    judgment_kind: "ordinary",
    status: "pending",
    added_revision: 1,
    ...overrides,
  };
}

describe("Memory review policy", () => {
  it("preserves a self sentence's contact dependence instead of stripping it", () => {
    const escape = checkMemoryDependence({
      scope: "self",
      subjectKind: "resolved_subject",
      subjectId: "contact-1",
      relationshipKind: "none",
      relationshipContextId: null,
    });
    expect(escape.ok).toBe(false);
    expect(escape.judgment).toBe("self_scope_escape");
    expect(checkMemoryDependence(ownerSelf).ok).toBe(true);
    expect(
      checkMemoryDependence({
        scope: "relationship",
        subjectKind: "resolved_subject",
        subjectId: "p1",
        relationshipKind: "none",
        relationshipContextId: null,
      }).judgment,
    ).toBe("ambiguous_attribution");
  });

  it("admits grounded, attributed statements and refuses prohibited or ungrounded ones", () => {
    const base = {
      scope: "person" as const,
      operation: "add" as const,
      statement_kind: "fact" as const,
      display_text: "Chen says he owns the design system this quarter.",
      speaker: "陈宇",
      reporter: null,
      valid_time: null,
      observed_time: null,
      time_status: "known" as const,
      sensitivity: "normal" as const,
      source_excerpt: "他目前负责设计系统",
      source_locator: { kind: "message" as const, session_id: null, message_id: null },
      reason: "Useful next time",
    };
    const dependence: MemoryDependence = {
      scope: "person",
      subjectKind: "resolved_subject",
      subjectId: "p1",
      relationshipKind: "none",
      relationshipContextId: null,
    };
    const context = {
      sourceText: "他说他目前负责设计系统",
      admittedArtifactIds: [] as string[],
      existingDisplayTexts: [] as string[],
      dependence,
      previousTargetStatus: "not_requested" as const,
    };
    expect(classifyMemoryAdmission(base, context).status).toBe("eligible");
    expect(
      classifyMemoryAdmission(
        { ...base, source_excerpt: "not present" },
        context,
      ).status,
    ).toBe("ineligible");
    expect(
      classifyMemoryAdmission(
        { ...base, display_text: "Chen is unreliable and emotionally difficult." },
        context,
      ).status,
    ).toBe("ineligible");
    expect(describesProhibitedPersonInference("陈宇性格很好")).toBe(true);
    expect(isGroundedExcerpt("负责设计系统", context.sourceText)).toBe(true);
    expect(isGroundedExcerpt("负责设计系统", null)).toBe(false);
  });

  it("routes sensitive, conflict, stale-target, and unnamed-speaker cases to judgment", () => {
    const ctx = (previousTargetStatus: "not_requested" | "valid" | "stale") => ({
      sourceText: "只有这句话",
      admittedArtifactIds: [] as string[],
      existingDisplayTexts: [] as string[],
      dependence: {
        scope: "relationship" as const,
        subjectKind: "resolved_subject" as const,
        subjectId: "p1",
        relationshipKind: "resolved_context" as const,
        relationshipContextId: "c1",
      },
      previousTargetStatus,
    });
    const base = {
      scope: "relationship" as const,
      operation: "add" as const,
      statement_kind: "source_statement" as const,
      display_text: "A dependency.",
      speaker: "陈宇",
      reporter: null,
      valid_time: null,
      observed_time: null,
      time_status: "known" as const,
      sensitivity: "normal" as const,
      source_excerpt: "只有这句话",
      source_locator: { kind: "message" as const, session_id: null, message_id: null },
      reason: "why",
    };
    expect(classifyMemoryAdmission({ ...base, sensitivity: "sensitive" }, ctx("not_requested")).judgment).toBe("sensitive");
    expect(classifyMemoryAdmission({ ...base, operation: "contest" }, ctx("not_requested")).judgment).toBe("conflict");
    expect(classifyMemoryAdmission(base, ctx("stale")).judgment).toBe("stale_target");
    expect(classifyMemoryAdmission({ ...base, reporter: "B", speaker: null }, ctx("not_requested")).judgment).toBe("ambiguous_attribution");
    expect(defaultSelectionForChange("needs_judgment", "new", "add")).toBe(false);
    expect(defaultSelectionForChange("eligible", "new", "add")).toBe(true);
    expect(defaultSelectionForChange("eligible", "conflict", "contest")).toBe(false);
  });

  it("keeps future plans distinct from current facts", () => {
    expect(
      classifyTemporalRelation(
        { displayText: "Plan to send the prototype Friday", timeStatus: "future" },
        { display_text: "Sent the prototype", time_status: "past", valid_time: "2026-09-21T00:00:00.000Z", operation: "update" },
      ),
    ).toBe("update");
    expect(
      classifyTemporalRelation(
        { displayText: "Located in Shanghai", timeStatus: "known" },
        { display_text: "Located in Beijing", time_status: "known", valid_time: "2026-09-21T00:00:00.000Z", operation: "contest" },
      ),
    ).toBe("conflict");
    expect(
      classifyTemporalRelation(
        { displayText: "Same", timeStatus: "known" },
        { display_text: "same", time_status: "known", valid_time: null, operation: "add" },
      ),
    ).toBe("no_change");
    expect(isExactDuplicate("Same", ["same", "other"])).toBe(true);
  });

  it("validates judgments, contact binding, and frozen visibility server-side", () => {
    const conflict = item({ judgment_kind: "conflict", admission_status: "needs_judgment" });
    const ordinary = item({ id: "ordinary" });
    const selfEscape = item({
      id: "escape",
      scope: "self",
      subject_kind: "resolved_subject",
      subject_id: "contact-1",
      judgment_kind: "self_scope_escape",
      admission_status: "needs_judgment",
    });
    const late = item({ id: "late", added_revision: 2 });
    const base = {
      frozenRevision: 1,
      surface: "chat" as const,
      contactDecision: "existing" as const,
      contactStatus: "resolved" as const,
      items: [conflict, ordinary, selfEscape, late],
    };
    expect(
      validateMemorySelection({
        ...base,
        selectedItemIds: [conflict.id],
        itemDecisions: {},
      }),
    ).toMatchObject({ ok: false, code: "MEMORY_DECISION_REQUIRED" });
    expect(
      validateMemorySelection({
        ...base,
        selectedItemIds: [conflict.id],
        itemDecisions: { [conflict.id]: "keep_old" },
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateMemorySelection({
        ...base,
        selectedItemIds: [conflict.id],
        itemDecisions: { [conflict.id]: "accept" },
      }),
    ).toMatchObject({ ok: false, code: "MEMORY_CONFLICT_DECISION_REQUIRED" });
    expect(
      validateMemorySelection({
        ...base,
        contactDecision: "none",
        selectedItemIds: [ordinary.id],
        itemDecisions: {},
      }),
    ).toMatchObject({ ok: false, code: "MEMORY_CONTACT_REQUIRED" });
    expect(
      validateMemorySelection({
        ...base,
        contactDecision: "new",
        selectedItemIds: [ordinary.id],
        itemDecisions: {},
      }),
    ).toMatchObject({ ok: false, code: "MEMORY_CONTACT_BINDING_MISMATCH" });
    const sensitive = item({
      id: "sensitive",
      judgment_kind: "sensitive",
      admission_status: "needs_judgment",
    });
    expect(
      validateMemorySelection({
        ...base,
        items: [sensitive],
        selectedItemIds: [sensitive.id],
        itemDecisions: { [sensitive.id]: "accept" },
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateMemorySelection({
        ...base,
        items: [sensitive],
        selectedItemIds: [sensitive.id],
        itemDecisions: { [sensitive.id]: "retain_conflict" },
      }),
    ).toMatchObject({ ok: false, code: "MEMORY_DECISION_INVALID" });
    expect(
      validateMemorySelection({
        ...base,
        selectedItemIds: [selfEscape.id],
        itemDecisions: {},
      }),
    ).toMatchObject({ ok: false, code: "MEMORY_SELF_SCOPE_ESCAPE" });
    expect(
      validateMemorySelection({
        ...base,
        selectedItemIds: [late.id],
        itemDecisions: {},
      }),
    ).toMatchObject({ ok: false, code: "MEMORY_ITEM_NOT_IN_FROZEN_REVIEW" });
    expect(
      validateMemorySelection({
        ...base,
        surface: "relationship",
        selectedItemIds: [ordinary.id],
        itemDecisions: {},
      }),
    ).toMatchObject({ ok: false, code: "MEMORY_ITEM_NOT_IN_FROZEN_REVIEW" });
  });

  it("treats any changed display text as user-edited and never as extra evidence", () => {
    expect(editedTextIsUserAugmented("Only designs systems", "Only designs systems and seeks a new job")).toBe(true);
    expect(editedTextIsUserAugmented("Only designs systems", "Only designs systems")).toBe(false);
    expect(decisionWritesNewItem("keep_old")).toBe(false);
    expect(decisionWritesNewItem("retain_conflict")).toBe(true);
    expect(surfaceAllowsScope("relationship", "person")).toBe(false);
    expect(surfaceAllowsScope("people", "self")).toBe(false);
    expect(surfaceAllowsScope("chat", "self")).toBe(true);
  });

  it("gates undo and contact reclaim on later dependence", () => {
    expect(undoIsCompensable({ itemStatus: "active", itemVersion: 1, latestVersion: 1, laterCommitTouchesItem: false }).safe).toBe(true);
    expect(undoIsCompensable({ itemStatus: "superseded", itemVersion: 1, latestVersion: 2, laterCommitTouchesItem: true }).safe).toBe(false);
    expect(contactReclaimIsSafe({ laterSourceCount: 0, laterMemoryItemCount: 0, laterAssignmentCount: 0 })).toBe(true);
    expect(contactReclaimIsSafe({ laterSourceCount: 0, laterMemoryItemCount: 0, laterAssignmentCount: 1 })).toBe(false);
    expect(evidenceIsAvailable({ itemStatus: "active", evidenceStatus: "active", sourceDeleted: false, authorizationRevoked: false })).toBe(true);
    expect(evidenceIsAvailable({ itemStatus: "active", evidenceStatus: "active", sourceDeleted: false, authorizationRevoked: true })).toBe(false);
  });
});


describe("item-scoped Memory decisions", () => {
  it("keeps untouched siblings pending while an older batch commit still skips them", () => {
    const visible = [{ id: "first" }, { id: "second" }, { id: "third" }];
    expect(skippedVisibleItemIds(visible, ["first"], "item")).toEqual([]);
    expect(skippedVisibleItemIds(visible, ["first"], "batch")).toEqual(["second", "third"]);
  });
});
