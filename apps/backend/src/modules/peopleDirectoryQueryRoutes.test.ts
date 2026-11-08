import { createHash } from "node:crypto";
import { CONTRACT_VERSION, normalizeIdentityHandle } from "@talent-signal/contracts";
import Fastify from "fastify";
import type { Pool } from "pg";
import { afterEach, expect, it } from "vitest";

import { ApiError } from "../lib/apiError.js";
import type { AuthContext } from "./auth.js";
import { registerPeopleRoutes } from "./peopleRoutes.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const credential = "Bearer synthetic-directory-route-access";
const methods = ["GET", "POST"] as const;
type Method = typeof methods[number];
const apps: ReturnType<typeof Fastify>[] = [];

function fixture() {
  const app = Fastify({ logger: false }); apps.push(app);
  const queries: { sql: string; values: unknown[] }[] = [];
  let authDeliveries = 0;
  const pool = { query: async (sql: string, values: unknown[] = []) => {
    queries.push({ sql, values: [...values] }); return { rows: [] };
  } } as unknown as Pool;
  app.decorateRequest("auth", null as unknown as AuthContext);
  // Transport binding for the existing 4xx ErrorResponseSchema, as in other
  // route tests. It does not validate queries or replace any route/schema/
  // domain handler. The app.ts global error owner still needs its own proof.
  app.setErrorHandler((error, request, reply) => {
    const schemaFailure = Boolean((error as { validation?: unknown }).validation);
    const status = error instanceof ApiError ? error.statusCode : schemaFailure ? 400 : 500;
    const code = error instanceof ApiError ? error.code : schemaFailure ? "REQUEST_VALIDATION_FAILED" : "UNEXPECTED_FIXTURE_FAILURE";
    void reply.status(status).send({ error: { code, request_id: request.id,
      message: error instanceof ApiError ? error.message : "Synthetic request could not be completed." } });
  });
  registerPeopleRoutes(app, pool, async request => {
    authDeliveries++;
    if (request.headers.authorization !== credential) throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Synthetic authentication required.");
    request.auth = { accountId, accountSlug: "synthetic-directory", userId: "22222222-2222-4222-8222-222222222222",
      userEmail: "directory@example.invalid", userKind: "password_human", sessionId: "33333333-3333-4333-8333-333333333333" };
  });
  function send(method: Method, query?: unknown, authorized = true) {
    // An HTTP GET query is wire text. Do not repair a lone surrogate with
    // URLSearchParams and pretend that tests the original malformed string;
    // escaped surrogate JSON is tested through the actual POST parser below.
    if (method === "GET" && query !== undefined && typeof query !== "string") {
      throw new Error("Synthetic GET query must be wire text.");
    }
    const url = method === "GET" ? `/v1/people${query === undefined ? "" : `?query=${encodeURIComponent(query as string)}`}` : "/v1/people/search";
    return app.inject({ method, url, headers: authorized ? { authorization: credential } : {},
      ...(method === "POST" ? { payload: query === undefined ? {} : { query } } : {}) });
  }
  return { app, send, queries, authDeliveries: () => authDeliveries };
}

afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

it.each(methods)("%s ordinary query reaches the actual account-bound domain after authentication", async method => {
  const f = fixture(), response = await f.send(method, "Reader");
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ contract_version: CONTRACT_VERSION, people: [] });
  expect(f.authDeliveries()).toBe(1);
  expect(f.queries.map(query => query.values)).toEqual([[accountId, "reader", null, null, null]]);
});

it.each(methods)("%s does not query people without the existing authentication delivery", async method => {
  const f = fixture(), response = await f.send(method, "Reader", false);
  expect(response.statusCode).toBe(401);
  expect(response.json()).toMatchObject({ error: { code: "AUTHENTICATION_REQUIRED" } });
  expect(f.authDeliveries()).toBe(1); expect(f.queries).toEqual([]);
});

it.each(methods.flatMap(method => [
  { method, label: "ASCII", query: "a".repeat(500) },
  { method, label: "supplementary Unicode", query: "😀".repeat(500) },
]))("$method admits complete 500-scalar $label independently of result capacity", async ({ method, query }) => {
  const f = fixture(), response = await f.send(method, query);
  expect(response.statusCode).toBe(200);
  expect(f.queries.map(value => value.values)).toEqual([[accountId, query, null, null, null]]);
  expect(f.queries[0]?.sql).toContain("LIMIT 200");
});

it.each(methods)("%s preserves distinguishing tails after character160 through real schema and domain dispatch", async method => {
  const f = fixture(), prefix = `Shared directory ${"a".repeat(160)}`;
  const values = [`${prefix} first`, `${prefix} second`] as const;
  expect(values[0].slice(0, 160)).toBe(values[1].slice(0, 160));
  for (const query of values) expect((await f.send(method, query)).statusCode).toBe(200);
  expect(f.queries.map(query => query.values)).toEqual(values.map(query => [accountId, query.toLowerCase(), null, null, null]));
});

it("keeps the existing POST handle hash and GET name-only authority for a complete long email", async () => {
  const email = `Reader.${"a".repeat(48)}@${"b".repeat(60)}.${"c".repeat(55)}.example.invalid`;
  const normalized = normalizeIdentityHandle("email", email);
  if (normalized === null) throw new Error("Synthetic identity fixture is invalid.");
  const post = fixture(); expect((await post.send("POST", email)).statusCode).toBe(200);
  expect(post.queries.map(query => query.values)).toEqual([[accountId, "", "email", createHash("sha256").update(normalized).digest("hex"), null]]);
  const get = fixture(); expect((await get.send("GET", email)).statusCode).toBe(200);
  expect(get.queries.map(query => query.values)).toEqual([[accountId, email.toLowerCase(), null, null, null]]);
});

const refusedText = [
  { label: "raw scalar limit", query: "a".repeat(501) },
  { label: "raw whitespace before trim", query: `${" ".repeat(500)}a` },
  { label: "complete NFKC expansion", query: "ﬃ".repeat(170) },
  { label: "NUL", query: "Reader\0Tail" },
];
it.each(methods.flatMap(method => refusedText.map(value => ({ method, ...value }))))(
  "$method explicitly refuses $label before auth delivery or People SQL", async ({ method, query }) => {
    const f = fixture(), response = await f.send(method, query);
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: { code: string; message: string } }>();
    expect(body.error.code).toEqual(expect.any(String));
    expect(body.error.message).toBeTruthy();
    expect(body.error.message).not.toContain(query);
    expect(f.authDeliveries()).toBe(0); expect(f.queries).toEqual([]);
});

it.each([
  { label: "number", query: 42 },
  { label: "single-element array", query: ["Reader"] },
])("POST rejects a provided $label before Ajv can coerce it into authorized query text", async ({ query }) => {
  const f = fixture(), response = await f.send("POST", query);
  expect(response.statusCode).toBe(400);
  expect(f.authDeliveries()).toBe(0); expect(f.queries).toEqual([]);
});

it.each([
  { label: "high", query: "Reader\ud800Tail" },
  { label: "low", query: "Reader\udfffTail" },
])("POST refuses an escaped $label surrogate carried by real JSON before domain dispatch", async ({ query }) => {
  const f = fixture(), response = await f.send("POST", query);
  expect(response.statusCode).toBe(400);
  expect(f.authDeliveries()).toBe(0); expect(f.queries).toEqual([]);
});

it("retains optional GET, POST minLength and whitespace semantics without normalizing the body before schema validation", async () => {
  const ordinary = fixture(); expect((await ordinary.send("GET")).statusCode).toBe(200);
  expect(ordinary.queries.map(query => query.values)).toEqual([[accountId, "", null, null, null]]);
  const empty = fixture(); expect((await empty.send("POST", "")).statusCode).toBe(400); expect(empty.queries).toEqual([]);
  const whitespace = fixture(); expect((await whitespace.send("POST", " \t ")).statusCode).toBe(200);
  expect(whitespace.queries.map(query => query.values)).toEqual([[accountId, "", null, null, null]]);
});

it("refuses duplicate GET query values rather than broadening them into an ordinary list", async () => {
  const f = fixture(), response = await f.app.inject({ method: "GET", url: "/v1/people?query=one&query=two",
    headers: { authorization: credential } });
  expect(response.statusCode).toBe(400);
  expect(f.authDeliveries()).toBe(0); expect(f.queries).toEqual([]);
});
