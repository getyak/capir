import type {
  IdentityHandleHint,
  PersonScopeIntent,
  RelationshipContextIntent,
} from "@talent-signal/contracts";
import { normalizeIdentityHandle } from "@talent-signal/contracts";

export { normalizeIdentityHandle } from "@talent-signal/contracts";

export type ConfirmedIdentityHandle = {
  type: IdentityHandleHint["type"];
  value: string;
};

export type ExistingPersonIdentity = {
  personId: string;
  displayLabel: string;
  confirmedHandles: ConfirmedIdentityHandle[];
};

function key(handle: ConfirmedIdentityHandle): string | null {
  const normalized = normalizeIdentityHandle(handle.type, handle.value);
  return normalized === null ? null : `${handle.type}:${normalized}`;
}

export function resolveIdentityCandidates(input: {
  displayNameHint?: string;
  hints: IdentityHandleHint[];
  existingPeople: ExistingPersonIdentity[];
  relationshipContext?: RelationshipContextIntent;
}): PersonScopeIntent {
  const confirmedIndex = new Map<string, Set<string>>();
  for (const person of input.existingPeople) {
    for (const handle of person.confirmedHandles) {
      const handleKey = key(handle);
      if (!handleKey) {
        continue;
      }
      const people = confirmedIndex.get(handleKey) ?? new Set<string>();
      people.add(person.personId);
      confirmedIndex.set(handleKey, people);
    }
  }

  const reasonsByPerson = new Map<string, Set<string>>();
  const normalizedHints = new Set<string>();
  for (const hint of input.hints) {
    const normalized = normalizeIdentityHandle(hint.type, hint.value);
    if (normalized === null) {
      continue;
    }
    const hintKey = `${hint.type}:${normalized}`;
    if (normalizedHints.has(hintKey)) {
      continue;
    }
    normalizedHints.add(hintKey);
    for (const personId of confirmedIndex.get(hintKey) ?? []) {
      const reasons = reasonsByPerson.get(personId) ?? new Set<string>();
      reasons.add(`Confirmed ${hint.type} handle matched.`);
      reasonsByPerson.set(personId, reasons);
    }
  }

  const candidates = [...reasonsByPerson.keys()].sort();
  if (candidates.length === 1) {
    const candidatePersonId = candidates[0] as string;
    return {
      status: "proposed",
      candidate_person_id: candidatePersonId,
      ...(input.relationshipContext
        ? { relationship_context: input.relationshipContext }
        : {}),
      match_reasons: [
        ...(reasonsByPerson.get(candidatePersonId) ?? new Set<string>()),
      ],
      reason:
        "One existing person matches confirmed identity handles; human confirmation is still required.",
    };
  }

  if (candidates.length > 1) {
    return {
      status: "candidates",
      candidate_person_ids: candidates,
      ...(input.relationshipContext
        ? { relationship_context: input.relationshipContext }
        : {}),
      reason:
        "The supplied identity handles conflict across more than one existing person.",
    };
  }

  return {
    status: "unresolved",
    ...(input.displayNameHint
      ? { display_name_hint: input.displayNameHint }
      : {}),
    handles: input.hints,
    ...(input.relationshipContext
      ? { relationship_context: input.relationshipContext }
      : {}),
    reason:
      normalizedHints.size === 0
        ? "No usable confirmed identity handle was supplied."
        : "No existing person matches the supplied confirmed identity handles.",
  };
}
