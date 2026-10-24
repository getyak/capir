import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { connect, type ClientHttp2Session } from "node:http2";
import { importPKCS8, SignJWT } from "jose";

export interface CaptureAPNsConfig {
  keyID: string; teamID: string; privateKey: string;
  environment: "production" | "sandbox"; bundleID: string;
}
export type CaptureActivityPhase = "queued" | "processing" | "review" | "failed" | "paused";

export function readCaptureAPNsConfig(env: Record<string, string | undefined> = process.env): CaptureAPNsConfig | null {
  if (![env.TALENT_SIGNAL_APNS_KEY_ID, env.TALENT_SIGNAL_APNS_TEAM_ID, env.TALENT_SIGNAL_APNS_PRIVATE_KEY].some(Boolean)) return null;
  const keyID = env.TALENT_SIGNAL_APNS_KEY_ID ?? "";
  const teamID = env.TALENT_SIGNAL_APNS_TEAM_ID ?? "";
  const privateKey = (env.TALENT_SIGNAL_APNS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n");
  const environment = env.TALENT_SIGNAL_APNS_ENVIRONMENT ?? "production";
  const bundleID = env.TALENT_SIGNAL_APNS_BUNDLE_ID ?? "com.talentsignal.app";
  if (!/^[A-Z0-9]{10}$/.test(keyID) || !/^[A-Z0-9]{10}$/.test(teamID)
      || !privateKey.startsWith("-----BEGIN PRIVATE KEY-----")
      || !["production", "sandbox"].includes(environment) || bundleID !== "com.talentsignal.app") {
    throw new Error("Incomplete or invalid capture APNs configuration; no credentials were logged.");
  }
  return { keyID, teamID, privateKey, environment: environment as CaptureAPNsConfig["environment"], bundleID };
}

export function captureActivityPhase(status: string, paused: boolean): CaptureActivityPhase {
  if (status === "completed") return "review";
  if (status === "failed") return "failed";
  if (paused || ["cancelled", "interrupted"].includes(status)) return "paused";
  return status === "running" ? "processing" : status === "queued" ? "queued" : "paused";
}

export function captureActivityPayload(phase: CaptureActivityPhase, revision: number, now: Date, end = false) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("Invalid Activity revision");
  const timestamp = Math.floor(now.valueOf() / 1000);
  return { aps: { timestamp, event: end ? "end" : "update", "stale-date": timestamp + 90,
    ...(end ? { "dismissal-date": timestamp + 60 } : {}),
    "content-state": { phase, eventRevision: revision + 100, updatedAtEpochSeconds: timestamp } } };
}

function storageKey(secret: string): Buffer {
  return createHash("sha256").update("capri-capture-push-token-v1\0").update(secret).digest();
}
export function encryptActivityToken(token: string, secret: string, owner: string): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", storageKey(secret), iv);
  cipher.setAAD(Buffer.from(owner));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}
export function decryptActivityToken(value: string, secret: string, owner: string): string {
  const data = Buffer.from(value, "base64url");
  if (data.length < 29) throw new Error("Invalid protected Activity registration");
  const decipher = createDecipheriv("aes-256-gcm", storageKey(secret), data.subarray(0, 12));
  decipher.setAAD(Buffer.from(owner)); decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}

export interface CapturePushResult { accepted: boolean; invalidToken: boolean }
export interface CapturePushSending {
  send(token: string, payload: ReturnType<typeof captureActivityPayload>): Promise<CapturePushResult>;
}
export function capturePushResult(status: number, body: string): CapturePushResult {
  let reason: unknown;
  if (Buffer.byteLength(body) <= 4096) { try { reason = (JSON.parse(body) as { reason?: unknown }).reason; } catch { /* Unknown is retryable. */ } }
  return { accepted: status === 200, invalidToken:
    (status === 400 && ["BadDeviceToken", "DeviceTokenNotForTopic"].includes(String(reason)))
    || (status === 410 && reason === "Unregistered") };
}

/** A bounded HTTP/2 provider. No token, PEM, payload or APNs response body enters logs. */
export class CaptureAPNsProvider implements CapturePushSending {
  private key: ReturnType<typeof importPKCS8> | undefined;
  private jwt: { value: string; issued: number } | undefined;
  constructor(private readonly config: CaptureAPNsConfig,
    private readonly connection: (authority: string) => ClientHttp2Session = connect) {}
  private async authorization(): Promise<string> {
    const issued = Math.floor(Date.now() / 1000);
    this.key ??= importPKCS8(this.config.privateKey, "ES256");
    if (this.jwt && issued - this.jwt.issued < 3000) return this.jwt.value;
    const value = await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: this.config.keyID })
      .setIssuer(this.config.teamID).setIssuedAt(issued).sign(await this.key);
    this.jwt = { value, issued }; return value;
  }
  async send(token: string, payload: ReturnType<typeof captureActivityPayload>): Promise<CapturePushResult> {
    const authorization = await this.authorization();
    return new Promise((resolve, reject) => {
      const client = this.connection(this.config.environment === "production" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com");
      let settled = false;
      const finish = (result?: CapturePushResult) => {
        if (settled) return; settled = true; clearTimeout(timer); client.close();
        if (result) resolve(result); else reject(new Error("Capture Activity push transport failed"));
      };
      const timer = setTimeout(() => { client.destroy(); finish(); }, 10_000);
      client.on("error", () => finish());
      const request = client.request({ ":method": "POST", ":path": `/3/device/${token}`,
        authorization: `bearer ${authorization}`, "apns-topic": `${this.config.bundleID}.push-type.liveactivity`,
        "apns-push-type": "liveactivity", "apns-priority": "5", "apns-expiration": "0" });
      let status = 0;
      let responseBody = "", oversized = false;
      request.on("response", (headers) => { status = Number(headers[":status"]); });
      request.on("data", (bytes: Buffer) => {
        if (oversized) return;
        if (Buffer.byteLength(responseBody)+bytes.length > 4096) { oversized = true; responseBody = ""; }
        else responseBody += bytes.toString("utf8");
      });
      request.on("error", () => finish());
      request.on("end", () => finish(capturePushResult(status, oversized ? "" : responseBody)));
      request.end(JSON.stringify(payload));
    });
  }
}
