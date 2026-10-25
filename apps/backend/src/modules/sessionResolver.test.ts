import {afterEach,describe,it,expect,vi} from 'vitest';
import {TalentSignalClient,TalentSignalHttpError} from '@talent-signal/contracts';
afterEach(()=>vi.unstubAllGlobals());
describe('SDK credential resolution before dispatch',()=>{
 it('resolves current credentials once before an authenticated write and never replays the write on rejection',async()=>{
  const order:string[]=[];
  const resolver=vi.fn(async()=>{order.push('renew');return 'synthetic-renewed-access';});
  const transport=vi.fn(async(_url:string,init:RequestInit)=>{order.push('write');expect((init.headers as Record<string,string>).authorization).toBe('Bearer synthetic-renewed-access');return Response.json({error:{code:'SESSION_REQUIRED',message:'Revoked'}},{status:401});});
  vi.stubGlobal('fetch',transport);
  const client=new TalentSignalClient('https://sdk.invalid','stale',{accessTokenResolver:resolver});
  await expect(client.createProductRunCase('synthetic',{id:'case',output_hash:'hash',expected_behavior:'test'})).rejects.toBeInstanceOf(TalentSignalHttpError);
  expect(order).toEqual(['renew','write']);expect(resolver).toHaveBeenCalledTimes(1);expect(transport).toHaveBeenCalledTimes(1);
 });
 it('does not dispatch business writes when renewal fails',async()=>{
  const transport=vi.fn();vi.stubGlobal('fetch',transport);
  const client=new TalentSignalClient('https://sdk.invalid',undefined,{accessTokenResolver:async()=>{throw new Error('Temporary keyring unavailability');}});
  await expect(client.createProductRunCase('synthetic',{id:'case',output_hash:'hash',expected_behavior:'test'})).rejects.toThrow('Temporary keyring');expect(transport).not.toHaveBeenCalled();
 });
 it('exposes persistent renewal and revocation by proof without invoking a stopped host resolver',async()=>{
  const resolver=vi.fn(async()=>{throw new Error('signed out');});
  const proof={renewal_secret:'s'.repeat(43),account_id:'00000000-0000-4000-8000-000000000001',user_id:'00000000-0000-4000-8000-000000000002',session_id:'00000000-0000-4000-8000-000000000003'};
  const revokeProof={...proof,original_access_token:'o'.repeat(43)};
  const transport=vi.fn(async(url:string,init:RequestInit)=>{
    expect((init.headers as Record<string,string>).authorization).toBeUndefined();expect(init.redirect).toBe('error');expect(JSON.parse(init.body as string)).toEqual(url.endsWith('/revoke') ? revokeProof : proof);
    return Response.json(url.endsWith('/renew') ? {access_token:'renewed',session_id:proof.session_id} : {revoked:true});
  });vi.stubGlobal('fetch',transport);
  const client=new TalentSignalClient('https://sdk.invalid','expired',{accessTokenResolver:resolver});
  expect((await client.renewPersistentSession(proof)).session_id).toBe(proof.session_id);
  expect(await client.revokePersistentSession(revokeProof)).toEqual({revoked:true});expect(resolver).not.toHaveBeenCalled();expect(transport).toHaveBeenCalledTimes(2);
 });
 it('bypasses the resolver and bearer for anonymous login calls',async()=>{
  const resolver=vi.fn(async()=>{throw new Error('must not resolve');});
  const transport=vi.fn(async(_url:string,init:RequestInit)=>{expect((init.headers as Record<string,string>).authorization).toBeUndefined();return Response.json({access_token:'new-login'});});vi.stubGlobal('fetch',transport);
  const client=new TalentSignalClient('https://sdk.invalid','previous',{accessTokenResolver:resolver});
  await client.signInWithPassword({identifier:'synthetic@example.invalid',password:'synthetic',client_label:'SDK proof'});
  expect(resolver).not.toHaveBeenCalled();expect(transport).toHaveBeenCalledTimes(1);
 });
});
