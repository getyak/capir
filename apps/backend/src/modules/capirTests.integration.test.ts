import { createHash, randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { TalentSignalClient } from "@talent-signal/contracts";
import type { LightMyRequestResponse } from "fastify";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../app.js";
import { createMemoryMailSink } from "../lib/mail.js";
import type { RemoteChatAnswerProviding } from "./chatAnswerProvider.js";
import { LocalChatMediaStorage } from "./chatMediaStorage.js";
import { ensureCapirTestProvisioningPrincipal } from "./capirTests.js";
import { LabWorkspaceService } from "./labWorkspaces.js";
import { encodePasswordCredential } from "./passwordCredential.js";

/**
 * Real production routes for `capir test create` (Task 1).
 *
 * Everything here goes through buildApp HTTP: operator provisioning admission,
 * atomic run creation, genuine password login, Lab session/entry admission and
 * the canonical stop/cleanup lifecycle. Direct SQL is used only for control
 * fixtures (existing real logins, principal rotation/revocation, cross-lineage
 * probes) and honest readback assertions. Expected values are independent
 * literals: preset counts and digests are never computed by a production
 * helper. No test stubs bypass real admission, construction or authority.
 */

const database = process.env.CAPIR_TEST_DATABASE_URL;
if (database && !["localhost", "127.0.0.1"].includes(new URL(database).hostname)) {
  throw new Error("Use an owned disposable loopback database.");
}
const pool = database ? new Pool({ connectionString: database, max: 6, statement_timeout: 15_000 }) : null;

const mediaDirectory = process.env.CAPIR_TEST_MEDIA_DIRECTORY ?? `/tmp/capir-test-create-${randomUUID()}`;
const provisioningKey = randomBytes(32).toString("base64url");
const webConsumerKey = randomBytes(32).toString("base64url");
const webOrigin = "https://lab-web.test.invalid";
const backendOrigin = "https://lab-api.test.invalid";

/** Independently authored golden values (not computed from production code). */
const DAILY_DIGEST = "fafb7b91bc0b9c2ac47585096cef38f82b445d2437ef751aa8d65b1cb559bc22";
const EMPTY_DIGEST = "f4c3e51544c4bbbf7175ed8a21f3b79dbcb8f7f1fc4c970945818d7f3483836d";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
const sideEffects = { model: 0, mail: 0 };
const mailSink = createMemoryMailSink();

const mainSettings = (): CapirSettings => ({
  enabled: true,
  provisioningKey,
  provisioningGeneration: 1,
  webOrigin,
  backendOrigin,
  webConsumerKey,
  maxActiveRuns: 8,
});

const countingModelProvider: RemoteChatAnswerProviding = {
  providerId: "claude-agent-sdk",
  model: "capir-test-model-counter",
  supportsImageInput: false,
  async answer(): Promise<never> {
    sideEffects.model += 1;
    throw new Error("Creation must dispatch no model call.");
  },
};

type CapirSettings = NonNullable<Parameters<typeof buildApp>[0]["config"]["capirTests"]>;

async function buildTestApp(capirTests: CapirSettings): Promise<App> {
  return buildApp({
    pool: pool!,
    config: {
      databaseUrl: database!, host: "127.0.0.1", port: 0, allowedOrigins: [webOrigin],
      appleSignInAudiences: [], appleSignInEnabled: false, passwordAuthEnabled: true,
      passwordRegistrationEnabled: false, simulatedAuthEnabled: true, internalLabEnabled: true,
      retentionSweepIntervalMs: 60000, sessionTtlSeconds: 3600,
      chatMediaStorage: { provider: "local", directory: mediaDirectory },
      capirTests,
    },
    chatMediaStorage: new LocalChatMediaStorage(mediaDirectory),
    remoteChatProvider: countingModelProvider,
    personResearchProvider: null,
    privateConversationProvider: null,
    labProviders: new Map(),
    labJobWorkerEnabled: false,
    conversationQueueWorkerEnabled: false,
    labCIVerifier: null,
    screenshotContact: null,
    mail: mailSink.delivery,
  });
}

function provisioningHeaders(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    authorization: `Bearer ${provisioningKey}`,
    "x-capir-backend-origin": backendOrigin,
    origin: backendOrigin,
    ...overrides,
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

interface CreatedRun {
  run: Record<string, unknown>;
  password: string;
  username: string;
  requestId: string;
  response: LightMyRequestResponse;
}

function generatedPassword(): string {
  return randomBytes(18).toString("base64url");
}

async function createRun(overrides: Record<string, unknown> = {}): Promise<CreatedRun> {
  const requestId = randomUUID();
  const password = generatedPassword();
  const username = `qa-${randomBytes(4).toString("hex")}`;
  const body: Record<string, unknown> = {
    request_id: requestId,
    username,
    password,
    preset: "empty",
    duration_hours: 4,
    web_origin: webOrigin,
    ...overrides,
  };
  if (overrides.username === null) {
    body.username = undefined;
    delete body.username;
  }
  const response = await app.inject({
    method: "POST",
    url: "/v1/capir/tests",
    headers: provisioningHeaders(),
    payload: body,
  });
  return {
    run: response.statusCode === 200 ? response.json().run : {},
    password,
    username: response.statusCode === 200 ? response.json().run.username : username,
    requestId,
    response,
  };
}

function passwordLogin(identifier: string, password: string) {
  return app.inject({
    method: "POST",
    url: "/v1/auth/password/login",
    payload: { identifier, password, client_label: "capir-tests" },
  });
}

function sessionRead(token: string) {
  return app.inject({
    method: "GET",
    url: "/v1/auth/session",
    headers: { authorization: `Bearer ${token}` },
  });
}

function stopRun(runId: string, requestId = randomUUID(), key = provisioningKey) {
  return app.inject({
    method: "POST",
    url: `/v1/capir/tests/${runId}/stop`,
    headers: provisioningHeaders({ authorization: `Bearer ${key}` }),
    payload: { request_id: requestId },
  });
}

/** Honest readback: every classified account-scope row for the target account. */
async function accountDataRows(accountId: string): Promise<number> {
  const tables = (
    await pool!.query<{ table_name: string }>(
      "SELECT table_name FROM lab_test_workspace_table_manifest WHERE scope='account'",
    )
  ).rows.map((row) => row.table_name);
  const result = await pool!.query<{ count: string }>(
    `SELECT sum(n)::text AS count FROM (
      ${tables.map((t) => `SELECT count(*) AS n FROM "${t}" WHERE account_id=$1`).join(" UNION ALL ")}) counts`,
    [accountId],
  );
  return Number(result.rows[0]?.count ?? 0);
}

/** Real-identity fixture: a password login user with its email reservation. */
async function insertPasswordFixtureUser(
  accountId: string,
  userId: string,
  email: string,
  username: string,
  password: string,
): Promise<void> {
  const credential = await encodePasswordCredential(password);
  const client = await pool!.connect();
  try {
    // One transaction: the reservation and user rows reference each other
    // through deferred constraints and the real-identity reservation trigger.
    await client.query("BEGIN");
    await client.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Password fixture')", [accountId, `fixture-${accountId.slice(0, 8)}`]);
    await client.query(
      "INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES($1,'owned',$2,$3)",
      [email.trim().toLowerCase(), accountId, userId],
    );
    await client.query(
      "INSERT INTO users(id,account_id,email,display_name,kind,username) VALUES($1,$2,$3,'Fixture','password_human',$4)",
      [userId, accountId, email, username],
    );
    await client.query(
      "INSERT INTO password_credentials(account_id,user_id,password_scrypt) VALUES($1,$2,$3)",
      [accountId, userId, credential],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function removePasswordFixtureUser(accountId: string): Promise<void> {
  await pool!.query("DELETE FROM sessions WHERE account_id=$1", [accountId]);
  await pool!.query("DELETE FROM password_credentials WHERE account_id=$1", [accountId]);
  await pool!.query("DELETE FROM account_email_reservations WHERE account_id=$1", [accountId]);
  await pool!.query("DELETE FROM users WHERE account_id=$1", [accountId]);
  await pool!.query("DELETE FROM harness_source_generations WHERE account_id=$1", [accountId]);
  await pool!.query("DELETE FROM accounts WHERE id=$1", [accountId]);
}

describe.skipIf(!pool)("capir test provisioning (PostgreSQL)", () => {
  beforeAll(async () => {
    if (!pool) return;
    // Fixture provisioning of a fresh random operator key (root provisions the
    // production credential). Interrupted prior attempts are retired through
    // the verified lifecycle before this suite runs.
    await pool.query(
      `INSERT INTO capir_test_provisioners(id,label,credential_hash,generation,web_origin,backend_origin,max_active_runs)
       VALUES($1,'configured',$2,1,$3,$4,8)
       ON CONFLICT (label) DO UPDATE SET credential_hash=EXCLUDED.credential_hash,
         generation=1, state='enabled', revoked_at=NULL,
         web_origin=EXCLUDED.web_origin, backend_origin=EXCLUDED.backend_origin,
         max_active_runs=8`,
      [randomUUID(), sha256Hex(provisioningKey), webOrigin, backendOrigin],
    );
    const leftovers = await pool.query<{ id: string }>(
      "SELECT id FROM lab_test_workspaces WHERE owner_principal_id IS NOT NULL AND state <> 'deleted'",
    );
    const hygienic = new LabWorkspaceService(pool, new LocalChatMediaStorage(mediaDirectory), 3600);
    for (const row of leftovers.rows) await hygienic.stopOperatorRun(row.id, randomUUID());
  }, 60_000);

  beforeEach(async () => {
    if (!pool) return;
    // A fresh app per case keeps the production rate-limit counters and the
    // provisioning bootstrap honest while staying inside per-window limits.
    app = await buildTestApp(mainSettings());
    await app.ready();
  }, 30_000);

  afterEach(async () => {
    await app?.close();
  }, 30_000);

  afterAll(async () => {
    // Teardown: retire every run this suite left through the verified
    // lifecycle (real stop/cleanup), never by erasing the account graph.
    if (pool) {
      const leftovers = await pool.query<{ id: string }>(
        "SELECT id FROM lab_test_workspaces WHERE owner_principal_id IS NOT NULL AND state <> 'deleted'",
      );
      const hygienic = new LabWorkspaceService(pool, new LocalChatMediaStorage(mediaDirectory), 3600);
      for (const row of leftovers.rows) await hygienic.stopOperatorRun(row.id, randomUUID()).catch(() => undefined);
    }
    await pool?.end();
  }, 120_000);

  it("creates a usable daily test account and admits a real password login with a matching Lab entry", async () => {
    const requestId = randomUUID();
    const suppliedPassword = randomBytes(18).toString("base64url");
    const username = `qa-${randomBytes(4).toString("hex")}`;
    const created = await app.inject({
      method: "POST",
      url: "/v1/capir/tests",
      headers: provisioningHeaders(),
      payload: {
        request_id: requestId,
        username,
        password: suppliedPassword,
        preset: "daily",
        duration_hours: 4,
        web_origin: webOrigin,
      },
    });
    expect(created.statusCode, created.body).toBe(200);
    const run = created.json().run;
    expect(run.request_id).toBe(requestId);
    expect(run.username).toBe(username);
    expect(run.email).toBe(`${username}@lab.invalid`);
    expect(run.preset).toBe("daily");
    expect(run.preset_version).toBe("1");
    expect(run.preset_digest).toBe(DAILY_DIGEST);
    expect(run.state).toBe("ready");
    expect(run.counts).toEqual({ contacts: 12, observations: 30, tasks: 4 });
    expect(created.body.includes(suppliedPassword), "the response must never echo the password").toBe(false);

    const login = await passwordLogin(username, suppliedPassword);
    expect(login.statusCode, login.body).toBe(200);
    const session = login.json();
    expect(session.user.id).toBe(run.user_id);
    expect(session.user.kind).toBe("lab_human");
    expect(session.user.username).toBe(username);
    expect(Boolean(session.access_token), "a real session token is required").toBe(true);
    expect(login.body.includes(suppliedPassword), "login output must not echo the password").toBe(false);

    const read = await sessionRead(session.access_token);
    expect(read.statusCode, read.body).toBe(200);
    expect(read.json().user.id).toBe(run.user_id);

    const entry = await pool!.query<{ owner_principal_id: string; principal_generation: number; expires_at: Date; session_id: string }>(
      "SELECT owner_principal_id, principal_generation, expires_at, session_id FROM lab_test_workspace_entries WHERE workspace_id=$1",
      [run.id],
    );
    expect(entry.rows.length, "the admitted password session must own exactly one Lab entry").toBe(1);
    expect(entry.rows[0]!.owner_principal_id).toBeTruthy();
    expect(entry.rows[0]!.principal_generation).toBe(1);
    expect(new Date(session.expires_at).getTime(), "session TTL must clamp to the run expiry").toBeLessThanOrEqual(
      new Date(run.expires_at).getTime(),
    );
    expect(entry.rows[0]!.expires_at.getTime()).toBeLessThanOrEqual(new Date(run.expires_at).getTime());

    const oauthLedger = await pool!.query("SELECT 1 FROM mcp_oauth_cleanup WHERE account_id=$1", [run.account_id]);
    sideEffects.mail = mailSink.messages.length;
    expect(sideEffects, "creation and login must invoke no model or email delivery").toEqual({ model: 0, mail: 0 });
    expect(oauthLedger.rowCount, "creation must dispatch no OAuth flow").toBe(0);

    const stopped = await stopRun(run.id);
    expect(stopped.statusCode, stopped.body).toBe(200);
    expect(stopped.json().run.state).toBe("deleted");
  }, 90_000);

  it("generates unique credentials for the empty preset with versioned digests", async () => {
    const created = await createRun({ username: null });
    expect(created.response.statusCode, created.response.body).toBe(200);
    const run = created.run as { username: string; email: string; preset_digest: string; counts: unknown; state: string };
    expect(run.username, "an omitted username must be generated uniquely").toMatch(/^qa-[0-9a-f]{8}$/);
    expect(run.email).toMatch(/^[a-z0-9-]+@lab\.invalid$/);
    expect(run.preset_digest).toBe(EMPTY_DIGEST);
    expect(run.counts).toEqual({ contacts: 0, observations: 0, tasks: 0 });
    expect(run.state).toBe("ready");

    const login = await passwordLogin(run.username, created.password);
    expect(login.statusCode, login.body).toBe(200);
    const read = await sessionRead(login.json().access_token);
    expect(read.statusCode, read.body).toBe(200);

    const stopped = await stopRun((created.run as { id: string }).id);
    expect(stopped.json().run.state).toBe("deleted");
  }, 30_000);

  it("replays the exact request into one allocation and conflicts on any semantic change", async () => {
    const password = generatedPassword();
    const username = `qa-${randomBytes(4).toString("hex")}`;
    const requestId = randomUUID();
    const payload = {
      request_id: requestId,
      username,
      password,
      preset: "empty",
      duration_hours: 1,
      web_origin: webOrigin,
    };
    const first = await app.inject({ method: "POST", url: "/v1/capir/tests", headers: provisioningHeaders(), payload });
    expect(first.statusCode, first.body).toBe(200);
    const second = await app.inject({ method: "POST", url: "/v1/capir/tests", headers: provisioningHeaders(), payload });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().run.id, "an exact replay must return the one allocation").toBe(first.json().run.id);
    const allocations = await pool!.query("SELECT id FROM capir_test_runs WHERE principal_id IN (SELECT id FROM capir_test_provisioners) AND request_id=$1", [requestId]);
    expect(allocations.rows.length, "one request ID must never allocate twice").toBe(1);

    const changedPassword = await app.inject({
      method: "POST", url: "/v1/capir/tests", headers: provisioningHeaders(),
      payload: { ...payload, password: generatedPassword() },
    });
    expect(changedPassword.statusCode, "a changed password must conflict").toBe(409);
    expect(changedPassword.json().error.code).toBe("CAPIR_TEST_REQUEST_CONFLICT");

    const addedUsername = await app.inject({
      method: "POST", url: "/v1/capir/tests", headers: provisioningHeaders(),
      payload: { ...payload, request_id: randomUUID(), username: `qa-${randomBytes(4).toString("hex")}` },
    });
    expect(addedUsername.statusCode, "a different request is a separate allocation").toBe(200);

    // The original intent is exact: an omitted username must be omitted again.
    const omittedRequest = randomUUID();
    const omittedPayload = { request_id: omittedRequest, password, preset: "empty", duration_hours: 1, web_origin: webOrigin };
    const omitted = await app.inject({ method: "POST", url: "/v1/capir/tests", headers: provisioningHeaders(), payload: omittedPayload });
    expect(omitted.statusCode, omitted.body).toBe(200);
    const nowNamed = await app.inject({
      method: "POST", url: "/v1/capir/tests", headers: provisioningHeaders(),
      payload: { ...omittedPayload, username },
    });
    expect(nowNamed.statusCode, "adding the username argument must conflict").toBe(409);
    const omittedAgain = await app.inject({ method: "POST", url: "/v1/capir/tests", headers: provisioningHeaders(), payload: omittedPayload });
    expect(omittedAgain.statusCode, "exact omitted-name replay must succeed").toBe(200);
    expect(omittedAgain.json().run.id).toBe(omitted.json().run.id);
    const nameDropped = await app.inject({
      method: "POST", url: "/v1/capir/tests", headers: provisioningHeaders(),
      payload: { request_id: requestId, password, preset: "empty", duration_hours: 1, web_origin: webOrigin },
    });
    // Same request ID as the named allocation, now without the username: conflict.
    expect(nameDropped.statusCode, "dropping the username argument must conflict").toBe(409);

    // A conflicting replay never rotates the original credential.
    const login = await passwordLogin(username, password);
    expect(login.statusCode, login.body).toBe(200);

    for (const runId of [first.json().run.id, addedUsername.json().run.id, omitted.json().run.id]) {
      const stopped = await stopRun(runId);
      expect(stopped.statusCode, stopped.body).toBe(200);
    }
  }, 60_000);

  it("preserves an existing login on username and email collisions and rejects foreign email usernames", async () => {
    const accountId = randomUUID();
    const userId = randomUUID();
    const fixturePassword = generatedPassword();
    const fixtureUsername = `qa-${randomBytes(4).toString("hex")}`;
    const fixtureEmail = `${fixtureUsername}@lab.invalid`;
    await insertPasswordFixtureUser(accountId, userId, fixtureEmail, fixtureUsername, fixturePassword);
    try {
      const colliding = await createRun({ username: fixtureUsername, password: generatedPassword() });
      expect(colliding.response.statusCode, "a username collision must be a stable conflict").toBe(409);
      expect(colliding.response.json().error.code).toBe("CAPIR_TEST_USERNAME_TAKEN");

      const emailCollision = await createRun({ username: fixtureEmail, password: generatedPassword() });
      expect(emailCollision.response.statusCode, "an email-shaped collision must be a stable conflict").toBe(409);
      expect(emailCollision.response.json().error.code).toBe("CAPIR_TEST_USERNAME_TAKEN");

      const foreignEmail = await createRun({ username: `qa-${randomBytes(3).toString("hex")}@example.com`, password: generatedPassword() });
      expect(foreignEmail.response.statusCode, "non-lab.invalid email usernames must be rejected").toBe(400);
      expect(foreignEmail.response.json().error.code).toBe("CAPIR_TEST_USERNAME_EMAIL_DOMAIN_INVALID");

      // The existing identity is untouched: the same password still logs in.
      const login = await passwordLogin(fixtureUsername, fixturePassword);
      expect(login.statusCode, login.body).toBe(200);
      const read = await sessionRead(login.json().access_token);
      expect(read.statusCode, read.body).toBe(200);
      const credential = await pool!.query("SELECT failed_attempts, locked_until FROM password_credentials WHERE account_id=$1 AND user_id=$2", [accountId, userId]);
      expect(credential.rows[0]!.failed_attempts).toBe(0);
      expect(credential.rows[0]!.locked_until).toBeNull();
    } finally {
      await removePasswordFixtureUser(accountId);
    }
  }, 30_000);

  it("denies new sign-ins and live sessions at the deadline before any sweep", async () => {
    const created = await createRun();
    expect(created.response.statusCode, created.response.body).toBe(200);
    const run = created.run as { id: string; account_id: string; user_id: string };
    const login = await passwordLogin(created.username, created.password);
    expect(login.statusCode, login.body).toBe(200);
    const token = login.json().access_token;
    const sessionsBefore = (await pool!.query("SELECT 1 FROM sessions WHERE account_id=$1 AND revoked_at IS NULL", [run.account_id])).rowCount;

    // Deadline fixture for this disposable run; no sweep runs before these
    // assertions, so only live state can deny access.
    await pool!.query("UPDATE lab_test_workspaces SET expires_at = now() - interval '1 second' WHERE id=$1", [run.id]);

    const read = await sessionRead(token);
    expect(read.statusCode, "an expired run must deny existing sessions immediately").toBe(401);
    const lateLogin = await passwordLogin(created.username, created.password);
    expect([401, 410], "an expired run must reject new password sign-ins").toContain(lateLogin.statusCode);
    const sessions = await pool!.query("SELECT 1 FROM sessions WHERE account_id=$1 AND revoked_at IS NULL", [run.account_id]);
    expect(sessions.rowCount, "the rejected login must mint no session").toBe(sessionsBefore);

    const stopped = await stopRun(run.id);
    expect(stopped.statusCode, stopped.body).toBe(200);
  }, 30_000);

  it("serializes stop with password login: no usable session survives a stop", async () => {
    // (a) Stop wins first: login creates no session at all.
    const first = await createRun();
    const firstRun = first.run as { id: string; account_id: string };
    const stoppedFirst = await stopRun(firstRun.id);
    expect(stoppedFirst.statusCode, stoppedFirst.body).toBe(200);
    const deniedLogin = await passwordLogin(first.username, first.password);
    expect([401, 410], "a stopped run must reject password login").toContain(deniedLogin.statusCode);
    expect(
      (await pool!.query("SELECT 1 FROM sessions WHERE account_id=$1", [firstRun.account_id])).rowCount,
      "a rejected login must mint no session",
    ).toBe(0);

    // (b) Login wins first: stop revokes that session and its entry immediately.
    const second = await createRun();
    const secondRun = second.run as { id: string; account_id: string; user_id: string };
    const login = await passwordLogin(second.username, second.password);
    expect(login.statusCode, login.body).toBe(200);
    const token = login.json().access_token;
    expect((await sessionRead(token)).statusCode).toBe(200);
    const stoppedSecond = await stopRun(secondRun.id);
    expect(stoppedSecond.statusCode, stoppedSecond.body).toBe(200);
    expect((await sessionRead(token)).statusCode, "stop must revoke the live session immediately").toBe(401);
    const entries = await pool!.query("SELECT revoked_at FROM lab_test_workspace_entries WHERE workspace_id=$1", [secondRun.id]);
    expect(entries.rows[0]!.revoked_at, "stop must revoke the matching Lab entry").toBeTruthy();

    // (c) True concurrency: whichever side wins, the outcome stays consistent.
    const third = await createRun();
    const thirdRun = third.run as { id: string; account_id: string };
    const [loginResult, stopResult] = await Promise.allSettled([
      passwordLogin(third.username, third.password),
      stopRun(thirdRun.id),
    ]);
    expect(stopResult.status).toBe("fulfilled");
    const sessionsAfter = await pool!.query<{ id: string }>("SELECT id FROM sessions WHERE account_id=$1 AND revoked_at IS NULL", [thirdRun.account_id]);
    if (loginResult.status === "fulfilled" && loginResult.value.statusCode === 200) {
      // Login won the race: the surviving session must be revoked by the stop.
      expect(sessionsAfter.rows.length, "stop must revoke a session admitted during the race").toBe(0);
    } else {
      expect(sessionsAfter.rows.length, "a lost login race must mint no session").toBe(0);
    }
  }, 60_000);

  it("counts failed lab password attempts and enforces the existing lockout threshold", async () => {
    const created = await createRun();
    expect(created.response.statusCode, created.response.body).toBe(200);
    const run = created.run as { id: string; account_id: string; user_id: string };
    const wrong = generatedPassword();
    for (let attempt = 1; attempt <= 6; attempt++) {
      const response = await passwordLogin(created.username, wrong);
      expect(response.statusCode, "a wrong password must fail generically").toBe(401);
      expect(response.json().error.code).toBe("PASSWORD_SIGN_IN_FAILED");
      expect(response.body.includes(wrong), "the failure must not echo the password").toBe(false);
      const state = await pool!.query<{ failed_attempts: number; locked_until: Date | null }>(
        "SELECT failed_attempts, locked_until FROM password_credentials WHERE account_id=$1 AND user_id=$2",
        [run.account_id, run.user_id],
      );
      expect(state.rows[0]!.failed_attempts, "each failed attempt must be committed bookkeeping").toBe(attempt);
      expect(
        Boolean(state.rows[0]!.locked_until) === (attempt === 6),
        "the existing sixth-attempt threshold must lock the credential",
      ).toBe(true);
      expect(
        (await pool!.query("SELECT 1 FROM sessions WHERE account_id=$1", [run.account_id])).rowCount,
        "a rejected password must never mint a session",
      ).toBe(0);
    }
    // Even the correct password is denied while the credential is locked.
    const denied = await passwordLogin(created.username, created.password);
    expect(denied.statusCode, "the correct password is denied until unlock").toBe(401);
    expect(
      (await pool!.query("SELECT 1 FROM sessions WHERE account_id=$1", [run.account_id])).rowCount,
      "a locked credential must never mint a session",
    ).toBe(0);
    // Administrative unlock restores the same credential; nothing rotated.
    await pool!.query(
      "UPDATE password_credentials SET failed_attempts=0, locked_until=NULL WHERE account_id=$1 AND user_id=$2",
      [run.account_id, run.user_id],
    );
    const accepted = await passwordLogin(created.username, created.password);
    expect(accepted.statusCode, accepted.body).toBe(200);
    const stopped = await stopRun(run.id);
    expect(stopped.statusCode, stopped.body).toBe(200);
  }, 60_000);

  it("serializes credential verification with principal rotation at a real lock barrier", async () => {
    const created = await createRun();
    expect(created.response.statusCode, created.response.body).toBe(200);
    const run = created.run as { id: string; account_id: string; user_id: string };
    // Hold the target credential row so the login must take the canonical
    // admission locks (advisory, principal share, workspace) and then wait.
    const holder = await pool!.connect();
    await holder.query("BEGIN");
    await holder.query(
      "SELECT * FROM password_credentials WHERE account_id=$1 AND user_id=$2 FOR UPDATE",
      [run.account_id, run.user_id],
    );
    let loginSettled = false;
    const login = passwordLogin(created.username, created.password).then((response) => {
      loginSettled = true;
      return response;
    });
    let loginBlocked = false;
    for (let n = 0; n < 200 && !loginBlocked; n++) {
      loginBlocked =
        (await pool!.query(
          "SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query ILIKE '%password_credentials%'",
        )).rowCount === 1;
      if (!loginBlocked) await delay(10);
    }
    expect(loginBlocked, "the login must be waiting on the held credential row").toBe(true);

    // Now rotate: the rotation must serialize behind the in-flight admission.
    let rotationSettled = false;
    const rotation = ensureCapirTestProvisioningPrincipal(pool!, {
      ...mainSettings(),
      provisioningGeneration: 2,
    }).then(() => {
      rotationSettled = true;
    });
    let rotationBlocked = false;
    for (let n = 0; n < 200 && !rotationBlocked; n++) {
      rotationBlocked =
        (await pool!.query(
          "SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query ILIKE '%capir_test_provisioners%'",
        )).rowCount === 1;
      if (!rotationBlocked) await delay(10);
    }
    expect(rotationBlocked, "the rotation must wait for the in-flight admission").toBe(true);
    expect(loginSettled, "the login must still be inside its admission").toBe(false);

    await holder.query("COMMIT");
    holder.release();
    const loginResponse = await login;
    await rotation;
    expect(rotationSettled).toBe(true);
    expect(
      loginResponse.statusCode,
      "an admission serialized before the rotation commits truthfully",
    ).toBe(200);

    // A rotation that completed first can never be followed by success.
    const after = await passwordLogin(created.username, created.password);
    expect(after.statusCode, "post-rotation sign-ins must be denied").toBe(403);
    expect(after.json().error.code).toBe("CAPIR_TEST_PRINCIPAL_INACTIVE");
    const status = await app.inject({ method: "GET", url: `/v1/capir/tests/${run.id}`, headers: provisioningHeaders() });
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json().run.state, "the rotated run is honestly not ready").toBe("revoked");

    await pool!.query("UPDATE capir_test_provisioners SET generation=1 WHERE label='configured'");
    const stopped = await stopRun(run.id);
    expect(stopped.statusCode, stopped.body).toBe(200);
    expect(stopped.json().run.state).toBe("deleted");
  }, 60_000);

  it("denies provisioning when disabled and truthfully discloses capabilities", async () => {
    const disabledApp = await buildTestApp({
      enabled: false,
      provisioningKey,
      provisioningGeneration: 1,
      webOrigin,
      backendOrigin,
      webConsumerKey,
      maxActiveRuns: 8,
    });
    await disabledApp.ready();
    try {
      const create = await disabledApp.inject({
        method: "POST", url: "/v1/capir/tests", headers: provisioningHeaders(),
        payload: { request_id: randomUUID(), password: generatedPassword(), preset: "empty", duration_hours: 1, web_origin: webOrigin },
      });
      expect(create.statusCode, "disabled defaults must deny provisioning").toBe(403);
      expect(create.json().error.code).toBe("CAPIR_TESTS_DISABLED");

      const capabilities = await disabledApp.inject({ method: "GET", url: "/v1/capir/capabilities" });
      expect(capabilities.statusCode).toBe(200);
      const disclosed = capabilities.json();
      expect(disclosed.enabled).toBe(false);
      expect(disclosed.supported).toEqual([]);
      expect(disclosed.unsupported).toContain("test.create");
      expect(disclosed.unsupported).toContain("sandbox.create");
      expect(disclosed.unsupported).toContain("auth.authorize");
    } finally {
      await disabledApp.close();
    }

    const capabilities = await app.inject({ method: "GET", url: "/v1/capir/capabilities" });
    expect(capabilities.statusCode).toBe(200);
    const disclosed = capabilities.json();
    expect(disclosed.enabled, "capabilities must report the real enabled state").toBe(true);
    expect(disclosed.supported).toContain("test.create");
    // Unavailable legacy human-auth and sandbox scopes are never advertised.
    for (const legacy of ["auth.authorize", "auth.exchange", "sandbox.create", "sandbox.strict_replay"]) {
      expect(disclosed.supported).not.toContain(legacy);
      expect(disclosed.unsupported).toContain(legacy);
    }
  }, 30_000);

  it("revokes access on principal revocation and generation rotation while keeping cleanup honest", async () => {
    const created = await createRun();
    expect(created.response.statusCode, created.response.body).toBe(200);
    const run = created.run as { id: string; account_id: string; user_id: string };
    const login = await passwordLogin(created.username, created.password);
    expect(login.statusCode, login.body).toBe(200);
    const token = login.json().access_token;
    let secondRunId = "";

    try {
      // Rotation: the recorded generation is no longer the live one.
      await pool!.query("UPDATE capir_test_provisioners SET generation = generation + 1 WHERE label='configured'");
      expect((await sessionRead(token)).statusCode, "rotation must deny live sessions immediately").toBe(401);
      const rotatedLogin = await passwordLogin(created.username, created.password);
      expect(rotatedLogin.statusCode, "rotation must deny new sign-ins").toBe(403);
      expect(rotatedLogin.json().error.code).toBe("CAPIR_TEST_PRINCIPAL_INACTIVE");
      const status = await app.inject({ method: "GET", url: `/v1/capir/tests/${run.id}`, headers: provisioningHeaders() });
      expect(status.statusCode, status.body).toBe(200);
      expect(status.json().run.state, "canonical status must not call an inaccessible run ready").toBe("revoked");

      // The current-generation operator still cleans its own historical run.
      const stopped = await stopRun(run.id);
      expect(stopped.statusCode, stopped.body).toBe(200);
      expect(stopped.json().run.state).toBe("deleted");

      // Revocation: the credential principal itself is disabled.
      const second = await createRun();
      secondRunId = (second.run as { id: string }).id;
      const secondLogin = await passwordLogin(second.username, second.password);
      expect(secondLogin.statusCode, secondLogin.body).toBe(200);
      const secondToken = secondLogin.json().access_token;
      await pool!.query("UPDATE capir_test_provisioners SET state='revoked', revoked_at=now() WHERE label='configured'");
      expect((await sessionRead(secondToken)).statusCode, "revocation must deny live sessions immediately").toBe(401);
      const revokedLogin = await passwordLogin(second.username, second.password);
      expect([401, 403], "revocation must deny new sign-ins").toContain(revokedLogin.statusCode);
      const denied = await app.inject({
        method: "POST", url: "/v1/capir/tests", headers: provisioningHeaders(),
        payload: { request_id: randomUUID(), password: generatedPassword(), preset: "empty", duration_hours: 1, web_origin: webOrigin },
      });
      expect([401, 403], "a revoked principal cannot provision").toContain(denied.statusCode);
    } finally {
      await pool!.query("UPDATE capir_test_provisioners SET state='enabled', revoked_at=NULL, generation=1 WHERE label='configured'");
    }
    // The restored operator finishes the second run through the real lifecycle.
    const finalStop = await stopRun(secondRunId);
    expect(finalStop.statusCode, finalStop.body).toBe(200);
    expect(finalStop.json().run.state).toBe("deleted");
  }, 60_000);

  it("rejects cross-operator access, wrong origins and quota overreach without allocating", async () => {
    const created = await createRun();
    expect(created.response.statusCode, created.response.body).toBe(200);
    const run = created.run as { id: string; account_id: string };
    const before = (await pool!.query("SELECT count(*) FROM capir_test_runs")).rows[0]!.count;

    // A second principal with its own credential and the same registered pair.
    const secondKey = randomBytes(32).toString("base64url");
    await pool!.query(
      `INSERT INTO capir_test_provisioners(id,label,credential_hash,generation,web_origin,backend_origin,max_active_runs)
       VALUES($1,$2,$3,1,$4,$5,8)`,
      [randomUUID(), `second-${randomUUID().slice(0, 8)}`, sha256Hex(secondKey), webOrigin, backendOrigin],
    );
    const crossStatus = await app.inject({
      method: "GET", url: `/v1/capir/tests/${run.id}`,
      headers: provisioningHeaders({ authorization: `Bearer ${secondKey}` }),
    });
    expect(crossStatus.statusCode, "cross-operator reads must not exist").toBe(404);
    expect(crossStatus.json().error.code).toBe("CAPIR_TEST_RUN_NOT_FOUND");
    const crossStop = await app.inject({
      method: "POST", url: `/v1/capir/tests/${run.id}/stop`,
      headers: provisioningHeaders({ authorization: `Bearer ${secondKey}` }),
      payload: { request_id: randomUUID() },
    });
    expect(crossStop.statusCode, "cross-operator stops must not exist").toBe(404);

    // Wrong or missing origin/credential is denied before any allocation.
    const wrongHeader = await app.inject({
      method: "POST", url: "/v1/capir/tests",
      headers: provisioningHeaders({ "x-capir-backend-origin": "https://other.test.invalid" }),
      payload: { request_id: randomUUID(), password: generatedPassword(), preset: "empty", duration_hours: 1, web_origin: webOrigin },
    });
    expect(wrongHeader.statusCode).toBe(403);
    expect(wrongHeader.json().error.code).toBe("CAPIR_TEST_ORIGIN_DENIED");
    const wrongBody = await createRun({ web_origin: "https://other.test.invalid" });
    expect(wrongBody.response.statusCode).toBe(403);
    expect(wrongBody.response.json().error.code).toBe("CAPIR_TEST_ORIGIN_DENIED");
    const anonymous = await app.inject({
      method: "POST", url: "/v1/capir/tests",
      payload: { request_id: randomUUID(), password: generatedPassword(), preset: "empty", duration_hours: 1, web_origin: webOrigin },
    });
    expect(anonymous.statusCode).toBe(401);

    // A principal row whose pair does not match this instance is denied too.
    const foreignKey = randomBytes(32).toString("base64url");
    await pool!.query(
      `INSERT INTO capir_test_provisioners(id,label,credential_hash,generation,web_origin,backend_origin,max_active_runs)
       VALUES($1,$2,$3,1,$4,$5,8)`,
      [randomUUID(), `foreign-${randomUUID().slice(0, 8)}`, sha256Hex(foreignKey), "https://foreign.test.invalid", "https://foreign-api.test.invalid"],
    );
    const foreign = await app.inject({
      method: "POST", url: "/v1/capir/tests",
      headers: provisioningHeaders({ authorization: `Bearer ${foreignKey}`, "x-capir-backend-origin": "https://foreign-api.test.invalid", origin: "https://foreign-api.test.invalid" }),
      payload: { request_id: randomUUID(), password: generatedPassword(), preset: "empty", duration_hours: 1, web_origin: "https://foreign.test.invalid" },
    });
    expect(foreign.statusCode, "the instance pair must be exact").toBe(403);

    const after = (await pool!.query("SELECT count(*) FROM capir_test_runs")).rows[0]!.count;
    expect(after, "denied requests must never allocate").toBe(before);

    // Quota is enforced per principal.
    await pool!.query("UPDATE capir_test_provisioners SET max_active_runs=1 WHERE label='configured'");
    const overQuota = await createRun();
    expect(overQuota.response.statusCode, "the active-run quota must hold").toBe(409);
    expect(overQuota.response.json().error.code).toBe("CAPIR_TEST_QUOTA_EXCEEDED");
    await pool!.query("UPDATE capir_test_provisioners SET max_active_runs=8 WHERE label='configured'");

    const stopped = await stopRun(run.id);
    expect(stopped.statusCode, stopped.body).toBe(200);
  }, 60_000);

  it("enforces strict provisioning generation semantics on re-provisioning", async () => {
    const settings = {
      enabled: true as const,
      provisioningGeneration: 1,
      webOrigin,
      backendOrigin,
      maxActiveRuns: 8,
    };
    // Same generation with a different credential must be rejected.
    let code = "";
    try {
      await ensureCapirTestProvisioningPrincipal(pool!, { ...settings, provisioningKey: randomBytes(32).toString("base64url") });
    } catch (error) {
      code = (error as { code?: string }).code ?? "";
    }
    expect(code, "a key change without a generation bump must be rejected").toBe("CAPIR_TEST_PRINCIPAL_ROTATION_REQUIRED");
    const unchanged = await pool!.query("SELECT credential_hash, generation, state FROM capir_test_provisioners WHERE label='configured'");
    expect(unchanged.rows[0]!.generation).toBe(1);
    expect(unchanged.rows[0]!.state).toBe("enabled");
    expect(unchanged.rows[0]!.credential_hash).toBe(sha256Hex(provisioningKey));

    // A downgrade must never overwrite a newer generation.
    await pool!.query("UPDATE capir_test_provisioners SET generation=3 WHERE label='configured'");
    let downgradeCode = "";
    try {
      await ensureCapirTestProvisioningPrincipal(pool!, { ...settings, provisioningKey });
    } catch (error) {
      downgradeCode = (error as { code?: string }).code ?? "";
    }
    expect(downgradeCode, "a configured downgrade must be rejected").toBe("CAPIR_TEST_PRINCIPAL_GENERATION_DOWNGRADE");
    expect((await pool!.query("SELECT generation FROM capir_test_provisioners WHERE label='configured'")).rows[0]!.generation).toBe(3);

    // A revoked principal is never revived by configuration.
    await pool!.query("UPDATE capir_test_provisioners SET state='revoked', revoked_at=now(), generation=1 WHERE label='configured'");
    let revokedCode = "";
    try {
      await ensureCapirTestProvisioningPrincipal(pool!, { ...settings, provisioningKey });
    } catch (error) {
      revokedCode = (error as { code?: string }).code ?? "";
    }
    expect(revokedCode, "a revoked principal must stay revoked").toBe("CAPIR_TEST_PRINCIPAL_REVOKED");
    await pool!.query("UPDATE capir_test_provisioners SET state='enabled', revoked_at=NULL, generation=1 WHERE label='configured'");
    await ensureCapirTestProvisioningPrincipal(pool!, { ...settings, provisioningKey });
  }, 30_000);

  it.each(["webOrigin", "backendOrigin"] as const)("rejects a handoff on an instance with a different %s without consuming it", async (originSetting) => {
    const created = await createRun();
    expect(created.response.statusCode).toBe(200);
    const handoff = await app.inject({
      method: "POST", url: `/v1/capir/tests/${created.run.id}/handoffs`,
      headers: provisioningHeaders(), payload: { request_id: randomUUID() },
    });
    expect(handoff.statusCode).toBe(200);
    const payload = { handoff_secret: handoff.json().handoff_secret, web_origin: webOrigin };
    const headers = { "x-capir-web-consumer-key": webConsumerKey };
    const foreignInstance = await buildTestApp({ ...mainSettings(), [originSetting]: "https://foreign-instance.test.invalid" });
    try {
      await foreignInstance.ready();
      const refused = await foreignInstance.inject({ method: "POST", url: "/v1/capir/tests/handoffs/exchange", headers, payload });
      expect(refused.statusCode, "the consumer key must not authorize a different deployment origin pair").toBe(403);
      expect((await pool!.query("SELECT id FROM sessions WHERE account_id=$1", [created.run.account_id])).rowCount).toBe(0);
      const valid = await app.inject({ method: "POST", url: "/v1/capir/tests/handoffs/exchange", headers, payload });
      expect(valid.statusCode, "a denied exchange must preserve the one-use handoff").toBe(200);
      expect((await pool!.query("SELECT id FROM sessions WHERE account_id=$1", [created.run.account_id])).rowCount).toBe(1);
    } finally {
      await foreignInstance.close();
    }
  });

  it("creates one-use handoffs that admit exactly one matching session per run", async () => {
    const created = await createRun();
    expect(created.response.statusCode, created.response.body).toBe(200);
    const run = created.run as { id: string; user_id: string; expires_at: string };
    const handoffRequest = { request_id: randomUUID() };
    const handoff = await app.inject({
      method: "POST", url: `/v1/capir/tests/${run.id}/handoffs`,
      headers: provisioningHeaders(),
      payload: handoffRequest,
    });
    expect(handoff.statusCode, handoff.body).toBe(200);
    const secret = handoff.json().handoff_secret;
    expect(typeof secret, "the one-use secret is returned exactly once to the operator").toBe("string");

    const replayed = await app.inject({
      method: "POST", url: `/v1/capir/tests/${run.id}/handoffs`,
      headers: provisioningHeaders(),
      payload: handoffRequest,
    });
    expect(replayed.statusCode, "a handoff secret can never be re-disclosed").toBe(409);
    expect(replayed.json().error.code).toBe("CAPIR_TEST_HANDOFF_CONFLICT");

    const wrongConsumer = await app.inject({
      method: "POST", url: "/v1/capir/tests/handoffs/exchange",
      headers: { "x-capir-web-consumer-key": randomBytes(32).toString("base64url") },
      payload: { handoff_secret: secret, web_origin: webOrigin },
    });
    expect(wrongConsumer.statusCode).toBe(401);
    const wrongOriginExchange = await app.inject({
      method: "POST", url: "/v1/capir/tests/handoffs/exchange",
      headers: { "x-capir-web-consumer-key": webConsumerKey },
      payload: { handoff_secret: secret, web_origin: "https://other.test.invalid" },
    });
    expect(wrongOriginExchange.statusCode).toBe(403);

    const exchanged = await app.inject({
      method: "POST", url: "/v1/capir/tests/handoffs/exchange",
      headers: { "x-capir-web-consumer-key": webConsumerKey },
      payload: { handoff_secret: secret, web_origin: webOrigin },
    });
    expect(exchanged.statusCode, exchanged.body).toBe(200);
    expect(exchanged.json().session.user.id).toBe(run.user_id);
    expect(exchanged.json().run_id).toBe(run.id);
    const handoffToken = exchanged.json().session.access_token;
    const banner = await app.inject({
      method: "GET", url: "/v1/capir/test-session",
      headers: { authorization: `Bearer ${handoffToken}` },
    });
    expect(banner.statusCode, banner.body).toBe(200);
    expect(banner.json().run.id, "handoff entry must resolve the same run").toBe(run.id);
    expect(banner.json().run.expires_at, "handoff entry must resolve the same deadline").toBe(run.expires_at);

    const consumed = await app.inject({
      method: "POST", url: "/v1/capir/tests/handoffs/exchange",
      headers: { "x-capir-web-consumer-key": webConsumerKey },
      payload: { handoff_secret: secret, web_origin: webOrigin },
    });
    expect(consumed.statusCode, "a one-use handoff can never be exchanged twice").toBe(409);
    expect(consumed.json().error.code).toBe("CAPIR_TEST_HANDOFF_CONSUMED");

    const stopped = await stopRun(run.id);
    expect(stopped.statusCode, stopped.body).toBe(200);
  }, 60_000);

  it("resolves the canonical run for direct password and handoff sessions and denies everyone else", async () => {
    const created = await createRun();
    const run = created.run as { id: string; account_id: string; expires_at: string };
    const login = await passwordLogin(created.username, created.password);
    expect(login.statusCode, login.body).toBe(200);
    const token = login.json().access_token;

    const banner = await app.inject({
      method: "GET", url: "/v1/capir/test-session",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(banner.statusCode, banner.body).toBe(200);
    expect(banner.json().run.id).toBe(run.id);
    expect(banner.json().run.expires_at).toBe(run.expires_at);

    // Ordinary real accounts are denied without leaking run metadata.
    const accountId = randomUUID();
    const userId = randomUUID();
    const ordinaryPassword = generatedPassword();
    const ordinaryUsername = `qa-${randomBytes(4).toString("hex")}`;
    await insertPasswordFixtureUser(accountId, userId, `${ordinaryUsername}@example.test`, ordinaryUsername, ordinaryPassword);
    try {
      const ordinarySession = await passwordLogin(ordinaryUsername, ordinaryPassword);
      expect(ordinarySession.statusCode, ordinarySession.body).toBe(200);
      const ordinaryBanner = await app.inject({
        method: "GET", url: "/v1/capir/test-session",
        headers: { authorization: `Bearer ${ordinarySession.json().access_token}` },
      });
      expect(ordinaryBanner.statusCode, "ordinary accounts have no test run").toBe(404);
    } finally {
      await removePasswordFixtureUser(accountId);
    }

    const stopped = await stopRun(run.id);
    expect(stopped.statusCode, stopped.body).toBe(200);
    const afterStop = await app.inject({
      method: "GET", url: "/v1/capir/test-session",
      headers: { authorization: `Bearer ${token}` },
    });
    expect([401, 404], "a stopped run must deny the banner read").toContain(afterStop.statusCode);
  }, 60_000);

  it("denies cross-lineage and cross-target session fixtures through the shared Lab predicate", async () => {
    const firstKey = randomBytes(32).toString("base64url");
    const secondKey = randomBytes(32).toString("base64url");
    const keys = [firstKey, secondKey];
    const labels = [`lineage-a-${randomUUID().slice(0, 8)}`, `lineage-b-${randomUUID().slice(0, 8)}`];
    for (let i = 0; i < 2; i++) {
      await pool!.query(
        `INSERT INTO capir_test_provisioners(id,label,credential_hash,generation,web_origin,backend_origin,max_active_runs)
         VALUES($1,$2,$3,1,$4,$5,8)`,
        [randomUUID(), labels[i], sha256Hex(keys[i]!), webOrigin, backendOrigin],
      );
    }
    const principals = (
      await pool!.query<{ id: string; label: string }>(`SELECT id, label FROM capir_test_provisioners WHERE label = ANY($1)`, [labels])
    ).rows;
    const runs: Array<Record<string, unknown>> = [];
    for (const key of keys) {
      const response = await app.inject({
        method: "POST", url: "/v1/capir/tests",
        headers: provisioningHeaders({ authorization: `Bearer ${key}` }),
        payload: { request_id: randomUUID(), password: generatedPassword(), preset: "empty", duration_hours: 1, web_origin: webOrigin },
      });
      expect(response.statusCode, response.body).toBe(200);
      runs.push(response.json().run);
    }
    const runA = runs[0]! as { id: string; account_id: string; user_id: string };
    const runB = runs[1]! as { id: string; account_id: string; user_id: string };
    const principalB = principals.find((p) => p.label === labels[1])!;

    // Fixture: a session for B's target user with an entry on A's workspace
    // claiming B's principal. Cross-lineage and cross-target must be denied.
    const forgedToken = randomBytes(32).toString("base64url");
    const forgedSessionId = randomUUID();
    await pool!.query(
      "INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at) VALUES($1,$2,$3,$4,'forged',now()+interval '1 hour')",
      [forgedSessionId, runB.account_id, runB.user_id, sha256Hex(forgedToken)],
    );
    await pool!.query(
      `INSERT INTO lab_test_workspace_entries(id,workspace_id,owner_session_id,owner_principal_id,principal_generation,session_id,token_hash,expires_at)
       VALUES($1,$2,NULL,$3,1,$4,$5,now()+interval '1 hour')`,
      [randomUUID(), runA.id, principalB.id, forgedSessionId, sha256Hex(forgedToken)],
    );
    const denied = await sessionRead(forgedToken);
    expect(denied.statusCode, "a cross-lineage/cross-target entry must never admit a session").toBe(401);
    const bannerDenied = await app.inject({
      method: "GET", url: "/v1/capir/test-session",
      headers: { authorization: `Bearer ${forgedToken}` },
    });
    expect([401, 404], "the banner read must deny the forged entry too").toContain(bannerDenied.statusCode);

    for (let i = 0; i < runs.length; i++) {
      const stopped = await stopRun((runs[i] as { id: string }).id, randomUUID(), keys[i]!);
      expect(stopped.statusCode, stopped.body).toBe(200);
    }
  }, 60_000);

  it("wipes all password, data and session rows on stop and stays honest about external broker cleanup", async () => {
    const created = await createRun({ preset: "daily" });
    expect(created.response.statusCode, created.response.body).toBe(200);
    const run = created.run as { id: string; account_id: string; user_id: string };
    const login = await passwordLogin(created.username, created.password);
    expect(login.statusCode, login.body).toBe(200);

    // A broker credential makes external cleanup pending and must stay honest.
    await pool!.query(
      `INSERT INTO mcp_connections(account_id,id,created_by_user_id,friendly_name,server_url,auth_mode,nango_connection_id,nango_provider)
       VALUES($1,$2,$3,'Synthetic broker','https://broker.test.invalid/mcp','oauth',$4,'mcp-generic')`,
      [run.account_id, randomUUID(), run.user_id, `conn-${randomUUID()}`],
    );

    const stopped = await stopRun(run.id);
    expect(stopped.statusCode, stopped.body).toBe(200);
    const state = stopped.json().run.state;
    const pending = await pool!.query<{ external_cleanup_pending: number }>(
      "SELECT external_cleanup_pending FROM lab_test_workspaces WHERE id=$1", [run.id],
    );
    const ledger = await pool!.query<{ provenance: string }>(
      "SELECT provenance FROM mcp_oauth_cleanup WHERE lab_workspace_id=$1", [run.id],
    );
    expect(state, "pending broker cleanup must never claim deletion").toBe("deleting");
    expect(Number(pending.rows[0]!.external_cleanup_pending), "the pending boundary must be explicit").toBeGreaterThan(0);
    expect(ledger.rows[0]?.provenance).toBe("lab_stop");

    // Local password/data/session rows are already verified gone.
    expect(await accountDataRows(run.account_id), "every classified account row must be wiped").toBe(0);
    expect((await pool!.query("SELECT 1 FROM sessions WHERE account_id=$1", [run.account_id])).rowCount, "sessions must be removed").toBe(0);
    const dataTables = (
      await pool!.query<{ table_name: string }>("SELECT table_name FROM lab_test_workspace_table_manifest WHERE scope='account'")
    ).rows.map((row) => row.table_name);
    for (const table of dataTables) {
      const rows = await pool!.query(`SELECT count(*) FROM "${table}" WHERE account_id=$1`, [run.account_id]);
      expect(Number(rows.rows[0]!.count), `${table} must be wiped for the test account`).toBe(0);
    }

    // With the external ledger settled the same lifecycle finalizes honestly.
    await pool!.query("DELETE FROM mcp_oauth_cleanup WHERE lab_workspace_id=$1", [run.id]);
    const finalized = await stopRun(run.id);
    expect(finalized.statusCode, finalized.body).toBe(200);
    expect(finalized.json().run.state, "verified local deletion plus settled ledger claims deletion").toBe("deleted");
  }, 90_000);

  it("fails closed on unknown schema and recovers only after the schema is restored", async () => {
    const created = await createRun();
    expect(created.response.statusCode, created.response.body).toBe(200);
    const run = created.run as { id: string };
    await pool!.query("CREATE TABLE capir_test_schema_probe_20261004 (account_id uuid)");
    try {
      const stopped = await stopRun(run.id);
      expect(stopped.statusCode, stopped.body).toBe(200);
      const projection = stopped.json().run;
      expect(projection.state, "unknown schema must fail closed, never claim deletion").toBe("deleting");
      expect(projection.cleanup_error).toBe("schema_changed");
    } finally {
      await pool!.query("DROP TABLE IF EXISTS capir_test_schema_probe_20261004");
    }
    const recovered = await stopRun(run.id);
    expect(recovered.statusCode, recovered.body).toBe(200);
    expect(recovered.json().run.state).toBe("deleted");
  }, 60_000);

  it("keeps ordinary password login and human-parent Lab authority unchanged", async () => {
    // (a) Ordinary password login: no Lab entry is invented.
    const accountId = randomUUID();
    const userId = randomUUID();
    const ordinaryPassword = generatedPassword();
    const username = `qa-${randomBytes(4).toString("hex")}`;
    await insertPasswordFixtureUser(accountId, userId, `${username}@example.test`, username, ordinaryPassword);
    try {
      const login = await passwordLogin(username, ordinaryPassword);
      expect(login.statusCode, login.body).toBe(200);
      const read = await sessionRead(login.json().access_token);
      expect(read.statusCode, read.body).toBe(200);
      expect(read.json().user.kind).toBe("password_human");
      const entries = await pool!.query("SELECT 1 FROM lab_test_workspace_entries WHERE session_id IN (SELECT id FROM sessions WHERE account_id=$1)", [accountId]);
      expect(entries.rowCount, "ordinary password login invents no Lab entry").toBe(0);
    } finally {
      await removePasswordFixtureUser(accountId);
    }

    // (b) Existing human-parent Lab flow keeps its exact semantics.
    const ownerAccountId = randomUUID();
    const ownerUserId = randomUUID();
    const ownerSessionId = randomUUID();
    const ownerToken = randomBytes(32).toString("base64url");
    const workspaceId = randomUUID();
    await pool!.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Human Lab owner')", [ownerAccountId, `human-${workspaceId.slice(0, 8)}`]);
    await pool!.query(
      "INSERT INTO users(id,account_id,email,display_name,kind) VALUES($1,$2,$3,'Human owner','simulated_human')",
      [ownerUserId, ownerAccountId, `owner-${workspaceId.slice(0, 8)}@example.test`],
    );
    await pool!.query(
      "INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at) VALUES($1,$2,$3,$4,'human',now()+interval '1 hour')",
      [ownerSessionId, ownerAccountId, ownerUserId, sha256Hex(ownerToken)],
    );
    try {
      const created = await app.inject({
        method: "POST", url: "/v1/lab/workspaces",
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { id: workspaceId, duration_hours: 1 },
      });
      expect(created.statusCode, created.body).toBe(200);
      const entryToken = randomBytes(32).toString("base64url");
      const entered = await app.inject({
        method: "POST", url: `/v1/lab/workspaces/${workspaceId}/entries`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { id: randomUUID(), access_token: entryToken },
      });
      expect(entered.statusCode, entered.body).toBe(200);
      expect(entered.json().entry.state).toBe("active");
      const entryRow = await pool!.query<{ owner_session_id: string; owner_principal_id: string | null }>(
        "SELECT owner_session_id, owner_principal_id FROM lab_test_workspace_entries WHERE workspace_id=$1", [workspaceId],
      );
      expect(entryRow.rows[0]!.owner_session_id, "the human parent session stays the lineage").toBe(ownerSessionId);
      expect(entryRow.rows[0]!.owner_principal_id).toBeNull();

      const stopped = await app.inject({
        method: "POST", url: `/v1/lab/workspaces/${workspaceId}/stop`,
        headers: { authorization: `Bearer ${ownerToken}` },
        payload: { id: randomUUID() },
      });
      expect(stopped.statusCode, stopped.body).toBe(200);
      expect(stopped.json().workspace.state, "the human Lab lifecycle keeps its verified cleanup").toBe("deleted");
    } finally {
      await pool!.query("DELETE FROM sessions WHERE account_id=$1", [ownerAccountId]);
      await pool!.query("DELETE FROM lab_test_workspace_entries WHERE workspace_id=$1", [workspaceId]);
      await pool!.query("DELETE FROM lab_test_workspaces WHERE id=$1", [workspaceId]);
      await pool!.query("DELETE FROM users WHERE account_id=$1", [ownerAccountId]);
      await pool!.query("DELETE FROM harness_source_generations WHERE account_id=$1", [ownerAccountId]);
      await pool!.query("DELETE FROM accounts WHERE id=$1", [ownerAccountId]);
    }
  }, 60_000);

  it("serves the typed session client banner over real HTTP routing", async () => {
    const created = await createRun();
    expect(created.response.statusCode, created.response.body).toBe(200);
    const run = created.run as { id: string; expires_at: string };
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const client = new TalentSignalClient(address);
      const session = await client.signInWithPassword({
        identifier: created.username,
        password: created.password,
        client_label: "capir-tests",
      });
      expect(session.user.kind).toBe("lab_human");
      const banner = await client.currentCapirTestRun();
      expect(banner.id, "the typed client resolves the same run").toBe(run.id);
      expect(banner.expires_at, "the typed client resolves the same deadline").toBe(run.expires_at);
      expect(banner.state).toBe("ready");
    } finally {
      await stopRun(run.id);
    }
  }, 60_000);
});
