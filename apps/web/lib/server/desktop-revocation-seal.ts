import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { authSecret } from "./backendAuth";

const PURPOSE = "capri.macos.session-revocation.v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
type Scope = { account_id: string; user_id: string; session_id: string };
type Payload = Scope & { version: 1; purpose: typeof PURPOSE; origin: string; original_access_token: string };

function key(origin: string) {
  if (new URL(origin).origin !== origin || origin.length > 200) throw new Error("Invalid revocation scope.");
  return Buffer.from(hkdfSync("sha256", authSecret(), origin, PURPOSE, 32));
}
function validScope(scope: Scope) {
  return UUID.test(scope.account_id) && UUID.test(scope.user_id) && UUID.test(scope.session_id);
}

/** Destructive-only escrow. No access/renewal consumer accepts this envelope;
 * it has no arbitrary lifetime shorter than the session it must revoke. */
export function sealDesktopRevocationProof(origin: string, scope: Scope, access: string): string {
  if (!validScope(scope) || !SECRET.test(access)) throw new Error("Invalid revocation scope.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(origin), nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(PURPOSE));
  const payload: Payload = { version: 1, purpose: PURPOSE, origin, ...scope, original_access_token: access };
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return ["v1", nonce.toString("base64url"), encrypted.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
}

export function openDesktopRevocationProof(proof: string, origin: string, expected: Scope): string {
  try {
    if (typeof proof !== "string" || proof.length > 2048 || !validScope(expected)) throw new Error();
    const parts = proof.split(".");
    if (parts.length !== 4 || parts[0] !== "v1" || !/^[A-Za-z0-9_-]{16}$/.test(parts[1]!)
      || !/^[A-Za-z0-9_-]{22}$/.test(parts[3]!) || !/^[A-Za-z0-9_-]{1,1800}$/.test(parts[2]!)) throw new Error();
    const decode = (value: string) => {
      const bytes = Buffer.from(value, "base64url");
      if (bytes.toString("base64url") !== value) throw new Error();
      return bytes;
    };
    const decipher = createDecipheriv("aes-256-gcm", key(origin), decode(parts[1]!), { authTagLength: 16 });
    decipher.setAAD(Buffer.from(PURPOSE));
    decipher.setAuthTag(decode(parts[3]!));
    const clear = Buffer.concat([decipher.update(decode(parts[2]!)), decipher.final()]);
    if (clear.length > 1024) throw new Error();
    const value = JSON.parse(clear.toString("utf8")) as Payload;
    if (!value || Object.keys(value).sort().join(",") !== "account_id,origin,original_access_token,purpose,session_id,user_id,version"
      || value.version !== 1 || value.purpose !== PURPOSE || value.origin !== origin || !validScope(value)
      || value.account_id !== expected.account_id || value.user_id !== expected.user_id
      || value.session_id !== expected.session_id || !SECRET.test(value.original_access_token)) throw new Error();
    return value.original_access_token;
  } catch { throw new Error("The revocation proof could not be verified."); }
}
