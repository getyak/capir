import "server-only";

import { cookies } from "next/headers";
import { decode, encode } from "next-auth/jwt";

import { authCookieSecure } from "@/lib/auth-cookie-policy";
import {
  LOGIN_COLLISION_TTL_SECONDS,
  collisionHintIsLive,
  connectProviderFrom,
  type ConnectProvider,
  type LoginCollisionHint,
} from "@/lib/login-continuity";
import { authSecret } from "@/lib/server/backendAuth";

/**
 * Server-sealed collision hint (GET-141).
 *
 * When an unbound OAuth sign-in is rejected because the verified provider
 * email already belongs to an account, this short-lived HttpOnly cookie
 * records ONLY the provider the user just tried and the seal time. It is the
 * sole authority for showing the account-continuity panel: a forged
 * `?error=OAuthAccountNotLinked` query never discloses collision state, and an
 * expired hint discloses nothing. The rejected login retains no token, email
 * or account detail.
 */
export const LOGIN_COLLISION_COOKIE = "talent-signal.login-collision";

export async function sealLoginCollisionHint(provider: ConnectProvider): Promise<void> {
  const hint: LoginCollisionHint = {
    provider,
    sealedAt: new Date().toISOString(),
  };
  const value = await encode({
    secret: authSecret(),
    salt: LOGIN_COLLISION_COOKIE,
    maxAge: LOGIN_COLLISION_TTL_SECONDS,
    token: hint,
  });
  (await cookies()).set(LOGIN_COLLISION_COOKIE, value, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: LOGIN_COLLISION_TTL_SECONDS,
    secure: authCookieSecure(),
  });
}

/**
 * Read the sealed hint. Tampered bytes, an unknown provider or an expired
 * seal all fail closed to "no hint": the login page then shows only the
 * generic neutral message.
 */
export async function readLoginCollisionHint(
  now = Date.now(),
): Promise<LoginCollisionHint | null> {
  const jar = await cookies();
  const value = jar.get(LOGIN_COLLISION_COOKIE)?.value;
  try {
    const decoded = value
      ? ((await decode({
          token: value,
          secret: authSecret(),
          salt: LOGIN_COLLISION_COOKIE,
        })) ?? null)
      : null;
    const provider = connectProviderFrom(
      (decoded as { provider?: unknown } | null)?.provider,
    );
    const sealedAt = (decoded as { sealedAt?: unknown } | null)?.sealedAt;
    const hint =
      provider && typeof sealedAt === "string" ? { provider, sealedAt } : null;
    return collisionHintIsLive(hint, now) ? hint : null;
  } catch {
    return null;
  }
}
