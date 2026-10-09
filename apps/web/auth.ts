import { TalentSignalHttpError } from "@talent-signal/contracts";
import NextAuth, { AuthError, CredentialsSignin } from "next-auth";
import type { NextAuthConfig } from "next-auth";
import Apple from "next-auth/providers/apple";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import type { Provider } from "next-auth/providers";
import { cookies, headers } from "next/headers";
import { getToken } from "next-auth/jwt";
import {
  appleFormPostCookiesSupported,
  emailSignInSchema,
  getAuthAvailability,
  getDefaultAccount,
  normalizeEmail,
  passwordSignInSchema,
  verifyConfiguredPassword,
} from "@/lib/auth-config";
import { backendSessionIsExpired } from "@/lib/backend-session";
import {
  DesktopAuthRequestError,
  authorizeDesktopBrowserLogin,
} from "@/lib/server/desktop-browser-login";
import {
  AUTH_SESSION_COOKIE,
  authSecret,
  confirmBackendRegistration,
  signInBackendAccount,
} from "@/lib/server/backendAuth";
import { getGoogleOAuthCredentials } from "@/lib/server/google-oauth";
import { TEST_WORKSPACE_COOKIE } from "@/lib/server/testWorkspaceSession";

import { authCookieSecure } from "@/lib/auth-cookie-policy";
import { OAUTH_NONCE_COOKIE, OAuthAccountLinkRequired, oauthBackendClaims } from "@/lib/server/oauth-session";
import { finishGoogleSignIn } from "@/lib/server/google-session";
import {
  clearStagedAuth,
  readAuthOperation,
  readAuthProof,
  readAuthRound,
  readCallbackPath,
  resolveProviderReturn,
  sealAuthProof,
} from "@/lib/server/stagedAuth";
import { finishAppleSignIn } from "@/lib/server/apple-session";
import { getAppleOAuthCredentials } from "@/lib/server/apple-oauth";

class AccountLinkRequired extends AuthError { static type = "OAuthAccountNotLinked"; }
// Auth.js maps error types it knows; reusing the supported AccessDenied type
// keeps the callback choreography inside the framework contract while the
// staged proof cookie (server-sealed state) carries the real distinction.
class StagedProofError extends AuthError {
  static type = "AccessDenied";
  code = "staged_proof";
}

async function exchangeProviderSession<T>(exchange: () => Promise<T>): Promise<T> {
  try { return await exchange(); }
  catch (error) {
    if (error instanceof OAuthAccountLinkRequired) throw new AccountLinkRequired("Use the original sign-in method.");
    throw error;
  }
}

function applyBackendSessionToToken(
  token: Record<string, unknown>,
  backend: Awaited<ReturnType<typeof finishGoogleSignIn>>,
) {
  token.sub = backend.user.id;
  token.email = backend.user.email;
  token.name = backend.user.display_name;
  Object.assign(token, oauthBackendClaims(backend));
  return token;
}

function appleNameFields(profile: unknown, fallbackName?: string | null) {
  const raw = (profile as {
    user?: { name?: { firstName?: unknown; lastName?: unknown } };
  } | null)?.user;
  const firstName =
    typeof raw?.name?.firstName === "string" ? raw.name.firstName.trim() : "";
  const lastName =
    typeof raw?.name?.lastName === "string" ? raw.name.lastName.trim() : "";
  if (firstName) {
    return {
      givenName: firstName.slice(0, 100),
      ...(lastName ? { familyName: lastName.slice(0, 100) } : {}),
    };
  }
  const fallback = typeof fallbackName === "string" ? fallbackName.trim() : "";
  return fallback ? { givenName: fallback.slice(0, 100) } : {};
}

const credentialAttempts = new Map<
  string,
  { count: number; resetAt: number }
>();
const credentialWindowMs = 60_000;
const credentialAttemptLimit = 6;

class AccountExistsCredentialsError extends CredentialsSignin {
  code = "account_exists";
}

class AccountServiceCredentialsError extends CredentialsSignin {
  code = "service_unavailable";
}

class TestWorkspaceSessionLimitCredentialsError extends CredentialsSignin {
  code = "test_workspace_session_limit";
}

class RateLimitedCredentialsError extends CredentialsSignin {
  code = "rate_limited";
}

function canAttemptCredentialSignIn(email: string) {
  const now = Date.now();
  if (credentialAttempts.size > 500) {
    for (const [key, attempt] of credentialAttempts) {
      if (attempt.resetAt <= now) {
        credentialAttempts.delete(key);
      }
    }
    if (credentialAttempts.size > 500) {
      credentialAttempts.delete(credentialAttempts.keys().next().value ?? "");
    }
  }

  const current = credentialAttempts.get(email);

  if (!current || current.resetAt <= now) {
    credentialAttempts.set(email, {
      count: 1,
      resetAt: now + credentialWindowMs,
    });
    return true;
  }

  if (current.count >= credentialAttemptLimit) {
    return false;
  }

  current.count += 1;
  return true;
}

type AppleCredentials = ReturnType<typeof getAppleOAuthCredentials>;

function buildProviders(appleCredentials: AppleCredentials): Provider[] {
  const providers: Provider[] = [
    Credentials({
      id: "password-account",
      name: "capri account",
      credentials: {
        mode: { label: "Mode", type: "text" },
        identifier: { label: "Username or email", type: "text" },
        username: { label: "Username", type: "text" },
        email: { label: "Email", type: "email" },
        displayName: { label: "Display name", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const availability = getAuthAvailability();
        if (
          credentials.mode === "register"
            ? !availability.registration
            : !availability.password
        ) {
          return null;
        }
        try {
          // Verified signup never signs in directly: registration starts an
          // email verification and only the verified confirmation opens a
          // session (see the email-verification provider below).
          if (credentials.mode === "register") return null;
          const backendSession = await (async () => {
            const parsed = passwordSignInSchema.safeParse(credentials);
            if (!parsed.success) return null;
            return signInBackendAccount(parsed.data);
          })();
          if (!backendSession) return null;

          return {
            id: backendSession.user.id,
            email: backendSession.user.email,
            name: backendSession.user.display_name,
            backendAccessToken: backendSession.access_token,
            backendAccountId: backendSession.account.id,
            backendAccountName: backendSession.account.name,
            backendAccountSlug: backendSession.account.slug,
            backendExpiresAt: backendSession.expires_at,
            backendRole: backendSession.user.role,
            backendUserId: backendSession.user.id,
            backendUsername: backendSession.user.username,
          };
        } catch (error) {
          if (
            error instanceof TalentSignalHttpError &&
            error.code === "PASSWORD_ACCOUNT_EXISTS"
          ) {
            throw new AccountExistsCredentialsError();
          }
          if (
            error instanceof TalentSignalHttpError &&
            error.code === "PASSWORD_SIGN_IN_FAILED"
          ) {
            return null;
          }
          if (
            error instanceof TalentSignalHttpError &&
            (error.status === 429 || error.code === "RATE_LIMITED")
          ) {
            throw new RateLimitedCredentialsError();
          }
          if (
            error instanceof TalentSignalHttpError &&
            error.status === 409 &&
            error.code === "LAB_WORKSPACE_ENTRY_LIMIT"
          ) {
            throw new TestWorkspaceSessionLimitCredentialsError();
          }
          throw new AccountServiceCredentialsError();
        }
      },
    }),
    Credentials({
      id: "email-password",
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = emailSignInSchema.safeParse(credentials);
        const account = getDefaultAccount();
        if (!parsed.success || !account.emailPasswordEnabled) {
          return null;
        }

        const email = normalizeEmail(parsed.data.email);
        if (!canAttemptCredentialSignIn(email)) {
          throw new RateLimitedCredentialsError();
        }

        if (
          email !== account.email ||
          !verifyConfiguredPassword(
            parsed.data.password,
            account.passwordScrypt,
          )
        ) {
          return null;
        }

        credentialAttempts.delete(email);
        return {
          id: `configured:${account.email}`,
          email: account.email,
          name: account.name,
        };
      },
    }),
  ];

  // Verified password signup: the emailed link/code is confirmed by an
  // intentional user action, never by a GET scanner, and only then opens a
  // session for the verified account.
  providers.push(
    Credentials({
      id: "email-verification",
      name: "Email verification",
      credentials: {
        verificationSecret: { label: "Verification code", type: "text" },
      },
      async authorize(credentials) {
        const secret =
          typeof credentials.verificationSecret === "string"
            ? credentials.verificationSecret.trim()
            : "";
        if (secret.length < 32 || secret.length > 200) return null;
        try {
          const backendSession = await confirmBackendRegistration({
            verification_secret: secret,
            client_label: "talent-signal-web",
          });
          return {
            id: backendSession.user.id,
            email: backendSession.user.email,
            name: backendSession.user.display_name,
            backendAccessToken: backendSession.access_token,
            backendAccountId: backendSession.account.id,
            backendAccountName: backendSession.account.name,
            backendAccountSlug: backendSession.account.slug,
            backendExpiresAt: backendSession.expires_at,
            backendRole: backendSession.user.role,
            backendUserId: backendSession.user.id,
            backendUsername: backendSession.user.username,
          };
        } catch (error) {
          if (
            error instanceof TalentSignalHttpError &&
            error.status >= 400 &&
            error.status < 500
          ) {
            return null;
          }
          throw new AccountServiceCredentialsError();
        }
      },
    }),
  );

  // One generic first-party browser exchange (ADR 0022): the selected
  // WKWebView context posts its one-use code and PKCE verifier here, and the
  // authorization runs the backend's atomic consume. The resulting claims are
  // the ordinary backend session claims; nothing invents a token format.
  providers.push(
    Credentials({
      id: "desktop-browser",
      name: "Mac 浏览器登录",
      credentials: {
        attempt_id: { label: "Attempt", type: "text" },
        code: { label: "Code", type: "text" },
        verifier: { label: "Verifier", type: "text" },
        state: { label: "State", type: "text" },
      },
      async authorize(credentials) {
        try {
          return await authorizeDesktopBrowserLogin(credentials ?? {});
        } catch (error) {
          if (error instanceof DesktopAuthRequestError && error.status >= 500) {
            throw new AccountServiceCredentialsError();
          }
          // A malformed or refused exchange is a failed sign-in, never a
          // partial session.
          return null;
        }
      },
    }),
  );

  const googleCredentials = getGoogleOAuthCredentials();

  if (googleCredentials) {
    providers.push(
      Google({
        clientId: googleCredentials.clientId,
        clientSecret: googleCredentials.clientSecret,
        checks: ["pkce", "state", "nonce"],
      }),
    );
  }

  // A fresh Apple provider is built for every invocation with the credentials
  // resolved at that moment. Auth.js env-default resolution must therefore run
  // per request, which is why NextAuth is configured lazily below. An invalid
  // or expired Apple configuration simply omits this provider; Google,
  // password, and default-account providers are unaffected.
  if (appleCredentials) {
    providers.push(
      Apple({
        clientId: appleCredentials.clientId,
        clientSecret: appleCredentials.clientSecret,
        checks: ["nonce", "state"],
      }),
    );
  }

  if (getDefaultAccount().quickLoginEnabled) {
    providers.push(
      Credentials({
        id: "default-account",
        name: "Default account",
        credentials: {},
        authorize() {
          const account = getDefaultAccount();
          if (!account.quickLoginEnabled) {
            return null;
          }

          return {
            id: `default:${account.email}`,
            email: account.email,
            name: account.name,
          };
        },
      }),
    );
  }

  return providers;
}

// Resolved once so a production deployment without AUTH_SECRET fails at module
// load, exactly as it did before the lazy configuration. The value is an
// immutable string and Auth.js only replaces an absent/empty secret.
const configuredAuthSecret = authSecret();

/**
 * Build a complete Auth.js configuration for a single invocation.
 *
 * `NextAuth` is called with a lazy config function, so this runs on every
 * request and `@auth/core`'s env-default resolution runs against fresh provider
 * objects each time. Auth.js mutates the config it receives (environment
 * defaults, per-provider credentials, base path), so nothing here is shared
 * between invocations.
 */
export function buildAuthConfig(): NextAuthConfig {
  const appleCredentials = appleFormPostCookiesSupported()
    ? getAppleOAuthCredentials()
    : null;

  return {
    logger: {
      error(error) { console.error("Authentication failed:", error.name); },
    },
    callbacks: {
      async jwt({ token, user, account, profile }) {
        if (
          account &&
          (account.provider === "google" || account.provider === "apple")
        ) {
          // Bounded staged operation (ADR 0018): a Settings linking or
          // reauthentication round trip stages its proof here and returns to
          // the fixed same-origin completion route with the ORIGINAL session.
          // Nothing here creates, replaces, or attaches a credential, and a
          // missing, stale or wrong-purpose attempt fails closed instead of
          // falling through to ordinary login.
          const operationForReturn = await readAuthOperation();
          const roundForReturn = await readAuthRound();
          const decision = resolveProviderReturn({
            operation: operationForReturn,
            round: roundForReturn,
            provider: account.provider,
            callbackPath: await readCallbackPath(),
          });
          if (decision.kind === "fail-closed") {
            await clearStagedAuth();
            throw new AccountLinkRequired(
              "This sign-in method change did not complete. Return to Settings and start again.",
            );
          }
          if (decision.kind === "stage") {
            const round = roundForReturn;
            if (!round || !account.id_token) {
              await clearStagedAuth();
              throw new AccountLinkRequired("Provider did not return an identity token.");
            }
            // The explicit sealed round decides role, challenge and purpose:
            // this return is routed to the round it validated, never inferred
            // from provider equality or from which slot happens to be empty.
            await sealAuthProof(
              {
                ref: round.flowRef,
                roundRef: round.roundRef,
                purpose: round.purpose,
                provider: round.provider,
                challengeId: round.challengeId,
                identityToken: account.id_token,
                stagedAt: new Date().toISOString(),
              },
              round.role === "duplicate" ? "duplicate" : "current",
            );
            // Terminate before any session write using an Auth.js-supported
            // error type. The staged proof (server-sealed state, not a URL
            // success flag) carries the completed round forward.
            throw new StagedProofError("staged");
          }
        }
        if (account?.provider === "google") {
          if (!account.id_token) throw new Error("Google did not return an identity token.");
          const backend = await exchangeProviderSession(() => finishGoogleSignIn(account.id_token!));
          return applyBackendSessionToToken(token, backend);
        }
        if (account?.provider === "apple") {
          if (!account.id_token) throw new Error("Apple did not return an identity token.");
          const backend = await exchangeProviderSession(() => finishAppleSignIn({
            identityToken: account.id_token!,
            ...appleNameFields(profile, user?.name),
          }));
          return applyBackendSessionToToken(token, backend);
        }
        if (user) {
          const backendUser = user as typeof user & {
            backendAccessToken?: string;
            backendAccountId?: string;
            backendAccountName?: string;
            backendAccountSlug?: string;
            backendExpiresAt?: string;
            backendRole?: "admin" | "member";
            backendUserId?: string;
            backendUsername?: string | null;
          };
          token.backendAccessToken = backendUser.backendAccessToken;
          token.backendAccountId = backendUser.backendAccountId;
          token.backendAccountName = backendUser.backendAccountName;
          token.backendAccountSlug = backendUser.backendAccountSlug;
          token.backendExpiresAt = backendUser.backendExpiresAt;
          token.backendRole = backendUser.backendRole;
          token.backendUserId = backendUser.backendUserId;
          token.backendUsername = backendUser.backendUsername;
        }
        return token;
      },
      session({ session, token }) {
        const publicSession = session as typeof session & {
          account?: {
            id: string;
            name: string;
            role: "admin" | "member";
            slug: string;
          };
        };
        if (
          typeof token.backendExpiresAt === "string" &&
          backendSessionIsExpired(token.backendExpiresAt)
        ) {
          delete (publicSession as unknown as { user?: unknown }).user;
          publicSession.account = undefined;
          return publicSession;
        }
        if (
          typeof token.backendAccountId === "string" &&
          typeof token.backendAccountName === "string" &&
          typeof token.backendAccountSlug === "string" &&
          (token.backendRole === "admin" || token.backendRole === "member")
        ) {
          publicSession.account = {
            id: token.backendAccountId,
            name: token.backendAccountName,
            role: token.backendRole,
            slug: token.backendAccountSlug,
          };
        }
        if (session.user && typeof token.backendUsername === "string") {
          (session.user as typeof session.user & { username?: string }).username =
            token.backendUsername;
        }
        return publicSession;
      },
    },
    cookies: {
      // Apple returns by cross-site POST; preserve its original onboarding destination.
      // Auth.js already adjusts state/nonce cookies for form_post; this cookie is separate.
      callbackUrl: { name: "talent-signal.callback-url", options: { httpOnly: true, path: "/",
        sameSite: appleCredentials ? "none" : "lax",
        secure: Boolean(appleCredentials) || authCookieSecure() } },
      nonce: { name: OAUTH_NONCE_COOKIE, options: { httpOnly: true, sameSite: "lax", path: "/", secure: authCookieSecure() } },
      sessionToken: {
        name: AUTH_SESSION_COOKIE,
        options: {
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          secure: authCookieSecure(),
        },
      },
    },
    providers: buildProviders(appleCredentials),
    pages: {
      signIn: "/login",
      error: "/login",
    },
    session: {
      maxAge: 60 * 60 * 8,
      strategy: "jwt",
    },
    events: {
      async signIn({ account }) {
        // Unified ordinary primary-login boundary (password, verified email,
        // Google, Apple): a fresh primary login retires any stale test
        // workspace SELECTION cookie. Only the selection is cleared: test
        // workspace data and sessions are untouched, and staged link /
        // reauthentication flows throw before this event, preserving their
        // original selection and session. Failed logins never reach it.
        if (
          account &&
          (account.provider === "password-account" ||
            account.provider === "email-verification" ||
            account.provider === "desktop-browser" ||
            account.provider === "google" ||
            account.provider === "apple")
        ) {
          (await cookies()).delete(TEST_WORKSPACE_COOKIE);
        }
      },
    },
    secret: configuredAuthSecret,
    trustHost:
      process.env.AUTH_TRUST_HOST === "true" ||
      process.env.NODE_ENV !== "production" ||
      Boolean(process.env.VERCEL),
  };
}

// Lazy configuration: NextAuth invokes the factory per request, so the freshly
// generated Apple client secret is never captured for the process lifetime.
export const { auth, handlers, signIn, signOut } = NextAuth(() => buildAuthConfig());
