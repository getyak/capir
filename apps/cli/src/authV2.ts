/** Versioned keyring records. A durable refresh intent prevents retrying a
 * consumed token after response loss; status never changes the record. */
import { Value } from '@sinclair/typebox/value';
import {
  CapirAuthCapabilitiesResponseSchema, CapirAuthExchangeResponseSchema,
  CapirAuthRefreshResponseSchema, CapirAuthV2StatusResponseSchema,
  CapirAuthLogoutResponseSchema,
  type CapirAuthExchangeResponse, type CapirAuthV2StatusResponse,
} from '@talent-signal/contracts';
import { CapirBackendClient, type FetchLike } from './http.js';
import { type CapirEnvironment } from './config.js';
import { type CredentialStore, credentialMutexPath, keyringUsername, KEYRING_SERVICE } from './keyring.js';
import { ProcessLock } from './lock.js';
import { CapirCliError, EXIT } from './errors.js';

export interface AuthRecord {
  version: 'capir-auth.v2';
  backend_origin: string;
  web_origin: string;
  credentials: CapirAuthExchangeResponse;
  identity: CapirAuthV2StatusResponse['identity'];
  last_verified_at: string | null;
  refresh_inflight: boolean;
}
const denied = (code: string, message: string) => new CapirCliError(code, EXIT.AUTH_DENIED, message);
export function parseAuthRecord(raw: string, environment: CapirEnvironment): AuthRecord | null {
  if (!raw.startsWith('{')) return null; // legacy single-token keyring entry
  let record: AuthRecord;
  try { record = JSON.parse(raw) as AuthRecord; } catch { throw denied('CAPIR_CREDENTIAL_INVALID', 'The keyring record is invalid; run auth logout and log in again.'); }
  if (record.version !== 'capir-auth.v2' || record.backend_origin !== environment.backendOrigin ||
      record.web_origin !== environment.webOrigin || typeof record.refresh_inflight !== 'boolean' ||
      !Value.Check(CapirAuthExchangeResponseSchema, record.credentials))
    throw denied('CAPIR_CREDENTIAL_INVALID', 'The keyring record does not belong to this configured origin pair.');
  return record;
}
export function serializeAuthRecord(environment: CapirEnvironment, credentials: CapirAuthExchangeResponse, identity:AuthRecord['identity']=null): string {
  if (credentials.grant.backend_origin !== environment.backendOrigin || credentials.grant.web_origin !== environment.webOrigin)
    throw denied('CAPIR_ORIGIN_DENIED', 'The granted origin pair differs from the configured environment.');
  return JSON.stringify({ version: 'capir-auth.v2', backend_origin: environment.backendOrigin,
    web_origin: environment.webOrigin, credentials, identity, last_verified_at: identity ? new Date().toISOString() : null, refresh_inflight: false } satisfies AuthRecord);
}
export class CapirAuthV2Client extends CapirBackendClient {
  discovery(options:{signal?:AbortSignal;timeoutMs?:number}={}) { return this.request<import('@talent-signal/contracts').CapirAuthCapabilitiesResponse>(CapirAuthCapabilitiesResponseSchema, 'GET', '/v1/capir/auth/capabilities',undefined,options); }
  exchangeV2(body: unknown, options: {signal?: AbortSignal} = {}) { return this.request<CapirAuthExchangeResponse>(CapirAuthExchangeResponseSchema, 'POST', '/v1/capir/auth/exchange', {schema_version:'capir-auth.v2', ...(body as object)}, options); }
  statusV2(options:{signal?:AbortSignal;timeoutMs?:number}={}) { return this.request<CapirAuthV2StatusResponse>(CapirAuthV2StatusResponseSchema, 'GET', '/v1/capir/auth/status',undefined,options); }
  refreshV2(refreshToken: string, environment: CapirEnvironment, options:{signal?:AbortSignal;timeoutMs?:number}={}) {
    return this.request<CapirAuthExchangeResponse>(CapirAuthRefreshResponseSchema, 'POST', '/v1/capir/auth/refresh', {
      schema_version:'capir-auth.v2', refresh_token:refreshToken, backend_origin:environment.backendOrigin, web_origin:environment.webOrigin },options);
  }
  logoutV2(refreshToken?: string,options:{signal?:AbortSignal;timeoutMs?:number}={}) { return this.request<{revoked_grant_id:string}>(CapirAuthLogoutResponseSchema, 'POST', '/v1/capir/auth/logout', {schema_version:'capir-auth.v2', ...(refreshToken ? {refresh_token:refreshToken} : {})},options); }
}
export async function authV2Status(environment: CapirEnvironment, store: CredentialStore, fetchImpl: FetchLike): Promise<Record<string, unknown>> {
  const source={credential_source:store.kind === 'environment' ? 'CAPIR_TOKEN' : 'keyring',backend_origin:environment.backendOrigin,web_origin:environment.webOrigin};
  const raw = await store.get();
  if (!raw) return { ...source,state:'missing', environment:environment.name, next_action:'capir auth login' };
  const record = store.kind === 'keyring' ? parseAuthRecord(raw, environment) : null;
  const token = record?.credentials.access_token ?? raw;
  if (record?.refresh_inflight) return {...source,state:'reauth_required', environment:environment.name, next_action:'capir auth logout, then capir auth login'};
  try {
    const status = await new CapirAuthV2Client(environment.backendOrigin, fetchImpl, token).statusV2();
    const {schema_version:_version,...projection}=status;
    return { ...source,...projection, environment:environment.name };
  } catch (error) {
    if (error instanceof CapirCliError && error.code === 'CAPIR_TRANSPORT') return {
      ...source,state:'unverified', environment:environment.name,
      last_verified_identity:record?.identity ?? null, last_verified_at:record?.last_verified_at ?? null };
    throw error;
  }
}
/** Returns a current access token and stable recovery namespace. Never refreshes
 * environment tokens or legacy v1 records, never retries an inflight rotation. */
export async function usableCredential(environment: CapirEnvironment, store: CredentialStore, fetchImpl: FetchLike, options:{signal?:AbortSignal;timeoutMs?:number}={}): Promise<{token:string; authority:string}> {
  const mutex = credentialMutexPath(KEYRING_SERVICE, keyringUsername(environment.backendOrigin, environment.webOrigin));
  return new ProcessLock(mutex).runAsync(async () => {
    const raw = await store.get();
    if (!raw) throw denied('CAPIR_CREDENTIAL_MISSING', 'Run capir auth login --env ' + environment.name + ' first.');
    if (store.kind === 'environment') return {token:raw, authority:raw};
    let record = parseAuthRecord(raw, environment);
    if (!record) throw denied('CAPIR_LEGACY_REAUTH_REQUIRED','This legacy record needs browser reauthorization. Run capir auth login --env '+environment.name+'.');
    if (record.refresh_inflight) throw denied('CAPIR_REFRESH_UNCERTAIN', 'A prior refresh may have consumed this credential. Run auth logout, then auth login; it cannot safely be retried.');
    if (Date.parse(record.credentials.grant.access_expires_at) <= Date.now()) {
      if (Date.parse(record.credentials.grant.refresh_expires_at) <= Date.now() || Date.parse(record.credentials.grant.absolute_expires_at) <= Date.now())
        throw denied('CAPIR_CREDENTIAL_EXPIRED', 'The login expired; run auth logout, then auth login.');
      record = {...record, refresh_inflight:true};
      // Commit in the OS keyring BEFORE dispatch. No raw material in the mutex.
      await store.set(JSON.stringify(record));
      const refreshed = await new CapirAuthV2Client(environment.backendOrigin, fetchImpl).refreshV2(record.credentials.refresh_token, environment, options);
      if (refreshed.grant.id !== record.credentials.grant.id || refreshed.grant.web_origin !== environment.webOrigin || refreshed.grant.backend_origin !== environment.backendOrigin ||
          JSON.stringify(refreshed.grant.scopes) !== JSON.stringify(record.credentials.grant.scopes))
        throw denied('CAPIR_CONTRACT_DRIFT', 'The refresh changed the grant authority; reauthorization is required.');
      record = {...record, credentials:refreshed, refresh_inflight:false};
      await store.set(JSON.stringify(record));
    }
    const status = await new CapirAuthV2Client(environment.backendOrigin, fetchImpl, record.credentials.access_token).statusV2(options);
    if (status.state !== 'active' || status.grant?.id !== record.credentials.grant.id || !status.identity)
      throw denied('CAPIR_CREDENTIAL_INACTIVE', 'The login is no longer active; run auth logout, then auth login.');
    record = {...record, identity:status.identity, last_verified_at:new Date().toISOString()};
    await store.set(JSON.stringify(record));
    return {token:record.credentials.access_token, authority:`user:${status.identity.account_id}:${status.identity.user_id}`};
  });
}
