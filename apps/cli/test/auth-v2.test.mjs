import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after,it} from 'node:test';
import {runCli} from '../dist/run.js';
import {runAuthLogin} from '../dist/login.js';
import {runAuthLogout} from '../dist/auth.js';
import {authV2Status,usableCredential,serializeAuthRecord} from '../dist/authV2.js';
import {createCredentialTxn} from '../dist/keyring.js';
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
