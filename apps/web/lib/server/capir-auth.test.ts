import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('./backendAuth',()=>({authSecret:()=> 'synthetic-csrf-secret',backendAuthBaseUrl:()=> 'http://127.0.0.1:4317'}));
import {capirAuthRequest,openCapirForm,sealCapirForm,validateConsentParams} from './capir-auth';
const claims={backendAccessToken:'primary-session-one',backendAccountId:'a',backendUserId:'u',backendAccountName:'A',backendAccountSlug:'a',backendExpiresAt:'2099-01-01T00:00:00Z',backendRole:'admin' as const,backendUsername:null};
const params={schema_version:'capir-auth.v2',web_origin:'https://web.test.invalid',backend_origin:'https://api.test.invalid',redirect_uri:'http://127.0.0.1:49381/capir/callback',state:'s'.repeat(43),code_challenge:'p'.repeat(43),code_challenge_method:'S256',client_label:'Proof CLI'};
beforeEach(()=>{process.env.CAPIR_AUTH_WEB_ORIGIN=params.web_origin;process.env.CAPIR_AUTH_BACKEND_ORIGIN=params.backend_origin;vi.restoreAllMocks();});
it('binds deliberate form proof to primary session, origin and exact displayed request',()=>{
 const consent=validateConsentParams(params,['grants.read','grants.revoke']);const sealed=sealCapirForm(claims,consent);
 const request=new Request(params.web_origin+'/api/capir/authorize',{method:'POST',headers:{origin:params.web_origin}});
 expect(openCapirForm(request,claims,sealed)).toEqual(consent);
 expect(()=>openCapirForm(request,{...claims,backendAccessToken:'different-session'},sealed)).toThrow();
 expect(()=>openCapirForm(new Request('https://evil.invalid',{headers:{origin:'https://evil.invalid'}}),claims,sealed)).toThrow();
 expect(()=>openCapirForm(request,claims,sealed.slice(0,-3)+'abc')).toThrow();
});
it('rejects arbitrary callbacks and unregistered origin pairs before login return',()=>{
 for(const redirect_uri of ['https://evil.invalid/capir/callback','http://localhost:49381/capir/callback','http://127.0.0.1:49381/wrong','http://127.0.0.1:49381/capir/callback?token=x'])expect(()=>validateConsentParams({...params,redirect_uri},['grants.read'])).toThrow();
 expect(()=>validateConsentParams({...params,backend_origin:'https://evil.invalid'},['grants.read'])).toThrow();
});
it('expires form proof and never dispatches backend tokens to a caller-selected origin',async()=>{
 vi.spyOn(Date,'now').mockReturnValue(1);const sealed=sealCapirForm(claims,params);vi.spyOn(Date,'now').mockReturnValue(300002);
 expect(()=>openCapirForm(new Request(params.web_origin,{headers:{origin:params.web_origin}}),claims,sealed)).toThrow();
 const transport=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({scopes:[]}));await capirAuthRequest('context',claims);
 expect(transport.mock.calls[0]?.[0]).toBe('http://127.0.0.1:4317/v1/capir/auth/context');expect(transport.mock.calls[0]?.[1]?.redirect).toBe('error');
});
