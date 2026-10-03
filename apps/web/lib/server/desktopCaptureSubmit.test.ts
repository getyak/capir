import { beforeEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ claims: vi.fn(), policy: vi.fn(), admit: vi.fn() }));
vi.mock("./backendAuth", () => ({
  readBackendSessionClaims: f.claims,
  backendAuthBaseUrl: () => "http://backend.invalid",
  authSecret: () => "synthetic-test-secret",
}));
vi.mock("@talent-signal/contracts", async importOriginal => {
  const actual = await importOriginal<typeof import("@talent-signal/contracts")>();
  return { ...actual, TalentSignalClient: class { getDesktopCapturePolicy = f.policy; } };
});
vi.mock("./conversationQueue", () => ({ conversationQueueRoute: f.admit }));

import { desktopCaptureSubmitRoute } from "./desktopCaptureSubmit";
import { contactHandoffSessionVersion } from "./contact-handoff-session";
import { workspaceSessionDraftStorageScope } from "./workspaceSessions";
import { proxy } from "../../proxy";
import { NextRequest } from "next/server";

const sid = "72ce7ff4-a5a8-40d0-b1d7-d84a13adcd30";
const mid = "a072ed54-6d56-413d-af4b-3ebc01ba646a";
const aid = "ae5d77d0-7cdf-420f-8c45-ecf317d05c6d";
const claims = {
  backendAccountId: "synthetic-account", backendUserId: "synthetic-user",
  backendExpiresAt: "2099-01-01T00:00:00.000Z", backendAccessToken: "synthetic-token",
  backendAccountName: "Workspace", backendAccountSlug: "workspace", backendRole: "member" as const, backendUsername: null,
};
const image = { attachment_id: aid, file_name: "capture.png", media_type: "image/png", byte_size: 8,
  content_hash: "a".repeat(64), data_base64: "iVBORwECAwQ=" };
const payload = () => ({ policy_version: "current-policy", owner_scope: workspaceSessionDraftStorageScope(claims),
  idempotency_key: mid, session_id: sid, message_id: mid, objective: "", images: [image] });
const request = (body: unknown, origin = "https://workspace.example", extraHeaders: Record<string,string> = {}) =>
  new Request(`https://workspace.example/api/desktop-capture/${sid}/${mid}`, { method: "POST", headers: {
    "content-type": "application/json", "host": "workspace.example", "origin": origin, "x-forwarded-proto": "https",
    "x-talent-signal-workspace": claims.backendAccountId,
    "x-workspace-session": contactHandoffSessionVersion(claims), ...extraHeaders,
  }, body: JSON.stringify(body) });

beforeEach(() => {
  f.claims.mockReset(); f.policy.mockReset(); f.admit.mockReset();
  f.claims.mockResolvedValue(claims);
  f.policy.mockResolvedValue({ policy_version: "current-policy", available: true, source_retention_days: 30, processor_labels: ["Claude · sonnet"] });
  f.admit.mockResolvedValue(Response.json({ session_id: sid, message_id: mid, queue_entry_id: aid }, { status: 202 }));
});

it("admits one immutable screenshot through the existing durable queue", async () => {
  const response = await desktopCaptureSubmitRoute(request(payload()), sid, mid);
  expect(response.status).toBe(202);
  expect(f.admit).toHaveBeenCalledOnce();
  const delegated = f.admit.mock.calls[0][0] as Request;
  const body = await delegated.json();
  expect(body).toEqual({ idempotency_key: mid, session_id: sid, message_id: mid, objective: "", images: [image] });
});

it("passes the real workspace mutation gate for the pinned account", () => {
  const incoming = request(payload());
  const gated = proxy(new NextRequest(incoming.url, { method: "POST", headers: incoming.headers }));
  expect(gated.status).toBe(200);
});

it("refuses changed processing policy or account scope before admission", async () => {
  expect((await desktopCaptureSubmitRoute(request({ ...payload(), policy_version: "old" }), sid, mid)).status).toBe(409);
  expect((await desktopCaptureSubmitRoute(request({ ...payload(), owner_scope: "b".repeat(64) }), sid, mid)).status).toBe(409);
  expect(f.admit).not.toHaveBeenCalled();
});

it("refuses cross-origin submission, stale login, and mismatched message identity", async () => {
  expect((await desktopCaptureSubmitRoute(request(payload(), "https://other.example"), sid, mid)).status).toBe(403);
  expect((await desktopCaptureSubmitRoute(request(payload(), undefined, { "x-workspace-session": "stale" }), sid, mid)).status).toBe(409);
  expect((await desktopCaptureSubmitRoute(request({ ...payload(), message_id: aid }), sid, mid)).status).toBe(400);
  expect((await desktopCaptureSubmitRoute(request(payload(), undefined,
    { "x-talent-signal-workspace": "other-account" }), sid, mid)).status).toBe(409);
  expect(f.admit).not.toHaveBeenCalled();
});

it("rejects an undeclared oversized stream before allocating JSON or calling the queue", async () => {
  const oversized = "x".repeat(13_500_001);
  const response = await desktopCaptureSubmitRoute(request({ ...payload(), images: [{ ...image, data_base64: oversized }] }), sid, mid);
  expect(response.status).toBe(413);
  expect(f.admit).not.toHaveBeenCalled();
});
