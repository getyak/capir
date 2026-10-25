import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {get} from 'node:http';
import {after,it} from 'node:test';
import {runCli} from '../dist/run.js';
import {runAuthLogin} from '../dist/login.js';
import {runAuthLogout} from '../dist/auth.js';
import {authV2Status,usableCredential,serializeAuthRecord} from '../dist/authV2.js';
import {createCredentialTxn,credentialMutexPath,keyringUsername,KEYRING_SERVICE} from '../dist/keyring.js';
import {writeEnvironment} from './helpers.mjs';
const dirs=[];after(()=>dirs.forEach(dir=>rmSync(dir,{recursive:true,force:true})));
const secret=()=>randomBytes(32).toString('base64url');
const environment={name:'v2',backendOrigin:'http://127.0.0.1:44317',webOrigin:'http://127.0.0.1:44399'};
const identity={account_id:randomUUID(),account_slug:'synthetic',user_id:randomUUID(),user_email:'proof@example.invalid'};
function credentials(expired=false) {return {schema_version:'capir-auth.v2',access_token:secret(),refresh_token:secret(),grant:{id:randomUUID(),client_label:'Proof',scopes:['grants.read','grants.revoke'],web_origin:environment.webOrigin,backend_origin:environment.backendOrigin,created_at:new Date().toISOString(),last_verified_at:null,access_expires_at:new Date(Date.now()+(expired?-1000:600000)).toISOString(),refresh_expires_at:new Date(Date.now()+600000).toISOString(),absolute_expires_at:new Date(Date.now()+3600000).toISOString(),state:'active',refresh_supported:true}};}
function store(value=null){return {kind:'keyring',value,writes:0,async get(){return this.value;},async set(v){this.value=v;this.writes++;},async delete(){this.value=null;return true;}};}
const response=v=>Response.json(v);
it('status does not rotate or write; network failure is unverified',async()=>{const c=credentials(true),s=store(serializeAuthRecord(environment,c));let paths=[];
 const status=await authV2Status(environment,s,async url=>{paths.push(new URL(url).pathname);return response({schema_version:'capir-auth.v2',state:'expired',grant:c.grant,identity});});assert.equal(status.state,'expired');assert.equal(s.writes,0);assert.deepEqual(paths,['/v1/capir/auth/status']);assert.equal((await authV2Status(environment,s,async()=>{throw Error('offline')})).state,'unverified');assert.equal(s.writes,0);});
it('invalid and legacy status require reauthorization without network or keyring writes', async () => {
 const c = credentials();
 const foreign = JSON.stringify({...JSON.parse(serializeAuthRecord(environment,c)),web_origin:'https://foreign.invalid'});
 for (const raw of ['{broken',foreign,secret()]) {
  const s = store(raw);
  const status = await authV2Status(environment,s,async()=>{assert.fail('Locally invalid or legacy material must not be dispatched');});
  assert.equal(status.state,'reauth_required');
  assert.equal(status.reason,raw.startsWith('{')?'credential_invalid':'legacy_credential');
  assert.match(status.next_action,/capir auth login --env v2/);
  assert.equal(s.value,raw);assert.equal(s.writes,0);
 }
});
it('invalid logout clears only the exact record and never claims a remote revoke', async () => {
 const dir=mkdtempSync(join(tmpdir(),'capir-invalid-v2-'));dirs.push(dir);
 const raw='{broken',s=store(raw),txn=createCredentialTxn(s,join(dir,'mutex.sqlite'));
 const fetchImpl=async()=>{assert.fail('Invalid material must not be dispatched');};
 const result=await runAuthLogout(environment,{store:s,txn,token:raw,protocolV2:true,fetchImpl});
 assert.equal(s.value,null);assert.equal(result.local_credential_removed,true);
 assert.equal(result.remote_revoked,false);assert.equal(result.remote_status,'unverified');
 assert.equal(result.next_action,environment.webOrigin+'/workspace/settings/cli');
 const newer=serializeAuthRecord(environment,credentials());s.value=newer;
 const stale=await runAuthLogout(environment,{store:s,txn,token:raw,protocolV2:true,fetchImpl});
 assert.equal(stale.local_credential_state,'preserved_newer');assert.equal(s.value,newer);
 s.value=raw;s.delete=async()=>false;
 const uncertain=await runAuthLogout(environment,{store:s,txn,token:raw,protocolV2:true,fetchImpl});
 assert.equal(uncertain.local_credential_state,'unverified');assert.equal(uncertain.local_credential_removed,false);assert.equal(s.value,raw);
});
it('human auth recovery distinguishes invalid local cleanup from remote revocation and upgrades legacy status',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'capir-invalid-human-v2-'));dirs.push(dir);writeEnvironment(dir,environment.name,environment.backendOrigin,environment.webOrigin);
 const s=store('{broken'),deps={env:{CAPIR_CONFIG_DIR:dir},credentialStore:()=>s,credentialTxn:()=>createCredentialTxn(s,join(dir,'mutex.sqlite')),fetchImpl:async()=>assert.fail('No network for invalid/legacy status or invalid logout'),interactive:true,openBrowser:async()=>{},sleep:async()=>{}};
 const invalid=await runCli(['auth','status','--env','v2','--human'],deps);
 assert.equal(invalid.exitCode,0);assert.match(invalid.output,/需要重新授权/);assert.match(invalid.output,/auth logout --env v2/);
 const logout=await runCli(['auth','logout','--env','v2','--human'],deps);
 assert.equal(logout.exitCode,0);assert.match(logout.output,/撤销：尚未确认/);assert.match(logout.output,/本机凭据：已移除/);assert.match(logout.output,/workspace\/settings\/cli/);
 const absent=await runCli(['auth','status','--env','v2','--json'],deps);assert.equal(JSON.parse(absent.output).state,'missing');
 s.value=secret();
 const legacy=await runCli(['auth','status','--env','v2','--human'],deps);
 assert.equal(legacy.exitCode,0);assert.match(legacy.output,/下一步：capir auth login --env v2/);assert.doesNotMatch(legacy.output,/重试：/);
});
it('commits refresh intent before dispatch and refuses response-loss replay',async()=>{const c=credentials(true),s=store(serializeAuthRecord(environment,c));let refreshCalls=0;
 await assert.rejects(usableCredential(environment,s,async url=>{assert.match(String(url),/refresh$/);refreshCalls++;assert.equal(JSON.parse(s.value).refresh_inflight,true);throw Error('lost response');}),{code:'CAPIR_TRANSPORT'});
 await assert.rejects(usableCredential(environment,s,async()=>{refreshCalls++;throw Error('must not retry');}),{code:'CAPIR_REFRESH_UNCERTAIN'});assert.equal(refreshCalls,1);});
it('two concurrent callers rotate once and keep stable user recovery identity',async()=>{const c=credentials(true),s=store(serializeAuthRecord(environment,c));let rotations=0;
 const transport=async(url,init)=>{if(String(url).endsWith('/refresh')){rotations++;assert.equal(JSON.parse(init.body).refresh_token,c.refresh_token);await new Promise(r=>setTimeout(r,20));return response({...c,access_token:secret(),refresh_token:secret(),grant:{...c.grant,access_expires_at:new Date(Date.now()+600000).toISOString()}});}return response({schema_version:'capir-auth.v2',state:'active',grant:JSON.parse(s.value).credentials.grant,identity});};
 const [a,b]=await Promise.all([usableCredential(environment,s,transport),usableCredential(environment,s,transport)]);assert.equal(rotations,1);assert.equal(a.token,b.token);assert.equal(a.authority,`user:${identity.account_id}:${identity.user_id}`);});
for(const legacy of [false,true]) it(`real dispatcher ${legacy?'upgrades legacy record':'negotiates v2'}, uses loopback PKCE and reuses verified keyring record`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'capir-auth-v2-'));dirs.push(dir);writeEnvironment(dir,environment.name,environment.backendOrigin,environment.webOrigin);
 const c=credentials(),s=store(legacy?secret():null);let browser=0,challenge;
 const fetchImpl=async(url,init={})=>{const path=new URL(url).pathname;
 if(path.endsWith('/capabilities'))return response({schema_version:'capir-auth.v2',enabled:true,capabilities:Object.fromEntries(['auth.authorize','auth.exchange','auth.refresh','auth.status','auth.logout','auth.grants'].map(k=>[k,'supported'])),device_auth:'unsupported',scopes:c.grant.scopes,backend_origin:environment.backendOrigin,web_origin:environment.webOrigin,lifetimes:{code_seconds:60,access_seconds:900,refresh_idle_seconds:604800,refresh_absolute_seconds:2592000},unsupported:['device_auth']});
 if(path.endsWith('/logout'))return Response.json({error:{code:'CAPIR_AUTH_REQUIRED',message:'No matching grant'}},{status:401});
 if(path.endsWith('/exchange')){const body=JSON.parse(init.body);assert.equal(body.schema_version,'capir-auth.v2');assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'),challenge);return response(c);}
 if(path.endsWith('/status'))return response({schema_version:'capir-auth.v2',state:'active',grant:c.grant,identity});throw Error('Unexpected dispatch');};
 const deps={env:{CAPIR_CONFIG_DIR:dir},credentialStore:()=>s,credentialTxn:()=>createCredentialTxn(s,join(dir,'mutex.sqlite')),fetchImpl,interactive:true,sleep:async()=>{},openBrowser:async url=>{browser++;const parsed=new URL(url);assert.equal(parsed.searchParams.get('schema_version'),'capir-auth.v2');challenge=parsed.searchParams.get('code_challenge');const callback=new URL(parsed.searchParams.get('redirect_uri'));assert.equal(callback.hostname,'127.0.0.1');callback.searchParams.set('state',parsed.searchParams.get('state'));callback.searchParams.set('code',secret());await fetch(callback);}};
 const result=await runCli(['auth','login','--env','v2','--json'],deps);assert.equal(result.exitCode,0,result.output);assert.equal(JSON.parse(s.value).version,'capir-auth.v2');assert.ok(!result.output.includes(c.access_token));assert.ok(!result.output.includes(c.refresh_token));
 const reused=await runCli(['auth','login','--env','v2','--json'],deps);assert.equal(reused.exitCode,0,reused.output);assert.equal(browser,1);assert.equal(JSON.parse(reused.output).reused,true);
 const human=await runCli(['auth','status','--env','v2','--human'],deps);assert.equal(human.exitCode,0,human.output);assert.match(human.output,/已登录/);assert.ok(human.output.includes(environment.backendOrigin));assert.ok(!human.output.includes(c.access_token));
});
it('rejects unregistered --server before loading keyring or dispatching',async()=>{const dir=mkdtempSync(join(tmpdir(),'capir-server-v2-'));dirs.push(dir);writeEnvironment(dir,'v2',environment.backendOrigin,environment.webOrigin);
 const result=await runCli(['auth','status','--env','v2','--server','https://evil.invalid'],{env:{CAPIR_CONFIG_DIR:dir},credentialStore(){throw Error('must not load');},fetchImpl(){throw Error('must not dispatch');},interactive:false,openBrowser:async()=>{},sleep:async()=>{}});assert.equal(result.exitCode,2);assert.match(result.output,/CAPIR_SERVER_UNREGISTERED/);
});

it('the login deadline aborts discovery before opening a browser or writing a credential',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'capir-deadline-v2-'));dirs.push(dir);const s=store();let aborted=false,browser=0;
 await assert.rejects(runAuthLogin({environment,clientLabel:'Proof',timeoutSeconds:0.03,noninteractive:false,protocolV2:true},{store:s,txn:createCredentialTxn(s,join(dir,'mutex.sqlite')),interactive:true,openBrowser:async()=>{browser++;},fetchImpl:async(_url,init)=>new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>{aborted=true;reject(new DOMException('Aborted','AbortError'));},{once:true});})}),{code:'CAPIR_LOGIN_TIMEOUT'});
 assert.equal(aborted,true);assert.equal(browser,0);assert.equal(s.value,null);assert.equal(s.writes,0);
});

// Reproduce Node's millisecond timer boundary without scheduler luck: the
// request timer fires while Date.now is still one millisecond before login's
// deadline, and the outer login timer has not fired. Production callbacks,
// abort propagation and error handling remain real.
function loginClock(t) {
 const started=Date.now(),timers=[];
 let now=started;
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'setTimeout',(callback,ms,...args)=>{
  const timer={ms,cleared:false,fired:false,unref(){return this;},fire(){
   if(this.cleared||this.fired)return;
   this.fired=true;callback(...args);
  }};
  timers.push(timer);return timer;
 });
 const clear=globalThis.clearTimeout;
 t.mock.method(globalThis,'clearTimeout',timer=>{
  if(timers.includes(timer))timer.cleared=true;
  else clear(timer);
 });
 return {timers,beforeDeadline(){now=started+29;},atDeadline(){now=started+30;}};
}

for(const phase of ['fetch','body']) it(`a ${phase} deadline before the login timer is still a login timeout`,async t=>{
 const clock=loginClock(t),s=store();let browser=0,commits=0,aborted=false;
 const pending=new Promise(()=>{});
 let requestReady;
 const ready=new Promise(resolve=>{requestReady=resolve;});
 const login=runAuthLogin({environment,clientLabel:'Proof',timeoutSeconds:0.03,noninteractive:false,protocolV2:true},{
  store:s,txn:{async commitIfAbsent(){commits++;return 'committed';}},interactive:true,
  openBrowser:async()=>{browser++;},fetchImpl:async(_url,init)=>{
   init.signal.addEventListener('abort',()=>{aborted=true;},{once:true});
   if(phase==='fetch'){requestReady();return pending;}
   return {ok:true,status:200,async text(){requestReady();return pending;}};
  },
 });
 const rejection=assert.rejects(login,{code:'CAPIR_LOGIN_TIMEOUT'});
 // Wait for the named protocol stage without advancing either clock.
 await ready;
 assert.equal(clock.timers.length,2);
 clock.beforeDeadline();clock.timers[1].fire();
 await rejection;
 assert.equal(clock.timers[0].fired,false,'the transport deadline wins the timer race');
 assert.equal(aborted,true);assert.equal(browser,0);assert.equal(commits,0);
 assert.equal(s.value,null);assert.equal(s.writes,0);
 assert.ok(clock.timers.every(timer=>timer.cleared));
});

for(const failure of ['fetch','body','backend-code']) it(`an immediate ${failure} failure before the deadline remains transport failure`,async t=>{
 const clock=loginClock(t),s=store();let browser=0,commits=0;
 await assert.rejects(runAuthLogin({environment,clientLabel:'Proof',timeoutSeconds:0.03,noninteractive:false,protocolV2:true},{
  store:s,txn:{async commitIfAbsent(){commits++;return 'committed';}},interactive:true,
  openBrowser:async()=>{browser++;},fetchImpl:async()=>{
   if(failure==='fetch')throw Error('private network detail');
   if(failure==='body')return {ok:true,status:200,async text(){throw Error('private body detail');}};
   return Response.json({error:{code:'CAPIR_TRANSPORT',message:'Upstream refusal'}},{status:503});
  },
 }),error=>{assert.equal(error.code,'CAPIR_TRANSPORT');assert.doesNotMatch(error.message,/private/);return true;});
 assert.equal(clock.timers.some(timer=>timer.fired),false);
 assert.equal(browser,0);assert.equal(commits,0);assert.equal(s.writes,0);
});

for(const first of ['SIGINT','login timer']) it(`${first} remains the first terminal reason when a request timer also fires`,async t=>{
 const clock=loginClock(t),s=store();let commits=0;
 const login=runAuthLogin({environment,clientLabel:'Proof',timeoutSeconds:0.03,noninteractive:false,protocolV2:true},{
  store:s,txn:{async commitIfAbsent(){commits++;return 'committed';}},interactive:true,
  openBrowser:async()=>assert.fail('must not open'),fetchImpl:async()=>new Promise(()=>{}),
 });
 const rejection=assert.rejects(login,{code:first==='SIGINT'?'CAPIR_LOGIN_CANCELLED':'CAPIR_LOGIN_TIMEOUT'});
 if(first==='SIGINT'){clock.beforeDeadline();process.emit('SIGINT');}
 else {clock.atDeadline();clock.timers[0].fire();}
 clock.timers[1].fire();
 await rejection;
 assert.equal(commits,0);assert.equal(s.writes,0);
});

it('a post-mint request deadline is latched before cleanup and never writes a credential',async t=>{
 const clock=loginClock(t),s=store(),c=credentials();let commits=0,revoked=0,statusTimer;
 let statusStarted;
 const ready=new Promise(resolve=>{statusStarted=resolve;});
 const login=runAuthLogin({environment,clientLabel:'Proof',timeoutSeconds:0.03,noninteractive:false,protocolV2:true},{
  store:s,txn:{async commitIfAbsent(){commits++;return 'committed';},async removeIfMatch(){return 'already_absent';}},interactive:true,
  openBrowser:async url=>{
   const consent=new URL(url),callback=new URL(consent.searchParams.get('redirect_uri'));
   callback.searchParams.set('state',consent.searchParams.get('state'));callback.searchParams.set('code',secret());
   await new Promise((resolve,reject)=>get(callback,res=>{res.resume();res.on('end',resolve);}).on('error',reject));
  },
  fetchImpl:async(url)=>{
   const path=new URL(url).pathname;
   if(path.endsWith('/capabilities'))return response({schema_version:'capir-auth.v2',enabled:true,capabilities:Object.fromEntries(['auth.authorize','auth.exchange','auth.refresh','auth.status','auth.logout','auth.grants'].map(k=>[k,'supported'])),device_auth:'unsupported',scopes:c.grant.scopes,backend_origin:environment.backendOrigin,web_origin:environment.webOrigin,lifetimes:{code_seconds:60,access_seconds:900,refresh_idle_seconds:604800,refresh_absolute_seconds:2592000},unsupported:['device_auth']});
   if(path.endsWith('/exchange'))return response(c);
   if(path.endsWith('/status')){statusTimer=clock.timers.at(-1);statusStarted();return new Promise(()=>{});}
   if(path.endsWith('/logout')){
    revoked++;
    // The request timeout happened before this later cancellation.
    process.emit('SIGINT');
    return response({schema_version:'capir-auth.v2',revoked_grant_id:c.grant.id,revoked_at:new Date().toISOString()});
   }
   throw Error('Unexpected dispatch');
  },
 });
 const rejection=assert.rejects(login,error=>{
  assert.equal(error.code,'CAPIR_LOGIN_TIMEOUT');
  assert.deepEqual(error.clientState,{remote_revoked:true,local_minted_credential_absent:true});return true;
 });
 await ready;clock.beforeDeadline();statusTimer.fire();await rejection;
 assert.equal(clock.timers[0].fired,false);assert.equal(revoked,1);
 assert.equal(commits,0);assert.equal(s.value,null);assert.equal(s.writes,0);
});

it('post-mint timeout preserves failed remote-revoke evidence without persisting the token',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'capir-postmint-v2-'));dirs.push(dir);const s=store(),c=credentials();let revoked=0;
 const fetchImpl=async(url,init={})=>{const path=new URL(url).pathname;
 if(path.endsWith('/capabilities'))return response({schema_version:'capir-auth.v2',enabled:true,capabilities:Object.fromEntries(['auth.authorize','auth.exchange','auth.refresh','auth.status','auth.logout','auth.grants'].map(k=>[k,'supported'])),device_auth:'unsupported',scopes:c.grant.scopes,backend_origin:environment.backendOrigin,web_origin:environment.webOrigin,lifetimes:{code_seconds:60,access_seconds:900,refresh_idle_seconds:604800,refresh_absolute_seconds:2592000},unsupported:['device_auth']});
 if(path.endsWith('/exchange'))return response(c);
 if(path.endsWith('/logout')){revoked++;throw Error('revoke unavailable');}
 if(path.endsWith('/status'))return new Promise((_resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true}));
 throw Error('Unexpected dispatch');};
 await assert.rejects(runAuthLogin({environment,clientLabel:'Proof',timeoutSeconds:0.15,noninteractive:false,protocolV2:true},{store:s,txn:createCredentialTxn(s,join(dir,'mutex.sqlite')),interactive:true,fetchImpl,openBrowser:async url=>{const consent=new URL(url),callback=new URL(consent.searchParams.get('redirect_uri'));callback.searchParams.set('state',consent.searchParams.get('state'));callback.searchParams.set('code',secret());await fetch(callback);}}),error=>{assert.equal(error.code,'CAPIR_LOGIN_TIMEOUT');assert.deepEqual(error.clientState,{remote_revoked:false,local_minted_credential_absent:true});return true;});
 assert.equal(revoked,1);assert.equal(s.value,null);
});

it('browser opener failure exposes a public manual URL and keeps the same loopback request alive',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'capir-manual-v2-'));dirs.push(dir);const s=store(),c=credentials();let manual;
 const fetchImpl=async(url)=>{const path=new URL(url).pathname;
 if(path.endsWith('/capabilities'))return response({schema_version:'capir-auth.v2',enabled:true,capabilities:Object.fromEntries(['auth.authorize','auth.exchange','auth.refresh','auth.status','auth.logout','auth.grants'].map(k=>[k,'supported'])),device_auth:'unsupported',scopes:c.grant.scopes,backend_origin:environment.backendOrigin,web_origin:environment.webOrigin,lifetimes:{code_seconds:60,access_seconds:900,refresh_idle_seconds:604800,refresh_absolute_seconds:2592000},unsupported:['device_auth']});
 if(path.endsWith('/exchange'))return response(c);
 if(path.endsWith('/status'))return response({schema_version:'capir-auth.v2',state:'active',grant:c.grant,identity});throw Error('Unexpected dispatch');};
 const result=await runAuthLogin({environment,clientLabel:'Proof',timeoutSeconds:2,noninteractive:false,protocolV2:true},{store:s,txn:createCredentialTxn(s,join(dir,'mutex.sqlite')),interactive:true,fetchImpl,openBrowser:async()=>{throw Error('Opener unavailable');},onProgress:message=>{const line=message.split('\n').find(v=>v.startsWith('http://'));if(!line)return;manual=new URL(line);assert.equal(manual.origin,environment.webOrigin);for(const key of ['access_token','refresh_token','code_verifier','code'])assert.equal(manual.searchParams.has(key),false);const callback=new URL(manual.searchParams.get('redirect_uri'));callback.searchParams.set('state',manual.searchParams.get('state'));callback.searchParams.set('code',secret());void fetch(callback);}});
 assert.ok(manual);assert.equal(result.grant.id,c.grant.id);assert.equal(JSON.parse(s.value).credentials.access_token,c.access_token);
 const lateStore=store(),messages=[];
 await runAuthLogin({environment,clientLabel:'Proof',timeoutSeconds:2,noninteractive:false,protocolV2:true},{store:lateStore,txn:createCredentialTxn(lateStore,join(dir,'late-mutex.sqlite')),interactive:true,fetchImpl,onProgress:m=>messages.push(m),openBrowser:async url=>{const consent=new URL(url),callback=new URL(consent.searchParams.get('redirect_uri'));callback.searchParams.set('state',consent.searchParams.get('state'));callback.searchParams.set('code',secret());await fetch(callback);throw Error('Late opener exit');}});
 assert.equal(messages.some(message=>message.includes('/capir/authorize?')),false);
 assert.equal(JSON.parse(lateStore.value).credentials.access_token,c.access_token);
});

function persistentCredentials(expired=true) {
 const value=credentials(expired);
 return {...value,schema_version:'capir-auth.v3',grant:{...value.grant,refresh_expires_at:null,absolute_expires_at:null}};
}
function active(value) {return response({schema_version:value.schema_version,state:'active',grant:value.grant,identity});}
it('v3 lost refresh response resumes the same durable intent after restart without browser login',async()=>{
 const original=persistentCredentials(),s=store(serializeAuthRecord(environment,original));
 const successor={...persistentCredentials(false),grant:{...original.grant,access_expires_at:new Date(Date.now()+600000).toISOString()}};
 let requestId,refreshCalls=0;
 const transport=async(url,init)=>{
  if(new URL(url).pathname.endsWith('/refresh')) {
   const body=JSON.parse(init.body),pending=JSON.parse(s.value);
   assert.equal(body.schema_version,'capir-auth.v3');assert.equal(pending.pending_refresh.request_id,body.request_id);assert.equal(pending.refresh_inflight,true);
   assert.equal(body.refresh_token,original.refresh_token);refreshCalls++;
   if(!requestId){requestId=body.request_id;throw Error('response lost after server commit');}
   assert.equal(body.request_id,requestId);return response(successor);
  }
  return active(successor);
 };
 await assert.rejects(usableCredential(environment,s,transport),{code:'CAPIR_TRANSPORT'});
 const status=await authV2Status(environment,s,async()=>assert.fail('Pending status stays read-only'));
 assert.equal(status.state,'unverified');assert.equal(status.reason,'renewal_pending');
 const result=await usableCredential(environment,s,transport);
 assert.equal(result.token,successor.access_token);assert.equal(refreshCalls,2);
 assert.equal(JSON.parse(s.value).refresh_inflight,false);assert.equal(JSON.parse(s.value).pending_refresh,undefined);
});
it('v3 final keyring write failure preserves pending intent and recovers the exact response',async()=>{
 const original=persistentCredentials(),s=store(serializeAuthRecord(environment,original));
 const successor={...persistentCredentials(false),grant:{...original.grant,access_expires_at:new Date(Date.now()+600000).toISOString()}};
 let writes=0,id;
 const save=s.set.bind(s);s.set=async(value)=>{writes++;if(writes===2)throw Error('Keychain temporarily locked');await save(value);};
 const transport=async(url,init)=>{
  if(new URL(url).pathname.endsWith('/refresh')){const body=JSON.parse(init.body);if(id)assert.equal(body.request_id,id);id=body.request_id;return response(successor);}
  return active(successor);
 };
 await assert.rejects(usableCredential(environment,s,transport),/Keychain temporarily locked/);
 assert.equal(JSON.parse(s.value).refresh_inflight,true);assert.equal(JSON.parse(s.value).pending_refresh.request_id,id);
 const result=await usableCredential(environment,s,transport);assert.equal(result.token,successor.access_token);
});
it('an expired recovered receipt is committed before rotating its successor to current access',async()=>{
 const original=persistentCredentials(),s=store(serializeAuthRecord(environment,original));
 const receipt={...persistentCredentials(),grant:original.grant};
 const current={...persistentCredentials(false),grant:{...original.grant,access_expires_at:new Date(Date.now()+600000).toISOString()}};
 const pending=JSON.parse(s.value);pending.refresh_inflight=true;pending.pending_refresh={request_id:randomUUID(),protocol:'capir-auth.v3'};s.value=JSON.stringify(pending);
 const requests=[];
 const result=await usableCredential(environment,s,async(url,init)=>{
  if(new URL(url).pathname.endsWith('/refresh')) {const body=JSON.parse(init.body);requests.push(body);return response(requests.length===1 ? receipt : current);}
  return active(current);
 });
 assert.equal(requests.length,2);assert.equal(requests[0].request_id,pending.pending_refresh.request_id);assert.equal(requests[1].refresh_token,receipt.refresh_token);assert.notEqual(requests[0].request_id,requests[1].request_id);assert.equal(result.token,current.access_token);
});
it('v3 concurrent command resolution rotates once and leaves one stable keyring record',async()=>{
 const original=persistentCredentials(),s=store(serializeAuthRecord(environment,original));
 const current={...persistentCredentials(false),grant:{...original.grant,access_expires_at:new Date(Date.now()+600000).toISOString()}};let rotations=0;
 const transport=async(url)=>{if(new URL(url).pathname.endsWith('/refresh')){rotations++;await new Promise(r=>setTimeout(r,20));return response(current);}return active(current);};
 const [a,b]=await Promise.all([usableCredential(environment,s,transport),usableCredential(environment,s,transport)]);
 assert.equal(rotations,1);assert.equal(a.token,b.token);assert.equal(a.authority,b.authority);
});
it('read-only v3 status distinguishes renewable access expiry from a revoked authorization',async()=>{
 const value=persistentCredentials(),s=store(serializeAuthRecord(environment,value));
 const renewable=await authV2Status(environment,s,async()=>response({schema_version:'capir-auth.v3',state:'expired',grant:value.grant,identity}));
 assert.equal(renewable.state,'renewable');assert.equal(s.writes,0);
 const revoked=await authV2Status(environment,s,async()=>response({schema_version:'capir-auth.v3',state:'revoked',grant:{...value.grant,state:'revoked'},identity}));assert.equal(revoked.state,'revoked');assert.equal(s.writes,0);
});
it('explicit offline logout durably stops renewal and a later retry revokes then removes it',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'capir-persistent-logout-'));dirs.push(dir);
 const value=persistentCredentials(),s=store(serializeAuthRecord(environment,value)),txn=createCredentialTxn(s,join(dir,'mutex.sqlite'));
 await assert.rejects(runAuthLogout(environment,{store:s,txn,token:s.value,protocolV2:true,fetchImpl:async()=>{throw Error('offline');}}),{code:'CAPIR_TRANSPORT'});
 assert.equal(JSON.parse(s.value).logout_pending,true);
 await assert.rejects(usableCredential(environment,s,async()=>assert.fail('Signed-out record cannot renew')),{code:'CAPIR_LOGOUT_PENDING'});
 assert.equal((await authV2Status(environment,s,async()=>assert.fail('Signed-out status is local'))).state,'signed_out');
 await runAuthLogout(environment,{store:s,txn,token:s.value,protocolV2:true,fetchImpl:async()=>response({schema_version:'capir-auth.v2',revoked_grant_id:value.grant.id,revoked_at:new Date().toISOString()})});
 assert.equal(s.value,null);
});
it('v3 real dispatcher negotiates persistent consent, verifies and stores only in OS keyring',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'capir-persistent-dispatch-'));dirs.push(dir);writeEnvironment(dir,environment.name,environment.backendOrigin,environment.webOrigin);
 const value=persistentCredentials(false),s=store();let browser=0;
 const transport=async(url,init={})=>{
  const parsed=new URL(url),path=parsed.pathname;
  if(path.endsWith('/capabilities')){assert.equal(parsed.searchParams.get('schema_version'),'capir-auth.v3');return response({schema_version:'capir-auth.v3',enabled:true,capabilities:Object.fromEntries(['auth.authorize','auth.exchange','auth.refresh','auth.status','auth.logout','auth.grants'].map(k=>[k,'supported'])),device_auth:'unsupported',scopes:value.grant.scopes,backend_origin:environment.backendOrigin,web_origin:environment.webOrigin,lifetimes:{code_seconds:60,access_seconds:900,refresh_idle_seconds:null,refresh_absolute_seconds:null},unsupported:['device_auth']});}
  if(path.endsWith('/exchange')){assert.equal(JSON.parse(init.body).schema_version,'capir-auth.v3');return response(value);}
  if(path.endsWith('/status'))return active(value);
  assert.fail('Unexpected path '+path);
 };
 const deps={env:{CAPIR_CONFIG_DIR:dir},credentialStore:()=>s,credentialTxn:()=>createCredentialTxn(s,join(dir,'mutex.sqlite')),fetchImpl:transport,interactive:true,sleep:async()=>{},openBrowser:async url=>{browser++;const consent=new URL(url);assert.equal(consent.searchParams.get('schema_version'),'capir-auth.v3');const callback=new URL(consent.searchParams.get('redirect_uri'));callback.searchParams.set('state',consent.searchParams.get('state'));callback.searchParams.set('code',secret());await fetch(callback);}};
 const login=await runCli(['auth','login','--env','v2','--json'],deps);assert.equal(login.exitCode,0,login.output);assert.equal(JSON.parse(s.value).version,'capir-auth.v3');assert.ok(!login.output.includes(value.refresh_token));assert.ok(!login.output.includes(value.access_token));
 const reused=await runCli(['auth','login','--env','v2','--json'],deps);assert.equal(reused.exitCode,0,reused.output);assert.equal(JSON.parse(reused.output).reused,true);assert.equal(browser,1);
});

it('auth login preserves a v3 record during a server rollback and resumes it when v3 returns',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'capir-protocol-rollback-'));dirs.push(dir);writeEnvironment(dir,environment.name,environment.backendOrigin,environment.webOrigin);
 const original=persistentCredentials(),raw=serializeAuthRecord(environment,original,identity),s=store(raw);
 const current={...persistentCredentials(false),grant:{...original.grant,access_expires_at:new Date(Date.now()+600000).toISOString()}};
 let protocol='capir-auth.v2',refreshes=0,browser=0;
 const transport=async(url,init={})=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/capabilities'))return response({schema_version:protocol,enabled:true,capabilities:Object.fromEntries(['auth.authorize','auth.exchange','auth.refresh','auth.status','auth.logout','auth.grants'].map(k=>[k,'supported'])),device_auth:'unsupported',scopes:original.grant.scopes,backend_origin:environment.backendOrigin,web_origin:environment.webOrigin,lifetimes:{code_seconds:60,access_seconds:900,refresh_idle_seconds:protocol==='capir-auth.v3'?null:604800,refresh_absolute_seconds:protocol==='capir-auth.v3'?null:2592000},unsupported:['device_auth']});
  if(path.endsWith('/refresh')){refreshes++;const body=JSON.parse(init.body);assert.equal(body.schema_version,'capir-auth.v3');assert.ok(body.request_id);return response(current);}
  if(path.endsWith('/status'))return active(current);
  assert.fail('Rollback must not dispatch logout, consent or exchange: '+path);
 };
 const deps={env:{CAPIR_CONFIG_DIR:dir},credentialStore:()=>s,credentialTxn:()=>createCredentialTxn(s,join(dir,'mutex.sqlite')),fetchImpl:transport,interactive:true,sleep:async()=>{},openBrowser:async()=>{browser++;assert.fail('A server rollback does not invalidate saved v3 consent');}};
 const unavailable=await runCli(['auth','login','--env','v2','--json'],deps);
 assert.notEqual(unavailable.exitCode,0);assert.equal(JSON.parse(unavailable.output).error.code,'CAPIR_AUTH_PROTOCOL_UNAVAILABLE');
 assert.equal(s.value,raw);assert.equal(s.writes,0);assert.equal(refreshes,0);assert.equal(browser,0);
 protocol='capir-auth.v3';
 const recovered=await runCli(['auth','login','--env','v2','--json'],deps);
 assert.equal(recovered.exitCode,0,recovered.output);assert.equal(JSON.parse(recovered.output).reused,true);
 assert.equal(JSON.parse(s.value).version,'capir-auth.v3');assert.equal(JSON.parse(s.value).credentials.grant.id,original.grant.id);
 assert.equal(JSON.parse(s.value).refresh_inflight,false);assert.equal(refreshes,1);assert.equal(browser,0);
});

it('server rollback cannot rewrite an already committed v3 refresh intent',async()=>{
 const value=persistentCredentials(),record=JSON.parse(serializeAuthRecord(environment,value,identity));
 record.refresh_inflight=true;record.pending_refresh={request_id:randomUUID(),protocol:'capir-auth.v3'};
 const raw=JSON.stringify(record),s=store(raw);
 await assert.rejects(usableCredential(environment,s,async()=>assert.fail('No refresh may be sent to the incompatible server'),{protocol:'capir-auth.v2'}),error=>error.code==='CAPIR_AUTH_PROTOCOL_UNAVAILABLE');
 assert.equal(s.value,raw);assert.equal(s.writes,0);
 const current={...persistentCredentials(false),grant:{...value.grant,access_expires_at:new Date(Date.now()+600000).toISOString()}};
 await usableCredential(environment,s,async(url,init={})=>{
  if(new URL(url).pathname.endsWith('/refresh')){assert.equal(JSON.parse(init.body).request_id,record.pending_refresh.request_id);return response(current);}
  return active(current);
 },{protocol:'capir-auth.v3'});
 assert.equal(JSON.parse(s.value).refresh_inflight,false);assert.equal(JSON.parse(s.value).credentials.grant.id,value.grant.id);
});

it('explicit logout serializes behind in-flight renewal and removes that same grant successor',async()=>{
 const original=persistentCredentials(),initial=serializeAuthRecord(environment,original),s=store(initial);
 const current={...persistentCredentials(false),grant:{...original.grant,access_expires_at:new Date(Date.now()+600000).toISOString()}};
 let started,release;const ready=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 let revoked=false;
 const transport=async(url,init)=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/refresh')){started();await gate;return response(current);}
  if(path.endsWith('/logout')){const body=JSON.parse(init.body);assert.equal(body.refresh_token,current.refresh_token);assert.equal(JSON.parse(s.value).logout_pending,true);revoked=true;return response({schema_version:'capir-auth.v2',revoked_grant_id:original.grant.id,revoked_at:new Date().toISOString()});}
  return active(current);
 };
 const renewing=usableCredential(environment,s,transport);await ready;
 const txn=createCredentialTxn(s,credentialMutexPath(KEYRING_SERVICE,keyringUsername(environment.backendOrigin,environment.webOrigin)));
 const signingOut=runAuthLogout(environment,{store:s,txn,token:initial,protocolV2:true,fetchImpl:transport});
 release();await renewing;const result=await signingOut;
 assert.equal(revoked,true);assert.equal(result.local_credential_removed,true);assert.equal(s.value,null);
});
