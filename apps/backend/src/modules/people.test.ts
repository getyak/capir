import type { Pool } from "pg";
import { TalentSignalClient } from "@talent-signal/contracts";
import { describe, expect, it, vi } from "vitest";

import { sha256 } from "../lib/hash.js";
import type { AuthContext } from "./auth.js";
import {
  getPerson,
  getRelationshipScope,
  listPeople,
  searchPeople,
} from "./people.js";

const auth: AuthContext = {
  accountId: "11111111-1111-4111-8111-111111111111",
  accountSlug: "fixture-alpha",
  userId: "22222222-2222-4222-8222-222222222222",
  userEmail: "recruiter@alpha.local",
  userKind: "simulated_human",
  sessionId: "33333333-3333-4333-8333-333333333333",
};

describe("people directory", () => {
  it("returns account-scoped people and their recent relationship contexts", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          display_label: "周屿",
          context_count: 2,
          capture_count: 4,
          confirmed_identity_count: 1,
          last_activity_at: new Date("2026-08-06T10:00:00.000Z"),
          name_match: true,
          matched_handle_status: null,
          matched_handle_type: null,
          matched_handle_hint: null,
          matched_handle_source_resource_id: null,
          matched_handle_valid_until: null,
          contexts: [
            {
              id: "55555555-5555-4555-8555-555555555555",
              display_label: "VP Product · Northstar search",
              last_activity_at: "2026-08-06T10:00:00.000Z",
            },
          ],
        },
      ],
    });

    const response = await listPeople(
      { query } as unknown as Pool,
      auth,
      "  周屿  ",
    );

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[1]).toEqual([
      auth.accountId,
      "周屿",
      null,
      null,
      null,
    ]);
    expect(response.people).toEqual([
      {
        id: "44444444-4444-4444-8444-444444444444",
        display_label: "周屿",
        context_count: 2,
        capture_count: 4,
        confirmed_identity_count: 1,
        last_activity_at: "2026-08-06T10:00:00.000Z",
        profile: null,
        avatar: null,
        contexts: [
          {
            id: "55555555-5555-4555-8555-555555555555",
            display_label: "VP Product · Northstar search",
            last_activity_at: "2026-08-06T10:00:00.000Z",
          },
        ],
        identity_matches: [{ kind: "name" }],
      },
    ]);
  });

  it("returns a user-authored profile without turning it into evidence", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          display_label: "cubxxw",
          context_count: 0,
          capture_count: 0,
          confirmed_identity_count: 0,
          last_activity_at: new Date("2026-08-26T10:00:00.000Z"),
          name_match: false,
          matched_handle_status: null,
          matched_handle_type: null,
          matched_handle_hint: null,
          matched_handle_source_resource_id: null,
          matched_handle_valid_until: null,
          profile_headline: "Talent Signal 创建者",
          profile_summary: "由工作区所有者明确写入的人物介绍。",
          profile_provenance_kind: "user_authored",
          profile_authored_by_user_id: auth.userId,
          profile_revision: 1,
          profile_updated_at: new Date("2026-08-26T10:00:00.000Z"),
          contexts: [],
        },
      ],
    });

    const response = await listPeople({ query } as unknown as Pool, auth);

    expect(response.people[0]).toMatchObject({
      display_label: "cubxxw",
      capture_count: 0,
      confirmed_identity_count: 0,
      profile: {
        headline: "Talent Signal 创建者",
        summary: "由工作区所有者明确写入的人物介绍。",
        provenance_kind: "user_authored",
        authored_by_user_id: auth.userId,
        revision: 1,
        updated_at: "2026-08-26T10:00:00.000Z",
      },
    });
  });

  it("returns a recruiter-confirmed public card with governed avatar provenance", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          display_label: "周屿",
          context_count: 1,
          capture_count: 1,
          confirmed_identity_count: 1,
          last_activity_at: new Date("2026-09-02T08:00:00.000Z"),
          name_match: false,
          matched_handle_status: null,
          matched_handle_type: null,
          matched_handle_hint: null,
          matched_handle_source_resource_id: null,
          matched_handle_valid_until: null,
          profile_headline: null,
          profile_summary: null,
          profile_provenance_kind: null,
          profile_authored_by_user_id: null,
          profile_revision: null,
          profile_updated_at: null,
          public_profile_card_headline: "VP Product · Example Co.",
          public_profile_confirmed_by_user_id: auth.userId,
          public_profile_revision: 1,
          public_profile_confirmed_at: new Date("2026-09-02T08:00:00.000Z"),
          public_profile_url: "https://example.com/in/zhou-yu",
          public_profile_platform: "linkedin",
          public_profile_avatar_url: "https://example.com/avatar.jpg",
          public_profile_use_avatar: true,
          public_profile_retrieved_at: new Date("2026-09-02T07:58:00.000Z"),
          contexts: [],
        },
      ],
    });

    const response = await listPeople({ query } as unknown as Pool, auth);

    expect(query.mock.calls[0]?.[0]).toContain(
      "profile_receipts.authorization_state = 'authorized'",
    );
    expect(response.people[0]).toMatchObject({
      profile: {
        headline: "VP Product · Example Co.",
        summary: "VP Product · Example Co.",
        provenance_kind: "reviewed_public_source",
        source_profile_url: "https://example.com/in/zhou-yu",
        source_platform: "linkedin",
      },
      avatar: {
        url: "https://example.com/avatar.jpg",
        source_profile_url: "https://example.com/in/zhou-yu",
        source_platform: "linkedin",
        retrieved_at: "2026-09-02T07:58:00.000Z",
        confirmed_at: "2026-09-02T08:00:00.000Z",
      },
    });
  });

  it("finds a person by a confirmed handle without putting raw data in SQL parameters", async () => {
    const sourceResourceId =
      "66666666-6666-4666-8666-666666666666";
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          display_label: "周屿",
          context_count: 1,
          capture_count: 2,
          confirmed_identity_count: 1,
          last_activity_at: new Date("2026-08-06T10:00:00.000Z"),
          name_match: false,
          matched_handle_status: "confirmed",
          matched_handle_type: "email",
          matched_handle_hint: "z•••@example.com",
          matched_handle_source_resource_id: sourceResourceId,
          matched_handle_valid_until: new Date(
            "2027-08-06T10:00:00.000Z",
          ),
          contexts: [],
        },
      ],
    });

    const response = await searchPeople(
      { query } as unknown as Pool,
      auth,
      "ZHOU.YU@example.com",
    );

    expect(query.mock.calls[0]?.[1]).toEqual([
      auth.accountId,
      "",
      "email",
      sha256("zhou.yu@example.com"),
      null,
    ]);
    expect(query.mock.calls[0]?.[1]).not.toContain(
      "ZHOU.YU@example.com",
    );
    expect(response.people[0]?.identity_matches).toEqual([
      {
        kind: "confirmed_handle",
        handle_type: "email",
        display_hint: "z•••@example.com",
        source_resource_id: sourceResourceId,
      },
    ]);
  });

  it("returns an expired handle only as a stale review clue", async () => {
    const sourceResourceId =
      "66666666-6666-4666-8666-666666666666";
    const expiredAt = new Date("2026-08-01T00:00:00.000Z");
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          display_label: "周屿",
          context_count: 1,
          capture_count: 2,
          confirmed_identity_count: 0,
          last_activity_at: new Date("2026-08-06T10:00:00.000Z"),
          name_match: false,
          matched_handle_status: "expired",
          matched_handle_type: "email",
          matched_handle_hint: "z•••@example.com",
          matched_handle_source_resource_id: sourceResourceId,
          matched_handle_valid_until: expiredAt,
          contexts: [],
        },
      ],
    });

    const response = await searchPeople(
      { query } as unknown as Pool,
      auth,
      "zhou.yu@example.com",
    );

    expect(response.people[0]?.identity_matches).toEqual([
      {
        kind: "expired_handle",
        handle_type: "email",
        display_hint: "z•••@example.com",
        source_resource_id: sourceResourceId,
        expired_at: expiredAt.toISOString(),
      },
    ]);
    expect(query.mock.calls[0]?.[0]).toContain(
      "handles.status IN ('confirmed', 'expired')",
    );
    expect(query.mock.calls[0]?.[0]).toContain(
      "handles.valid_until > now()",
    );
    expect(query.mock.calls[0]?.[0]).toContain(
      "WHEN 'confirmed' THEN 0",
    );
    expect(query.mock.calls[0]?.[0]).toContain(
      "WHEN 'expired' THEN 1",
    );
  });

  it("keeps an unknown handle search empty instead of returning the directory", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    const response = await searchPeople(
      { query } as unknown as Pool,
      auth,
      "unknown@example.com",
    );

    expect(response.people).toEqual([]);
    expect(query.mock.calls[0]?.[0]).toContain("$2 <> ''");
    expect(query.mock.calls[0]?.[1]).toEqual([
      auth.accountId,
      "",
      "email",
      sha256("unknown@example.com"),
      null,
    ]);
  });

  it("returns only current masked contact points on the governed relationship scope", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          person_id: "44444444-4444-4444-8444-444444444444",
          person_label: "周屿",
          profile_headline: "Product leader",
          profile_summary: "Recruiter-authored orientation, not evidence.",
          profile_provenance_kind: "user_authored",
          profile_authored_by_user_id: auth.userId,
          profile_revision: 2,
          profile_updated_at: new Date("2026-08-30T09:00:00.000Z"),
          contact_points: [
            {
              id: "66666666-6666-4666-8666-666666666666",
              type: "email",
              display_hint: "z•••@example.com",
              source_resource_id:
                "77777777-7777-4777-8777-777777777777",
              source_display_name: "Reviewed contact card",
              valid_from: "2026-08-01T10:00:00.000Z",
              valid_until: "2027-08-01T10:00:00.000Z",
            },
          ],
          context_id: "55555555-5555-4555-8555-555555555555",
          context_label: "VP Product · Northstar search",
        },
      ],
    });

    const response = await getRelationshipScope(
      { query } as unknown as Pool,
      auth,
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    );

    expect(query.mock.calls[0]?.[1]).toEqual([
      auth.accountId,
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    ]);
    expect(query.mock.calls[0]?.[0]).toContain(
      "handles.status = 'confirmed'",
    );
    expect(query.mock.calls[0]?.[0]).toContain(
      "receipts.authorization_state = 'authorized'",
    );
    expect(query.mock.calls[0]?.[0]).toContain(
      "handles.source_resource_id IS NOT NULL",
    );
    expect(response).toEqual({
      contract_version: expect.any(String),
      person: {
        id: "44444444-4444-4444-8444-444444444444",
        display_label: "周屿",
        profile: {
          headline: "Product leader",
          summary: "Recruiter-authored orientation, not evidence.",
          provenance_kind: "user_authored",
          authored_by_user_id: auth.userId,
          revision: 2,
          updated_at: "2026-08-30T09:00:00.000Z",
        },
        contact_points: [
          {
            id: "66666666-6666-4666-8666-666666666666",
            type: "email",
            display_hint: "z•••@example.com",
            source_resource_id:
              "77777777-7777-4777-8777-777777777777",
            source_display_name: "Reviewed contact card",
            valid_from: "2026-08-01T10:00:00.000Z",
            valid_until: "2027-08-01T10:00:00.000Z",
          },
        ],
      },
      relationship_context: {
        id: "55555555-5555-4555-8555-555555555555",
        display_label: "VP Product · Northstar search",
      },
    });
  });
});


describe("exact person detail", () => {
  const personId = "44444444-4444-4444-8444-444444444444";
  const personRow = {
    id: personId, display_label: "Reviewed contact", context_count: 0,
    capture_count: 1, confirmed_identity_count: 1,
    last_activity_at: new Date("2026-10-13T02:00:00Z"), contexts: [],
  };

  it("applies exact identity before the directory limit and preserves conflicting reviewed sources", async () => {
    const field = { field: "company", value: "Northstar", evidence_fragment_id: "66666666-6666-4666-8666-666666666666",
      capture_id: "77777777-7777-4777-8777-777777777777", source_resource_id: "88888888-8888-4888-8888-888888888888",
      observed_at: new Date("2026-10-12T02:00:00Z"), relationship_context_id: null, source_label: "Reviewed profile" };
    const point = { id: "99999999-9999-4999-8999-999999999999", type: "email", display_hint: "z•••@example.com",
      source_resource_id: field.source_resource_id, source_display_name: field.source_label,
      valid_from: new Date("2026-10-12T02:00:00Z"), valid_until: new Date("2027-10-12T02:00:00Z") };
    const query = vi.fn().mockResolvedValueOnce({ rows: [personRow] })
      .mockResolvedValueOnce({ rows: [field, { ...field, value: "Other company", evidence_fragment_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }] })
      .mockResolvedValueOnce({ rows: [point] });
    const response = await getPerson({ query } as unknown as Pool, auth, personId);
    const exactSql = String(query.mock.calls[0]?.[0]);
    expect(exactSql.indexOf("AND ($5::uuid IS NULL OR subjects.id = $5)")).toBeLessThan(exactSql.lastIndexOf("LIMIT 200"));
    expect(query.mock.calls[0]?.[1]).toEqual([auth.accountId, "", null, null, personId]);
    expect(response.person.id).toBe(personId);
    expect(response.basic_fields.map(item => item.value)).toEqual(["Northstar", "Other company"]);
    expect(response.basic_fields[0]).toEqual({ ...field, observed_at: "2026-10-12T02:00:00.000Z" });
    expect(response.contact_points).toEqual([{ ...point, valid_from: "2026-10-12T02:00:00.000Z", valid_until: "2027-10-12T02:00:00.000Z" }]);
    const fieldSql = String(query.mock.calls[1]?.[0]);
    expect(fieldSql).toContain("fragments.review_status = 'reviewed'");
    expect(fieldSql).toContain("fragments.attributed_actor = 'recruiter'");
    expect(fieldSql).toContain("fragments.attribution_status = 'confirmed'");
    expect(fieldSql).toContain("fragments.locator ->> 'field' = ANY($3::text[])");
    expect(fieldSql).not.toContain("person_profile_observations");
    expect(fieldSql).not.toContain("inferences");
    expect(query.mock.calls[1]?.[1]?.[2]).not.toContain("handle");
    expect(query.mock.calls[1]?.[1]?.[2]).not.toContain("email");
  });

  it("returns 404 for absent, inactive or other-account identities without reading sources", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] });
    await expect(getPerson({ query } as unknown as Pool, auth, personId))
      .rejects.toMatchObject({ statusCode: 404, code: "PERSON_NOT_FOUND" });
    expect(query).toHaveBeenCalledOnce();
  });
});


it("uses the exact person URL and carries the opaque Memory pagination cursor", async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  try {
    const client = new TalentSignalClient("https://synthetic.example.test", "synthetic-token");
    await client.getPerson("44444444-4444-4444-8444-444444444444");
    await client.recallMemories({ surface: "people", person_id: "44444444-4444-4444-8444-444444444444", limit: 24, cursor: "opaque+cursor=/" });
    expect(fetch.mock.calls[0]?.[0]).toBe("https://synthetic.example.test/v1/people/44444444-4444-4444-8444-444444444444");
    const recallUrl = new URL(String(fetch.mock.calls[1]?.[0]));
    expect(recallUrl.searchParams.get("cursor")).toBe("opaque+cursor=/");
    expect(recallUrl.searchParams.get("limit")).toBe("24");
  } finally {
    vi.unstubAllGlobals();
  }
});
