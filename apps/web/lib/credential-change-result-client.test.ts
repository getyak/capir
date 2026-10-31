import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTRACT_VERSION,
  TalentSignalClient,
  TalentSignalHttpError,
  type CredentialChangeReadback,
  type ReadCredentialChangeResultRequest,
} from "@talent-signal/contracts";

const BASE_URL = "https://backend.example.test";
const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const ATTEMPT_SECRET = "synthetic-result-proof-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const ACCESS_TOKEN = "synthetic-result-reader-access-token";
const RESPONSE_POISON = "synthetic-response-payload-must-not-escape";
const EXPIRES_AT = "2035-01-01T00:05:00.000Z";

// This only describes and invokes the future public API. It does not implement
// a reader or add a method to the real client. Missing API is an assertion RED,
// not a missing import/member TypeScript failure before the tests can run.
type ResultReader = (
  this: TalentSignalClient,
  input: ReadCredentialChangeResultRequest,
  signal?: AbortSignal,
) => Promise<CredentialChangeReadback>;

function publicReader(client: TalentSignalClient): ResultReader {
  const method: unknown = Reflect.get(client, "readCredentialChangeResult");
  expect(method, "TalentSignalClient.readCredentialChangeResult public API").toBeTypeOf("function");
  return method as ResultReader;
}

const pending: CredentialChangeReadback = {
  contract_version: CONTRACT_VERSION,
  attempt_id: ATTEMPT_ID,
  intent: "set_password",
  state: "pending",
  expires_at: EXPIRES_AT,
};
const applied: CredentialChangeReadback = {
  contract_version: CONTRACT_VERSION,
  attempt_id: ATTEMPT_ID,
  intent: "change_password",
  state: "applied",
  outcome: "password_set",
  account_id: "33333333-3333-4333-8333-333333333333",
  user_id: "44444444-4444-4444-8444-444444444444",
  consumed_at: "2035-01-01T00:01:00.000Z",
  expires_at: EXPIRES_AT,
  revision_before: 1,
  revision_after: 2,
};
const unresolved: CredentialChangeReadback = {
  contract_version: CONTRACT_VERSION,
  attempt_id: ATTEMPT_ID,
  intent: "set_password",
  state: "unknown",
  expires_at: EXPIRES_AT,
};
const invalid: CredentialChangeReadback = {
  contract_version: CONTRACT_VERSION,
  attempt_id: ATTEMPT_ID,
  intent: "change_password",
  state: "invalid",
};
const results = [pending, applied, unresolved, invalid];

function requestFor(intent: ReadCredentialChangeResultRequest["intent"]): ReadCredentialChangeResultRequest {
  return { attempt_id: ATTEMPT_ID, attempt_secret: ATTEMPT_SECRET, intent };
}

function installResponse(body: unknown) {
  const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function expectUnverifiable(promise: Promise<CredentialChangeReadback>): Promise<void> {
  const rejected: unknown = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(rejected).toBeInstanceOf(TalentSignalHttpError);
  if (!(rejected instanceof TalentSignalHttpError)) return;
  expect(rejected.code).toBe("CREDENTIAL_RESULT_UNVERIFIABLE");
  expect([undefined, null]).toContain(rejected.details);
  const exposed = JSON.stringify({
    name: rejected.name,
    status: rejected.status,
    code: rejected.code,
    message: rejected.message,
    details: rejected.details,
    cause: String(Reflect.get(rejected, "cause") ?? ""),
  });
  expect(exposed).not.toContain(ATTEMPT_SECRET);
  expect(exposed).not.toContain(ACCESS_TOKEN);
  expect(exposed).not.toContain(RESPONSE_POISON);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("same-attempt password outcome SDK", () => {
  it("exposes the result lookup as an actual public client method", () => {
    publicReader(new TalentSignalClient(BASE_URL, ACCESS_TOKEN));
  });

  it.each(results)("POSTs only the bounded proof and returns the correlated $state result", async (reply) => {
    const fetchMock = installResponse(reply);
    const client = new TalentSignalClient(BASE_URL, ACCESS_TOKEN);
    const controller = new AbortController();
    const input = requestFor(reply.intent);

    const result = await publicReader(client).call(client, input, controller.signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://backend.example.test/v1/account/login-methods/result");
    expect(String(url)).not.toContain(ATTEMPT_SECRET);
    expect(String(url)).not.toContain(ACCESS_TOKEN);
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBe(controller.signal);
    expect(init?.redirect).toBe("error");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(headers.get("content-type")).toBe("application/json");
    expect(typeof init?.body).toBe("string");
    expect(JSON.parse(init?.body as string)).toEqual({
      attempt_id: ATTEMPT_ID,
      attempt_secret: ATTEMPT_SECRET,
      intent: reply.intent,
    });
    expect(result).toEqual(reply);
  });

  for (const reply of results) {
    it(`rejects a different attempt even in a schema-valid ${reply.state} result`, async () => {
      const fetchMock = installResponse({ ...reply, attempt_id: OTHER_ATTEMPT_ID });
      const client = new TalentSignalClient(BASE_URL, ACCESS_TOKEN);
      await expectUnverifiable(publicReader(client).call(client, requestFor(reply.intent)));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it(`rejects a different intent even in a schema-valid ${reply.state} result`, async () => {
      const otherIntent = reply.intent === "set_password" ? "change_password" : "set_password";
      const fetchMock = installResponse({ ...reply, intent: otherIntent });
      const client = new TalentSignalClient(BASE_URL, ACCESS_TOKEN);
      await expectUnverifiable(publicReader(client).call(client, requestFor(reply.intent)));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  }

  // Each malformed payload has the matching input intent, so rejection
  // cannot pass merely because an applied/change_password fixture was sent
  // with a set_password request. These isolate schema/JSON from correlation.
  const malformedReplies: Array<{
    label: string;
    intent: ReadCredentialChangeResultRequest["intent"];
    body: unknown;
  }> = [
    { label: "null success body", intent: "set_password", body: null },
    { label: "empty success object", intent: "set_password", body: {} },
    { label: "unsupported state", intent: "set_password", body: { ...pending, state: "completed" } },
    { label: "wrong contract version", intent: "set_password", body: { ...pending, contract_version: "not-this-contract" } },
    { label: "invalid applied account UUID", intent: "change_password", body: { ...applied, account_id: "not-a-uuid" } },
    { label: "invalid expiry format", intent: "set_password", body: { ...pending, expires_at: "not-a-date" } },
    { label: "invalid applied revision", intent: "change_password", body: { ...applied, revision_after: 0 } },
    { label: "unsafe applied revision pair", intent: "change_password", body: { ...applied, revision_before: 2 ** 53, revision_after: 2 ** 53 } },
    { label: "applied revision did not advance", intent: "change_password", body: { ...applied, revision_after: 1 } },
    { label: "applied revision skipped one increment", intent: "change_password", body: { ...applied, revision_after: 3 } },
    { label: "applied consumption after original expiry", intent: "change_password", body: { ...applied, consumed_at: "2035-01-01T00:06:00.000Z" } },
    { label: "unexpected secret-bearing property", intent: "set_password", body: { ...pending, attempt_secret: ATTEMPT_SECRET, extra: RESPONSE_POISON } },
    { label: "error envelope at HTTP200", intent: "set_password", body: { error: { code: RESPONSE_POISON, message: ATTEMPT_SECRET, details: ACCESS_TOKEN } } },
  ];
  it.each(malformedReplies)("rejects $label as an unconfirmed outcome without exposing its body", async ({ body, intent }) => {
    const fetchMock = installResponse(body);
    const client = new TalentSignalClient(BASE_URL, ACCESS_TOKEN);
    await expectUnverifiable(publicReader(client).call(client, requestFor(intent)));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects non-JSON HTTP200 through the same sanitized unknown-result error", async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      new Response(`not-json ${ATTEMPT_SECRET} ${RESPONSE_POISON}`, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new TalentSignalClient(BASE_URL, ACCESS_TOKEN);
    await expectUnverifiable(publicReader(client).call(client, requestFor("set_password")));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
