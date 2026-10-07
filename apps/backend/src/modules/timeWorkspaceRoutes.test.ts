import rateLimit from "@fastify/rate-limit";
import { CONTRACT_VERSION } from "@talent-signal/contracts";
import Fastify from "fastify";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  list: vi.fn(),
  review: vi.fn(),
  put: vi.fn(),
  get: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("./timeActivities.js", () => ({
  collectTimeActivities: vi.fn(),
  listTimeActivities: mocked.list,
}));
vi.mock("./timeReview.js", () => ({
  reviewTimeRange: mocked.review,
  timeReviewFingerprint: vi.fn(),
}));
vi.mock("./timeSchedules.js", () => ({
  deleteTimeSchedule: mocked.remove,
  getTimeSchedule: mocked.get,
  putTimeSchedule: mocked.put,
}));

import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import type { RemoteChatAnswerProviding } from "./chatAnswerProvider.js";
import { registerTimeWorkspaceRoutes } from "./timeWorkspaceRoutes.js";

const app = Fastify({ logger: false });

const provider = {
  providerId: "zhipu-chat-completions",
  model: "glm-test",
  supportsImageInput: false,
  answer: vi.fn(),
} as unknown as RemoteChatAnswerProviding;

beforeAll(async () => {
  mocked.list.mockImplementation(
    async (_pool, _auth, scope: unknown, after?: string) => ({
      contract_version: CONTRACT_VERSION,
      scope,
      activities: [],
      complete: true,
      next_cursor: after ? null : null,
      snapshot_at: "2026-03-01T00:00:00.000Z",
      coverage_note: "note",
    }),
  );
  mocked.review.mockResolvedValue({
    contract_version: CONTRACT_VERSION,
    scope: { from: "2026-03-01", to: "2026-04-01", time_zone: "UTC" },
    generated_at: "2026-03-01T00:00:00.000Z",
    title: "Review",
    body: "Body",
    sources: [],
    complete: true,
    coverage_note: "note",
    authority: "unconfirmed",
    external_effect: "none",
  });
  app.decorateRequest("auth", null as unknown as AuthContext);
  await app.register(rateLimit, { global: false });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      void reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          request_id: String(request.id),
        },
      });
      return;
    }
    if ((error as { statusCode?: number }).statusCode === 429) {
      void reply.status(429).send({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests.",
          request_id: String(request.id),
        },
      });
      return;
    }
    if ((error as { validation?: unknown }).validation) {
      void reply.status(400).send({
        error: {
          code: "REQUEST_VALIDATION_FAILED",
          message: "Invalid.",
          request_id: String(request.id),
        },
      });
      return;
    }
    void reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed.",
        request_id: String(request.id),
      },
    });
  });
  registerTimeWorkspaceRoutes(
    app,
    { query: vi.fn() } as unknown as Pool,
    async (request) => {
      const account = request.headers["x-test-account"];
      if (!account) {
        throw new ApiError(401, "UNAUTHENTICATED", "Sign in first.");
      }
      const userId = String(request.headers["x-test-user"] ?? "user-a");
      request.auth = {
        accountId: String(account),
        accountSlug: String(account),
        sessionId: `${userId}-session`,
        userEmail: `${userId}@example.test`,
        userId,
        userKind: "simulated_human",
      };
    },
    provider,
  );
  await app.ready();
});

afterAll(async () => app.close());

describe("time workspace routes", () => {
  it("requires an authenticated account for activities", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/time/activities?from=2026-03-01&to=2026-03-08&time_zone=UTC",
    });
    expect(response.statusCode).toBe(401);
  });

  it("validates real dates and the 93 day cap before querying", async () => {
    const impossible = await app.inject({
      method: "GET",
      url: "/v1/time/activities?from=2026-02-30&to=2026-03-08&time_zone=UTC",
      headers: { "x-test-account": "account-a", "x-test-user": "user-a" },
    });
    expect(impossible.statusCode, impossible.body).toBe(400);
    expect(mocked.list).not.toHaveBeenCalled();

    const tooWide = await app.inject({
      method: "GET",
      url: "/v1/time/activities?from=2026-01-01&to=2026-04-10&time_zone=UTC",
      headers: { "x-test-account": "account-a", "x-test-user": "user-a" },
    });
    expect(tooWide.statusCode).toBe(400);
  });

  it("returns no-store activities for a valid scope", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/time/activities?from=2026-03-01&to=2026-03-08&time_zone=America%2FNew_York&kind=schedule",
      headers: { "x-test-account": "account-a", "x-test-user": "user-a" },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["cache-control"]).toContain("no-store");
    expect(mocked.list).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ accountId: "account-a" }),
      expect.objectContaining({
        from: "2026-03-01",
        to: "2026-03-08",
        time_zone: "America/New_York",
        kind: "schedule",
      }),
      undefined,
    );
  });

  it("rejects a malformed schedule body with the shared strict schema", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/v1/time/schedules/44444444-4444-4444-8444-444444444444",
      headers: { "x-test-account": "account-a", "x-test-user": "user-a" },
      payload: { expected_revision: 0 },
    });
    expect(response.statusCode).toBe(400);
    expect(mocked.put).not.toHaveBeenCalled();
  });

  it.each([0, 1])("preserves explicit reminder choices at revision %i", async (revision) => {
    for (const reminder of [null, 0, 5, 15, 30, 60]) {
      const payload = {
        expected_revision: revision,
        idempotency_key: "55555555-5555-4555-8555-555555555555",
        title: "Synthetic schedule",
        note: "No external invitation",
        kind: "meeting",
        person_id: null,
        starts_at: "2026-10-07T09:00:00.000Z",
        ends_at: "2026-10-07T09:30:00.000Z",
        time_zone: "Asia/Shanghai",
        all_day: false,
        status: "planned",
        reminder_minutes: reminder,
      };
      mocked.put.mockResolvedValueOnce({
        contract_version: CONTRACT_VERSION,
        schedule: {
          id: "44444444-4444-4444-8444-444444444444",
          revision: revision + 1,
          last_operation_id: payload.idempotency_key,
          created_at: payload.starts_at,
          updated_at: payload.starts_at,
          content_available: true,
          authority: "user_authored",
          external_effect: "none",
          person_label: null,
          ...payload,
        },
      });
      const response = await app.inject({
        method: "PUT",
        url: "/v1/time/schedules/44444444-4444-4444-8444-444444444444",
        headers: { "x-test-account": "account-a", "x-test-user": "user-a" },
        payload,
      });
      expect(response.statusCode, response.body).toBe(200);
      expect(mocked.put.mock.calls.at(-1)?.[3]).toEqual(payload);
    }
  });

  it.each([
    { reminder_minutes: "0" },
    { reminder_minutes: false },
    { reminder_minutes: 10 },
    { expected_revision: "0" },
    { all_day: "false" },
    { person_id: "not-a-uuid" },
    { starts_at: "2026-10-07" },
    { unexpected: "must not be stripped" },
  ])("rejects malformed choices without changing the request: %j", async (invalid) => {
    const before = mocked.put.mock.calls.length;
    const response = await app.inject({
      method: "PUT",
      url: "/v1/time/schedules/44444444-4444-4444-8444-444444444444",
      headers: { "x-test-account": "account-a", "x-test-user": "user-a" },
      payload: {
        expected_revision: 0,
        idempotency_key: "55555555-5555-4555-8555-555555555555",
        title: "Synthetic schedule", note: "", kind: "meeting", person_id: null,
        starts_at: "2026-10-07T09:00:00.000Z", ends_at: "2026-10-07T09:30:00.000Z",
        time_zone: "Asia/Shanghai", all_day: false, status: "planned", reminder_minutes: null,
        ...invalid,
      },
    });
    expect(response.statusCode, response.body).toBe(400);
    expect(mocked.put.mock.calls.length).toBe(before);
  });

  it("keeps path validation on the application compiler", async () => {
    const response = await app.inject({
      method: "PUT", url: "/v1/time/schedules/not-a-uuid",
      headers: { "x-test-account": "account-a" }, payload: {},
    });
    expect(response.statusCode).toBe(400);
  });

  it("still authenticates before committing a valid schedule", async () => {
    const before = mocked.put.mock.calls.length;
    const response = await app.inject({
      method: "PUT",
      url: "/v1/time/schedules/44444444-4444-4444-8444-444444444444",
      payload: {
        expected_revision: 0,
        idempotency_key: "55555555-5555-4555-8555-555555555555",
        title: "Synthetic schedule", note: "", kind: "meeting", person_id: null,
        starts_at: "2026-10-07T09:00:00.000Z", ends_at: "2026-10-07T09:30:00.000Z",
        time_zone: "Asia/Shanghai", all_day: false, status: "planned", reminder_minutes: null,
      },
    });
    expect(response.statusCode, response.body).toBe(401);
    expect(mocked.put.mock.calls.length).toBe(before);
  });

  it("rate limits range review per account and user", async () => {
    for (let index = 0; index < 6; index += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/time/review",
        headers: { "x-test-account": "limit-account", "x-test-user": "user-a" },
        payload: {
          scope: { from: "2026-03-01", to: "2026-04-01", time_zone: "UTC" },
          objective: "Summarize my week.",
        },
      });
      expect(response.statusCode, response.body).toBe(200);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/v1/time/review",
      headers: { "x-test-account": "limit-account", "x-test-user": "user-a" },
      payload: {
        scope: { from: "2026-03-01", to: "2026-04-01", time_zone: "UTC" },
        objective: "Summarize my week.",
      },
    });
    expect(limited.statusCode).toBe(429);
    const peer = await app.inject({
      method: "POST",
      url: "/v1/time/review",
      headers: { "x-test-account": "limit-account", "x-test-user": "user-b" },
      payload: {
        scope: { from: "2026-03-01", to: "2026-04-01", time_zone: "UTC" },
        objective: "Summarize my week.",
      },
    });
    expect(peer.statusCode).toBe(200);
  });
});
