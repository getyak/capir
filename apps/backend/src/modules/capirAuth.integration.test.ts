/** Real-route protocol proof. PKCE is independently produced with Node's
 * base64url digest, never the implementation helper. Fixtures are synthetic
 * and confined to an explicitly owned loopback PostgreSQL database. */
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {CapirAuthService} from './capirAuth.js';
import {beforeAll,beforeEach,afterEach,afterAll,describe,it,expect} from 'vitest';
import {buildApp} from '../app.js';
import {encodePasswordCredential} from './passwordCredential.js';
import {LocalChatMediaStorage} from './chatMediaStorage.js';
import {resolveMcpGrant} from './mcpGrants.js';
import {operatorTestDeployment} from './labWorkspaceAccess.js';
import {LabWorkspaceService} from './labWorkspaces.js';
const database=process.env.CAPIR_AUTH_TEST_DATABASE_URL;
if(database && !['localhost','127.0.0.1'].includes(new URL(database).hostname)) throw new Error('Use an owned disposable loopback DB.');
const pool=database ? new Pool({connectionString:database,max:8,statement_timeout:15000}):null;
const backend='https://auth-api.test.invalid',web='https://auth-web.test.invalid';
const media=process.env.CAPIR_TEST_MEDIA_DIRECTORY??`/tmp/capir-auth-${randomUUID()}`;
const account=randomUUID(),user=randomUUID(),email=`auth-${randomUUID()}@example.invalid`,password=randomBytes(24).toString('base64url');
const operator=randomBytes(32).toString('base64url'),consumer=randomBytes(32).toString('base64url');
let app:Awaited<ReturnType<typeof buildApp>>,browserToken:string;
process.env.TALENT_SIGNAL_MCP_PUBLIC_ORIGIN=web;
const settings={databaseUrl:database!,host:'127.0.0.1',port:0,allowedOrigins:[web],appleSignInAudiences:[],appleSignInEnabled:false,
 simulatedAuthEnabled:false,passwordAuthEnabled:true,passwordRegistrationEnabled:false,internalLabEnabled:true,retentionSweepIntervalMs:60000,sessionTtlSeconds:3600,
 chatMediaStorage:{provider:'local' as const,directory:media},
 capirAuth:{enabled:true,webOrigin:web,backendOrigin:backend,codeTtlSeconds:60,accessTtlSeconds:60,refreshIdleTtlSeconds:600,refreshAbsoluteTtlSeconds:3600},
 capirTests:{enabled:true,provisioningKey:operator,provisioningGeneration:1,webOrigin:web,backendOrigin:backend,webConsumerKey:consumer,maxActiveRuns:8}};
const secret=()=>randomBytes(32).toString('base64url');
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
async function makeApp(config=settings){return buildApp({pool:pool!,config,chatMediaStorage:new LocalChatMediaStorage(media),remoteChatProvider:null,
 personResearchProvider:null,privateConversationProvider:null,labProviders:new Map(),labJobWorkerEnabled:false,conversationQueueWorkerEnabled:false,labCIVerifier:null,screenshotContact:null});}
async function login(){const r=await app.inject({method:'POST',url:'/v1/auth/password/login',payload:{identifier:email,password,client_label:'auth-proof-browser'}});expect(r.statusCode).toBe(200);return r.json().access_token as string;}
async function code(scopes=['grants.read','grants.revoke'],protocol:'capir-auth.v2'|'capir-auth.v3'='capir-auth.v2') {
 const verifier=secret(),state=secret(),redirect_uri='http://127.0.0.1:49381/capir/callback';
 const r=await app.inject({method:'POST',url:'/v1/capir/auth/authorize',headers:{authorization:`Bearer ${browserToken}`},payload:{schema_version:protocol,redirect_uri,state,
 code_challenge:createHash('sha256').update(verifier,'ascii').digest('base64url'),code_challenge_method:'S256',web_origin:web,backend_origin:backend,scopes,consent:true,client_label:'GET-139 proof'}});
 expect(r.statusCode,r.body).toBe(200);
 return {schema_version:protocol,code:r.json().code,code_verifier:verifier,state,redirect_uri,web_origin:web,backend_origin:backend};
}
async function grant(scopes?:string[],protocol:'capir-auth.v2'|'capir-auth.v3'='capir-auth.v2') {const r=await app.inject({method:'POST',url:'/v1/capir/auth/exchange',payload:await code(scopes,protocol)});expect(r.statusCode,r.body).toBe(200);return r.json();}
async function status(token:string){return app.inject({method:'GET',url:'/v1/capir/auth/status',headers:{authorization:`Bearer ${token}`}});}
async function entitlement(state='active') {await pool!.query(`INSERT INTO capir_user_test_entitlements(id,account_id,user_id,scopes,state,granted_by,revoked_at)
 VALUES($1,$2,$3,ARRAY['test.create','test.status','test.stop','test.handoff'],$4,'synthetic GET-139 proof',CASE WHEN $4='revoked' THEN now() END)
 ON CONFLICT(account_id,user_id) DO UPDATE SET state=$4,generation=capir_user_test_entitlements.generation+1,revoked_at=CASE WHEN $4='revoked' THEN now() END`,[randomUUID(),account,user,state]);}
const testScopes=['grants.read','grants.revoke','test.create','test.status','test.stop','test.handoff'];
async function createRun(token:string){const password=secret();const r=await app.inject({method:'POST',url:'/v1/capir/tests',headers:{authorization:`Bearer ${token}`,'x-capir-backend-origin':backend},payload:{request_id:randomUUID(),password,preset:'empty',duration_hours:1,web_origin:web,backend_origin:backend}});expect(r.statusCode,r.body).toBe(200);return {run:r.json().run,password};}
describe.skipIf(!pool)('capir-auth.v2 real routes',()=>{
 beforeAll(async()=>{const c=await pool!.connect();try {await c.query('BEGIN');await c.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic auth proof')",[account,`auth-${account}`]);await c.query("INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES($1,'owned',$2,$3)",[email,account,user]);await c.query("INSERT INTO users(id,account_id,email,display_name,kind,username) VALUES($1,$2,$3,'Auth proof','password_human',$3)",[user,account,email]);await c.query('INSERT INTO password_credentials(account_id,user_id,password_scrypt) VALUES($1,$2,$3)',[account,user,await encodePasswordCredential(password)]);await c.query('COMMIT');}finally{c.release();}},30000);
 beforeEach(async()=>{await pool!.query('DELETE FROM capir_user_test_entitlements WHERE account_id=$1 AND user_id=$2',[account,user]);app=await makeApp();await app.ready();browserToken=await login();},30000);
 afterEach(async()=>{await app?.close();});
 afterAll(async()=>{if(!pool)return;const rows=await pool.query<{id:string}>("SELECT id FROM lab_test_workspaces WHERE owner_account_id=$1 AND state<>'deleted'",[account]);const service=new LabWorkspaceService(pool,new LocalChatMediaStorage(media),3600);for(const row of rows.rows)await service.stopOperatorRun(row.id,randomUUID());await pool.end();},60000);
 it('negotiates persistent CLI grants while legacy discovery and grants keep finite deadlines',async()=>{
  const legacy=(await app.inject({method:'GET',url:'/v1/capir/auth/capabilities'})).json();
  const persistent=(await app.inject({method:'GET',url:'/v1/capir/auth/capabilities?schema_version=capir-auth.v3'})).json();
  expect(legacy.schema_version).toBe('capir-auth.v2');expect(legacy.lifetimes.refresh_absolute_seconds).toBe(3600);
  expect(persistent.schema_version).toBe('capir-auth.v3');expect(persistent.lifetimes.refresh_idle_seconds).toBeNull();expect(persistent.lifetimes.refresh_absolute_seconds).toBeNull();
  const g=await grant(undefined,'capir-auth.v3');expect(g.grant.absolute_expires_at).toBeNull();expect(g.grant.refresh_expires_at).toBeNull();
  expect((await app.inject({method:'GET',url:'/v1/auth/session',headers:{authorization:`Bearer ${g.access_token}`}})).statusCode).toBe(401);
 });
 it('recovers the exact committed v3 refresh response and still revokes a different replay intent',async()=>{
  const g=await grant(undefined,'capir-auth.v3');
  const request={schema_version:'capir-auth.v3',refresh_token:g.refresh_token,request_id:randomUUID(),web_origin:web,backend_origin:backend};
  const first=await app.inject({method:'POST',url:'/v1/capir/auth/refresh',payload:request});expect(first.statusCode,first.body).toBe(200);
  const retry=await app.inject({method:'POST',url:'/v1/capir/auth/refresh',payload:request});expect(retry.statusCode,retry.body).toBe(200);expect(retry.json()).toEqual(first.json());
  const rows=(await pool!.query('SELECT token_hash,request_id_hash FROM capir_auth_refresh_tokens WHERE grant_id=$1',[g.grant.id])).rows;
  expect(rows).toHaveLength(2);expect(rows.some(row=>row.request_id_hash===hash(request.request_id))).toBe(true);
  expect(JSON.stringify(rows)).not.toContain(g.refresh_token);expect(JSON.stringify(rows)).not.toContain(first.json().refresh_token);
  const replay=await app.inject({method:'POST',url:'/v1/capir/auth/refresh',payload:{...request,request_id:randomUUID()}});
  expect(replay.json().error.code).toBe('CAPIR_REFRESH_REPLAY');expect((await status(first.json().access_token)).json().state).toBe('revoked');
 });
 it('serializes two identical v3 intents into one successor generation',async()=>{
  const g=await grant(undefined,'capir-auth.v3');const payload={schema_version:'capir-auth.v3',refresh_token:g.refresh_token,request_id:randomUUID(),web_origin:web,backend_origin:backend};
  const [a,b]=await Promise.all([app.inject({method:'POST',url:'/v1/capir/auth/refresh',payload}),app.inject({method:'POST',url:'/v1/capir/auth/refresh',payload})]);
  expect(a.statusCode,a.body).toBe(200);expect(b.statusCode,b.body).toBe(200);expect(a.json()).toEqual(b.json());
  expect((await pool!.query('SELECT count(*)::int AS n FROM capir_auth_refresh_tokens WHERE grant_id=$1',[g.grant.id])).rows[0].n).toBe(2);
 });
 it('requires a v3 refresh intent without consuming the credential or revoking its grant',async()=>{
  const g=await grant(undefined,'capir-auth.v3');const response=await app.inject({method:'POST',url:'/v1/capir/auth/refresh',payload:{schema_version:'capir-auth.v3',refresh_token:g.refresh_token,web_origin:web,backend_origin:backend}});
  expect(response.statusCode).toBe(400);expect(response.json().error.code).toBe('CAPIR_REFRESH_INTENT_REQUIRED');expect((await status(g.access_token)).json().state).toBe('active');
 });
 it('renews v3 after years of inactivity without widening generic bearer admission',async()=>{
  const g=await grant(undefined,'capir-auth.v3');
  await pool!.query("UPDATE capir_auth_grants SET created_at=now()-interval '10 years',access_expires_at=now()-interval '9 years' WHERE id=$1",[g.grant.id]);
  await pool!.query("UPDATE sessions SET expires_at=now()-interval '9 years' WHERE id=(SELECT backing_session_id FROM capir_auth_grants WHERE id=$1)",[g.grant.id]);
  const r=await app.inject({method:'POST',url:'/v1/capir/auth/refresh',payload:{schema_version:'capir-auth.v3',refresh_token:g.refresh_token,request_id:randomUUID(),web_origin:web,backend_origin:backend}});
  expect(r.statusCode,r.body).toBe(200);expect(r.json().grant.id).toBe(g.grant.id);expect(r.json().grant.absolute_expires_at).toBeNull();
  expect((await status(r.json().access_token)).json().state).toBe('active');
 });
 it('upgrades a still-live v2 grant in place and never revives an expired legacy grant',async()=>{
  const g=await grant();const refresh=(token:string)=>app.inject({method:'POST',url:'/v1/capir/auth/refresh',payload:{schema_version:'capir-auth.v3',refresh_token:token,request_id:randomUUID(),web_origin:web,backend_origin:backend}});
  const upgraded=await refresh(g.refresh_token);expect(upgraded.statusCode,upgraded.body).toBe(200);expect(upgraded.json().grant.id).toBe(g.grant.id);expect(upgraded.json().grant.scopes).toEqual(g.grant.scopes);expect(upgraded.json().grant.absolute_expires_at).toBeNull();
  const expired=await grant();await pool!.query("UPDATE capir_auth_refresh_tokens SET expires_at=now()-interval '1 second' WHERE grant_id=$1",[expired.grant.id]);
  expect((await refresh(expired.refresh_token)).json().error.code).toBe('CAPIR_REFRESH_EXPIRED');
 });
 it('keeps a persistent CLI parent usable while its scoped Lab run still expires',async()=>{
  await entitlement();const g=await grant(testScopes,'capir-auth.v3');const {run,password}=await createRun(g.access_token);
  await pool!.query("UPDATE sessions SET expires_at=now()-interval '1 day' WHERE id=(SELECT backing_session_id FROM capir_auth_grants WHERE id=$1)",[g.grant.id]);
  const admitted=await app.inject({method:'POST',url:'/v1/auth/password/login',payload:{identifier:run.username,password,client_label:'Persistent CLI scoped run'}});
  expect(admitted.statusCode,admitted.body).toBe(200);const token=admitted.json().access_token;
  expect((await app.inject({method:'GET',url:'/v1/auth/session',headers:{authorization:`Bearer ${token}`}})).statusCode).toBe(200);
  const expiry=(await pool!.query('SELECT e.expires_at<=w.expires_at AS bounded FROM lab_test_workspace_entries e JOIN lab_test_workspaces w ON w.id=e.workspace_id WHERE e.session_id=(SELECT id FROM sessions WHERE token_hash=$1)',[hash(token)])).rows[0];expect(expiry.bounded).toBe(true);
  await pool!.query("UPDATE lab_test_workspaces SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[run.id]);
  expect((await app.inject({method:'GET',url:'/v1/auth/session',headers:{authorization:`Bearer ${token}`}})).statusCode).toBe(401);
  expect((await status(g.access_token)).json().state).toBe('active');
 });
 it('binds a v3 authorization code to its negotiated protocol before minting',async()=>{
  const proof=await code(undefined,'capir-auth.v3');
  const rejected=await app.inject({method:'POST',url:'/v1/capir/auth/exchange',payload:{...proof,schema_version:'capir-auth.v2'}});
  expect(rejected.statusCode,rejected.body).toBe(401);expect(rejected.json().error.code).toBe('CAPIR_AUTH_PROOF_INVALID');
  expect((await app.inject({method:'POST',url:'/v1/capir/auth/exchange',payload:proof})).json().error.code).toBe('CAPIR_AUTH_CODE_REPLAY');
 });
 it('does not revoke the current grant when an exact completed intent is superseded',async()=>{
  const g=await grant(undefined,'capir-auth.v3');const first={schema_version:'capir-auth.v3',refresh_token:g.refresh_token,request_id:randomUUID(),web_origin:web,backend_origin:backend};
  const a=await app.inject({method:'POST',url:'/v1/capir/auth/refresh',payload:first});expect(a.statusCode,a.body).toBe(200);
  const b=await app.inject({method:'POST',url:'/v1/capir/auth/refresh',payload:{...first,refresh_token:a.json().refresh_token,request_id:randomUUID()}});expect(b.statusCode,b.body).toBe(200);
  const stale=await app.inject({method:'POST',url:'/v1/capir/auth/refresh',payload:first});expect(stale.statusCode).toBe(409);expect(stale.json().error.code).toBe('CAPIR_REFRESH_SUPERSEDED');expect((await status(b.json().access_token)).json().state).toBe('active');
 });
 it('orders refresh, revoke and a queued account mutation without a grant/account deadlock',async()=>{
  const g=await grant(undefined,'capir-auth.v3');
  const defer=()=>{let resolve!:()=>void;return {promise:new Promise<void>(done=>{resolve=done;}),resolve:()=>resolve()};};
  const refreshAccount=defer(),releaseRefresh=defer(),revokeAccountAttempt=defer();
  const refreshPool=new Pool({connectionString:database,max:1,statement_timeout:5000});
  const revokePool=new Pool({connectionString:database,max:1,statement_timeout:5000});
  const admin=await pool!.connect();let adminOpen=false;
  const wrapped=(source:Pool,kind:'refresh'|'revoke')=>({connect:async()=>{
    const connection=await source.connect();let outerAccount=false;
    return new Proxy(connection,{get(target,key){
      if(key==='query')return async(...args:unknown[])=>{
        const sql=String(args[0]).replace(/\s+/g,' ');
        const accountLock=/FROM accounts WHERE id ?= ?\$1 FOR SHARE/.test(sql);
        if(accountLock && kind==='revoke')revokeAccountAttempt.resolve();
        if(/capir_auth_grants.*FOR UPDATE/.test(sql))expect(outerAccount).toBe(true);
        const result=await (target.query as (...parameters:unknown[])=>Promise<unknown>).apply(target,args);
        if(accountLock){outerAccount=true;if(kind==='refresh'){refreshAccount.resolve();await releaseRefresh.promise;}}
        return result;
      };
      const value=Reflect.get(target,key,target);return typeof value==='function' ? value.bind(target) : value;
    }}) as PoolClient;
  }}) as unknown as Pool;
  let refreshing:Promise<unknown>|undefined,revoking:Promise<unknown>|undefined;
  try {
    refreshing=new CapirAuthService(wrapped(refreshPool,'refresh'),settings).refresh({schema_version:'capir-auth.v3',refresh_token:g.refresh_token,request_id:randomUUID(),web_origin:web,backend_origin:backend});
    void refreshing.catch(()=>{});await refreshAccount.promise;
    await admin.query('BEGIN');adminOpen=true;
    const adminPid=(await admin.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    const mutation=admin.query('UPDATE accounts SET name=name WHERE id=$1',[account]);void mutation.catch(()=>{});
    let blocked=false;
    for(let attempt=0;attempt<100 && !blocked;attempt++){
      blocked=(await pool!.query<{blocked:boolean}>('SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',[adminPid])).rows[0]!.blocked;
      if(!blocked)await new Promise(resolve=>setTimeout(resolve,10));
    }
    expect(blocked).toBe(true);
    revoking=new CapirAuthService(wrapped(revokePool,'revoke'),settings).logout({refreshToken:g.refresh_token});
    void revoking.catch(()=>{});await revokeAccountAttempt.promise;
    releaseRefresh.resolve();await refreshing.catch(error=>expect(error.code).toBe('CAPIR_GRANT_REVOKED'));
    await mutation;await admin.query('COMMIT');adminOpen=false;
    await revoking;
    expect((await pool!.query('SELECT state FROM capir_auth_grants WHERE id=$1',[g.grant.id])).rows[0].state).toBe('revoked');
  } finally {
    releaseRefresh.resolve();if(adminOpen)await admin.query('ROLLBACK');admin.release();
    await Promise.allSettled([refreshing,revoking]);await Promise.all([refreshPool.end(),revokePool.end()]);
  }
 },15000);
 it('reports a retired account as revoked and refuses persistent renewal',async()=>{
  const retiredAccount=randomUUID(),retiredUser=randomUUID(),retiredEmail=`retired-${randomUUID()}@example.invalid`;
  const fixture=await pool!.connect();
  try {await fixture.query('BEGIN');
  await fixture.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Disposable retired auth proof')",[retiredAccount,`retired-${retiredAccount}`]);
  await fixture.query("INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES($1,'owned',$2,$3)",[retiredEmail,retiredAccount,retiredUser]);
  await fixture.query("INSERT INTO users(id,account_id,email,display_name,kind,username) VALUES($1,$2,$3,'Retired auth proof','password_human',$3)",[retiredUser,retiredAccount,retiredEmail]);
  await fixture.query('INSERT INTO password_credentials(account_id,user_id,password_scrypt) SELECT $1,$2,password_scrypt FROM password_credentials WHERE account_id=$3 AND user_id=$4',[retiredAccount,retiredUser,account,user]);
  await fixture.query('COMMIT');}catch(error){await fixture.query('ROLLBACK');throw error;}finally{fixture.release();}
  const signedIn=await app.inject({method:'POST',url:'/v1/auth/password/login',payload:{identifier:retiredEmail,password,client_label:'Retired account proof'}});expect(signedIn.statusCode,signedIn.body).toBe(200);
  const previous=browserToken;browserToken=signedIn.json().access_token;let g;
  try {g=await grant(undefined,'capir-auth.v3');} finally {browserToken=previous;}
  await pool!.query('UPDATE accounts SET retired_at=clock_timestamp() WHERE id=$1',[retiredAccount]);
  expect((await status(g.access_token)).json().state).toBe('revoked');
  const renewed=await app.inject({method:'POST',url:'/v1/capir/auth/refresh',payload:{schema_version:'capir-auth.v3',refresh_token:g.refresh_token,request_id:randomUUID(),web_origin:web,backend_origin:backend}});
  expect(renewed.json().error.code).toBe('ACCOUNT_RETIRED');
 });
 it('keeps revocation and membership withdrawal terminal for persistent CLI refresh',async()=>{
  const g=await grant(undefined,'capir-auth.v3');
  await pool!.query('UPDATE sessions SET revoked_at=now() WHERE id=(SELECT backing_session_id FROM capir_auth_grants WHERE id=$1)',[g.grant.id]);
  const payload={schema_version:'capir-auth.v3',refresh_token:g.refresh_token,request_id:randomUUID(),web_origin:web,backend_origin:backend};
  expect((await app.inject({method:'POST',url:'/v1/capir/auth/refresh',payload})).json().error.code).toBe('CAPIR_GRANT_REVOKED');
  const another=await grant(undefined,'capir-auth.v3');
  await pool!.query("UPDATE users SET status='revoked' WHERE account_id=$1 AND id=$2",[account,user]);
  try {expect((await app.inject({method:'POST',url:'/v1/capir/auth/refresh',payload:{...payload,refresh_token:another.refresh_token,request_id:randomUUID()}})).json().error.code).toBe('CAPIR_GRANT_REVOKED');}
  finally {await pool!.query("UPDATE users SET status='active' WHERE account_id=$1 AND id=$2",[account,user]);}
 });
 it('mints scoped credentials with standards PKCE, no general workspace bearer and independent browser logout',async()=>{
  const g=await grant();expect(g.schema_version).toBe('capir-auth.v2');expect(g.refresh_token).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(g.grant.scopes).toEqual(['grants.read','grants.revoke']);
  expect((await status(g.access_token)).json().state).toBe('active');
  expect((await app.inject({method:'GET',url:'/v1/auth/session',headers:{authorization:`Bearer ${g.access_token}`}})).statusCode).toBe(401);
  await pool!.query('UPDATE sessions SET revoked_at=now() WHERE token_hash=$1',[hash(browserToken)]);
  expect((await status(g.access_token)).json().state).toBe('active');
  const stored=(await pool!.query('SELECT access_token_hash FROM capir_auth_grants WHERE id=$1',[g.grant.id])).rows[0];expect(stored.access_token_hash).toBe(hash(g.access_token));
 });
 it('commits bad-proof code consumption and refuses replay',async()=>{const proof=await code();const bad=await app.inject({method:'POST',url:'/v1/capir/auth/exchange',payload:{...proof,code_verifier:secret()}});expect(bad.statusCode).toBe(401);expect((await app.inject({method:'POST',url:'/v1/capir/auth/exchange',payload:proof})).json().error.code).toBe('CAPIR_AUTH_CODE_REPLAY');});
 it('rotates refresh and commits whole-family revocation on replay',async()=>{const g=await grant();const payload={schema_version:'capir-auth.v2',refresh_token:g.refresh_token,web_origin:web,backend_origin:backend};const rotated=await app.inject({method:'POST',url:'/v1/capir/auth/refresh',payload});expect(rotated.statusCode,rotated.body).toBe(200);expect(rotated.json().grant.id).toBe(g.grant.id);expect(rotated.json().refresh_token).not.toBe(g.refresh_token);expect((await app.inject({method:'POST',url:'/v1/capir/auth/refresh',payload})).json().error.code).toBe('CAPIR_REFRESH_REPLAY');expect((await status(rotated.json().access_token)).json().state).toBe('revoked');expect((await pool!.query('SELECT state FROM capir_auth_grants WHERE id=$1',[g.grant.id])).rows[0].state).toBe('revoked');});
 it('status is read-only; expired access logs out by refresh proof without rotation',async()=>{const g=await grant();await pool!.query("UPDATE capir_auth_grants SET access_expires_at=now()-interval '1 second' WHERE id=$1",[g.grant.id]);expect((await status(g.access_token)).json().state).toBe('expired');expect((await pool!.query('SELECT count(*)::int AS n FROM capir_auth_refresh_tokens WHERE grant_id=$1',[g.grant.id])).rows[0].n).toBe(1);expect((await app.inject({method:'POST',url:'/v1/capir/auth/logout',payload:{schema_version:'capir-auth.v2',refresh_token:g.refresh_token}})).statusCode).toBe(200);expect((await status(g.access_token)).json().state).toBe('revoked');});
 it('denies test scopes by default even for a real user; freezes consent scopes',async()=>{const r=await app.inject({method:'GET',url:'/v1/capir/auth/context',headers:{authorization:`Bearer ${browserToken}`}});expect(r.json().scopes).toEqual(['grants.read','grants.revoke']);const g=await grant();await entitlement();const denied=await app.inject({method:'POST',url:'/v1/capir/tests',headers:{authorization:`Bearer ${g.access_token}`},payload:{request_id:randomUUID(),password:secret(),preset:'empty',duration_hours:1,web_origin:web,backend_origin:backend}});expect(denied.statusCode).toBe(403);});
 it('keeps old entries revoked after entitlement regrant; re-login owns prior runs, new handoff belongs to current grant',async()=>{
  await entitlement();const first=await grant(testScopes);const {run,password}=await createRun(first.access_token);
  const passwordLogin=await app.inject({method:'POST',url:'/v1/auth/password/login',payload:{identifier:run.username,password,client_label:'proof-entry'}});expect(passwordLogin.statusCode,passwordLogin.body).toBe(200);
  const entry=passwordLogin.json().access_token;
  const mcp=await app.inject({method:'POST',url:'/v1/mcp/clients',headers:{authorization:`Bearer ${entry}`},payload:{name:'Synthetic lineage proof',scopes:['workspace_metadata_read'],expires_in_days:1,idempotency_key:randomUUID()}});
  expect(mcp.statusCode,mcp.body).toBe(201);
  const mcpToken=mcp.json().token;
  expect(await resolveMcpGrant(pool!,`Bearer ${mcpToken}`,{operatorTestDeployment:operatorTestDeployment(settings)})).not.toBeNull();
  await entitlement('revoked');expect((await app.inject({method:'GET',url:'/v1/auth/session',headers:{authorization:`Bearer ${entry}`}})).statusCode).toBe(401);
  await entitlement();expect((await app.inject({method:'GET',url:'/v1/auth/session',headers:{authorization:`Bearer ${entry}`}})).statusCode).toBe(401);
  const newer=await grant(testScopes);const headers={authorization:`Bearer ${newer.access_token}`,'x-capir-backend-origin':backend};
  expect((await app.inject({method:'GET',url:`/v1/capir/tests/${run.id}`,headers})).statusCode).toBe(200);
  const legacy=await app.inject({method:'POST',url:`/v1/lab/workspaces/${run.id}/entries`,headers:{authorization:`Bearer ${browserToken}`},payload:{id:randomUUID(),access_token:secret()}});expect(legacy.statusCode).toBe(403);
  const handoff=await app.inject({method:'POST',url:`/v1/capir/tests/${run.id}/handoffs`,headers,payload:{request_id:randomUUID()}});expect(handoff.statusCode,handoff.body).toBe(200);
  const exchanged=await app.inject({method:'POST',url:'/v1/capir/tests/handoffs/exchange',headers:{'x-capir-web-consumer-key':consumer},payload:{handoff_secret:handoff.json().handoff_secret,web_origin:web}});expect(exchanged.statusCode,exchanged.body).toBe(200);
  expect(await resolveMcpGrant(pool!,`Bearer ${mcpToken}`,{operatorTestDeployment:operatorTestDeployment(settings)})).toBeNull();
  const currentEntry=exchanged.json().session.access_token;expect((await app.inject({method:'GET',url:'/v1/auth/session',headers:{authorization:`Bearer ${currentEntry}`}})).statusCode).toBe(200);
  for (const disabledConfig of [{...settings,internalLabEnabled:false},{...settings,capirTests:{...settings.capirTests,enabled:false}},{...settings,capirAuth:{...settings.capirAuth,enabled:false}}]) {
    const disabledApp=await makeApp(disabledConfig);
    expect((await disabledApp.inject({method:'GET',url:'/v1/auth/session',headers:{authorization:`Bearer ${currentEntry}`}})).statusCode).toBe(401);
    await disabledApp.close();
  }
  await app.inject({method:'POST',url:'/v1/capir/auth/logout',payload:{schema_version:'capir-auth.v2',refresh_token:newer.refresh_token}});
  expect((await app.inject({method:'GET',url:'/v1/auth/session',headers:{authorization:`Bearer ${currentEntry}`}})).statusCode).toBe(401);
 });
});
