#!/usr/bin/env node
/**
 * Disposable backend HTTP protocol probe for the browser-owned macOS primary login
 * (task-owned fixture, not a production mock).
 *
 * It drives the REAL backend and Web routes over HTTP with one disposable
 * real account: prepare -> authenticated backend approval -> one-use exchange -> live
 * status correlation -> read-only re-open. The WK exchange and
 * ASWebAuthenticationSession legs need OS interaction and are reported as
 * manual evidence, never faked here. Ambiguous failures are preserved
 * separately from clean passes.
 *
 * Usage:
 *   DESKTOP_LOGIN_E2E_BACKEND=http://127.0.0.1:4317 \
 *   DESKTOP_LOGIN_E2E_WEB=http://127.0.0.1:3000 \
 *   DESKTOP_LOGIN_E2E_IDENTIFIER=... DESKTOP_LOGIN_E2E_PASSWORD=... \
 *   node scripts/evals/desktop-browser-login-e2e.mjs
 */
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const backend = process.env.DESKTOP_LOGIN_E2E_BACKEND ?? "http://127.0.0.1:4317";
const web = process.env.DESKTOP_LOGIN_E2E_WEB ?? "http://127.0.0.1:3000";
const identifier = process.env.DESKTOP_LOGIN_E2E_IDENTIFIER;
const password = process.env.DESKTOP_LOGIN_E2E_PASSWORD;
const evidence = [];

function record(name, outcome, detail) {
  evidence.push({ name, outcome, detail });
  console.log(`${outcome === "pass" ? "PASS" : outcome === "ambiguous" ? "AMBIGUOUS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const base64url = (buffer) => buffer.toString("base64url");
const verifier = base64url(randomBytes(32));
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = base64url(randomBytes(32));
const cancelSecret = base64url(randomBytes(32));

async function main() {
  for (const origin of [backend, web]) {
    const url = new URL(origin);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Only disposable loopback fixtures are supported.");
  }
  if (!process.env.DESKTOP_LOGIN_E2E_ARTIFACT) throw new Error("Set DESKTOP_LOGIN_E2E_ARTIFACT to this task's storage-guard output directory.");
  if (!identifier || !password) {
    console.error("Disposable real account required: set DESKTOP_LOGIN_E2E_IDENTIFIER and DESKTOP_LOGIN_E2E_PASSWORD.");
    process.exit(2);
  }
  const meta = await fetch(`${backend}/v1/meta`).then((r) => r.json());
  record("backend-reachable", meta.authority ? "pass" : "fail", meta.contract_version);

  const login = await fetch(`${backend}/v1/auth/password/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier, password, client_label: "desktop-login-e2e" }),
  }).then((r) => r.json());
  if (!login.access_token) {
    record("disposable-account-login", "fail", "login refused");
    return;
  }
  record("disposable-account-login", "pass", `account=${login.account.id} user=${login.user.id}`);
  const bearer = { authorization: `Bearer ${login.access_token}`, "content-type": "application/json" };

  const prepared = await fetch(`${web}/api/desktop-auth/prepare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challenge, state, cancel_secret: cancelSecret }),
  }).then((r) => r.json());
  if (!prepared.attempt_id) {
    record("web-prepare", "fail", "prepare refused");
    return;
  }
  record("web-prepare", "pass", `attempt=${prepared.attempt_id} hint=${prepared.matching_hint}`);

  const approved = await fetch(`${backend}/v1/desktop-browser-login/${prepared.attempt_id}/approve`, {
    method: "POST",
    headers: bearer,
    body: JSON.stringify({ state, web_origin: new URL(web).origin }),
  }).then((r) => r.json());
  record("backend-approval", approved.code ? "pass" : "fail", approved.code ? "one code minted" : "approval refused");
  if (!approved.code) return;

  const session = await fetch(`${backend}/v1/desktop-browser-login/consume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ attempt_id: prepared.attempt_id, code: approved.code, verifier, state, web_origin: new URL(web).origin }),
  }).then((r) => r.json());
  record("one-use-exchange", session.access_token ? "pass" : "fail", session.access_token ? "device session created" : "consume refused");
  if (!session.access_token) return;

  const deviceBearer = { authorization: `Bearer ${session.access_token}` };
  const status = await fetch(`${backend}/v1/desktop-browser-login/${prepared.attempt_id}/status`, { headers: deviceBearer }).then((r) => r.json());
  const correlated =
    status.account_id === login.account.id &&
    status.user_id === login.user.id &&
    status.state === "consumed";
  record("status-correlation", correlated ? "pass" : "fail", JSON.stringify(status).slice(0, 200));

  const replay = await fetch(`${backend}/v1/desktop-browser-login/consume`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ attempt_id: prepared.attempt_id, code: approved.code, verifier, state, web_origin: new URL(web).origin }),
  });
  record("replay-refused", replay.status === 409 ? "pass" : "fail", `HTTP ${replay.status}`);

  const result = await fetch(`${backend}/v1/desktop-browser-login/${prepared.attempt_id}/grant-result`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ attempt_id: prepared.attempt_id, verifier }),
  }).then((r) => r.json());
  record("read-only-result", result.committed && result.account_id === login.account.id ? "pass" : "fail", JSON.stringify(result).slice(0, 200));

  record("manual-wk-exchange-and-store-reopen", "ambiguous", "Requires the signed native app and OS browser confirmation; run the Mac acceptance manually and attach its receipt.");
}

main()
  .catch((error) => record("probe-crashed", "fail", error instanceof Error ? error.name : "unknown-error"))
  .finally(() => {
    const directory = resolve(process.env.DESKTOP_LOGIN_E2E_ARTIFACT ?? ".", "desktop-browser-login-http");
    if (!process.env.DESKTOP_LOGIN_E2E_ARTIFACT) process.exit(2);
    mkdirSync(directory, { recursive: true });
    const file = `${directory}/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(file, JSON.stringify({ backend, web, evidence }, null, 2));
    console.log(`Evidence: ${file}`);
    process.exit(evidence.some((entry) => entry.outcome === "fail") ? 1 : 0);
  });
