import { generateKeyPairSync } from "node:crypto";
import { EventEmitter } from "node:events";
import type { ClientHttp2Session } from "node:http2";
import { describe, expect, it, vi } from "vitest";
import { CaptureAPNsProvider, captureActivityPayload, capturePushResult } from "./captureActivity.js";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const config = { keyID: "ABCDEFGHIJ", teamID: "ABCDEFGHIJ", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  environment: "production" as const, bundleID: "com.talentsignal.app" };

function connection(status: number | null, reason?: string) {
  const stream = new EventEmitter() as EventEmitter & { end: (data: string) => void };
  let headers: Record<string, string> = {};
  let payload = "";
  stream.end = (data) => { payload = data; if (status != null) queueMicrotask(() => {
    stream.emit("response", { ":status": status });
    if (reason) stream.emit("data", Buffer.from(JSON.stringify({ reason })));
    stream.emit("end");
  }); };
  const session = new EventEmitter() as EventEmitter & { request: (values: Record<string, string>) => typeof stream; close: () => void; destroy: () => void };
  session.request = (values) => { headers = values; return stream; };
  session.close = vi.fn(); session.destroy = vi.fn();
  let created!: () => void;
  const ready = new Promise<void>((resolve) => { created = resolve; });
  const factory = vi.fn((authority: string) => { expect(authority).toBe("https://api.push.apple.com"); created(); return session as unknown as ClientHttp2Session; });
  return { factory, ready, session, headers: () => headers, payload: () => payload };
}

describe("APNs HTTP2 provider boundary", () => {
  it("sends one bounded Activity request to the production topic and closes HTTP2", async () => {
    const mock = connection(200);
    const result = await new CaptureAPNsProvider(config, mock.factory).send("a".repeat(64), captureActivityPayload("processing", 1, new Date()));
    expect(result).toEqual({ accepted: true, invalidToken: false });
    expect(mock.headers()["apns-topic"]).toBe("com.talentsignal.app.push-type.liveactivity");
    expect(mock.headers()["apns-push-type"]).toBe("liveactivity");
    expect(mock.session.close).toHaveBeenCalledOnce();
    expect(JSON.parse(mock.payload()).aps["content-state"].phase).toBe("processing");
  });
  it.each([[400,"BadDeviceToken",true], [400,"DeviceTokenNotForTopic",true], [410,"Unregistered",true],
    [400,"BadPriority",false], [400,"BadTopic",false], [400,"BadPayload",false], [403,"ExpiredProviderToken",false]])(
    "handles status %s reason %s without deleting valid registrations", async (status, reason, invalid) => {
      const mock = connection(status as number, reason as string);
      expect(await new CaptureAPNsProvider(config, mock.factory).send("b".repeat(64), captureActivityPayload("queued", 2, new Date())))
        .toEqual({ accepted: false, invalidToken: invalid });
    });
  it("bounds provider response parsing and treats unknown errors as retryable", () => {
    expect(capturePushResult(400, "x".repeat(5000))).toEqual({ accepted: false, invalidToken: false });
    expect(capturePushResult(410, "not-json")).toEqual({ accepted: false, invalidToken: false });
  });
  it("terminates its own HTTP2 connection after the transport deadline", async () => {
    vi.useFakeTimers();
    try {
      const mock = connection(null);
      const result = new CaptureAPNsProvider(config, mock.factory).send("c".repeat(64), captureActivityPayload("queued", 1, new Date()));
      const rejected = expect(result).rejects.toThrow("push transport failed");
      await mock.ready;
      await vi.advanceTimersByTimeAsync(10_000);
      await rejected;
      expect(mock.session.destroy).toHaveBeenCalledOnce();
      expect(mock.session.close).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
});
