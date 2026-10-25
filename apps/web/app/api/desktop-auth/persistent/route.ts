import { cookies } from "next/headers";
import { decode } from "next-auth/jwt";
import { signIn } from "@/auth";
import { AUTH_SESSION_COOKIE, authSecret, readPrimaryBackendSessionClaims } from "@/lib/server/backendAuth";
import { rebindTestWorkspaceParent } from "@/lib/server/testWorkspaceSession";
import { desktopAuthDeploymentOrigin } from "@/lib/server/desktop-browser-login";
import { sealDesktopRevocationProof } from "@/lib/server/desktop-revocation-seal";
import {
  desktopPersistentPostFields,
  DesktopPersistentSessionError,
  readDesktopPersistentStatus,
  revokeDesktopPersistentSession,
} from "@/lib/server/desktop-persistent-session";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer",
  } });
}

function failure(error: unknown, enrollment = false) {
  const status = error instanceof DesktopPersistentSessionError ? error.status : 503;
  return json({ status: status === 401 ? "revoked" : status === 403 && enrollment ? "ineligible" : "unavailable" }, status);
}

/** Decode the cookie Auth.js just installed in this request's cookie store.
 * Request headers/React.cache still describe the incoming old cookie.
 * Handle Auth.js's ordered cookie chunks without exposing any token to DOM. */
async function sessionCookie(): Promise<string | undefined> {
  const jar = await cookies();
  const parts = jar.getAll().filter(c => c.name === AUTH_SESSION_COOKIE || c.name.startsWith(AUTH_SESSION_COOKIE + "."));
  if (!parts.length || parts.length > 8) return undefined;
  const unchunked = parts.find(c => c.name === AUTH_SESSION_COOKIE && c.value);
  const chunks = parts.filter(c => /^\.\d+$/.test(c.name.slice(AUTH_SESSION_COOKIE.length)) && c.value)
    .sort((a, b) => Number(a.name.split(".").at(-1)) - Number(b.name.split(".").at(-1)));
  const raw = unchunked?.value ?? chunks.map(c => c.value).join("");
  return raw && raw.length <= 32_768 ? raw : undefined;
}

async function installedAccess(previousCookie: string | undefined): Promise<string> {
  const raw = await sessionCookie();
  // A successful Auth.js Credentials signIn encodes a fresh JWT with a random
  // jti, even when the bounded backend access generation is unchanged. Its
  // configuration-error fallback can leave an old valid cookie untouched.
  if (!raw || raw === previousCookie) throw new DesktopPersistentSessionError(503);
  const token = await decode({ token: raw, salt: AUTH_SESSION_COOKIE, secret: authSecret() });
  if (typeof token?.backendAccessToken !== "string") throw new DesktopPersistentSessionError(503);
  return token.backendAccessToken;
}

/** Read-only, live backend readback. Does not invoke Auth.js session refresh. */
export async function GET() {
  try {
    const claims = await readPrimaryBackendSessionClaims();
    if (!claims) return json({ status: "signed_out" }, 401);
    const live = await readDesktopPersistentStatus(claims.backendAccessToken);
    const revocation_proof = sealDesktopRevocationProof(await desktopAuthDeploymentOrigin(), live, claims.backendAccessToken);
    return json({ ...live, revocation_proof });
  } catch (error) {
    if (error instanceof DesktopPersistentSessionError && error.status === 401) return json({ status: "signed_out" }, 401);
    return failure(error);
  }
}

/** Native proof in JSON only. The supported Auth.js signIn path installs the
 * short session cookie; a separate native GET is still required for admission.
 * https://authjs.dev/reference/nextjs#signin */
export async function POST(request: Request) {
  let enrollment = false;
  let revoking = false;
  try {
    const fields = await desktopPersistentPostFields(request);
    enrollment = fields.action === "enroll";
    revoking = fields.action === "revoke";
    if (fields.action === "revoke") {
      await revokeDesktopPersistentSession(fields);
      return json({ status: "revoked", revocation_confirmed: true });
    }
    // Renewal does not require an incoming access cookie. If one is still
    // readable, retain it only to migrate an already verified legacy selection
    // after a lost initial-enrollment response.
    const claims = await readPrimaryBackendSessionClaims().catch(() => null);
    if (enrollment && (!claims || claims.backendAccountId !== fields.account_id || claims.backendUserId !== fields.user_id)) {
      throw new DesktopPersistentSessionError(401);
    }
    if (!enrollment && claims && (claims.backendAccountId !== fields.account_id || claims.backendUserId !== fields.user_id)) {
      throw new DesktopPersistentSessionError(503);
    }
    const previousCookie = await sessionCookie();
    let result: string | undefined;
    try {
      result = await signIn("desktop-persistent", {
        ...fields, ...(enrollment ? { backend_access_token: claims!.backendAccessToken } : {}),
        redirect: false, redirectTo: "/workspace",
      });
    } catch (error) {
      // Auth.js intentionally propagates CredentialsSignin from server signIn.
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      const type = error && typeof error === "object" && "type" in error ? error.type : undefined;
      if (code === "service_unavailable") throw new DesktopPersistentSessionError(503);
      if (type === "CredentialsSignin") throw new DesktopPersistentSessionError(enrollment ? 403 : 401);
      throw new DesktopPersistentSessionError(503);
    }
    if (typeof result === "string") {
      const params = new URL(result, "https://desktop-session.invalid").searchParams;
      if (params.has("error")) throw new DesktopPersistentSessionError(params.get("code") === "service_unavailable" ? 503 : enrollment ? 403 : 401);
    }
    const status = await readDesktopPersistentStatus(await installedAccess(previousCookie));
    if (status.account_id !== fields.account_id || status.user_id !== fields.user_id) throw new DesktopPersistentSessionError(503);
    if (claims) {
      await rebindTestWorkspaceParent(claims, { ...claims, backendSessionId: status.session_id });
    }
    return json(status);
  } catch (error) {
    // A legacy resident backend can report an unknown pending capability as
    // canonical 401. Only verified backend 200 {revoked:true} is completion.
    return revoking ? json({ status: "unavailable" }, 503) : failure(error, enrollment);
  }
}
