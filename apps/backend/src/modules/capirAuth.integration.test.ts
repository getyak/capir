/** Real-route protocol proof. PKCE is independently produced with Node's
 * base64url digest, never the implementation helper. Fixtures are synthetic
 * and confined to an explicitly owned loopback PostgreSQL database. */
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {Pool} from 'pg';
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
async function code(scopes=['grants.read','grants.revoke']) {
 const verifier=secret(),state=secret(),redirect_uri='http://127.0.0.1:49381/capir/callback';
 const r=await app.inject({method:'POST',url:'/v1/capir/auth/authorize',headers:{authorization:`Bearer ${browserToken}`},payload:{schema_version:'capir-auth.v2',redirect_uri,state,
 code_challenge:createHash('sha256').update(verifier,'ascii').digest('base64url'),code_challenge_method:'S256',web_origin:web,backend_origin:backend,scopes,consent:true,client_label:'GET-139 proof'}});
 expect(r.statusCode,r.body).toBe(200);
 return {schema_version:'capir-auth.v2',code:r.json().code,code_verifier:verifier,state,redirect_uri,web_origin:web,backend_origin:backend};
}
async function grant(scopes?:string[]) {const r=await app.inject({method:'POST',url:'/v1/capir/auth/exchange',payload:await code(scopes)});expect(r.statusCode,r.body).toBe(200);return r.json();}
async function status(token:string){return app.inject({method:'GET',url:'/v1/capir/auth/status',headers:{authorization:`Bearer ${token}`}});}
async function entitlement(state='active') {await pool!.query(`INSERT INTO capir_user_test_entitlements(id,account_id,user_id,scopes,state,granted_by,revoked_at)
 VALUES($1,$2,$3,ARRAY['test.create','test.status','test.stop','test.handoff'],$4,'synthetic GET-139 proof',CASE WHEN $4='revoked' THEN now() END)
 ON CONFLICT(account_id,user_id) DO UPDATE SET state=$4,generation=capir_user_test_entitlements.generation+1,revoked_at=CASE WHEN $4='revoked' THEN now() END`,[randomUUID(),account,user,state]);}
const testScopes=['grants.read','grants.revoke','test.create','test.status','test.stop','test.handoff'];
async function createRun(token:string){const password=secret();const r=await app.inject({method:'POST',url:'/v1/capir/tests',headers:{authorization:`Bearer ${token}`,'x-capir-backend-origin':backend},payload:{request_id:randomUUID(),password,preset:'empty',duration_hours:1,web_origin:web,backend_origin:backend}});expect(r.statusCode,r.body).toBe(200);return {run:r.json().run,password};}
describe.skipIf(!pool)('capir-auth.v2 real routes',()=>{
 beforeAll(async()=>{const c=await pool!.connect();try {await c.query('BEGIN');await c.query("INSERT INTO accounts(id,slug,name) VALUES($1,$2,'Synthetic auth proof')",[account,`auth-${account}`]);await c.query("INSERT INTO account_email_reservations(normalized_email,state,account_id,user_id) VALUES($1,'owned',$2,$3)",[email,account,user]);await c.query("INSERT INTO users(id,account_id,email,display_name,kind,username) VALUES($1,$2,$3,'Auth proof','password_human',$3)",[user,account,email]);await c.query('INSERT INTO password_credentials(account_id,user_id,password_scrypt) VALUES($1,$2,$3)',[account,user,await encodePasswordCredential(password)]);await c.query('COMMIT');}finally{c.release();}},30000);
 beforeEach(async()=>{app=await makeApp();await app.ready();browserToken=await login();},30000);
 afterEach(async()=>{await app?.close();});
 afterAll(async()=>{if(!pool)return;const rows=await pool.query<{id:string}>("SELECT id FROM lab_test_workspaces WHERE owner_account_id=$1 AND state<>'deleted'",[account]);const service=new LabWorkspaceService(pool,new LocalChatMediaStorage(media),3600);for(const row of rows.rows)await service.stopOperatorRun(row.id,randomUUID());await pool.end();},60000);
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
