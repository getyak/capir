/** Production app -> password login -> persistent enrollment -> guarded readback.
 * All expiry/revocation manipulation is restricted to a named disposable DB. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { LabTaskTrial, SessionResponse, PersistentSessionProof, PersistentSessionResponse } from "@talent-signal/contracts";
import { buildApp } from "../app.js";
import type { BackendConfig } from "../config.js";
import { sha256 } from "../lib/hash.js";
import { encodePasswordCredential } from "./passwordCredential.js";
import { LocalChatMediaStorage } from "./chatMediaStorage.js";
import { enrollPersistentSession } from "./persistentSession.js";
import { approveDesktopBrowserLogin, consumeDesktopBrowserLogin, pkceS256,
  postgresDesktopBrowserLoginDb, prepareDesktopBrowserLogin } from "./desktopBrowserLogin.js";
import type { AuthContext } from "./auth.js";
import { LabTaskTrialService } from "./labTaskTrials.js";
import { LabFeatureOverrideService } from "./labFeatureOverrides.js";
import type { RemoteChatAnswerProviding } from "./chatAnswerProvider.js";
import { createMcpClientGrant, resolveMcpGrant } from "./mcpGrants.js";

const database = process.env.PERSISTENT_SESSION_TEST_DATABASE_URL;
const artifacts = process.env.PERSISTENT_SESSION_TEST_ARTIFACT_DIR;
if (database) {
  const parsed = new URL(database);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname)
    || !parsed.pathname.slice(1).startsWith("capri_persistent_test_") || !artifacts) {
    throw new Error("Use a named disposable loopback database and task-owned artifact directory.");
  }
}
const pool = database ? new Pool({ connectionString: database, max: 8,
  statement_timeout: 10_000, query_timeout: 12_000 }) : null;
const media = join(artifacts ?? ".", "persistent-session-media");
const config: BackendConfig = { databaseUrl: database!, host: "127.0.0.1", port: 0,
  allowedOrigins: ["https://web.test"], appleSignInAudiences: [], appleSignInEnabled: false,
  passwordAuthEnabled: true, passwordRegistrationEnabled: false, simulatedAuthEnabled: false,
  sessionTtlSeconds: 28_800, retentionSweepIntervalMs: 60_000,
  capirAuth: { enabled: true, webOrigin: "https://web.test", backendOrigin: "https://api.test",
    codeTtlSeconds: 60, accessTtlSeconds: 900, refreshIdleTtlSeconds: 604800,
    refreshAbsoluteTtlSeconds: 2592000 },
  chatMediaStorage: { provider: "local", directory: media } };
const secret = () => randomBytes(32).toString("base64url");
const accounts: { accountId: string; email: string }[] = [];
let app: Awaited<ReturnType<typeof buildApp>>;
let fixtureAddress = 0;
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

function makeApp(databasePool: Pool = pool!) {
  return buildApp({ pool: databasePool, config, chatMediaStorage: new LocalChatMediaStorage(media),
    remoteChatProvider: null, personResearchProvider: null, privateConversationProvider: null,
    labProviders: new Map(), labJobWorkerEnabled: false, conversationQueueWorkerEnabled: false,
    labCIVerifier: null, screenshotContact: null });
}

/** Transparent fault injection: execute every real statement, holding only the
 * selected transaction's COMMIT. No fixture supplies missing protocol state. */
function holdSessionCommit(sessionId: string, operation: "enroll" | "revoke") {
  let release!: () => void, reached!: () => void;
  const released = new Promise<void>(resolve => { release = resolve; });
  const atCommit = new Promise<void>(resolve => { reached = resolve; });
  let holderPid: number | null = null;
  const marker = operation === "enroll" ? "INSERT INTO persistent_session_credentials"
    : "UPDATE sessions SET revoked_at=clock_timestamp()";
  const wrapped = new Proxy(pool!, {
    get(target, property) {
      if (property !== "connect") {
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async () => {
        const client = await target.connect();
        let matches = false;
        return new Proxy(client, {
          get(connection, key) {
            if (key !== "query") {
              const value: unknown = Reflect.get(connection, key);
              return typeof value === "function" ? value.bind(connection) : value;
            }
            return async (...args: unknown[]) => {
              const [sql, values] = args;
              if (typeof sql === "string" && sql.includes(marker)
                && Array.isArray(values) && values[0] === sessionId) matches = true;
              if (sql === "COMMIT" && matches) {
                matches = false;
                holderPid = (await connection.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
                reached();
                await released;
              }
              const query = connection.query as unknown as (...parameters: unknown[]) => Promise<unknown>;
              return query.apply(connection, args);
            };
          },
        });
      };
    },
  });
  return { pool: wrapped, atCommit, release, holderPid: () => holderPid };
}

async function waitForBlockedTransaction(holderPid: number | null) {
  expect(holderPid).not.toBeNull();
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const row = await pool!.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
      AND wait_event_type='Lock' AND $1=ANY(pg_blocking_pids(pid))`, [holderPid]);
    if (row.rowCount) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("The expected production transaction did not reach the held row lock.");
}

async function waitForCommit(gate: ReturnType<typeof holdSessionCommit>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([gate.atCommit, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("The production transaction did not reach COMMIT.")), 5_000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

async function fixture() {
  const accountId = randomUUID(), userId = randomUUID();
  const email = `persistent-${userId}@example.test`, password = secret();
  const username = `renew-${userId.replaceAll("-", "")}`;
  const client = await pool!.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Disposable persistent proof')",
      [accountId, `persistent-${accountId}`]);
    await client.query("INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES($1,'owned',$2,$3)",
      [email, accountId, userId]);
    await client.query(`INSERT INTO users(id,account_id,email,display_name,kind,account_role,email_verified_at,username)
      VALUES($1,$2,$3,'Disposable owner','password_human','admin',now(),$4)`, [userId, accountId, email, username]);
    await client.query("UPDATE accounts SET owner_user_id=$2 WHERE id=$1", [accountId, userId]);
    await client.query("INSERT INTO password_credentials(account_id,user_id,password_scrypt) VALUES($1,$2,$3)",
      [accountId, userId, await encodePasswordCredential(password)]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK"); throw error;
  } finally { client.release(); }
  accounts.push({ accountId, email });
  // Each isolated test client has its own address; retain the real production
  // login rate limiter instead of disabling it or making later tests share it.
  const remoteAddress = `192.0.2.${++fixtureAddress}`;
  const login = async () => {
    const response = await app.inject({ method: "POST", url: "/v1/auth/password/login", remoteAddress,
      payload: { identifier: email, password, client_label: "Disposable renewal client" } });
    expect(response.statusCode).toBe(200);
    return response.json<SessionResponse>();
  };
  const session = await login();
  expect(session.session_id).toMatch(/^[0-9a-f-]{36}$/);
  const proof: PersistentSessionProof = { renewal_secret: secret(), account_id: accountId,
    user_id: userId, session_id: session.session_id! };
  const enroll = (client_kind: "web" | "ios" = "ios", token = session.access_token, server = app) => server.inject({
    method: "POST", url: "/v1/auth/persistent/enroll", headers: bearer(token),
    payload: { renewal_secret: proof.renewal_secret, client_kind },
  });
  const renew = (input = proof) => app.inject({ method: "POST", url: "/v1/auth/persistent/renew", payload: input });
  const auth: AuthContext = { accountId, userId, sessionId: session.session_id!, accountSlug: session.account.slug,
    userEmail: email, userKind: "password_human" };
  return { accountId, userId, session, proof, enroll, renew, login, auth };
}
const readback = (accessToken: string) => app.inject({ url: "/v1/auth/session", headers: bearer(accessToken) });


const replayProvider: RemoteChatAnswerProviding = {
  providerId: "zhipu-chat-completions", model: "synthetic-replay-model", imageModel: null,
  supportsImageInput: false, supportsPromptPresets: false,
  async answer() { throw new Error("Replay-retention proof must not execute a model."); },
};
const replayProviders = new Map([[replayProvider.model, replayProvider]]);
type ReplayLogin = "ordinary" | "web" | "ios" | "macos";

async function labReplayContext(kind: ReplayLogin) {
  const f = await fixture();
  const server = await buildApp({ pool: pool!, config: { ...config, internalLabEnabled: true },
    chatMediaStorage: new LocalChatMediaStorage(media), remoteChatProvider: null,
    personResearchProvider: null, privateConversationProvider: null, labProviders: replayProviders,
    labJobWorkerEnabled: false, conversationQueueWorkerEnabled: false, labCIVerifier: null,
    screenshotContact: null });
  try {
    let session = f.session;
    let renew = () => server.inject({ url: "/v1/auth/session", headers: bearer(session.access_token) });
    let revoke = () => server.inject({ method: "POST", url: "/v1/auth/logout", headers: bearer(session.access_token) });
    if (kind === "macos") {
      const db = postgresDesktopBrowserLoginDb(pool!), verifier = secret(), state = secret();
      const prepared = await prepareDesktopBrowserLogin(db, config, { protocol_version: 1,
        purpose: "macos-primary-login", web_origin: "https://web.test", state,
        challenge: pkceS256(verifier), cancel_secret: secret() });
      const approved = await approveDesktopBrowserLogin(db, config, prepared.attempt_id, f.auth,
        { state, web_origin: "https://web.test" });
      const mac = await consumeDesktopBrowserLogin(db, config, { attempt_id: prepared.attempt_id,
        code: approved.code!, verifier, state, web_origin: "https://web.test" });
      const proof = { device_secret: secret(), web_origin: "https://web.test",
        account_id: f.accountId, user_id: f.userId };
      const enrolled = await server.inject({ method: "POST", url: "/v1/desktop-persistent-session/enroll",
        headers: bearer(mac.access_token), payload: proof });
      expect(enrolled.statusCode).toBe(200); session = enrolled.json();
      renew = () => server.inject({ method: "POST", url: "/v1/desktop-persistent-session/renew", payload: proof });
      revoke = () => server.inject({ method: "POST", url: "/v1/desktop-persistent-session/revoke", payload: proof });
    } else if (kind !== "ordinary") {
      const enrolled = await f.enroll(kind, f.session.access_token, server);
      expect(enrolled.statusCode).toBe(200); session = enrolled.json();
      renew = () => server.inject({ method: "POST", url: "/v1/auth/persistent/renew", payload: f.proof });
      revoke = () => server.inject({ method: "POST", url: "/v1/auth/persistent/revoke", payload: f.proof });
    }
    expect(session.session_id).toBeDefined();
    const auth = { ...f.auth, sessionId: session.session_id! };
    const revision = process.env.TALENT_SIGNAL_BACKEND_REVISION?.trim() || null;
    const trials = new LabTaskTrialService(pool!, replayProviders, null, revision);
    const features = new LabFeatureOverrideService(pool!, revision);
    return { f, server, session, auth, renew, revoke, trials, features };
  } catch (error) { await server.close(); throw error; }
}

function labReplayOperations() {
  return [
    { url: "/v1/lab/task-trials", table: "lab_task_trials", key: "trial", conflict: "LAB_TRIAL_ID_CONFLICT",
      request: { id: randomUUID(), task: "relationship_text", model: replayProvider.model,
        prompt_preset: "baseline", duration_minutes: 5, replaces_trial_id: null } },
    { url: "/v1/lab/feature-overrides", table: "lab_feature_overrides", key: "override", conflict: "LAB_FEATURE_OVERRIDE_ID_CONFLICT",
      request: { id: randomUUID(), feature_id: "relationship_evidence_preview", value: "inline_excerpt",
        duration_minutes: 5, replaces_override_id: null } },
  ] as const;
}

async function createLabReplayRecords(c: Awaited<ReturnType<typeof labReplayContext>>,
  operations: ReturnType<typeof labReplayOperations>, end: "stopped" | "expired") {
  let trial!: LabTaskTrial;
  for (const operation of operations) {
    const created = await c.server.inject({ method: "POST", url: operation.url,
      headers: bearer(c.session.access_token), payload: operation.request });
    expect(created.statusCode).toBe(200);
    if (operation.key === "trial") trial = created.json().trial;
    if (end === "stopped") {
      const stopped = await c.server.inject({ method: "POST", url: `${operation.url}/${operation.request.id}/stop`,
        headers: bearer(c.session.access_token) });
      expect(stopped.statusCode).toBe(200); expect(stopped.json()[operation.key].status).toBe("stopped");
    }
  }
  return trial;
}

async function ageLabReplayRecords(c: Awaited<ReturnType<typeof labReplayContext>>) {
  const created = new Date(Date.now() - 9 * 86_400_000).toISOString();
  const expires = new Date(Date.parse(created) + 5 * 60_000).toISOString();
  // These table names are fixed fixture definitions, never request data.
  for (const table of ["lab_task_trials", "lab_feature_overrides"]) {
    await pool!.query(`UPDATE ${table} SET created_at=$4::text::timestamptz,expires_at=$5::text::timestamptz,
      record=jsonb_set(jsonb_set(record,'{created_at}',to_jsonb($4::text)),'{expires_at}',to_jsonb($5::text))
      WHERE account_id=$1 AND user_id=$2 AND auth_session_id=$3`,
    [c.auth.accountId, c.auth.userId, c.auth.sessionId, created, expires]);
  }
  await pool!.query(`UPDATE sessions SET expires_at=$2::timestamptz,
    previous_token_expires_at=CASE WHEN previous_token_hash IS NULL THEN NULL ELSE $2::timestamptz END WHERE id=$1`,
  [c.auth.sessionId, created]);
  return { created, expires };
}

async function sweepLabReplayRecords(c: Awaited<ReturnType<typeof labReplayContext>>) {
  await c.trials.scrubExpired(); await c.features.scrubExpired();
}

describe.skipIf(!pool)("first-party persistent login (disposable PostgreSQL)", () => {
  beforeAll(async () => {
    app = await makeApp();
  });
  afterEach(async () => {
    for (const { accountId, email } of accounts.splice(0)) {
      await pool!.query("UPDATE accounts SET retired_at=NULL WHERE id=$1", [accountId]);
      await pool!.query("DELETE FROM lab_task_trials WHERE account_id=$1", [accountId]);
      await pool!.query("DELETE FROM lab_feature_overrides WHERE account_id=$1", [accountId]);
      await pool!.query("DELETE FROM mcp_client_grants WHERE account_id=$1", [accountId]);
      await pool!.query("DELETE FROM audit_events WHERE account_id=$1", [accountId]);
      await pool!.query("DELETE FROM desktop_browser_login_attempts WHERE account_id=$1", [accountId]);
      await pool!.query("DELETE FROM capir_auth_refresh_tokens WHERE account_id=$1", [accountId]);
      await pool!.query("DELETE FROM capir_auth_codes WHERE account_id=$1", [accountId]);
      await pool!.query("DELETE FROM capir_auth_grants WHERE account_id=$1", [accountId]);
      await pool!.query("DELETE FROM account_access_events WHERE account_id=$1", [accountId]);
      await pool!.query("DELETE FROM sessions WHERE account_id=$1", [accountId]);
      await pool!.query("DELETE FROM password_credentials WHERE account_id=$1", [accountId]);
      await pool!.query("DELETE FROM harness_source_generations WHERE account_id=$1", [accountId]);
      await pool!.query("UPDATE accounts SET owner_user_id=NULL WHERE id=$1", [accountId]);
      await pool!.query("DELETE FROM account_email_reservations WHERE normalized_email=$1", [email]);
      await pool!.query("DELETE FROM users WHERE account_id=$1", [accountId]);
      await pool!.query("DELETE FROM accounts WHERE id=$1", [accountId]);
    }
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it.each(["ios", "web"] as const)("enrolls %s through real password login and returns canonical readback", async kind => {
    const f = await fixture();
    const initialRead = await readback(f.session.access_token);
    expect(initialRead.statusCode).toBe(200);
    expect(initialRead.json().session_id).toBe(f.session.session_id);
    const response = await f.enroll(kind);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const enrolled = response.json<PersistentSessionResponse>();
    expect(enrolled.session_id).toBe(f.session.session_id);
    expect((await readback(enrolled.access_token)).json().session_id).toBe(enrolled.session_id);
    const stored = (await pool!.query("SELECT * FROM persistent_session_credentials WHERE session_id=$1",
      [enrolled.session_id])).rows[0];
    expect(stored.credential_hash).toBe(sha256(f.proof.renewal_secret));
    expect(stored.client_kind).toBe(kind);
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain(f.proof.renewal_secret);
    expect(serialized).not.toContain(enrolled.access_token);
  });

  it("recovers a lost enrollment response and a lost renewal response without needing old access", async () => {
    const f = await fixture();
    expect((await f.enroll()).statusCode).toBe(200); // Deliberately discard the response.
    await pool!.query("UPDATE persistent_session_credentials SET created_at=now()-interval '10 years',updated_at=now()-interval '10 years' WHERE session_id=$1", [f.proof.session_id]);
    await pool!.query("UPDATE sessions SET expires_at=now()-interval '10 years',previous_token_expires_at=now()-interval '10 years' WHERE id=$1", [f.proof.session_id]);
    expect((await readback(f.session.access_token)).statusCode).toBe(401);
    const renewed = await f.renew();
    expect(renewed.statusCode).toBe(200);
    const first = renewed.json<PersistentSessionResponse>();
    const retry = await f.renew();
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(first);
    const live = await readback(first.access_token);
    expect(live.statusCode).toBe(200);
    expect(live.json()).toMatchObject({ session_id: f.proof.session_id,
      account: { id: f.accountId }, user: { id: f.userId } });
    expect(Date.parse(first.expires_at) - Date.now()).toBeGreaterThan(28_790_000);
    expect((await pool!.query("SELECT count(*)::int AS count FROM sessions WHERE account_id=$1", [f.accountId])).rows[0].count).toBe(1);
  });

  it("serializes concurrent enrollment and renewal while preserving the previous access deadline", async () => {
    const f = await fixture();
    const enrollments = await Promise.all([f.enroll(), f.enroll()]);
    expect(enrollments.map(r => r.statusCode)).toEqual([200, 200]);
    expect(enrollments[0].json()).toEqual(enrollments[1].json());
    const old = enrollments[0].json<PersistentSessionResponse>();
    const deadline = new Date(Date.now() + 60_000);
    await pool!.query("UPDATE sessions SET expires_at=$2 WHERE id=$1", [f.proof.session_id, deadline]);
    const outcomes = await Promise.all([f.renew(), f.renew(), f.renew()]);
    expect(outcomes.map(r => r.statusCode)).toEqual([200, 200, 200]);
    expect(outcomes[0].json()).toEqual(outcomes[1].json());
    expect(outcomes[1].json()).toEqual(outcomes[2].json());
    const row = (await pool!.query("SELECT previous_token_expires_at FROM sessions WHERE id=$1", [f.proof.session_id])).rows[0];
    expect(row.previous_token_expires_at).toEqual(deadline);
    expect((await readback(old.access_token)).statusCode).toBe(200);
    await pool!.query("UPDATE sessions SET previous_token_expires_at=now()-interval '1 second' WHERE id=$1", [f.proof.session_id]);
    expect((await readback(old.access_token)).statusCode).toBe(401);
    expect((await readback(outcomes[0].json().access_token)).statusCode).toBe(200);
  });

  it("rejects mismatched enrollment and proof without replacing an existing capability", async () => {
    const f = await fixture();
    expect((await f.enroll()).statusCode).toBe(200);
    const wrong = await app.inject({ method: "POST", url: "/v1/auth/persistent/enroll",
      headers: bearer(f.session.access_token), payload: { renewal_secret: secret(), client_kind: "ios" } });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error.code).toBe("PERSISTENT_SESSION_INELIGIBLE");
    for (const proof of [{ ...f.proof, session_id: randomUUID() }, { ...f.proof, user_id: randomUUID() },
      { ...f.proof, account_id: randomUUID() }, { ...f.proof, renewal_secret: secret() }]) {
      const denied = await f.renew(proof);
      expect(denied.statusCode).toBe(401);
      expect(denied.json().error.code).toBe("PERSISTENT_SESSION_REVOKED");
    }
    expect((await f.renew()).statusCode).toBe(200);
  });

  it("accepts canonical UUIDs encoded with Foundation's uppercase spelling", async () => {
    const f = await fixture();
    expect((await f.enroll()).statusCode).toBe(200);
    const result = await f.renew({ ...f.proof, account_id: f.proof.account_id.toUpperCase(),
      user_id: f.proof.user_id.toUpperCase(), session_id: f.proof.session_id.toUpperCase() });
    expect(result.statusCode).toBe(200);
    expect(result.json().session_id).toBe(f.proof.session_id);
  });

  it("an already committed canonical logout cannot lose to an in-flight renewal", async () => {
    const f = await fixture();
    expect((await f.enroll()).statusCode).toBe(200);
    const revoker = await pool!.connect();
    try {
      await revoker.query("BEGIN");
      await revoker.query("SELECT id FROM accounts WHERE id=$1 FOR UPDATE", [f.accountId]);
      await revoker.query("UPDATE sessions SET revoked_at=clock_timestamp() WHERE id=$1", [f.proof.session_id]);
      const renewal = f.renew();
      // inject is a thenable; begin dispatch before observing the DB lock.
      const dispatched = Promise.resolve(renewal);
      const deadline = Date.now() + 2_000;
      let blocked = false;
      while (Date.now() < deadline) {
        const waiting = await pool!.query(`SELECT 1 FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE 'SELECT id,name,slug,retired_at FROM accounts%'`);
        if (waiting.rowCount) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await revoker.query("COMMIT");
      const result = await dispatched;
      expect(result.statusCode).toBe(401);
      expect(result.json().error.code).toBe("PERSISTENT_SESSION_REVOKED");
    } finally { await revoker.query("ROLLBACK"); revoker.release(); }
  });

  it("does not replace a browser-authorized Mac login even before Mac capability enrollment", async () => {
    const f = await fixture(), db = postgresDesktopBrowserLoginDb(pool!);
    const verifier = secret(), state = secret();
    const prepared = await prepareDesktopBrowserLogin(db, config, { protocol_version: 1,
      purpose: "macos-primary-login", web_origin: "https://web.test", state,
      challenge: pkceS256(verifier), cancel_secret: secret() });
    const approved = await approveDesktopBrowserLogin(db, config, prepared.attempt_id, f.auth,
      { state, web_origin: "https://web.test" });
    const mac = await consumeDesktopBrowserLogin(db, config, { attempt_id: prepared.attempt_id,
      code: approved.code!, verifier, state, web_origin: "https://web.test" });
    const denied = await f.enroll("web", mac.access_token);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("PERSISTENT_SESSION_INELIGIBLE");
    expect((await readback(mac.access_token)).statusCode).toBe(200);
  });

  it("does not promote a simulated identity into permanent authorization", async () => {
    const f = await fixture();
    await pool!.query("UPDATE users SET kind='simulated_human' WHERE id=$1", [f.userId]);
    const denied = await f.enroll();
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("PERSISTENT_SESSION_INELIGIBLE");
    expect((await pool!.query("SELECT count(*)::int AS count FROM persistent_session_credentials WHERE session_id=$1", [f.proof.session_id])).rows[0].count).toBe(0);
  });

  it("keeps an actual CLI grant and its independent backing session outside generic persistence", async () => {
    const f = await fixture(), verifier = secret(), state = secret();
    const redirect_uri = "http://127.0.0.1:49381/capir/callback";
    const code = await app.inject({ method: "POST", url: "/v1/capir/auth/authorize", headers: bearer(f.session.access_token),
      payload: { schema_version: "capir-auth.v2", redirect_uri, state,
        code_challenge: createHash("sha256").update(verifier, "ascii").digest("base64url"),
        code_challenge_method: "S256", web_origin: "https://web.test", backend_origin: "https://api.test",
        scopes: ["grants.read", "grants.revoke"], consent: true, client_label: "Disposable CLI boundary" } });
    expect(code.statusCode).toBe(200);
    const exchange = await app.inject({ method: "POST", url: "/v1/capir/auth/exchange", payload: {
      schema_version: "capir-auth.v2", code: code.json().code, code_verifier: verifier, state, redirect_uri,
      web_origin: "https://web.test", backend_origin: "https://api.test" } });
    expect(exchange.statusCode).toBe(200);
    expect((await f.enroll("web", exchange.json().access_token)).statusCode).toBe(401);
    const backing = (await pool!.query("SELECT backing_session_id FROM capir_auth_grants WHERE id=$1",
      [exchange.json().grant.id])).rows[0].backing_session_id as string;
    // The backing token never leaves the server. This additional internal
    // admission check verifies the protocol fence even for a forged context.
    await expect(enrollPersistentSession(pool!, config, { ...f.auth, sessionId: backing },
      { renewal_secret: secret(), client_kind: "web" }))
      .rejects.toMatchObject({ code: "PERSISTENT_SESSION_INELIGIBLE" });
    expect((await pool!.query("SELECT count(*)::int AS count FROM persistent_session_credentials WHERE session_id=$1", [backing])).rows[0].count).toBe(0);
  });

  it("keeps all dormant persistent devices visible beyond 100 ordinary sessions and revokes via Settings", async () => {
    const f = await fixture();
    expect((await f.enroll()).statusCode).toBe(200);
    await pool!.query("UPDATE sessions SET created_at=now()-interval '1 year',expires_at=now()-interval '1 day' WHERE id=$1", [f.proof.session_id]);
    const browser = await f.login();
    const ordinary = Array.from({ length: 101 }, () => randomUUID()), persistent = Array.from({ length: 101 }, () => randomUUID());
    for (const ids of [ordinary, persistent]) {
      await pool!.query(`INSERT INTO sessions(id,account_id,user_id,token_hash,client_label,expires_at)
        SELECT id,$1,$2,hash,'Disposable pressure',now()+interval '8 hours'
        FROM unnest($3::uuid[],$4::text[]) AS fixture(id,hash)`,
      [f.accountId, f.userId, ids, ids.map(() => sha256(secret()))]);
    }
    await pool!.query(`INSERT INTO persistent_session_credentials(session_id,account_id,user_id,credential_hash,client_kind)
      SELECT id,$1,$2,hash,'web' FROM unnest($3::uuid[],$4::text[]) AS fixture(id,hash)`,
    [f.accountId, f.userId, persistent, persistent.map(() => sha256(secret()))]);
    const list = await app.inject({ url: "/v1/account/settings", headers: bearer(browser.access_token) });
    expect(list.statusCode).toBe(200);
    const sessions = list.json().sessions as { id: string; persistent: boolean }[];
    expect(sessions.find(s => s.id === f.proof.session_id)?.persistent).toBe(true);
    expect(sessions.filter(s => s.persistent)).toHaveLength(102);
    expect(sessions.filter(s => !s.persistent)).toHaveLength(100);
    const mutation = await app.inject({ method: "POST", url: "/v1/account/settings", headers: bearer(browser.access_token),
      payload: { id: randomUUID(), kind: "revoke_session", session_id: f.proof.session_id } });
    expect(mutation.statusCode).toBe(200);
    expect(mutation.json().sessions.some((s: { id: string }) => s.id === f.proof.session_id)).toBe(false);
    expect((await f.renew()).json().error.code).toBe("PERSISTENT_SESSION_REVOKED");
  });

  it("uses renewal proof to sign out after access expiry and never revives the old family", async () => {
    const f = await fixture();
    const enrolled = (await f.enroll()).json<PersistentSessionResponse>();
    await pool!.query("UPDATE sessions SET expires_at=now()-interval '1 day' WHERE id=$1", [f.proof.session_id]);
    const revoked = await app.inject({ method: "POST", url: "/v1/auth/persistent/revoke", payload: f.proof });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toEqual({ revoked: true });
    expect((await readback(enrolled.access_token)).statusCode).toBe(401);
    expect((await f.renew()).json().error.code).toBe("PERSISTENT_SESSION_REVOKED");
    const fresh = await f.login();
    expect(fresh.session_id).not.toBe(f.proof.session_id);
    expect((await f.renew()).statusCode).toBe(401);
    expect((await readback(fresh.access_token)).statusCode).toBe(200);
  });

  it("fences an uncommitted enrollment after the original access crosses expiry", async () => {
    const f = await fixture(), gate = holdSessionCommit(f.proof.session_id, "enroll");
    const gatedApp = await makeApp(gate.pool);
    let enrollment: Promise<Awaited<ReturnType<typeof f.enroll>>> | undefined;
    let logout: Promise<Awaited<ReturnType<typeof app.inject>>> | undefined;
    try {
      await pool!.query("UPDATE sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1", [f.proof.session_id]);
      enrollment = Promise.resolve(f.enroll("ios", f.session.access_token, gatedApp));
      await waitForCommit(gate);
      const deadline = Date.now() + 4_000;
      let expired = false;
      while (Date.now() < deadline) {
        expired = (await pool!.query<{ expired: boolean }>(
          "SELECT clock_timestamp()>expires_at AS expired FROM sessions WHERE id=$1", [f.proof.session_id])).rows[0]!.expired;
        if (expired) break;
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      expect(expired).toBe(true);
      // The capability is still invisible, but the exact pending family is
      // known from the real login producer before enrollment was dispatched.
      expect((await pool!.query("SELECT 1 FROM persistent_session_credentials WHERE session_id=$1", [f.proof.session_id])).rowCount).toBe(0);
      logout = Promise.resolve(app.inject({ method: "POST", url: "/v1/auth/persistent/revoke",
        payload: { ...f.proof, original_access_token: f.session.access_token } }));
      await waitForBlockedTransaction(gate.holderPid());
      gate.release();
      const [enrolled, revoked] = await Promise.all([enrollment, logout]);
      expect(enrolled.statusCode).toBe(200);
      expect(revoked.statusCode).toBe(200);
      expect((await pool!.query("SELECT revoked_at FROM sessions WHERE id=$1", [f.proof.session_id])).rows[0].revoked_at).not.toBeNull();
      expect((await f.renew()).json().error.code).toBe("PERSISTENT_SESSION_REVOKED");
      expect((await readback(enrolled.json().access_token)).statusCode).toBe(401);
    } finally {
      gate.release();
      await Promise.allSettled([enrollment, logout]);
      await gatedApp.close();
    }
  }, 12_000);

  it("a pending logout that owns COMMIT prevents a concurrent enrollment from committing", async () => {
    const f = await fixture(), gate = holdSessionCommit(f.proof.session_id, "revoke");
    const gatedApp = await makeApp(gate.pool);
    let logout: Promise<Awaited<ReturnType<typeof app.inject>>> | undefined;
    let enrollment: Promise<Awaited<ReturnType<typeof f.enroll>>> | undefined;
    try {
      logout = Promise.resolve(gatedApp.inject({ method: "POST", url: "/v1/auth/persistent/revoke",
        payload: { ...f.proof, original_access_token: f.session.access_token } }));
      await waitForCommit(gate);
      enrollment = Promise.resolve(f.enroll());
      await waitForBlockedTransaction(gate.holderPid());
      gate.release();
      const [revoked, denied] = await Promise.all([logout, enrollment]);
      expect(revoked.statusCode).toBe(200);
      expect(denied.statusCode).toBe(401);
      expect(denied.json().error.code).toBe("PERSISTENT_SESSION_REVOKED");
      expect((await pool!.query("SELECT 1 FROM persistent_session_credentials WHERE session_id=$1", [f.proof.session_id])).rowCount).toBe(0);
      expect((await f.renew()).statusCode).toBe(401);
    } finally {
      gate.release();
      await Promise.allSettled([logout, enrollment]);
      await gatedApp.close();
    }
  }, 10_000);

  it("uses an expired original bearer only to revoke its exact pending session", async () => {
    const f = await fixture(), other = await f.login();
    await pool!.query("UPDATE sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [f.proof.session_id]);
    const wrongScope = await app.inject({ method: "POST", url: "/v1/auth/persistent/revoke",
      payload: { ...f.proof, session_id: other.session_id, original_access_token: f.session.access_token } });
    expect(wrongScope.statusCode).toBe(401);
    expect(wrongScope.json().error.code).toBe("PERSISTENT_SESSION_PROOF_INVALID");
    const wrongProof = await app.inject({ method: "POST", url: "/v1/auth/persistent/revoke",
      payload: { ...f.proof, renewal_secret: secret(), original_access_token: secret() } });
    expect(wrongProof.statusCode).toBe(401);
    expect(wrongProof.json().error.code).toBe("PERSISTENT_SESSION_PROOF_INVALID");
    expect((await pool!.query("SELECT revoked_at FROM sessions WHERE id=$1", [f.proof.session_id])).rows[0].revoked_at).toBeNull();
    expect((await readback(other.access_token)).statusCode).toBe(200);
    const renewal = await app.inject({ method: "POST", url: "/v1/auth/persistent/renew",
      payload: { ...f.proof, original_access_token: f.session.access_token } });
    expect(renewal.statusCode).toBe(400);
    const enrollment = await app.inject({ method: "POST", url: "/v1/auth/persistent/enroll",
      headers: bearer(f.session.access_token), payload: { renewal_secret: f.proof.renewal_secret,
        client_kind: "ios", original_access_token: f.session.access_token } });
    expect(enrollment.statusCode).toBe(400);
    expect((await f.renew()).statusCode).toBe(401);
    expect((await f.enroll()).statusCode).toBe(401);
    const revoke = () => app.inject({ method: "POST", url: "/v1/auth/persistent/revoke",
      payload: { ...f.proof, original_access_token: f.session.access_token } });
    expect((await revoke()).statusCode).toBe(200);
    expect((await revoke()).statusCode).toBe(200);
    expect((await f.enroll()).statusCode).toBe(401);
    expect((await readback(other.access_token)).statusCode).toBe(200);
  });

  it("revokes with an expired previous bearer without granting renewal or reviving a disabled member", async () => {
    const f = await fixture();
    expect((await f.enroll()).statusCode).toBe(200);
    await pool!.query("UPDATE sessions SET previous_token_expires_at=now()-interval '1 day' WHERE id=$1", [f.proof.session_id]);
    await pool!.query("UPDATE users SET status='revoked' WHERE id=$1", [f.userId]);
    const revoked = await app.inject({ method: "POST", url: "/v1/auth/persistent/revoke",
      payload: { ...f.proof, renewal_secret: secret(), original_access_token: f.session.access_token } });
    expect(revoked.statusCode).toBe(200);
    await pool!.query("UPDATE users SET status='active' WHERE id=$1", [f.userId]);
    expect((await f.renew()).statusCode).toBe(401);
    expect((await pool!.query("SELECT revoked_at FROM sessions WHERE id=$1", [f.proof.session_id])).rows[0].revoked_at).not.toBeNull();
  });

  it.each(["disable", "retire", "delete"] as const)("denies continuation after %s", async action => {
    const f = await fixture();
    const enrolled = (await f.enroll()).json<PersistentSessionResponse>();
    if (action === "disable") await pool!.query("UPDATE users SET status='revoked' WHERE id=$1", [f.userId]);
    if (action === "retire") await pool!.query("UPDATE accounts SET retired_at=now() WHERE id=$1", [f.accountId]);
    if (action === "delete") await pool!.query("DELETE FROM sessions WHERE id=$1", [f.proof.session_id]);
    expect((await readback(enrolled.access_token)).statusCode).toBe(401);
    expect((await f.renew()).json().error.code).toBe("PERSISTENT_SESSION_REVOKED");
  });

  it("preserves deployment audience denial as unavailable rather than canonical revocation", async () => {
    const f = await fixture();
    expect((await f.enroll()).statusCode).toBe(200);
    await expect(enrollPersistentSession(pool!, config, f.auth,
      { renewal_secret: f.proof.renewal_secret, client_kind: "ios" }, [randomUUID()]))
      .rejects.toMatchObject({ code: "DEPLOYMENT_WORKSPACE_NOT_ADMITTED" });
    expect((await f.renew()).statusCode).toBe(200);
  });


  describe("Lab IDs remain ended when the same login family resumes after the access deadline", () => {
    it.each((["web", "ios", "macos"] as const).flatMap(kind =>
      (["stopped", "expired"] as const).map(end => ({ kind, end }))))
    ("retains $end configuration IDs for a dormant $kind login without extending their leases", async ({ kind, end }) => {
      const c = await labReplayContext(kind), operations = labReplayOperations();
      try {
        const trial = await createLabReplayRecords(c, operations, end);
        if (kind === "web" && end === "stopped") {
          expect(await c.trials.recordMeasurements(c.auth, randomUUID(), [{ trial, measurement: {
            execution: "local_only", remote_requests_started: 0, requested_model: replayProvider.model,
            resolved_model: replayProvider.model, actual_model: null, prompt_revision: trial.prompt_revision,
            actual_prompt_revision: null, duration_ms: 1, input_tokens: 0, output_tokens: 0,
            provider_request_id: null, status: "completed", error_code: null,
          } }], "unverified")).toBe(true);
          await pool!.query("UPDATE lab_trial_observations SET created_at=now()-interval '9 days' WHERE account_id=$1 AND trial_id=$2",
            [c.auth.accountId, trial.id]);
        }
        const aged = await ageLabReplayRecords(c);
        await sweepLabReplayRecords(c);
        const renewed = await c.renew(); expect(renewed.statusCode).toBe(200);
        expect(renewed.json().session_id).toBe(c.auth.sessionId);
        const token = renewed.json().access_token as string;
        expect((await c.server.inject({ url: "/v1/auth/session", headers: bearer(token) })).statusCode).toBe(200);
        for (const operation of operations) {
          const replay = await c.server.inject({ method: "POST", url: operation.url,
            headers: bearer(token), payload: operation.request });
          expect(replay.statusCode).toBe(200);
          expect(replay.json()[operation.key]).toMatchObject({ id: operation.request.id,
            status: end, created_at: aged.created, expires_at: aged.expires });
          const changed = await c.server.inject({ method: "POST", url: operation.url,
            headers: bearer(token), payload: { ...operation.request, duration_minutes: 15 } });
          expect(changed.statusCode).toBe(409); expect(changed.json().error.code).toBe(operation.conflict);
        }
        // Retaining a replay record must not select any expired experiment for
        // a new product task or retain old observation payloads.
        expect(await c.trials.resolveProvider(pool!, c.auth, "relationship_text", () => {})).toBeNull();
        expect(await c.features.adoptionReceipt(pool!, c.auth)).toBeNull();
        expect((await pool!.query("SELECT count(*)::int AS count FROM lab_trial_observations WHERE account_id=$1",
          [c.auth.accountId])).rows[0].count).toBe(0);
      } finally { await c.server.close(); }
    });

    it("still cleans ordinary expired sessions that have no continuation capability", async () => {
      const c = await labReplayContext("ordinary"), operations = labReplayOperations();
      try {
        await createLabReplayRecords(c, operations, "stopped"); await ageLabReplayRecords(c);
        await sweepLabReplayRecords(c);
        for (const operation of operations) {
          expect((await pool!.query(`SELECT 1 FROM ${operation.table} WHERE account_id=$1 AND id=$2`,
            [c.auth.accountId, operation.request.id])).rowCount).toBe(0);
        }
        expect((await c.renew()).statusCode).toBe(401);
      } finally { await c.server.close(); }
    });

    it.each((["web", "macos"] as const).flatMap(kind =>
      (["revoked", "retired"] as const).map(ended => ({ kind, ended }))))
    ("still cleans a $kind family after it is $ended and cannot resume", async ({ kind, ended }) => {
      const c = await labReplayContext(kind), operations = labReplayOperations();
      try {
        await createLabReplayRecords(c, operations, "stopped"); await ageLabReplayRecords(c);
        if (ended === "revoked") {
          expect((await c.revoke()).statusCode).toBe(200);
          await pool!.query("UPDATE sessions SET revoked_at=now()-interval '9 days' WHERE id=$1", [c.auth.sessionId]);
        } else await pool!.query("UPDATE accounts SET retired_at=now() WHERE id=$1", [c.auth.accountId]);
        await sweepLabReplayRecords(c);
        for (const operation of operations) {
          expect((await pool!.query(`SELECT 1 FROM ${operation.table} WHERE account_id=$1 AND id=$2`,
            [c.auth.accountId, operation.request.id])).rowCount).toBe(0);
        }
        expect((await c.renew()).statusCode).toBe(401);
      } finally { await c.server.close(); }
    });

    it("does not make an ordinary MCP grant renewable or admit it to human Lab routes", async () => {
      const c = await labReplayContext("web"), operations = labReplayOperations();
      try {
        const issued = await createMcpClientGrant(pool!, c.auth, { expires_in_days: 30,
          idempotency_key: randomUUID(), name: "Synthetic independent grant", scopes: ["workspace_metadata_read"] }, "https://web.test");
        const deadline = issued.grant.expires_at;
        await ageLabReplayRecords(c); await sweepLabReplayRecords(c);
        expect(await resolveMcpGrant(pool!, `Bearer ${issued.token}`)).not.toBeNull();
        for (const operation of operations) {
          const denied = await c.server.inject({ method: "POST", url: operation.url,
            headers: bearer(issued.token), payload: operation.request });
          expect(denied.statusCode).toBe(401);
        }
        const renewed = await c.renew(); expect(renewed.statusCode).toBe(200);
        expect((await pool!.query("SELECT expires_at FROM mcp_client_grants WHERE account_id=$1 AND id=$2",
          [c.auth.accountId, issued.grant.id])).rows[0].expires_at.toISOString()).toBe(deadline);
        await pool!.query("UPDATE mcp_client_grants SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE account_id=$1 AND id=$2",
          [c.auth.accountId, issued.grant.id]);
        expect(await resolveMcpGrant(pool!, `Bearer ${issued.token}`)).toBeNull();
        expect((await c.server.inject({ url: "/v1/auth/session", headers: bearer(renewed.json().access_token) })).statusCode).toBe(200);
      } finally { await c.server.close(); }
    });

    it("does not admit a valid CLI v3 grant as a normal authenticated Lab session", async () => {
      const c = await labReplayContext("ordinary"), operations = labReplayOperations();
      try {
        const verifier = secret(), state = secret(), redirect_uri = "http://127.0.0.1:49381/capir/callback";
        const code = await c.server.inject({ method: "POST", url: "/v1/capir/auth/authorize",
          headers: bearer(c.session.access_token), payload: { schema_version: "capir-auth.v3", redirect_uri, state,
            code_challenge: createHash("sha256").update(verifier, "ascii").digest("base64url"),
            code_challenge_method: "S256", web_origin: "https://web.test", backend_origin: "https://api.test",
            scopes: ["grants.read", "grants.revoke"], consent: true, client_label: "Synthetic Lab admission boundary" } });
        expect(code.statusCode).toBe(200);
        const exchange = await c.server.inject({ method: "POST", url: "/v1/capir/auth/exchange", payload: {
          schema_version: "capir-auth.v3", code: code.json().code, code_verifier: verifier, state, redirect_uri,
          web_origin: "https://web.test", backend_origin: "https://api.test" } });
        expect(exchange.statusCode).toBe(200); const token = exchange.json().access_token as string;
        expect((await c.server.inject({ url: "/v1/capir/auth/status", headers: bearer(token) })).statusCode).toBe(200);
        for (const operation of operations) {
          const denied = await c.server.inject({ method: "POST", url: operation.url,
            headers: bearer(token), payload: operation.request });
          expect(denied.statusCode).toBe(401);
        }
      } finally { await c.server.close(); }
    });
  });
});
