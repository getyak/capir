import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION, type PersonDirectoryItem } from "@talent-signal/contracts";

vi.mock("server-only", () => ({}));
// The real primary/family resolver reads both request headers and cookies.
// An empty jar means these fixture cases are truly anonymous, not that auth
// was bypassed or replaced with a null-returning backend client.
const requestCookies = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: [...requestCookies].map(([name,value]) => `${name}=${value}`).join("; ") }),
  cookies: async () => ({
    get: (name: string) => requestCookies.has(name) ? { name, value: requestCookies.get(name)! } : undefined,
    getAll: () => [...requestCookies].map(([name,value]) => ({ name, value })),
    has: (name: string) => requestCookies.has(name),
  }),
}));
afterEach(() => { requestCookies.clear(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

import { encode } from "next-auth/jwt";
import { AUTH_SESSION_COOKIE } from "./backendAuth";
import { parseScreenshotCaptureDraft } from "../screenshot-capture";
import { issueScreenshotAnalysisReceipt } from "./screenshot-analysis-receipt";
import {
  commitRelationshipResource,
  commitScreenshotCapture,
  compileRelationshipKnowledge,
  deleteBackendCapture,
  getLatestRelationshipResearch,
  loadPersonMergeReversalPreview,
  mergeRelationshipPeople,
  reverseRelationshipPersonMerge,
  RELATIONSHIP_WIKI_COMPILE_OBJECTIVE,
} from "./localBackend";

const captureId = "11111111-1111-4111-8111-111111111111";
const personId = "22222222-2222-4222-8222-222222222222";
const contextId = "33333333-3333-4333-8333-333333333333";
const deletionId = "44444444-4444-4444-8444-444444444444";
const snapshotId = "55555555-5555-4555-8555-555555555555";
const seedResourceId =
  "66666666-6666-4666-8666-666666666666";
const researchTaskId =
  "77777777-7777-4777-8777-777777777777";
const mergeOperationId =
  "88888888-8888-4888-8888-888888888888";
const sourcePersonId =
  "99999999-9999-4999-8999-999999999999";
const targetPersonId =
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const movedContextId =
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const retainedContextId =
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ambiguousPersonId =
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ambiguousContextId =
  "ffffffff-ffff-4fff-8fff-ffffffffffff";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function directoryPerson(
  id: string,
  relationshipContextId: string,
): PersonDirectoryItem {
  return {
    capture_count: 1,
    confirmed_identity_count: 0,
    context_count: 1,
    contexts: [
      {
        display_label: "Chief Product Officer search",
        id: relationshipContextId,
        last_activity_at: "2026-08-30T08:00:00.000Z",
      },
    ],
    display_label: "Leila Hartmann",
    id,
    identity_matches: [{ kind: "name" }],
    last_activity_at: "2026-08-30T08:00:00.000Z",
    avatar: null,
    profile: null,
  };
}

describe("screenshot identity binding gate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a forged same-name selection before creating a capture", async () => {
    const draft = parseScreenshotCaptureDraft(
      JSON.stringify({
        platform: "line",
        captured_at: null,
        transcription_notes: [],
        messages: [
          { source_message_id: "m1", speaker: "unknown", text: "确认一下" },
        ],
        assertions: [],
        action: null,
      }),
    );
    const analysisMeta = {
      provider: "OpenRouter" as const,
      model: "anthropic/claude-opus-5",
      request_id: "generation-identity-gate",
      prompt_version: "screenshot-evidence.v2",
      source_sha256: "b".repeat(64),
      raw_image_stored_by_talent_signal: false as const,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: "a".repeat(32) }))
      .mockResolvedValueOnce(
        jsonResponse({
          contract_version: CONTRACT_VERSION,
          people: [
            directoryPerson(personId, contextId),
            directoryPerson(ambiguousPersonId, ambiguousContextId),
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      commitScreenshotCapture({
        request_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        person_id: personId,
        relationship_context_id: contextId,
        contact_name: "Leila Hartmann",
        identity_query: "Leila Hartmann",
        assignment_label: "Chief Product Officer search",
        draft,
        analysis_meta: analysisMeta,
        analysis_receipt: issueScreenshotAnalysisReceipt({
          draft,
          meta: analysisMeta,
        }),
      }),
    ).rejects.toThrow("多个无法区分的人物");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("local governed source deletion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recompiles the relationship from surviving sources after deletion", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "a".repeat(32),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: captureId,
          subject_id: personId,
          assignment_id: contextId,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          deletion_id: deletionId,
          capture_id: captureId,
          status: "deleted",
          derivatives_deleted: 3,
          access_revoked_at: "2026-08-07T00:00:00.000Z",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          deletion_id: deletionId,
          capture_id: captureId,
          access_revoked_at: "2026-08-07T00:00:00.000Z",
          completed_at: "2026-08-07T00:00:01.000Z",
          lineage: [],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: snapshotId,
          status: "published",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await deleteBackendCapture(captureId);

    expect(result.compilation).toMatchObject({
      id: snapshotId,
      status: "published",
    });
    expect(result.compilation_error).toBeNull();
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      `http://127.0.0.1:4317/v1/people/${personId}/contexts/${contextId}/wiki-compilations`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          idempotency_key: `source-deletion:${deletionId}:relationship`,
          objective:
            "Recompile the relationship from the governed sources that remain after recruiter-requested deletion",
        }),
      }),
    );
  });
});

describe("direct relationship Wiki compilation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("compiles without borrowing a non-empty chat objective", async () => {
    const requestId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "a".repeat(32),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          blocks: [],
          id: snapshotId,
          status: "published",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await compileRelationshipKnowledge({
      person_id: personId,
      relationship_context_id: contextId,
      request_id: requestId,
    });

    expect(result).toMatchObject({ id: snapshotId, status: "published" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `http://127.0.0.1:4317/v1/people/${personId}/contexts/${contextId}/wiki-compilations`,
      expect.objectContaining({
        body: JSON.stringify({
          idempotency_key: `web-wiki:${requestId}`,
          objective: RELATIONSHIP_WIKI_COMPILE_OBJECTIVE,
        }),
        method: "POST",
      }),
    );
  });

  it("rejects malformed compile scope as a client error", async () => {
    await expect(
      compileRelationshipKnowledge({
        person_id: "not-a-person",
        relationship_context_id: contextId,
        request_id: "not-a-request",
      }),
    ).rejects.toMatchObject({
      code: "wiki_compile_request_invalid",
      status: 400,
    });
  });
});

describe("local durable public research status", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores the latest task for a reopened seed resource", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "a".repeat(32),
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          contract_version: "2026-08-06",
          task_id: researchTaskId,
          seed_resource_id: seedResourceId,
          status: "running",
          authorization_scope:
            "example.com · maximum 1 page · link depth 0",
          pages: [],
          warnings: [],
          created_at: "2026-08-07T00:00:00.000Z",
          completed_at: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result =
      await getLatestRelationshipResearch(seedResourceId);

    expect(result).toMatchObject({
      task_id: researchTaskId,
      seed_resource_id: seedResourceId,
      status: "running",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `http://127.0.0.1:4317/v1/research-tasks/latest?seed_resource_id=${seedResourceId}`,
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: `Bearer ${"a".repeat(32)}`,
        }),
      }),
    );
  });
});

describe("local reversible person merge workflow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recompiles every retained relationship after applying a merge", async () => {
    const merge = {
      contract_version: "2026-08-06",
      operation_id: mergeOperationId,
      status: "applied",
      source_person_id: sourcePersonId,
      target_person_id: targetPersonId,
      source_person_version: 2,
      target_person_version: 2,
      affected_relationship_context_ids: [movedContextId],
      relationship_context_ids_requiring_recompilation: [
        movedContextId,
        retainedContextId,
      ],
      captures_rebound: 1,
      states_rebound: 0,
      identity_handles_rebound: 0,
      research_tasks_rebound: 0,
      knowledge_snapshots_invalidated: [],
      reversal_available: true,
      decided_at: "2026-08-07T00:00:00.000Z",
      reversed_at: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "a".repeat(32) }),
      )
      .mockResolvedValueOnce(jsonResponse(merge))
      .mockResolvedValueOnce(
        jsonResponse({ id: snapshotId, status: "published" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          status: "abstained",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await mergeRelationshipPeople({
      idempotency_key: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      source_person_id: sourcePersonId,
      target_person_id: targetPersonId,
      expected_source_version: 1,
      expected_target_version: 1,
      expected_preview_digest: "f".repeat(64),
      decision: "merge_people",
      reason: "Reviewed synthetic duplicate evidence.",
    });

    expect(result.compilations).toHaveLength(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `http://127.0.0.1:4317/v1/people/${targetPersonId}/contexts/${movedContextId}/wiki-compilations`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      `http://127.0.0.1:4317/v1/people/${targetPersonId}/contexts/${retainedContextId}/wiki-compilations`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("recompiles moved contexts on the restored source after reversal", async () => {
    const reversal = {
      contract_version: "2026-08-06",
      operation_id: mergeOperationId,
      status: "reversed",
      source_person_id: sourcePersonId,
      target_person_id: targetPersonId,
      source_person_version: 3,
      target_person_version: 3,
      affected_relationship_context_ids: [movedContextId],
      relationship_context_ids_requiring_recompilation: [
        movedContextId,
        retainedContextId,
      ],
      captures_rebound: 1,
      states_rebound: 0,
      identity_handles_rebound: 0,
      research_tasks_rebound: 0,
      knowledge_snapshots_invalidated: [],
      reversal_available: false,
      decided_at: "2026-08-07T00:00:00.000Z",
      reversed_at: "2026-08-07T00:01:00.000Z",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "a".repeat(32) }),
      )
      .mockResolvedValueOnce(jsonResponse(reversal))
      .mockResolvedValueOnce(
        jsonResponse({ id: snapshotId, status: "published" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          status: "published",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await reverseRelationshipPersonMerge(
      mergeOperationId,
      {
        idempotency_key: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        decision: "reverse_person_merge",
        reason: "Synthetic split review.",
      },
    );

    expect(result.compilations).toHaveLength(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `http://127.0.0.1:4317/v1/people/${sourcePersonId}/contexts/${movedContextId}/wiki-compilations`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      `http://127.0.0.1:4317/v1/people/${targetPersonId}/contexts/${retainedContextId}/wiki-compilations`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reloads a person-merge reversal review without mutating the operation", async () => {
    const preview = {
      contract_version: "2026-08-06",
      operation_id: mergeOperationId,
      status: "applied",
      source_person: {
        id: sourcePersonId,
        display_label: "Duplicate contact",
        status: "merged",
      },
      target_person: {
        id: targetPersonId,
        display_label: "Retained contact",
        status: "active",
      },
      contexts_to_restore: [
        {
          id: movedContextId,
          display_label: "VP Product search",
          active_capture_count: 3,
          active_fact_count: 1,
        },
      ],
      original_reason: "Reviewed synthetic duplicate evidence.",
      decided_at: "2026-08-07T00:00:00.000Z",
      reversed_at: null,
      blockers: [],
      reversal_available: true,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "a".repeat(32) }),
      )
      .mockResolvedValueOnce(jsonResponse(preview));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadPersonMergeReversalPreview(mergeOperationId),
    ).resolves.toEqual(preview);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `http://127.0.0.1:4317/v1/person-merges/${mergeOperationId}/reversal`,
      expect.objectContaining({ method: "GET" }),
    );
  });
});

describe("governed resource observation time validation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function noteInput(capturedAt: unknown) {
    return {
      request_id: "11111111-1111-4111-8111-111111111111",
      captured_at: capturedAt,
      person_id: personId,
      relationship_context_id: contextId,
      channel: "chat",
      kind: "personal_note",
      display_name: "Synthetic note",
      media_type: "text/plain",
      fragments: [
        {
          client_resource_id:
            "web-resource:11111111-1111-4111-8111-111111111111",
          kind: "note_revision",
          sequence: 0,
          text: "Synthetic note body",
          locator: { kind: "note_revision", revision: 1 },
          attribution: { actor_kind: "recruiter", status: "confirmed" },
          review_status: "reviewed",
          parser: { name: "direct-note-input", version: "1.0.0" },
        },
      ],
    } as unknown as Parameters<typeof commitRelationshipResource>[0];
  }

  it("rejects a missing captured_at with a friendly validation error before any backend call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      commitRelationshipResource(noteInput(undefined)),
    ).rejects.toThrow(
      "无法确认该来源的观察时间，未保存任何内容。请刷新页面后重新提交。",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed captured_at without a raw RangeError and never invents one", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const caught = await commitRelationshipResource(
      noteInput("Friday, August 7"),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).not.toBe("RangeError");
    expect((caught as Error).message).toBe(
      "无法确认该来源的观察时间，未保存任何内容。请刷新页面后重新提交。",
    );
    // Product copy must not expose internal format names or request plumbing.
    expect((caught as Error).message).not.toMatch(/ISO|时间戳|request/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("real renewable-session resolver before local backend IO", () => {
  const accountId = "10000000-0000-4000-8000-000000000001";
  const userId = "10000000-0000-4000-8000-000000000002";
  const sessionId = "10000000-0000-4000-8000-000000000003";
  async function installedRenewableCookie() {
    vi.stubEnv("AUTH_SECRET", "local-backend-renewable-test-secret");
    const token = await encode({ secret: "local-backend-renewable-test-secret", salt: AUTH_SESSION_COOKIE, maxAge: 400 * 86400,
      token: { backendAccountId: accountId, backendUserId: userId, backendSessionId: sessionId, backendAccessToken: "a".repeat(43),
        backendRenewalSecret: "s".repeat(43), backendExpiresAt: "2000-01-01T00:00:00Z", backendAccountName: "Fixture owner",
        backendAccountSlug: "fixture-owner", backendUsername: null, backendRole: "member" } });
    requestCookies.set(AUTH_SESSION_COOKIE, token);
  }
  const live = () => ({ contract_version: CONTRACT_VERSION, session_id: sessionId, access_token: "b".repeat(43),
    expires_at: new Date(Date.now() + 3600000).toISOString(), account: { id: accountId, name: "Fixture owner", slug: "fixture-owner" },
    user: { id: userId, username: null, email: "fixture@example.invalid", display_name: "Fixture", role: "member", kind: "password_human" } });

  it("renews an expired access cookie through the actual resolver and uses its current bearer without fixture login", async () => {
    await installedRenewableCookie();
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(live())).mockResolvedValueOnce(jsonResponse(live()))
      .mockResolvedValueOnce(jsonResponse({ task_id: researchTaskId, seed_resource_id: seedResourceId, status: "running" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getLatestRelationshipResearch(seedResourceId)).resolves.toMatchObject({ task_id: researchTaskId });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:4317/v1/auth/persistent/renew");
    expect(fetchMock.mock.calls[1][0]).toBe("http://127.0.0.1:4317/v1/auth/session");
    expect(fetchMock.mock.calls[2][0]).toBe(`http://127.0.0.1:4317/v1/research-tasks/latest?seed_resource_id=${seedResourceId}`);
    expect(fetchMock.mock.calls[2][1].headers.authorization).toBe(`Bearer ${"b".repeat(43)}`);
  });

  it.each([
    [401, "PERSISTENT_SESSION_REVOKED", "backend_session_expired"],
    [503, "UPSTREAM_UNAVAILABLE", "session_temporarily_unavailable"],
  ])("does not fall back to fixture authority after a real resolver %s/%s failure", async (status, code, expected) => {
    await installedRenewableCookie();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: { code } }, { status: status as number }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getLatestRelationshipResearch(seedResourceId)).rejects.toMatchObject({ code: expected });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:4317/v1/auth/persistent/renew");
  });
});
