import type { PersonDirectoryItem } from "@talent-signal/contracts";

export type AgentPersonTarget =
  | {
      mode: "existing_context";
      person: PersonDirectoryItem;
      relationshipContext: PersonDirectoryItem["contexts"][number];
    }
  | {
      mode: "existing_person_new_context";
      person: PersonDirectoryItem;
    }
  | {
      mode: "new_person";
    };

export type AgentPersonOutcome =
  | "created_person"
  | "created_relationship_context"
  | "reused_relationship";

export type AgentPersonScopeFields =
  | {
      contact_name: string;
      relationship_context_label: string;
      scope_mode: "new_person";
    }
  | {
      person_id: string;
      relationship_context_id: string;
      scope_mode: "existing";
    }
  | {
      contact_name: string;
      person_id: string;
      relationship_context_label: string;
      scope_mode: "existing_person_new_context";
    };

export function normalizePersonName(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function exactPersonNameMatches(
  name: string,
  people: PersonDirectoryItem[],
): PersonDirectoryItem[] {
  const normalizedName = normalizePersonName(name);
  if (!normalizedName) {
    return [];
  }
  return people.filter(
    (person) => normalizePersonName(person.display_label) === normalizedName,
  );
}

export function confirmedHandlePersonMatches(
  people: PersonDirectoryItem[],
): PersonDirectoryItem[] {
  return people.filter((person) =>
    person.identity_matches.some(
      (match) => match.kind === "confirmed_handle",
    ),
  );
}

export function expiredHandlePersonMatches(
  people: PersonDirectoryItem[],
): PersonDirectoryItem[] {
  return people.filter((person) =>
    person.identity_matches.some(
      (match) => match.kind === "expired_handle",
    ),
  );
}

export type PersonIdentityTemporalRole =
  | "current"
  | "historical"
  | "name_only";

export function personIdentityTemporalRole(
  person: PersonDirectoryItem,
): PersonIdentityTemporalRole {
  if (confirmedHandlePersonMatches([person]).length > 0) {
    return "current";
  }
  if (expiredHandlePersonMatches([person]).length > 0) {
    return "historical";
  }
  return "name_only";
}

export function canSelectPersonForIdentityClue(
  person: PersonDirectoryItem,
  matches: PersonDirectoryItem[],
): boolean {
  const currentOwners = confirmedHandlePersonMatches(matches);
  return (
    currentOwners.length === 0 ||
    currentOwners.some((owner) => owner.id === person.id)
  );
}

export function mergePersonDirectoryMatches(
  groups: PersonDirectoryItem[][],
): PersonDirectoryItem[] {
  const merged = new Map<string, PersonDirectoryItem>();
  for (const group of groups) {
    for (const person of group) {
      const current = merged.get(person.id);
      if (!current) {
        merged.set(person.id, person);
        continue;
      }
      const contexts = new Map(
        current.contexts.map((context) => [context.id, context]),
      );
      for (const context of person.contexts) {
        contexts.set(context.id, context);
      }
      const identityMatches = new Map(
        current.identity_matches.map((match) => [
          JSON.stringify(match),
          match,
        ]),
      );
      for (const match of person.identity_matches) {
        identityMatches.set(JSON.stringify(match), match);
      }
      merged.set(person.id, {
        ...current,
        context_count: Math.max(
          current.context_count,
          person.context_count,
        ),
        capture_count: Math.max(
          current.capture_count,
          person.capture_count,
        ),
        last_activity_at:
          current.last_activity_at > person.last_activity_at
            ? current.last_activity_at
            : person.last_activity_at,
        contexts: [...contexts.values()],
        identity_matches: [...identityMatches.values()],
      });
    }
  }
  return [...merged.values()].sort((left, right) => {
    const leftHandle = confirmedHandlePersonMatches([left]).length;
    const rightHandle = confirmedHandlePersonMatches([right]).length;
    if (leftHandle !== rightHandle) {
      return rightHandle - leftHandle;
    }
    const leftExpiredHandle = expiredHandlePersonMatches([left]).length;
    const rightExpiredHandle = expiredHandlePersonMatches([right]).length;
    if (leftExpiredHandle !== rightExpiredHandle) {
      return rightExpiredHandle - leftExpiredHandle;
    }
    return right.last_activity_at.localeCompare(left.last_activity_at);
  });
}

export function agentRelationshipContexts(
  person: PersonDirectoryItem,
): PersonDirectoryItem["contexts"] {
  return person.contexts;
}

export function canCreateDistinctPerson({
  name,
}: {
  differentPersonConfirmed: boolean;
  lookupState: "error" | "idle" | "loading" | "ready";
  matches: PersonDirectoryItem[];
  name: string;
}): boolean {
  // Directory matches advise the human; a failed lookup or namesake never
  // prevents an explicitly requested separate contact. Handle confirmation
  // keeps its own ownership checks after the contact is saved.
  return name.trim().length > 0;
}

export function agentPersonScopeFields(
  target: AgentPersonTarget,
  name: string,
  contextLabel: string,
): AgentPersonScopeFields {
  if (target.mode === "existing_context") {
    return {
      scope_mode: "existing",
      person_id: target.person.id,
      relationship_context_id: target.relationshipContext.id,
    };
  }
  if (target.mode === "existing_person_new_context") {
    return {
      scope_mode: "existing_person_new_context",
      person_id: target.person.id,
      contact_name: target.person.display_label,
      relationship_context_label: contextLabel.trim(),
    };
  }
  return {
    scope_mode: "new_person",
    contact_name: name.trim(),
    relationship_context_label: contextLabel.trim() || "联系人资料",
  };
}

export function agentPersonOutcome(
  target: AgentPersonTarget,
): AgentPersonOutcome {
  if (target.mode === "new_person") {
    return "created_person";
  }
  if (target.mode === "existing_person_new_context") {
    return "created_relationship_context";
  }
  return "reused_relationship";
}
