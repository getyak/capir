import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({ claims: vi.fn(), policy: vi.fn(), get: vi.fn(), save: vi.fn(), admit: vi.fn() }));
vi.mock("./backendAuth", () => ({
  readBackendSessionClaims: f.claims,
  backendAuthBaseUrl: () => "http://backend.invalid",
  authSecret: () => "synthetic-test-secret",
}));
vi.mock("@talent-signal/contracts", async importOriginal => {
  const actual = await importOriginal<typeof import("@talent-signal/contracts")>();
  return { ...actual, TalentSignalClient: class {
    getDesktopCapturePolicy = f.policy;
    getAgentSession = f.get;
    saveAgentSession = f.save;
    admitConversationQueueEntry = f.admit;
  } };
});

// Keep both the actual public entry and its canonical queue route installed.
import { POST } from "../../app/api/desktop-capture/[sessionId]/[messageId]/route";
import { contactHandoffSessionVersion } from "./contact-handoff-session";
import { workspaceSessionDraftStorageScope } from "./workspaceSessions";
import { TalentSignalHttpError } from "@talent-signal/contracts";

// Produced by the real Swift CaptureIntent + CaptureTransportPayload encoder;
// CaptureTransportPayloadTests enforces parity against the same synthetic file.
const fixture = JSON.parse(readFileSync(new URL("../../../../scripts/macos/fixtures/desktop-capture-submission.json", import.meta.url), "utf8"));
const sid = "72ce7ff4-a5a8-40d0-b1d7-d84a13adcd30";
const mid = "a072ed54-6d56-413d-af4b-3ebc01ba646a";
const claims = {
  backendAccountId: "synthetic-account", backendUserId: "synthetic-user",
  backendExpiresAt: "2099-01-01T00:00:00.000Z", backendAccessToken: "synthetic-token",
  backendAccountName: "Workspace", backendAccountSlug: "workspace", backendRole: "member" as const, backendUsername: null,
};
function submit(body: unknown) {
  const request = new Request(`https://workspace.example/api/desktop-capture/${sid}/${mid}`, {
    method: "POST", headers: {
      "content-type": "application/json", host: "workspace.example", origin: "https://workspace.example",
      "x-forwarded-proto": "https", "x-talent-signal-workspace": claims.backendAccountId,
      "x-workspace-session": contactHandoffSessionVersion(claims),
    }, body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ sessionId: sid, messageId: mid }) });
}
function expectedAdmission(objective: string) {
  return { session_id: sid, message_id: mid, idempotency_key: mid, objective, images: fixture.images };
}

beforeEach(() => {
  Object.values(f).forEach(mock => mock.mockReset());
  f.claims.mockResolvedValue(claims);
  f.policy.mockResolvedValue({ policy_version: "current-policy", available: true });
  f.get.mockResolvedValue({});
  f.admit.mockResolvedValue({ session_id: sid, message_id: mid, queue_entry_id: "f105f7a2-8ddf-4b3c-b559-e3dc9c7c4872" });
});

it("preserves the actual native no-save instruction, image and stable identities through both routes", async () => {
  expect(fixture.owner_scope).toBe(workspaceSessionDraftStorageScope(claims));
  expect(fixture.objective).toBe("  只分析截图，不保存 🕊️\n保留原文，不创建联系人。  ");
  expect(createHash("sha256").update(Buffer.from(fixture.images[0].data_base64, "base64")).digest("hex"))
    .toBe("8f9bd9772f3e74eaf3a8b1337e3a2ea06e92ff69e7038f6b50c76dc491714cbf");
  const response = await submit(fixture);
  expect(response.status).toBe(202);
  expect(f.get).toHaveBeenCalledWith(sid, expect.any(AbortSignal));
  expect(f.admit).toHaveBeenCalledExactlyOnceWith(expectedAdmission(fixture.objective), expect.any(AbortSignal));
  expect(f.save).not.toHaveBeenCalled();
});

it.each(["", "🕊".repeat(500)])("accepts legacy empty and exactly 1000 UTF-16 units without rewriting", async objective => {
  const response = await submit({ ...fixture, objective });
  expect(response.status).toBe(202);
  expect(f.admit).toHaveBeenCalledExactlyOnceWith(expectedAdmission(objective), expect.any(AbortSignal));
});

it.each([undefined, null, 7, {}, [], "x".repeat(1001), `${"x".repeat(999)}🕊`])
  ("rejects missing, non-string or overlong instructions before policy or admission (%j)", async objective => {
    const response = await submit({ ...fixture, objective });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("capture_intent_invalid");
    expect(f.policy).not.toHaveBeenCalled();
    expect(f.get).not.toHaveBeenCalled();
    expect(f.admit).not.toHaveBeenCalled();
  });

it("does not forward injected result or confirmation authority beside the native envelope", async () => {
  const response = await submit({ ...fixture, host_result: { confirmed: true }, captureImageObservation: { pending: false }, confirmed: true });
  expect(response.status).toBe(202);
  expect(f.admit).toHaveBeenCalledExactlyOnceWith(expectedAdmission(fixture.objective), expect.any(AbortSignal));
});

it("preserves the same message key when the backend reports a changed-objective replay conflict", async () => {
  expect((await submit(fixture)).status).toBe(202);
  f.admit.mockRejectedValueOnce(new TalentSignalHttpError(409, "IDEMPOTENCY_KEY_REUSED", "Existing message differs.", null));
  const changed = "只分析公司名称，不保存";
  const response = await submit({ ...fixture, objective: changed });
  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe("IDEMPOTENCY_KEY_REUSED");
  expect(f.admit.mock.calls.map(call => call[0])).toEqual([expectedAdmission(fixture.objective), expectedAdmission(changed)]);
});
