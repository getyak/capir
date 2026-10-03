import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { encode } from "next-auth/jwt";

const web = new URL(process.env.DESKTOP_CAPTURE_PROOF_WEB_URL ?? "");
const backend = new URL(process.env.DESKTOP_CAPTURE_PROOF_BACKEND_URL ?? "");
const secret = process.env.AUTH_SECRET;
assert(process.env.DESKTOP_CAPTURE_PROOF_DISPOSABLE === "true" && secret &&
  web.protocol === "http:" && backend.protocol === "http:" &&
  web.hostname === "127.0.0.1" && backend.hostname === "127.0.0.1",
  "The proof may target only explicit disposable loopback services.");

async function json(response, step) {
  const body = await response.json().catch(() => ({}));
  assert(response.ok, `${step}: HTTP ${response.status} (${body.code ?? body.error?.code ?? "unknown"})`);
  return body;
}

const login = await json(await fetch(new URL("/v1/auth/simulated-login", backend), {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ account_slug: "fixture-alpha", user_email: "recruiter@alpha.local",
    client_label: "desktop-capture-disposable-proof" }),
}), "local login");
const cookieName = "talent-signal.session-v2";
const token = await encode({ secret, salt: cookieName, maxAge: 3600, token: {
  sub: login.user.id, email: login.user.email, name: login.user.display_name,
  backendAccessToken: login.access_token, backendAccountId: login.account.id,
  backendAccountName: login.account.name, backendAccountSlug: login.account.slug,
  backendExpiresAt: login.expires_at, backendRole: login.user.role,
  backendUserId: login.user.id, backendUsername: login.user.username,
} });
const cookie = `${cookieName}=${encodeURIComponent(token)}`;
const cookieFile = process.env.DESKTOP_CAPTURE_PROOF_COOKIE_FILE;
if (cookieFile) {
  assert(cookieFile.startsWith("/private/tmp/ts-capture-proof-"), "Only a disposable private cookie file is allowed.");
  const handle = await open(cookieFile, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify({ origin: web.origin, cookieName, cookieValue: token,
      accountId: login.account.id }));
  } finally { await handle.close(); }
}
const headers = { cookie, "x-talent-signal-workspace": login.account.id };
const context = await json(await fetch(new URL("/api/desktop-capture/context", web), {
  headers: { cookie }, cache: "no-store",
}), "capture context");
assert.equal(context.processing.available, true);
assert.equal(context.workspace_account_id, login.account.id);

const image = Buffer.alloc(64, 3);
image.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
const contentHash = createHash("sha256").update(image).digest("hex");
const sessionId = randomUUID(), messageId = randomUUID(), attachmentId = randomUUID();
const path = `/api/desktop-capture/${sessionId}/${messageId}`;
const payload = JSON.stringify({ session_id: sessionId, message_id: messageId, idempotency_key: messageId,
  objective: "", policy_version: context.processing.policy_version, owner_scope: context.owner_scope,
  images: [{ attachment_id: attachmentId, file_name: "synthetic.png", media_type: "image/png",
    byte_size: image.length, content_hash: contentHash, data_base64: image.toString("base64") }] });
const postHeaders = { ...headers, origin: web.origin, "content-type": "application/json",
  "x-workspace-session": context.login_binding };
const deniedLogin = await fetch(new URL(path, web), { method: "POST",
  headers: { ...postHeaders, "x-workspace-session": "stale-login" }, body: payload });
assert.equal(deniedLogin.status, 409, "A changed login must not admit the image.");
const deniedAccount = await fetch(new URL(path, web), { method: "POST",
  headers: { ...postHeaders, "x-talent-signal-workspace": randomUUID() }, body: payload });
assert.equal(deniedAccount.status, 401, "A changed workspace must not admit the image.");
const deniedPolicy = await fetch(new URL(path, web), { method: "POST", headers: postHeaders,
  body: JSON.stringify({ ...JSON.parse(payload), policy_version: "stale-policy" }) });
assert.equal(deniedPolicy.status, 409, "A changed processing policy must not admit the image.");
async function submit() {
  return json(await fetch(new URL(path, web), { method: "POST", headers: postHeaders,
    body: payload }), "capture admission");
}
const admitted = await submit();
const replay = await submit();
assert.equal(admitted.queue_entry_id, replay.queue_entry_id, "Retry must not create another queue entry.");
let receipt;
for (let attempt = 0; attempt < 60; attempt += 1) {
  receipt = await json(await fetch(new URL(path, web), { headers: {
    ...headers, "x-workspace-session": context.login_binding }, cache: "no-store" }), "capture receipt");
  if (receipt.result_recorded) break;
  await new Promise(resolve => setTimeout(resolve, 500));
}
assert(receipt?.result_recorded, "The canonical Agent result was not recorded.");
assert.equal(receipt.session_id, sessionId);
assert.equal(receipt.message_id, messageId);
assert.equal(receipt.image_manifest?.[0]?.attachment_id, attachmentId);
assert.equal(receipt.image_manifest?.[0]?.content_hash, contentHash);
const authorization = { authorization: `Bearer ${login.access_token}` };
const source = await fetch(new URL(
  `/v1/agent-sessions/${sessionId}/conversation-images/${messageId}/0`, backend), { headers: authorization });
assert(source.ok, `Original image readback: HTTP ${source.status}`);
assert.equal(createHash("sha256").update(Buffer.from(await source.arrayBuffer())).digest("hex"), contentHash);
const session = await json(await fetch(new URL(`/v1/agent-sessions/${sessionId}`, backend),
  { headers: authorization }), "exact Session");
const turn = session.session?.payload?.turns?.find(item => item.id === messageId);
assert(turn, "The exact message must appear in its canonical Session.");
assert.equal(turn.images?.[0]?.content_hash, contentHash);
assert(JSON.stringify(turn.response).includes("Synthetic capture received"));
const recent = await json(await fetch(new URL("/api/desktop-capture/recent-session", web), {
  headers: { ...headers, "x-workspace-session": context.login_binding }, cache: "no-store",
}), "recent Session");
assert.equal(recent.session_id, sessionId, "Continue must resolve the same authorized Session.");
process.stdout.write(JSON.stringify({ proof: "desktop-capture-bff-to-agent",
  sessionId, messageId, queueEntryId: admitted.queue_entry_id,
  contentHash, imageBytes: image.length, status: receipt.status, resultRecorded: true,
  originalImageReadback: true, idempotentReplay: true, deniedStaleLogin: true,
  deniedWrongAccount: true, deniedStalePolicy: true, recentSessionReadback: true,
  realProvider: false }) + "\n");
