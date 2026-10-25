/** Versioned OS-keyring records. V3 refresh intents survive response loss,
 * process interruption and a failed final keyring write. The OS reservation
 * serializes every credential mutation for the exact configured origin pair. */
import { randomUUID } from 'node:crypto';
import { Value } from '@sinclair/typebox/value';
import {
  CapirAuthCapabilitiesResponseSchema, CapirAuthExchangeResponseSchema,
  CapirAuthRefreshResponseSchema, CapirAuthV2StatusResponseSchema,
  CapirAuthLogoutResponseSchema,
  type CapirAuthExchangeResponse, type CapirAuthV2StatusResponse, type CapirAuthProtocol,
} from '@talent-signal/contracts';
import { CapirBackendClient, type FetchLike } from './http.js';
import { type CapirEnvironment } from './config.js';
import { type CredentialStore, credentialMutexPath, keyringUsername, KEYRING_SERVICE } from './keyring.js';
import { ProcessLock } from './lock.js';
import { CapirCliError, EXIT } from './errors.js';

type RequestOptions = {signal?:AbortSignal;timeoutMs?:number};
export interface AuthRecord {
  version: CapirAuthProtocol;
  backend_origin: string;
  web_origin: string;
  credentials: CapirAuthExchangeResponse;
  identity: CapirAuthV2StatusResponse['identity'];
  last_verified_at: string | null;
  refresh_inflight: boolean;
  logout_pending?:boolean;
  pending_refresh?: { request_id:string; protocol:'capir-auth.v3' };
}
const denied = (code:string,message:string) => new CapirCliError(code, EXIT.AUTH_DENIED, message);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function parseAuthRecord(raw:string,environment:CapirEnvironment):AuthRecord|null {
  if (!raw.startsWith('{')) return null;
  let record:AuthRecord;
  try { record=JSON.parse(raw) as AuthRecord; } catch { throw denied('CAPIR_CREDENTIAL_INVALID','The keyring record is invalid; clear this record and sign in again.'); }
  const pending=record.pending_refresh;
  if (!['capir-auth.v2','capir-auth.v3'].includes(record.version) || record.backend_origin!==environment.backendOrigin ||
      record.web_origin!==environment.webOrigin || typeof record.refresh_inflight!=='boolean' || (record.logout_pending!==undefined && typeof record.logout_pending!=='boolean') ||
      !Value.Check(CapirAuthExchangeResponseSchema,record.credentials) ||
      record.credentials.grant.backend_origin!==environment.backendOrigin || record.credentials.grant.web_origin!==environment.webOrigin ||
      (record.credentials.schema_version==='capir-auth.v2' && (record.credentials.grant.absolute_expires_at===null || record.credentials.grant.refresh_expires_at===null)) ||
      (record.credentials.schema_version==='capir-auth.v3' && (record.credentials.grant.absolute_expires_at!==null || record.credentials.grant.refresh_expires_at!==null)) ||
      (pending!==undefined && (!pending || !uuid.test(pending.request_id) || pending.protocol!=='capir-auth.v3' || !record.refresh_inflight)) ||
      (record.version==='capir-auth.v3' && record.refresh_inflight && !pending))
    throw denied('CAPIR_CREDENTIAL_INVALID','The keyring record does not belong to this configured origin pair or protocol.');
  return record;
}
export function serializeAuthRecord(environment:CapirEnvironment,credentials:CapirAuthExchangeResponse,identity:AuthRecord['identity']=null):string {
  if (credentials.grant.backend_origin!==environment.backendOrigin || credentials.grant.web_origin!==environment.webOrigin)
    throw denied('CAPIR_ORIGIN_DENIED','The granted origin pair differs from the configured environment.');
  return JSON.stringify({version:credentials.schema_version,backend_origin:environment.backendOrigin,web_origin:environment.webOrigin,
    credentials,identity,last_verified_at:identity ? new Date().toISOString() : null,refresh_inflight:false} satisfies AuthRecord);
}
export class CapirAuthV2Client extends CapirBackendClient {
  discovery(options:RequestOptions={}) { return this.request<import('@talent-signal/contracts').CapirAuthCapabilitiesResponse>(CapirAuthCapabilitiesResponseSchema,'GET','/v1/capir/auth/capabilities?schema_version=capir-auth.v3',undefined,options); }
  exchangeV2(body:unknown,options:RequestOptions={},protocol:CapirAuthProtocol='capir-auth.v2') { return this.request<CapirAuthExchangeResponse>(CapirAuthExchangeResponseSchema,'POST','/v1/capir/auth/exchange',{...(body as object),schema_version:protocol},options); }
  statusV2(options:RequestOptions={}) { return this.request<CapirAuthV2StatusResponse>(CapirAuthV2StatusResponseSchema,'GET','/v1/capir/auth/status',undefined,options); }
  refreshV2(refreshToken:string,environment:CapirEnvironment,options:RequestOptions={},intent?:AuthRecord['pending_refresh']) {
    return this.request<CapirAuthExchangeResponse>(CapirAuthRefreshResponseSchema,'POST','/v1/capir/auth/refresh',{
      schema_version:intent?.protocol ?? 'capir-auth.v2',refresh_token:refreshToken,...(intent ? {request_id:intent.request_id} : {}),
      backend_origin:environment.backendOrigin,web_origin:environment.webOrigin},options);
  }
  logoutV2(refreshToken?:string,options:RequestOptions={}) { return this.request<{revoked_grant_id:string}>(CapirAuthLogoutResponseSchema,'POST','/v1/capir/auth/logout',{schema_version:'capir-auth.v2',...(refreshToken ? {refresh_token:refreshToken} : {})},options); }
}
export async function authV2Status(environment:CapirEnvironment,store:CredentialStore,fetchImpl:FetchLike):Promise<Record<string,unknown>> {
  const source={credential_source:store.kind==='environment' ? 'CAPIR_TOKEN' : 'keyring',backend_origin:environment.backendOrigin,web_origin:environment.webOrigin};
  const raw=await store.get();
  if (!raw) return {...source,state:'missing',environment:environment.name,next_action:'capir auth login --env '+environment.name};
  let record:AuthRecord|null;
  try { record=store.kind==='keyring' ? parseAuthRecord(raw,environment) : null; }
  catch(error) {
    if (!(error instanceof CapirCliError) || error.code!=='CAPIR_CREDENTIAL_INVALID') throw error;
    return {...source,state:'reauth_required',reason:'credential_invalid',environment:environment.name,next_action:'capir auth logout --env '+environment.name+', then capir auth login --env '+environment.name};
  }
  if (store.kind==='keyring' && !record) return {...source,state:'reauth_required',reason:'legacy_credential',environment:environment.name,next_action:'capir auth login --env '+environment.name};
  if (record?.logout_pending) return {...source,state:'signed_out',reason:'revocation_pending',environment:environment.name,next_action:'capir auth logout --env '+environment.name};
  if (record?.refresh_inflight) return record.pending_refresh
    ? {...source,state:'unverified',reason:'renewal_pending',environment:environment.name,last_verified_identity:record.identity,last_verified_at:record.last_verified_at,next_action:'capir auth login --env '+environment.name}
    : {...source,state:'reauth_required',reason:'legacy_refresh_uncertain',environment:environment.name,next_action:'capir auth logout --env '+environment.name+', then capir auth login --env '+environment.name};
  try {
    const status=await new CapirAuthV2Client(environment.backendOrigin,fetchImpl,record?.credentials.access_token ?? raw).statusV2();
    const {schema_version:_version,...projection}=status;
    if (status.schema_version==='capir-auth.v3' && status.state==='expired' && status.grant?.state==='active')
      return {...source,...projection,state:'renewable',environment:environment.name,next_action:'capir auth login --env '+environment.name};
    return {...source,...projection,environment:environment.name};
  } catch(error) {
    if (error instanceof CapirCliError && error.code==='CAPIR_TRANSPORT') return {...source,state:'unverified',environment:environment.name,last_verified_identity:record?.identity ?? null,last_verified_at:record?.last_verified_at ?? null};
    throw error;
  }
}
/** Resolve before business dispatch; never replays a business request. A v3
 * intent stays in the keyring until the exact response is safely persisted. */
export async function usableCredential(environment:CapirEnvironment,store:CredentialStore,fetchImpl:FetchLike,options:RequestOptions & {protocol?:CapirAuthProtocol;negotiate?:boolean}={}):Promise<{token:string;authority:string}> {
  const mutex=credentialMutexPath(KEYRING_SERVICE,keyringUsername(environment.backendOrigin,environment.webOrigin));
  return new ProcessLock(mutex).runAsync(async()=>{
    const raw=await store.get();
    if (!raw) throw denied('CAPIR_CREDENTIAL_MISSING','Run capir auth login --env '+environment.name+' first.');
    if (store.kind==='environment') return {token:raw,authority:raw};
    const parsed=parseAuthRecord(raw,environment);
    if (!parsed) throw denied('CAPIR_LEGACY_REAUTH_REQUIRED','This legacy record needs browser reauthorization. Run capir auth login --env '+environment.name+'.');
    let record:AuthRecord=parsed;
    if (record.logout_pending) throw denied('CAPIR_LOGOUT_PENDING','You signed out locally; retry auth logout to finish remote revocation.');
    if (record.refresh_inflight && !record.pending_refresh) throw denied('CAPIR_REFRESH_UNCERTAIN','A legacy refresh has no recoverable transaction id. Run auth logout, then auth login.');
    let protocol=record.pending_refresh?.protocol ?? options.protocol ?? record.credentials.schema_version;
    if (protocol==='capir-auth.v2' && options.negotiate) {
      const metadata=await new CapirAuthV2Client(environment.backendOrigin,fetchImpl).discovery(options);
      if (!metadata.enabled || metadata.backend_origin!==environment.backendOrigin || metadata.web_origin!==environment.webOrigin)
        throw new CapirCliError('CAPIR_AUTH_UNAVAILABLE',EXIT.INFRASTRUCTURE,'Authorization cannot be verified for this configured origin pair.');
      protocol=metadata.schema_version;
    }
    if ((record.version==='capir-auth.v3' || record.credentials.schema_version==='capir-auth.v3' || record.pending_refresh?.protocol==='capir-auth.v3')
      && (options.protocol==='capir-auth.v2' || protocol==='capir-auth.v2'))
      throw new CapirCliError('CAPIR_AUTH_PROTOCOL_UNAVAILABLE',EXIT.INFRASTRUCTURE,'Persistent sign-in is temporarily unavailable on this server. The saved credential is unchanged; retry after the server recovers.');
    // A receipt recovered after a long interruption can contain an expired
    // access token: persist it, then rotate its current successor once more.
    for(let attempt=0;attempt<2 && (record.refresh_inflight || Date.parse(record.credentials.grant.access_expires_at)<=Date.now() || protocol!==record.credentials.schema_version);attempt++) {
      const grant=record.credentials.grant;
      if (!record.pending_refresh && ((grant.refresh_expires_at!==null && Date.parse(grant.refresh_expires_at)<=Date.now()) || (grant.absolute_expires_at!==null && Date.parse(grant.absolute_expires_at)<=Date.now())))
        throw denied('CAPIR_CREDENTIAL_EXPIRED','The legacy authorization expired before persistent renewal was negotiated; sign in again.');
      const intent:AuthRecord['pending_refresh']=record.pending_refresh ?? (protocol==='capir-auth.v3' ? {request_id:randomUUID(),protocol:'capir-auth.v3' as const} : undefined);
      record={...record,version:protocol,refresh_inflight:true,...(intent ? {pending_refresh:intent} : {})};
      await store.set(JSON.stringify(record)); // must settle BEFORE any dispatch
      const refreshed=await new CapirAuthV2Client(environment.backendOrigin,fetchImpl).refreshV2(record.credentials.refresh_token,environment,options,intent);
      if (refreshed.schema_version!==protocol || refreshed.grant.id!==record.credentials.grant.id || refreshed.grant.web_origin!==environment.webOrigin || refreshed.grant.backend_origin!==environment.backendOrigin || JSON.stringify(refreshed.grant.scopes)!==JSON.stringify(record.credentials.grant.scopes))
        throw new CapirCliError('CAPIR_CONTRACT_DRIFT',EXIT.INFRASTRUCTURE,'The renewal response changed its authority; the pending credential was preserved.');
      const {pending_refresh:_pending,...settled}=record;
      record={...settled,version:refreshed.schema_version,credentials:refreshed,refresh_inflight:false};
      await store.set(JSON.stringify(record));
    }
    if (Date.parse(record.credentials.grant.access_expires_at)<=Date.now()) throw new CapirCliError('CAPIR_RENEWAL_PENDING',EXIT.INFRASTRUCTURE,'Access renewal is still pending; retry the same command.');
    const status=await new CapirAuthV2Client(environment.backendOrigin,fetchImpl,record.credentials.access_token).statusV2(options);
    if (status.state!=='active' || status.grant?.id!==record.credentials.grant.id || !status.identity)
      throw status.state==='revoked' ? denied('CAPIR_CREDENTIAL_INACTIVE','The authorization was revoked; sign in again.') : new CapirCliError('CAPIR_AUTH_UNVERIFIED',EXIT.INFRASTRUCTURE,'The current authorization could not be verified; its keyring record was preserved.');
    if (record.identity && (record.identity.account_id!==status.identity.account_id || record.identity.user_id!==status.identity.user_id))
      throw new CapirCliError('CAPIR_CONTRACT_DRIFT',EXIT.INFRASTRUCTURE,'The verified identity changed; the credential was preserved without business dispatch.');
    record={...record,identity:status.identity,last_verified_at:new Date().toISOString()};
    await store.set(JSON.stringify(record));
    return {token:record.credentials.access_token,authority:`user:${status.identity.account_id}:${status.identity.user_id}`};
  });
}
