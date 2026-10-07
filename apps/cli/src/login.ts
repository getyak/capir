/**
 * `auth login`: RFC 8252-style authorization-code flow for the capir CLI.
 *
 * The CLI opens the user's system browser at the configured Web
 * `/capir/authorize` (substitutable for owned test browsers), listens on a
 * literal loopback callback, validates callback state/path/method/Host, and
 * exchanges exactly one code on the configured backend with a PKCE S256
 * verifier. Tokens only ever reach the OS keyring; stdout stays secret-free.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { CapirCliError, EXIT } from "./errors.js";
import type { CapirEnvironment } from "./config.js";
import { CapirBackendClient } from "./http.js";
import { CapirAuthV2Client, serializeAuthRecord, usableCredential, parseAuthRecord } from "./authV2.js";
import {runAuthLogout} from "./auth.js";
import type { CredentialStore, CredentialTxn } from "./keyring.js";

const secret = () => randomBytes(32).toString("base64url");

export interface LoginDeps {
  openBrowser(url: string): Promise<void>;
  interactive: boolean;
  onProgress?: (message:string) => void;
}

interface CallbackOutcome {
  code?: string;
  error?: string;
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function validateCallback(
  request: {
    method?: string | undefined;
    url?: string | undefined;
    headers: Record<string, string | string[] | undefined>;
  },
  expected: { state: string; port: number },
): { kind: "valid"; code: string } | { kind: "denied" } | { kind: "invalid"; reason: string } {
  if (request.method !== "GET")
    return { kind: "invalid", reason: `method ${request.method ?? "missing"} rejected` };
  const host = String(request.headers.host ?? "");
  if (host.toLowerCase() !== `127.0.0.1:${expected.port}`)
    return { kind: "invalid", reason: "host rejected" };
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/capir/callback") return { kind: "invalid", reason: "path rejected" };
  const state = url.searchParams.get("state") ?? "";
  if (!state || !sameSecret(state, expected.state))
    return { kind: "invalid", reason: "state mismatch rejected" };
  if (url.searchParams.get("error")) return { kind: "denied" };
  const code = url.searchParams.get("code") ?? "";
  if (!/^[A-Za-z0-9_-]{43}$/.test(code))
    return { kind: "invalid", reason: "malformed code rejected" };
  return { kind: "valid", code };
}

export async function runAuthLogin(
  options: {
    environment: CapirEnvironment;
    clientLabel: string;
    timeoutSeconds: number;
    noninteractive: boolean;
    protocolV2?: boolean;
  },
  dependencies: LoginDeps & {
    fetchImpl: typeof fetch;
    store: CredentialStore;
    txn: CredentialTxn;
  },
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const deadlineAt = Date.now() + options.timeoutSeconds * 1000;
  let deadlineError: CapirCliError | null = null;
  let cancel!: (error: CapirCliError) => void;
  const cancellation = new Promise<never>((_resolve, reject) => { cancel = reject; });
  // A single deadline and signal cover callback and exchange. An in-flight
  // native keyring write must settle before cancellation can return safely.
  // Keep signal handlers until that settlement and cleanup have completed.
  const terminate = (error: CapirCliError) => {
    if (deadlineError) return; // Preserve the first terminal reason during compensation.
    deadlineError = error;
    cancel(deadlineError);
    controller.abort();
  };
  const timer = setTimeout(() => terminate(new CapirCliError(
    "CAPIR_LOGIN_TIMEOUT", EXIT.INFRASTRUCTURE,
    `Login did not complete within ${options.timeoutSeconds}s.`,
  )), options.timeoutSeconds * 1000);
  const onSignal = () => {
    terminate(new CapirCliError("CAPIR_LOGIN_CANCELLED", EXIT.CANCELLED,
      "Login cancelled; the loopback listener was closed."));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const expired = (): CapirCliError | null => {
    if (deadlineError) return deadlineError;
    if (Date.now() < deadlineAt) return null;
    deadlineError = new CapirCliError("CAPIR_LOGIN_TIMEOUT", EXIT.INFRASTRUCTURE,
      `Login did not complete within ${options.timeoutSeconds}s.`);
    controller.abort();
    return deadlineError;
  };

  // Observe early cancellation while native keyring operations settle.
  void cancellation.catch(() => {});
  const requestOptions = () => ({signal:controller.signal,timeoutMs:Math.max(1,deadlineAt-Date.now())});
  try {
  if (options.protocolV2) {
    const metadata = await new CapirAuthV2Client(options.environment.backendOrigin, dependencies.fetchImpl).discovery(requestOptions());
    if (!metadata.enabled || metadata.backend_origin !== options.environment.backendOrigin || metadata.web_origin !== options.environment.webOrigin)
      throw new CapirCliError("CAPIR_AUTH_UNAVAILABLE", EXIT.INFRASTRUCTURE, "Browser authorization is unavailable for this configured origin pair.");
    const prior = await dependencies.store.get();
    if (prior) {
      const record=parseAuthRecord(prior,options.environment);
      if (!record) {
        if(options.noninteractive || !dependencies.interactive) throw new CapirCliError("CAPIR_LOGIN_NONINTERACTIVE",EXIT.INFRASTRUCTURE,"Browser consent is required to upgrade this legacy record; run auth login interactively.");
        // Explicit login intent upgrades an obsolete single-token record.
        // Revoke if resolvable; confirmed unknown token is cleared only by CAS.
        await runAuthLogout(options.environment,{fetchImpl:dependencies.fetchImpl,store:dependencies.store,txn:dependencies.txn,token:prior,protocolV2:true,requestOptions:requestOptions()});
      } else {
        try {
          const current = await usableCredential(options.environment, dependencies.store, dependencies.fetchImpl, requestOptions());
          const verified=await new CapirAuthV2Client(options.environment.backendOrigin, dependencies.fetchImpl, current.token).statusV2(requestOptions());
          const terminal=expired(); if(terminal) throw terminal;
          return { reused: true, identity:verified.identity, grant:verified.grant, environment:options.environment.name, credential_store:dependencies.store.kind, authority:current.authority };
        } catch(error) {
          if (!(error instanceof CapirCliError) || !['CAPIR_CREDENTIAL_EXPIRED','CAPIR_CREDENTIAL_INACTIVE','CAPIR_GRANT_REVOKED','CAPIR_REFRESH_EXPIRED'].includes(error.code)) throw error;
          if(options.noninteractive || !dependencies.interactive) throw new CapirCliError("CAPIR_LOGIN_NONINTERACTIVE",EXIT.INFRASTRUCTURE,"Run auth login interactively to renew this authorization.");
          await runAuthLogout(options.environment,{fetchImpl:dependencies.fetchImpl,store:dependencies.store,txn:dependencies.txn,token:prior,protocolV2:true,requestOptions:requestOptions()});
        }
      }
    }
  }
  const preflightTerminal=expired(); if(preflightTerminal) throw preflightTerminal;
  if (options.noninteractive || !dependencies.interactive) {
    throw new CapirCliError(
      "CAPIR_LOGIN_NONINTERACTIVE",
      EXIT.INFRASTRUCTURE,
      "auth login requires interactive browser consent and fails promptly in noninteractive contexts. Use a preprovisioned CAPIR_TOKEN for automation.",
    );
  }
  const client = new CapirBackendClient(options.environment.backendOrigin, dependencies.fetchImpl);

  const state = secret();
  const codeVerifier = secret();
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");


  // A native keyring write may have completed even if its adapter rejects.
  // Observe the exact scoped entry and remove only this newly minted token.
  // The removal runs inside the origin-pair credential boundary, so it can
  // never delete a credential another login committed in the meantime.
  const cleanupMintedGrant = async (token: string, stored = token, refreshToken?: string): Promise<{
    localMintedAbsent: boolean;
    remoteRevoked: boolean;
  }> => {
    let localMintedAbsent = false;
    let remoteRevoked = false;
    try {
      const removal = await dependencies.txn.removeIfMatch(stored);
      // "preserved_newer" and "already_absent" both prove this minted token is
      // not persisted; only "unverified" keeps cleanup unconfirmed.
      localMintedAbsent = removal !== "unverified";
    } catch {
      // The remote revoke below still makes a persisted token unusable.
    }
    const revokeDeadline = AbortSignal.timeout(2_000);
    let revokeTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        options.protocolV2
          ? new CapirAuthV2Client(options.environment.backendOrigin, dependencies.fetchImpl, token).logoutV2(refreshToken,{signal:revokeDeadline,timeoutMs:2000})
          : client.withToken(token).logout({ timeoutMs: 2_000, signal: revokeDeadline }),
        new Promise<never>((_resolve, reject) => {
          revokeTimer = setTimeout(() => reject(new Error("revoke deadline")), 2_000);
        }),
      ]);
      remoteRevoked = true;
    } catch {
      // A timed-out or failed attempt is not proof of remote revocation.
    } finally {
      if (revokeTimer) clearTimeout(revokeTimer);
    }
    return { localMintedAbsent, remoteRevoked };
  };

  let callbackPort = 0;
  // Fail fast on a pre-existing credential before opening consent windows.
  // The authoritative recheck happens at commit time below, inside the
  // cross-process mutation boundary.
  const prior = await Promise.race([dependencies.store.get(), cancellation]);
  if (prior) throw new CapirCliError(
    "CAPIR_CREDENTIAL_EXISTS", EXIT.INVALID_ARGUMENTS,
    "A scoped credential already exists for this environment; use auth logout before replacing it.",
  );
  const outcome = await Promise.race([new Promise<CallbackOutcome>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      controller.signal.removeEventListener("abort", onAbort);
      server.close();
      callback();
    };
    const onAbort = () => finish(() => reject(new CapirCliError(
      "CAPIR_LOGIN_CANCELLED", EXIT.CANCELLED, "Login cancelled.")));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      const verdict = validateCallback(
        {
          method: request.method,
          url: request.url,
          headers: request.headers as Record<string, string | undefined>,
        },
        { state, port: callbackPort },
      );
      if (verdict.kind === "invalid") {
        // Invalid attempts never complete the flow; the listener keeps waiting
        // for its own validated callback until timeout or cancellation.
        response.writeHead(400, { "content-type": "text/plain", "cache-control": "no-store", "referrer-policy":"no-referrer" });
        response.end("Invalid capir callback; the CLI keeps waiting for its own callback.\n");
        return;
      }
      response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store", "referrer-policy":"no-referrer" });
      response.end(
        '<!doctype html><meta charset="utf-8"><title>capir</title><p>You can close this window and return to the terminal.</p>',
      );
      if (verdict.kind === "denied") finish(() => resolve({ error: "access_denied" }));
      else finish(() => resolve({ code: verdict.code }));
    });
    server.on("error", (error) => {
      finish(() =>
        reject(
          new CapirCliError(
            "CAPIR_LOGIN_FAILED",
            EXIT.INFRASTRUCTURE,
            `The loopback callback listener could not start: ${error.message}`,
          ),
        ),
      );
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        finish(() =>
          reject(
            new CapirCliError(
              "CAPIR_LOGIN_FAILED",
              EXIT.INFRASTRUCTURE,
              "The loopback callback listener did not bind a TCP port.",
            ),
          ),
        );
        return;
      }
      callbackPort = address.port;
      const redirectUri = `http://127.0.0.1:${address.port}/capir/callback`;
      const authorizeUrl = new URL("/capir/authorize", options.environment.webOrigin);
      authorizeUrl.search = new URLSearchParams({
        ...(options.protocolV2 ? {schema_version:"capir-auth.v2"} : {}),
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        web_origin: options.environment.webOrigin,
        backend_origin: options.environment.backendOrigin,
        client_label: options.clientLabel,
      }).toString();
      dependencies.onProgress?.("请在浏览器确认 CLI 授权；按 Ctrl+C 取消。\n");
      dependencies.openBrowser(authorizeUrl.toString()).catch((error: unknown) => {
        if (options.protocolV2 && dependencies.onProgress && !settled && !controller.signal.aborted) {
          // This short-lived request contains only state and public PKCE data.
          // Keep the local callback alive for manual same-machine completion.
          dependencies.onProgress(`无法自动打开浏览器，请在本机浏览器打开：\n${authorizeUrl.toString()}\n按 Ctrl+C 取消。\n`);
          return;
        }
        finish(() =>
          reject(
            new CapirCliError(
              "CAPIR_LOGIN_FAILED",
              EXIT.INFRASTRUCTURE,
              `The system browser could not be opened: ${error instanceof Error ? error.message : String(error)}`,
            ),
          ),
        );
      });
    });
  }), cancellation]);

  if (outcome.error) {
    throw new CapirCliError(
      "CAPIR_AUTH_DENIED",
      EXIT.AUTH_DENIED,
      "The authorization was denied in the browser; no credential was created or stored.",
    );
  }

  // Exchange the single code on the configured backend with the PKCE verifier.
  const exchangeClient = options.protocolV2 ? new CapirAuthV2Client(options.environment.backendOrigin, dependencies.fetchImpl) : client;
  const exchange = options.protocolV2 ? (body: unknown, opts: {signal:AbortSignal}) => (exchangeClient as CapirAuthV2Client).exchangeV2(body, opts) : client.exchange.bind(client);
  const exchanged = await Promise.race([exchange({
    code: outcome.code,
    code_verifier: codeVerifier,
    state,
    redirect_uri: `http://127.0.0.1:${callbackPort}/capir/callback`,
    web_origin: options.environment.webOrigin,
    backend_origin: options.environment.backendOrigin,
  }, { signal: controller.signal }), cancellation]);
  let verifiedIdentity:import("@talent-signal/contracts").CapirAuthV2StatusResponse['identity']=null;
  if (options.protocolV2) {
    try {
      const verified=await Promise.race([new CapirAuthV2Client(options.environment.backendOrigin,dependencies.fetchImpl,exchanged.access_token).statusV2({signal:controller.signal,timeoutMs:Math.max(1,deadlineAt-Date.now())}),cancellation]);
      if(verified.state!=='active' || verified.grant?.id!==exchanged.grant.id || !verified.identity) throw new CapirCliError('CAPIR_LOGIN_UNVERIFIED',EXIT.INFRASTRUCTURE,'The new grant could not be verified; log in again.');
      verifiedIdentity=verified.identity;
    } catch(error) {
      const cleanup=await cleanupMintedGrant(exchanged.access_token,exchanged.access_token,'refresh_token' in exchanged ? String(exchanged.refresh_token) : undefined);
      const terminal=expired();
      throw new CapirCliError(terminal?.code ?? 'CAPIR_LOGIN_UNVERIFIED',terminal?.exitCode ?? EXIT.INFRASTRUCTURE,terminal?.message ?? 'The login could not be verified; run auth login again.',{clientState:{remote_revoked:cleanup.remoteRevoked,local_minted_credential_absent:cleanup.localMintedAbsent}});
    }
  }
  const stored = options.protocolV2 ? serializeAuthRecord(options.environment, exchanged as import("@talent-signal/contracts").CapirAuthExchangeResponse, verifiedIdentity) : exchanged.access_token;
  let writeError: unknown;
  let commit: "committed" | "existing_preserved" | null = null;
  if (!expired()) {
    try {
      // Commit-time mutation boundary: recheck under the origin-pair lock and
      // never overwrite a credential another login completed first. The keyring
      // write is awaited to settlement (it cannot be aborted), so no credential
      // can appear after a timeout or SIGINT result was printed.
      commit = await dependencies.txn.commitIfAbsent(stored);
    } catch (error) {
      writeError = error;
    }
  }
  const late = expired();
  const lostRace = commit === "existing_preserved";
  if (writeError || late || lostRace) {
    const cleanup = await cleanupMintedGrant(exchanged.access_token, stored, "refresh_token" in exchanged ? String(exchanged.refresh_token) : undefined);
    const cleanupState = {
      local_minted_credential_absent: cleanup.localMintedAbsent,
      remote_revoked: cleanup.remoteRevoked,
      ...(lostRace ? { winner_credential_preserved: true } : {}),
    };
    // Compensation may cross the original deadline or receive SIGINT. The
    // first terminal cause still wins after every awaited cleanup step.
    const terminal = expired();
    if (terminal) throw new CapirCliError(
      terminal.code, terminal.exitCode, terminal.message, { clientState: cleanupState },
    );
    if (!cleanup.localMintedAbsent || !cleanup.remoteRevoked) throw new CapirCliError(
      "CAPIR_LOGIN_CLEANUP_FAILED", EXIT.INFRASTRUCTURE,
      lostRace
        ? `Another auth login stored a credential for this environment. Its credential was preserved, but ${!cleanup.localMintedAbsent ? "this login's local minted credential state" : "this login's minted grant revocation"} could not be confirmed. Run auth status and retry cleanup when the keyring and backend are available.`
        : "The interrupted login's local credential removal or minted grant revocation could not be confirmed. Run auth logout when the keyring and backend are available.",
      { clientState: cleanupState },
    );
    if (lostRace && !writeError) {
      // Another login committed first. Its credential is preserved untouched;
      // the grant minted here was confirmed revoked by cleanupMintedGrant.
      throw new CapirCliError(
        "CAPIR_CREDENTIAL_EXISTS",
        EXIT.INVALID_ARGUMENTS,
        "Another auth login stored a credential for this environment while this login was running; that credential was preserved and the grant minted by this login was revoked. Run auth status to inspect the stored credential.",
        { clientState: cleanupState },
      );
    }
    throw writeError;
  }
  return {
    grant: exchanged.grant,
    ...(verifiedIdentity ? {identity:verifiedIdentity} : {}),
    credential_store: dependencies.store.kind,
    environment: options.environment.name,
  };
  } catch(error) {
    const terminal=expired();
    if(terminal && !(error instanceof CapirCliError && error.code===terminal.code)) throw terminal;
    throw error;
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}
