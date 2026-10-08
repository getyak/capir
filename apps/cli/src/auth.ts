/**
 * `auth status` and `auth logout`.
 *
 * Status only reads the grant; it never renews or replaces credentials.
 * Logout revokes exactly one scoped grant (the backend revokes its parent
 * session and derived Lab entries) and removes only the keyring entry bound to
 * the exact configured origin pair. An ephemeral CAPIR_TOKEN is never
 * persisted or deleted by login/logout.
 */
import { CapirAuthV2Client, parseAuthRecord } from "./authV2.js";
import { CapirCliError, EXIT } from "./errors.js";
import type { CapirEnvironment } from "./config.js";
import { CapirBackendClient, type FetchLike } from "./http.js";
import type { CredentialStore, CredentialTxn } from "./keyring.js";

export async function runAuthStatus(
  environment: CapirEnvironment,
  deps: { fetchImpl: FetchLike; store: CredentialStore; token: string },
): Promise<Record<string, unknown>> {
  const client = new CapirBackendClient(environment.backendOrigin, deps.fetchImpl, deps.token);
  const status = await client.authStatus();
  return {
    grant: status.grant,
    credential_source: deps.store.kind === "environment" ? "CAPIR_TOKEN" : "keyring",
    environment: environment.name,
  };
}

export async function runAuthLogout(
  environment: CapirEnvironment,
  deps: { fetchImpl: FetchLike; store: CredentialStore; txn: CredentialTxn; token: string; protocolV2?: boolean; requestOptions?:{signal?:AbortSignal;timeoutMs?:number} },
): Promise<Record<string, unknown>> {
  let record;
  try {
    record = deps.store.kind === "keyring" ? parseAuthRecord(deps.token, environment) : null;
  } catch (error) {
    if (!(error instanceof CapirCliError) || error.code !== "CAPIR_CREDENTIAL_INVALID") throw error;
    // Invalid material cannot safely prove a remote grant. Clear only this
    // exact local record, never dispatch it or claim remote revocation.
    const removal = await deps.txn.removeIfMatch(deps.token);
    return {
      remote_revoked: false, remote_status: "unverified",
      local_credential_state: removal, local_credential_removed: removal === "removed",
      credential_source: "keyring", environment: environment.name,
      next_action: `${environment.webOrigin}/workspace/settings/cli`,
    };
  }
  const client = new CapirBackendClient(environment.backendOrigin, deps.fetchImpl, deps.token);
  if (record) {
    // Refresh is unnecessary even after access expiry. Retain the exact record
    // on every failed revoke; an uncertain rotation can still prove its family.
    const result = await new CapirAuthV2Client(environment.backendOrigin, deps.fetchImpl, record.credentials.access_token).logoutV2(record.credentials.refresh_token,deps.requestOptions);
    const removal = await deps.txn.removeIfMatch(deps.token);
    return {remote_revoked:true, revoked_grant_id:result.revoked_grant_id, local_credential_state:removal, local_credential_removed:removal === "removed", environment:environment.name};
  }
  if (deps.store.kind === "environment") {
    // Ephemeral token: revoke its grant remotely, never touch the keyring.
    const result = deps.protocolV2 ? await new CapirAuthV2Client(environment.backendOrigin,deps.fetchImpl,deps.token).logoutV2(undefined,deps.requestOptions) : await client.logout(deps.requestOptions);
    return {
      remote_revoked: true,
      revoked_grant_id: result.revoked_grant_id,
      local_credential_removed: false,
      credential_source: "CAPIR_TOKEN",
      environment: environment.name,
    };
  }
  let remote: { revoked: boolean; revoked_grant_id?: string; status: string };
  try {
    const result = deps.protocolV2 ? await new CapirAuthV2Client(environment.backendOrigin,deps.fetchImpl,deps.token).logoutV2(undefined,deps.requestOptions) : await client.logout(deps.requestOptions);
    remote = { revoked: true, revoked_grant_id: result.revoked_grant_id, status: "revoked" };
  } catch (error) {
    const code = error instanceof CapirCliError ? error.code : "";
    if (code === "CAPIR_AUTH_DENIED" || code === "CAPIR_AUTH_REQUIRED") {
      // The grant is already unusable; removing the local credential completes
      // the local scope of logout without claiming a fresh remote revocation.
      remote = { revoked: false, status: "already_unavailable" };
    } else {
      // Keep the local credential so logout can be retried.
      throw new CapirCliError(
        code === "CAPIR_TRANSPORT" ? "CAPIR_TRANSPORT" : code || "CAPIR_LOGOUT_FAILED",
        EXIT.INFRASTRUCTURE,
        "Logout could not revoke the grant; the local keyring credential was preserved for retry.",
        {},
      );
    }
  }
  // Remove only the credential this logout owns, inside the same origin-pair
  // mutation boundary as login. A delayed logout completion can therefore
  // never delete a credential a newer login committed in the meantime.
  const removal = await deps.txn.removeIfMatch(deps.token);
  return {
    remote_revoked: remote.revoked,
    ...(remote.revoked_grant_id ? { revoked_grant_id: remote.revoked_grant_id } : {}),
    remote_status: remote.status,
    local_credential_removed: removal === "removed",
    local_credential_state: removal,
    credential_source: "keyring",
    environment: environment.name,
  };
}
