import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./backendAuth", () => ({
  backendAuthBaseUrl: vi.fn(() => "http://127.0.0.1:55442"),
  readBackendSessionClaims: vi.fn(),
  authSecret: vi.fn(() => "get40-test-secret"),
}));
vi.mock("./contact-handoff-session", () => ({
  contactHandoffSessionVersion: vi.fn(() => "binding-1"),
}));
vi.mock("../backend-session", () => ({
  backendSessionIsExpired: vi.fn(() => false),
}));
vi.mock("../request-origin", () => ({
  isAllowedMutationOrigin: vi.fn(() => true),
}));

import { readBackendSessionClaims } from "./backendAuth";
import { backendSessionIsExpired } from "../backend-session";
import { isAllowedMutationOrigin } from "../request-origin";
import { memoryReviewRoute } from "./memoryReview";
import { mintMemoryEntryCapability, verifyMemoryEntryCapability } from "./memoryEntryCapability";

const claims = {
  backendAccountId: "acc",
  backendUserId: "user",
  backendAccessToken: "token-abc",
  backendExpiresAt: "2099-01-01T00:00:00.000Z",
} as never;

const UUID = "11111111-1111-4111-8111-111111111111";
const PERSON = "22222222-2222-4222-8222-222222222222";
const CONTEXT = "33333333-3333-4333-8333-333333333333";

function capability(purpose: "chat" | "people" | "relationship", extra: Record<string, string | null> = {}) {
  return mintMemoryEntryCapability(claims as never, { purpose, ...(purpose === "chat" ? { sessionId: UUID } : {}), ...extra });
}

function headers(token: string, extra: Record<string, string> = {}) {
  return {
    "x-workspace-session": "binding-1",
    "x-talent-signal-workspace": "acc",
    "x-memory-entry-capability": token,
    ...extra,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.mocked(readBackendSessionClaims).mockResolvedValue(claims as never);
  vi.mocked(backendSessionIsExpired).mockReturnValue(false);
  vi.mocked(isAllowedMutationOrigin).mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("same-origin Memory BFF", () => {
  it("rejects a path outside the additive allowlist", async () => {
    const response = await memoryReviewRoute(
      new Request("http://web.local/api/memory/accounts/secret"),
      ["accounts", "secret"],
    );
    expect(response.status).toBe(404);
  });

  it("requires a server-signed entry capability", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await memoryReviewRoute(
      new Request(`http://web.local/api/memory/reviews/${UUID}`, {
        headers: {
          "x-workspace-session": "binding-1",
          "x-talent-signal-workspace": "acc",
        },
      }),
      ["reviews", UUID],
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards an authenticated review read with no-store and the backend token", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        contract_version: "v",
        review: { purpose: "chat", person_id: null, relationship_context_id: null, source_session_id: UUID, pursuit_id: null },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await memoryReviewRoute(
      new Request(`http://web.local/api/memory/reviews/${UUID}`, {
        headers: headers(capability("chat"), {
          "x-memory-review-credential": "cred-1234567890",
        }),
      }),
      ["reviews", UUID],
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://127.0.0.1:55442/v1/memory/reviews/${UUID}`);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer token-abc");
    expect((init.headers as Record<string, string>)["x-memory-review-credential"]).toBe(
      "cred-1234567890",
    );
    expect(url).not.toContain("credential");
  });

  it("forwards a contact-only decision only within the signed Session", async () => {
    const fetchMock = vi.fn(async (url: string) => String(url).endsWith(`/v1/memory/reviews/${UUID}`)
      ? jsonResponse({ review: { purpose: "chat", source_session_id: UUID } })
      : jsonResponse({ receipt: { created_person_id: PERSON } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await memoryReviewRoute(new Request(`http://web.local/api/memory/reviews/${UUID}/contact-decisions`, {
      method: "POST",
      headers: headers(capability("chat"), { "content-type": "application/json", "x-memory-review-credential": "cred-1234567890" }),
      body: JSON.stringify({ display_label: "陈宇" }),
    }), ["reviews", UUID, "contact-decisions"]);
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1] as unknown as [string])[0]).toBe(`http://127.0.0.1:55442/v1/memory/reviews/${UUID}/contact-decisions`);
  });

  it("forwards one item decision only after checking the signed review lineage", async () => {
    const fetchMock = vi.fn(async (url: string) => String(url).endsWith(`/v1/memory/reviews/${UUID}`)
      ? jsonResponse({ review: { purpose: "chat", source_session_id: UUID } })
      : jsonResponse({ kind: "committed", item_id: PERSON }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await memoryReviewRoute(
      new Request(`http://web.local/api/memory/reviews/${UUID}/item-decisions`, {
        method: "POST",
        headers: headers(capability("chat"), {
          "content-type": "application/json",
          "x-memory-review-credential": "cred-1234567890",
        }),
        body: JSON.stringify({ item_id: PERSON, decision: "accept" }),
      }),
      ["reviews", UUID, "item-decisions"],
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe(`http://127.0.0.1:55442/v1/memory/reviews/${UUID}/item-decisions`);
    expect((init.headers as Record<string, string>)["x-memory-review-credential"]).toBe("cred-1234567890");
    expect(url).not.toContain("cred-1234567890");
  });

  it("rejects a stale login binding before any backend request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await memoryReviewRoute(
      new Request("http://web.local/api/memory/proposals?purpose=chat", {
        headers: { "x-workspace-session": "stale" },
      }),
      ["proposals"],
    );
    expect(response.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the backend session expired", async () => {
    vi.mocked(backendSessionIsExpired).mockReturnValue(true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await memoryReviewRoute(
      new Request("http://web.local/api/memory/proposals"),
      ["proposals"],
    );
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards an open-review mutation body to the exact backend route", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ review: { review_scope_id: UUID } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await memoryReviewRoute(
      new Request(`http://web.local/api/memory/proposals/${UUID}/reviews`, {
        method: "POST",
        headers: headers(capability("chat"), { "content-type": "application/json" }),
        body: JSON.stringify({ purpose: "chat" }),
      }),
      ["proposals", UUID, "reviews"],
    );
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`http://127.0.0.1:55442/v1/memory/proposals/${UUID}/reviews`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as { purpose: string; person_id: unknown };
    expect(body.purpose).toBe("chat");
    expect(body.person_id).toBeNull();
  });

  it("rejects a purpose claim that disagrees with the signed entry", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await memoryReviewRoute(
      new Request(`http://web.local/api/memory/proposals/${UUID}/reviews`, {
        method: "POST",
        headers: headers(capability("chat"), { "content-type": "application/json" }),
        body: JSON.stringify({ purpose: "relationship", person_id: PERSON }),
      }),
      ["proposals", UUID, "reviews"],
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a cross-site mutation before authentication", async () => {
    vi.mocked(isAllowedMutationOrigin).mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await memoryReviewRoute(
      new Request(`http://web.local/api/memory/proposals/${UUID}/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      ["proposals", UUID, "reviews"],
    );
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never exposes the owner-only raw operation or commit undo fallback", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const rawOperation = await memoryReviewRoute(
      new Request(`http://web.local/api/memory/operations/${UUID}`, {
        headers: headers(capability("chat")),
      }),
      ["operations", UUID],
    );
    expect(rawOperation.status).toBe(404);
    const rawUndo = await memoryReviewRoute(
      new Request(`http://web.local/api/memory/commits/${UUID}/undo`, {
        method: "POST",
        headers: headers(capability("chat"), { "content-type": "application/json" }),
        body: "{}",
      }),
      ["commits", UUID, "undo"],
    );
    expect(rawUndo.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows the scoped operation view and undo routes at the signed scope", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        state: "applied",
        purpose: "relationship",
        person_id: PERSON,
        relationship_context_id: CONTEXT,
        source_session_id: null,
        visible_effect_count: 0,
        undo: { allowed: true, limits: [] },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const token = capability("relationship", { personId: PERSON, contextId: CONTEXT });
    const view = await memoryReviewRoute(
      new Request(
        `http://web.local/api/memory/operation-views/${UUID}?purpose=relationship&person_id=${PERSON}&relationship_context_id=${CONTEXT}`,
        { headers: headers(token) },
      ),
      ["operation-views", UUID],
    );
    expect(view.status).toBe(200);
    const undo = await memoryReviewRoute(
      new Request(`http://web.local/api/memory/operation-views/${UUID}/undo`, {
        method: "POST",
        headers: headers(token, { "content-type": "application/json" }),
        body: JSON.stringify({ purpose: "relationship" }),
      }),
      ["operation-views", UUID, "undo"],
    );
    expect(undo.status).toBe(200);
  });

  it("rejects a business capability trying to reach a broad Chat review", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        review: {
          purpose: "chat",
          person_id: null,
          relationship_context_id: null,
          source_session_id: UUID,
          pursuit_id: null,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await memoryReviewRoute(
      new Request(`http://web.local/api/memory/reviews/${UUID}`, {
        headers: headers(capability("people", { personId: PERSON }), {
          "x-memory-review-credential": "cred-1234567890",
        }),
      }),
      ["reviews", UUID],
    );
    expect(response.status).toBe(403);
  });

  it("rejects a Chat capability against a different originating Session", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        review: {
          purpose: "chat",
          person_id: null,
          relationship_context_id: null,
          source_session_id: "99999999-9999-4999-8999-999999999999",
          pursuit_id: null,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await memoryReviewRoute(
      new Request(`http://web.local/api/memory/reviews/${UUID}`, {
        headers: headers(capability("chat", { sessionId: UUID }), {
          "x-memory-review-credential": "cred-1234567890",
        }),
      }),
      ["reviews", UUID],
    );
    expect(response.status).toBe(403);
  });

  it("never mints Chat authority for an unsigned browser Session id", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const cases = [
      { token: "", status: 403 },
      { token: capability("people", { personId: PERSON }), status: 200 },
      { token: mintMemoryEntryCapability(claims, { purpose: "chat", sessionId: UUID, stage: "bootstrap" }), status: 403 },
    ];
    for (const { token, status } of cases) {
      const response = await memoryReviewRoute(new Request("http://web.local/api/memory/entry", {
        method: "POST", headers: headers(token, { "content-type": "application/json" }), body: JSON.stringify({ session_id: UUID }),
      }), ["entry"]);
      expect(response.status).toBe(status);
      if (status === 200) expect(verifyMemoryEntryCapability((await response.json()).capability, claims)?.purpose).toBe("people");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
