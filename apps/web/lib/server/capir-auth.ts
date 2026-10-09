import 'server-only';
import {createHash, createHmac, randomBytes, timingSafeEqual} from 'node:crypto';
import {Value} from '@sinclair/typebox/value';
import {CapirAuthAuthorizeRequestSchema, type CapirAuthAuthorizeRequest} from '@talent-signal/contracts';
import {authSecret, backendAuthBaseUrl, type BackendSessionClaims} from './backendAuth';

export const AUTH_HEADERS = {'cache-control':'no-store', 'referrer-policy':'no-referrer', 'x-content-type-options':'nosniff'};
export function capirAuthOrigins() {
  const web = process.env.CAPIR_AUTH_WEB_ORIGIN?.trim();
  const backend = process.env.CAPIR_AUTH_BACKEND_ORIGIN?.trim();
  if (!web || !backend) throw new Error('CLI authorization is not configured.');
  for (const origin of [web,backend]) {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')))
      throw new Error('Invalid configured CLI origin.');
  }
  return {web,backend};
}
export async function capirAuthRequest<T>(path:string, claims:BackendSessionClaims, body?:unknown):Promise<T> {
  // Never dispatch to an origin supplied by a URL or form.
  const response = await fetch(`${backendAuthBaseUrl()}/v1/capir/auth/${path}`, {
    method:body === undefined ? 'GET' : 'POST', redirect:'error', cache:'no-store',
    headers:{authorization:`Bearer ${claims.backendAccessToken}`, ...(body === undefined ? {} : {'content-type':'application/json'})},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('CLI authorization is unavailable for this account.');
  return await response.json() as T;
}
export function validateConsentParams(params:Record<string,string|string[]|undefined>, scopes:CapirAuthAuthorizeRequest['scopes']):CapirAuthAuthorizeRequest {
  const origins=capirAuthOrigins();
  const request={schema_version:'capir-auth.v2', redirect_uri:params.redirect_uri, state:params.state,
    code_challenge:params.code_challenge, code_challenge_method:params.code_challenge_method,
    web_origin:params.web_origin, backend_origin:params.backend_origin, client_label:params.client_label, scopes, consent:true};
  if (!Value.Check(CapirAuthAuthorizeRequestSchema, request) || request.web_origin !== origins.web || request.backend_origin !== origins.backend || params.schema_version !== 'capir-auth.v2')
    throw new Error('Invalid CLI authorization request.');
  const redirect = new URL(request.redirect_uri);
  if (redirect.origin !== `http://127.0.0.1:${redirect.port}` || !redirect.port || Number(redirect.port)<1024 || redirect.pathname !== '/capir/callback' || redirect.search || redirect.hash || redirect.username || redirect.password)
    throw new Error('Invalid loopback callback.');
  return request;
}
function sessionDigest(claims:BackendSessionClaims) {return createHash('sha256').update(claims.backendAccessToken).digest('hex');}
function sign(value:string) {return createHmac('sha256',authSecret()).update('capir-auth.v2\n'+value).digest('base64url');}
export function sealCapirForm(claims:BackendSessionClaims, value:unknown):string {
  const payload=Buffer.from(JSON.stringify({session:sessionDigest(claims), value, expires:Date.now()+300000, nonce:randomBytes(16).toString('hex')})).toString('base64url');
  return payload+'.'+sign(payload);
}
export function openCapirForm<T>(request:Request, claims:BackendSessionClaims, sealed:string):T {
  if (request.headers.get('origin') !== capirAuthOrigins().web) throw new Error('Invalid form origin.');
  const [payload='',signature='',extra] = sealed.split('.');
  const expected=sign(payload); const a=Buffer.from(signature); const b=Buffer.from(expected);
  if (extra || a.length!==b.length || !timingSafeEqual(a,b)) throw new Error('Invalid form proof.');
  const parsed=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));
  if (parsed.session!==sessionDigest(claims) || !Number.isFinite(parsed.expires) || parsed.expires<Date.now()) throw new Error('Expired form proof.');
  return parsed.value as T;
}
