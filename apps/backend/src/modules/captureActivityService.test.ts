import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { CaptureActivityService } from "./captureActivityService.js";
import { decryptActivityToken, encryptActivityToken } from "./captureActivity.js";

const account = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const session = "33333333-3333-4333-8333-333333333333";
const message = "44444444-4444-4444-8444-444444444444";
const instance = "55555555-5555-4555-8555-555555555555";
const auth = { accountId: account, userId: user, sessionId: "66666666-6666-4666-8666-666666666666", accountSlug: "synthetic", userEmail: "synthetic@example.invalid", userKind: "apple_human" as const };
const config = { keyID: "ABCDEFGHIJ", teamID: "ABCDEFGHIJ", privateKey: "synthetic-storage-key", environment: "production" as const, bundleID: "com.talentsignal.app" };
const activeLogin = { expires_at: new Date(Date.now()+60000), account_slug: "synthetic", account_name: "Synthetic", user_email: "synthetic@example.invalid", display_name: "Synthetic", user_kind: "apple_human", account_role: "owner", username: null };

describe("capture Activity registration authority", () => {
  it("requires the current owner and an already admitted exact message", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [activeLogin], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ expires_at: new Date(Date.now()+60000), deleted_at: null }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const service = new CaptureActivityService({ query } as unknown as Pool, config, { send: vi.fn() });
    await expect(service.register(auth, session, { message_id: message, activity_instance_id: instance, token: "a".repeat(64), environment: "production", token_generation: 1 }))
      .rejects.toMatchObject({ code: "CAPTURE_MESSAGE_NOT_ADMITTED" });
    expect(query.mock.calls[2]?.[1]).toEqual([account,user,session,message]);
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("encrypts a rotated capability with exact account/user/Session/instance binding", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [activeLogin], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ expires_at: new Date(Date.now()+60000), deleted_at: null }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: "entry" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ count: "0" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const service = new CaptureActivityService({ query } as unknown as Pool, config, { send: vi.fn() });
    const token = "b".repeat(64);
    await service.register(auth, session, { message_id: message, activity_instance_id: instance, token, environment: "production", token_generation: 1 });
    const values = query.mock.calls[4]?.[1] as string[];
    expect(values[6]).not.toContain(token);
    expect(decryptActivityToken(values[6]!, config.privateKey, [account,user,session,instance].join(":"))).toBe(token);
  });

  it("revocation deletes a durable capability before any provider send", async () => {
    const registration = { account_id: account, user_id: user, session_id: session, message_id: message,
      activity_instance_id: instance, auth_session_id: auth.sessionId, token_ciphertext: "protected",
      environment: "production", last_sent_revision: "-1", last_phase: null, terminal_since: null, registration_version: "1", token_generation: "1", delivery_sequence: "0", last_sent_at: null, last_dispatched_at: null };
    const query = vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [registration], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const send = vi.fn();
    await new CaptureActivityService({ query } as unknown as Pool, config, { send }).pump();
    expect(send).not.toHaveBeenCalled();
    expect(query.mock.calls[3]?.[0]).toContain("DELETE FROM capture_activity_registrations");
    expect(query.mock.calls[3]?.[1]).toEqual([account,user,session,instance,"1"]);
  });

  it("late registration projects the committed terminal result without user content", async () => {
    const registration = { account_id: account, user_id: user, session_id: session, message_id: message,
      activity_instance_id: instance, auth_session_id: auth.sessionId,
      token_ciphertext: encryptActivityToken("c".repeat(64), config.privateKey, [account,user,session,instance].join(":")),
      environment: "production", last_sent_revision: "-1", last_phase: null, terminal_since: null, registration_version: "1", token_generation: "1", delivery_sequence: "0", last_sent_at: null, last_dispatched_at: null };
    const query = vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [registration], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [activeLogin], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ expires_at: new Date(Date.now()+60000), deleted_at: null }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ status: "completed", revision: 7, paused: false }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ delivery_sequence: "1" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const send = vi.fn().mockResolvedValue({ accepted: true, invalidToken: false });
    await new CaptureActivityService({ query } as unknown as Pool, config, { send }).pump();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1].aps["content-state"]).toMatchObject({ phase: "review", eventRevision: 1000001 });
    expect(JSON.stringify(send.mock.calls[0]?.[1])).not.toMatch(/screenshot|objective|email|name|source/i);
  });
});
