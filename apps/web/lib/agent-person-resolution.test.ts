import type { PersonDirectoryItem } from "@talent-signal/contracts";
import { describe, expect, it } from "vitest";

import {
  agentPersonOutcome,
  agentPersonScopeFields,
  agentRelationshipContexts,
  canSelectPersonForIdentityClue,
  canCreateDistinctPerson,
  confirmedHandlePersonMatches,
  expiredHandlePersonMatches,
  exactPersonNameMatches,
  mergePersonDirectoryMatches,
  personIdentityTemporalRole,
} from "./agent-person-resolution";

const person: PersonDirectoryItem = {
  id: "10000000-0000-4000-8000-000000000101",
  display_label: "陈雅宁",
  context_count: 1,
  capture_count: 3,
  confirmed_identity_count: 0,
  last_activity_at: "2026-08-07T00:00:00.000Z",
  avatar: null,
  profile: null,
  identity_matches: [{ kind: "name" }],
  contexts: [
    {
      id: "10000000-0000-4000-8000-000000000201",
      display_label: "VP Product search",
      last_activity_at: "2026-08-07T00:00:00.000Z",
    },
  ],
};

describe("Agent person resolution", () => {
  it("finds exact names after Unicode and case normalization", () => {
    expect(exactPersonNameMatches("  陈雅宁  ", [person])).toEqual([person]);
  });

  it("keeps every relationship context returned for identity choice", () => {
    const contexts = [
      person.contexts[0],
      {
        id: "10000000-0000-4000-8000-000000000202",
        display_label: "Founder network",
        last_activity_at: "2026-08-06T00:00:00.000Z",
      },
      {
        id: "10000000-0000-4000-8000-000000000203",
        display_label: "Advisor network",
        last_activity_at: "2026-08-05T00:00:00.000Z",
      },
    ];
    expect(
      agentRelationshipContexts({
        ...person,
        context_count: contexts.length,
        contexts,
      }),
    ).toEqual(contexts);
  });

  it("allows a separate contact despite an exact name match", () => {
    expect(
      canCreateDistinctPerson({
        name: "陈雅宁",
      }),
    ).toBe(true);
    expect(
      canCreateDistinctPerson({
        name: "陈雅宁",
      }),
    ).toBe(true);
  });

  it("keeps record creation independent of optional handle confirmation", () => {
    const handleOwner: PersonDirectoryItem = {
      ...person,
      identity_matches: [
        {
          kind: "confirmed_handle",
          handle_type: "email",
          display_hint: "c•••@example.com",
          source_resource_id: null,
        },
      ],
    };
    expect(confirmedHandlePersonMatches([handleOwner])).toEqual([
      handleOwner,
    ]);
    expect(
      canCreateDistinctPerson({
        name: "Another display name",
      }),
    ).toBe(true);
  });

  it("shows an expired handle as a review clue without treating it as a current owner", () => {
    const expiredHandleOwner: PersonDirectoryItem = {
      ...person,
      identity_matches: [
        {
          kind: "expired_handle",
          handle_type: "email",
          display_hint: "c•••@example.com",
          source_resource_id: null,
          expired_at: "2026-08-01T00:00:00.000Z",
        },
      ],
    };
    expect(expiredHandlePersonMatches([expiredHandleOwner])).toEqual([
      expiredHandleOwner,
    ]);
    expect(
      canCreateDistinctPerson({
        name: "Another display name",
      }),
    ).toBe(true);
    expect(
      canCreateDistinctPerson({
        name: "Another display name",
      }),
    ).toBe(true);
  });

  it("merges name and handle searches while ranking handle evidence first", () => {
    const handleOwner: PersonDirectoryItem = {
      ...person,
      identity_matches: [
        {
          kind: "confirmed_handle",
          handle_type: "phone",
          display_hint: "•••• 4567",
          source_resource_id: null,
        },
      ],
    };
    const sameNameOnly: PersonDirectoryItem = {
      ...person,
      id: "10000000-0000-4000-8000-000000000102",
      last_activity_at: "2026-08-08T00:00:00.000Z",
      identity_matches: [{ kind: "name" }],
    };

    expect(
      mergePersonDirectoryMatches([
        [person, sameNameOnly],
        [handleOwner],
      ]),
    ).toEqual([
      expect.objectContaining({
        id: person.id,
        identity_matches: expect.arrayContaining([
          { kind: "name" },
          expect.objectContaining({ kind: "confirmed_handle" }),
        ]),
      }),
      sameNameOnly,
    ]);
  });

  it("ranks an expired handle above a name-only hint but below a confirmed handle", () => {
    const expiredHandleOwner: PersonDirectoryItem = {
      ...person,
      identity_matches: [
        {
          kind: "expired_handle",
          handle_type: "phone",
          display_hint: "•••• 4567",
          source_resource_id: null,
          expired_at: "2026-08-01T00:00:00.000Z",
        },
      ],
    };
    const confirmedHandleOwner: PersonDirectoryItem = {
      ...person,
      id: "10000000-0000-4000-8000-000000000111",
      identity_matches: [
        {
          kind: "confirmed_handle",
          handle_type: "phone",
          display_hint: "•••• 4567",
          source_resource_id: null,
        },
      ],
    };
    const sameNameOnly: PersonDirectoryItem = {
      ...person,
      id: "10000000-0000-4000-8000-000000000112",
      identity_matches: [{ kind: "name" }],
    };
    expect(
      mergePersonDirectoryMatches([
        [sameNameOnly],
        [expiredHandleOwner],
        [confirmedHandleOwner],
      ]).map((match) => match.id),
    ).toEqual([
      confirmedHandleOwner.id,
      expiredHandleOwner.id,
      sameNameOnly.id,
    ]);
    expect(personIdentityTemporalRole(confirmedHandleOwner)).toBe(
      "current",
    );
    expect(personIdentityTemporalRole(expiredHandleOwner)).toBe(
      "historical",
    );
    expect(personIdentityTemporalRole(sameNameOnly)).toBe(
      "name_only",
    );
    expect(
      canSelectPersonForIdentityClue(confirmedHandleOwner, [
        confirmedHandleOwner,
        expiredHandleOwner,
      ]),
    ).toBe(true);
    expect(
      canSelectPersonForIdentityClue(expiredHandleOwner, [
        confirmedHandleOwner,
        expiredHandleOwner,
      ]),
    ).toBe(false);
  });

  it("allows explicit historical binding only when no current owner exists", () => {
    const expiredHandleOwner: PersonDirectoryItem = {
      ...person,
      identity_matches: [
        {
          kind: "expired_handle",
          handle_type: "phone",
          display_hint: "•••• 4567",
          source_resource_id: null,
          expired_at: "2026-08-01T00:00:00.000Z",
        },
      ],
    };
    expect(
      canSelectPersonForIdentityClue(expiredHandleOwner, [
        expiredHandleOwner,
      ]),
    ).toBe(true);
  });

  it("allows contact creation while optional directory lookup is unavailable", () => {
    expect(
      canCreateDistinctPerson({
        name: "陈雅宁",
      }),
    ).toBe(true);
  });

  it("binds a source to an existing person and context", () => {
    expect(
      agentPersonScopeFields(
        {
          mode: "existing_context",
          person,
          relationshipContext: person.contexts[0],
        },
        "ignored",
        "ignored",
      ),
    ).toEqual({
      scope_mode: "existing",
      person_id: person.id,
      relationship_context_id: person.contexts[0].id,
    });
  });

  it("creates a new context without creating a duplicate person", () => {
    expect(
      agentPersonScopeFields(
        { mode: "existing_person_new_context", person },
        "ignored",
        "Founder relationship",
      ),
    ).toEqual({
      scope_mode: "existing_person_new_context",
      person_id: person.id,
      contact_name: "陈雅宁",
      relationship_context_label: "Founder relationship",
    });
  });

  it("reports whether the Agent created, extended, or reused identity scope", () => {
    expect(agentPersonOutcome({ mode: "new_person" })).toBe(
      "created_person",
    );
    expect(
      agentPersonOutcome({ mode: "existing_person_new_context", person }),
    ).toBe("created_relationship_context");
    expect(
      agentPersonOutcome({
        mode: "existing_context",
        person,
        relationshipContext: person.contexts[0],
      }),
    ).toBe("reused_relationship");
  });
});
