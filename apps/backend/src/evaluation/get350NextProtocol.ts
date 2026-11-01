/** Explicit, isolated Linux protocol acceptance; never part of default tests. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { Socket } from "node:net";
import { access, chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import type { Pool as PgPool } from "pg";
import type { BackendConfig } from "../config.js";
import { PASSWORD_PATH, writeProtocolApp, type ProtocolSetup } from "./get350NextProtocolApp.js";
import { ProtocolCdp, ProtocolPage, until, cdpCommandErrorObservation, lastSetupHttpStatus, lastQuietNetworkObservation, type ProtocolFlow } from "./get350NextProtocolCdp.js";

function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label); }
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const secret = () => randomBytes(32).toString("base64url");
// Fixed source-authored message variants only; never hash or emit an unknown runtime message.
const FIXTURE_FAILURE_CODES = new Map<string,string>([["Protocol condition timed out: actionable production password input","ASSERT_dbfee6d55b4a"],["absolute existing Chrome path required","ASSERT_84f6f77679eb"],["Action dispatch gate","ASSERT_b5a6a1ae7481"],["actual Error recovery or verified read-only automatic GET; never stale editor","ASSERT_24f24a6ca9a5"],["actual Git HEAD required","ASSERT_1b3b742e4998"],["actual native303 followed by GET","ASSERT_b19f64a7cfdd"],["Ambiguous browser Action dispatch","ASSERT_7c75f613a522"],["applied UI is read-only","ASSERT_329f4a083e3b"],["CDP command rejected","ASSERT_eb7ec85a2ba1"],["CDP connection failed","ASSERT_c9995e881017"],["CDP connection timeout","ASSERT_96211f1f2072"],["checkout bytes must match actual HEAD blob","ASSERT_50d71e1f4296"],["child must own detached group/session","ASSERT_b437f34bcd04"],["complete held Action response","ASSERT_cb7e98a0e49c"],["control envelope bound","ASSERT_5444effd3d54"],["Cross-origin fixture navigation refused","ASSERT_d3af097c75f7"],["dedicated loopback get350 database required","ASSERT_6d08f1f6ad3a"],["explicit protocol flag required; no skip","ASSERT_ca06d99af71f"],["explicit runner-temp receipt directory required","ASSERT_9eeb42990fcb"],["first GET recovery is business-read-only","ASSERT_0a71f92d929e"],["fixture hydration","ASSERT_2f2789637d83"],["Fixture navigation failed","ASSERT_d1304dd6c483"],["Fixture page evaluation failed","ASSERT_2065cd2f4bb4"],["Fixture page function failed","ASSERT_013265c436c5"],["fixture slot is one-use","ASSERT_412e0cadebd3"],["flow createdAt/exp/iat/jti/envelope changed","ASSERT_e7649e986bc1"],["gate precedes producer","ASSERT_cb3c055f7f39"],["HEAD source path missing","ASSERT_e4d273e7bdd6"],["HEAD/source/lock changed during protocol run","ASSERT_2ea8c4b79011"],["held HTTP and exact CDP Action must match","ASSERT_274f018e9609"],["initial real flow baseline required","ASSERT_b48a7803998a"],["installed framework changed during run","ASSERT_6881ad0346e7"],["installed framework must match actual lock","ASSERT_6234bcdaa43d"],["installed framework version required","ASSERT_76ec9073499e"],["Invalid owned Chrome port","ASSERT_bd7ef75fa7de"],["Invalid real flow-cookie inspection","ASSERT_8eaeb59d881f"],["late A cannot display success for B","ASSERT_4eed558bcfda"],["late A committed before B","ASSERT_731cb062b608"],["late A dispatch","ASSERT_5776512235d4"],["late A held/CDP request match","ASSERT_2be6b4503aa0"],["late A must not replace B editor","ASSERT_974177361e1f"],["late A real commit","ASSERT_59f101835566"],["late A response held","ASSERT_bdc6c3297440"],["late A was not replayed","ASSERT_4ae346a77d7c"],["late response has no B business effects","ASSERT_74af7b650ff4"],["Linux Node22+ with built-in WebSocket required","ASSERT_db285a1da112"],["loopback server address","ASSERT_8ef74b50a2ce"],["Missing controlled DOM target","ASSERT_f7d6a4ce7f77"],["Missing current fixture page context","ASSERT_390afcdd6365"],["Missing fixture click target","ASSERT_56043906bd5d"],["Missing owned Chrome endpoint","ASSERT_1a60f17ff6f1"],["Missing production password input","ASSERT_9cfce4c88e53"],["Missing specific Action tracker","ASSERT_6dc413fbd2ab"],["native GET reload never resubmits","ASSERT_49ee4c2b53de"],["native minlength prevents dispatch","ASSERT_014a211dd7eb"],["native real form","ASSERT_df5e85d69e3b"],["native validation sent no hidden Action POST","ASSERT_4156d0173378"],["Next build budget","ASSERT_9094c05c841c"],["Next build diagnostic output overflow","ASSERT_8337d1768ac5"],["no external browser request","ASSERT_2d3d538de912"],["no second browser Action","ASSERT_a946e64099ae"],["one actual locked framework selection required","ASSERT_07eb5975d9d3"],["one native rejected POST, no303/no backend complete","ASSERT_96990f69e25f"],["one owned action interception","ASSERT_564ec52c36d1"],["one owned Next port","ASSERT_8c71d7cbad30"],["one real successful completion","ASSERT_a39a4f21e792"],["original consumed grant TTL","ASSERT_1cc75ffe9dba"],["owned build output pipes required","ASSERT_4087657f7828"],["Owned CDP socket closed","ASSERT_b1e8fc632981"],["owned child Chrome endpoint proof required","ASSERT_191d9d9e94d1"],["owned child DevTools announcement","ASSERT_bffbaf3f5bd6"],["owned Chrome announcement pipe required","ASSERT_63229ebd0096"],["Owned Chrome metadata unavailable","ASSERT_c260fa9142f9"],["owned fixture cleanup failed","ASSERT_6d3213a801a5"],["owned front authority","ASSERT_dd82e41d2146"],["owned group identity changed","ASSERT_fd0690466426"],["owned group membership unavailable","ASSERT_b45a02ff8a77"],["owned group PID format","ASSERT_6f8d8cc00ddd"],["owned leader reused/changed","ASSERT_0d12d5b828fd"],["owned member PID reused","ASSERT_b4460af98e8c"],["Owned Next child error","ASSERT_bf7d2e73063e"],["owned process group still nonempty","ASSERT_610f8eb2ec7b"],["owned project cleanup scope","ASSERT_4af0e15d9a03"],["owned protocol PG required; no skip","ASSERT_793cf6b68ed8"],["owned runtime cleanup scope","ASSERT_59798dcc20b5"],["password grant has no provider challenge","ASSERT_8b1a2e38d675"],["process start identity unavailable","ASSERT_b8a2a57fcbf7"],["product checkpoint must exist before dispatch","ASSERT_a59db6eef644"],["production visible GET recovery link","ASSERT_36b604dcef0b"],["Protected Next setup failed","ASSERT_5b68bbd907f5"],["Protocol condition timed out: actual Error recovery or verified read-only automatic GET; never stale editor","ASSERT_24f24a6ca9a5"],["Protocol condition timed out: fixture hydration","ASSERT_2f2789637d83"],["Protocol condition timed out: late A real commit","ASSERT_59f101835566"],["Protocol condition timed out: native real form","ASSERT_df5e85d69e3b"],["Protocol condition timed out: owned child DevTools announcement","ASSERT_bffbaf3f5bd6"],["Protocol condition timed out: real applied UI","ASSERT_fb7fe68672c6"],["Protocol condition timed out: real native local rejection formState","ASSERT_4b6c7faa3285"],["Protocol condition timed out: real Next client navigation to B","ASSERT_bd7b04a1af1a"],["Protocol condition timed out: real Next readiness","ASSERT_93b2a02ed3d1"],["Protocol condition timed out: real producer200","ASSERT_43a83c46adb3"],["Protocol condition timed out: same Action responseReceived before body loss","ASSERT_456be2295d53"],["Protocol condition timed out: same Action transport loss","ASSERT_a9d260c20a9c"],["Protocol condition timed out: same held late A transport settled","ASSERT_3363ba0b9253"],["Protocol condition timed out: settled real network","ASSERT_9efd06e672aa"],["Protocol condition timed out: specific browser Action request","ASSERT_f00dd0a305ec"],["Protocol condition timed out: visible production GET recovery","ASSERT_ad1349a86634"],["protocol did not reach all three scenarios","ASSERT_9f282ed894ad"],["protocol PG must be migrated and empty","ASSERT_5da89526f481"],["quoted lock selection","ASSERT_619e8b6030d4"],["real applied UI","ASSERT_fb7fe68672c6"],["real complete Action response","ASSERT_c52c3f1617b9"],["real complete upstream Action","ASSERT_e163f3c2d6ed"],["real native local rejection formState","ASSERT_4b6c7faa3285"],["real Next build failed","ASSERT_32961970352c"],["real Next client navigation to B","ASSERT_bd7b04a1af1a"],["real Next readiness","ASSERT_93b2a02ed3d1"],["Real page load timed out","ASSERT_edc19e9d1f80"],["real producer200","ASSERT_43a83c46adb3"],["real rendered operation ref","ASSERT_f0776b39b781"],["real Web grant origin/session binding","ASSERT_9869e45874af"],["receipt directory identity","ASSERT_5958f67de335"],["receipt directory must start empty","ASSERT_79ba70301c9b"],["receipt directory outside owned runner-temp slot","ASSERT_33fcb0e9f966"],["received native redirect gives GET URL","ASSERT_f6094fc05f85"],["registry framework version required","ASSERT_646668ae857c"],["regular HEAD source blob required","ASSERT_9e663c3a2a66"],["regular source checkout required","ASSERT_4889f9683583"],["repeat GET same receipt and no replay","ASSERT_8a8e463a7959"],["same Action responseReceived before body loss","ASSERT_456be2295d53"],["same Action transport loss","ASSERT_a9d260c20a9c"],["same held late A transport settled","ASSERT_3363ba0b9253"],["server-rejected same-operation form remains editing","ASSERT_9f5ce1f673be"],["settled real network","ASSERT_9efd06e672aa"],["specific browser Action request","ASSERT_f00dd0a305ec"],["synthetic business fingerprint row","ASSERT_89a80d091d1f"],["unknown member after leader exit; refuse signals","ASSERT_bee161fb44ad"],["unregistered child group","ASSERT_9e4ffa6c1a86"],["Unrelated Chrome endpoint refused","ASSERT_68fe559173b6"],["unsupported/ambiguous pnpm lock block","ASSERT_90c6ce38b5a2"],["visible production GET recovery","ASSERT_ad1349a86634"],["Voice is outside this protocol fixture","ASSERT_061d8a207cad"]]);
FIXTURE_FAILURE_CODES.set("no active frontend response before controlled connection drain","ASSERT_c239080432f2");
FIXTURE_FAILURE_CODES.set("owned frontend connections drained before controlled action","ASSERT_949aa1c38ed7");
FIXTURE_FAILURE_CODES.set("controlled Action is first HTTP request on frontend connection","ASSERT_8947e446ac77");
FIXTURE_FAILURE_CODES.set("Protocol condition timed out: owned frontend connections drained before controlled action","ASSERT_949aa1c38ed7");
const SOURCE_PATHS = [
  "apps/web/app/workspace/settings/link-complete/password/page.tsx",
  "apps/web/app/workspace/settings/link-complete/password/error.tsx",
  "apps/web/app/workspace/settings/link-complete/staged-forms.tsx",
  "apps/web/app/workspace/settings/login-methods/actions.ts",
  "apps/web/lib/server/loginMethods.ts",
  "apps/web/lib/server/stagedAuth.ts",
  "packages/contracts/src/client.ts",
  "apps/backend/src/app.ts"
];
type SourceFile = {path:string;mode:string;blob:string;sha256:string};
type SourceBinding = {commit:string;files:SourceFile[];lock:SourceFile};
let actualSource: SourceBinding | undefined;
function gitRead(repo:string,args:string[]) {
  return execFileSync("git",["--no-optional-locks","--no-lazy-fetch","-c","core.fsmonitor=false",
    "-c","core.untrackedCache=false","-c","gc.auto=0","-c","maintenance.auto=false","-C",repo,...args],
    {encoding:"utf8",stdio:["ignore","pipe","ignore"],env:{...process.env,GIT_OPTIONAL_LOCKS:"0",GIT_NO_LAZY_FETCH:"1",GIT_TERMINAL_PROMPT:"0"}});
}
async function bindSource(repo:string):Promise<SourceBinding> {
  const commit=gitRead(repo,["rev-parse","--verify","HEAD"]).trim();
  check(/^[0-9a-f]{40}$/.test(commit),"actual Git HEAD required");
  const entries=gitRead(repo,["ls-tree","-z",commit,"--",...SOURCE_PATHS,"pnpm-lock.yaml"]).split("\0").filter(Boolean);
  const records=new Map<string,{mode:string;blob:string}>();
  for(const entry of entries){
    const match=/^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(entry);
    check(match,"regular HEAD source blob required");records.set(match[3]!,{mode:match[1]!,blob:match[2]!});
  }
  const files:SourceFile[]=[];
  for(const path of [...SOURCE_PATHS,"pnpm-lock.yaml"]){
    const record=records.get(path);check(record,"HEAD source path missing");
    const stat=await lstat(join(repo,path));check(stat.isFile()&&!stat.isSymbolicLink(),"regular source checkout required");
    const bytes=await readFile(join(repo,path));
    const blob=createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    check(blob===record.blob,"checkout bytes must match actual HEAD blob");
    files.push({path,mode:record.mode,blob,sha256:hash(bytes)});
  }
  return {commit,files:files.slice(0,8),lock:files[8]!};
}
async function sourceMatches(repo:string,expected:SourceBinding) {
  check(JSON.stringify(await bindSource(repo))===JSON.stringify(expected),"HEAD/source/lock changed during protocol run");
}
// Read only the generated pnpm importer/dependency/version fields, not a new YAML dependency.
function lockedWebVersion(lock:string,name:string) {
  const block=(lines:string[],key:string,indent:number)=>{
    const header=" ".repeat(indent)+key+":";
    const positions=lines.flatMap((line,index)=>line===header?[index]:[]);
    check(positions.length===1,"unsupported/ambiguous pnpm lock block");
    const start=positions[0]!+1;let end=start;
    while(end<lines.length && (!lines[end]!.trim() || /^\s*/.exec(lines[end]!)![0].length>indent))end++;
    return lines.slice(start,end);
  };
  const importer=block(block(lock.split(/\r?\n/),"importers",0),"apps/web",2);
  const dependency=block(block(importer,"dependencies",4),name,6);
  const versions=dependency.filter(line=>line.startsWith("        version: "));
  check(versions.length===1,"one actual locked framework selection required");
  let value=versions[0]!.slice("        version: ".length).trim();
  if(value.startsWith('"'))value=JSON.parse(value) as string;
  else if(value.startsWith("'")){check(value.endsWith("'"),"quoted lock selection");value=value.slice(1,-1).replace(/''/g,"'");}
  const version=/^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?=\(|$)/.exec(value)?.[1];
  check(version,"registry framework version required");return version;
}

function deferred() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; }
async function bounded<T>(promise: Promise<T>, label: string, milliseconds = 20_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(label)), milliseconds); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function listen(server: Server) {
  await new Promise<void>((ok, bad) => { server.once("error", bad); server.listen(0, "127.0.0.1", () => { server.off("error", bad); ok(); }); });
  const address = server.address(); check(address && typeof address !== "string", "loopback server address");
  return `http://127.0.0.1:${address.port}`;
}
function ownServer(server: Server) {
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  return { sockets, async close() {
    if (!server.listening) return;
    const closed = new Promise<void>((ok, bad) => { server.close((e) => e ? bad(e) : ok()); });
    for (const socket of sockets) socket.destroy();
    await closed;
  } };
}
type ProcessIdentity={pid:number;pgid:number;sid:number;uid:number;start:string};
type OwnedGroup={pgid:number;leaderStart:string|undefined;known:Map<number,string>;closed:boolean};
const ownedGroups=new Map<ChildProcess,OwnedGroup>();
function identity(pid:number):ProcessIdentity|undefined {
  try{
    const text=readFileSync(`/proc/${pid}/stat`,"utf8"),fields=text.slice(text.lastIndexOf(")")+2).trim().split(/\s+/);
    check(/^\d+$/.test(fields[19]??""),"process start identity unavailable");
    return {pid,pgid:Number(fields[2]),sid:Number(fields[3]),uid:statSync(`/proc/${pid}`).uid,start:fields[19]!};
  }catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return undefined;throw error;}
}
function groupPids(pgid:number):number[]{
  try{return execFileSync("/usr/bin/pgrep",["-g",String(pgid)],{encoding:"utf8",timeout:1000,maxBuffer:65536,stdio:["ignore","pipe","ignore"]})
    .trim().split(/\s+/).filter(Boolean).map(value=>{check(/^\d+$/.test(value),"owned group PID format");return Number(value);});}
  catch(error){if((error as {status?:number}).status===1)return [];throw new Error("owned group membership unavailable");}
}
function groupMembers(group:OwnedGroup){
  const leader=identity(group.pgid);
  if(leader)check(leader.start===group.leaderStart&&leader.pgid===group.pgid&&leader.sid===group.pgid,"owned leader reused/changed");
  const rows:ProcessIdentity[]=[];
  for(const pid of groupPids(group.pgid)){
    const row=identity(pid);if(!row)continue;
    check(row.pgid===group.pgid&&row.sid===group.pgid&&row.uid===process.getuid?.(),"owned group identity changed");
    const prior=group.known.get(pid);
    if(prior)check(prior===row.start,"owned member PID reused");
    else {check(Boolean(leader),"unknown member after leader exit; refuse signals");group.known.set(pid,row.start);}
    rows.push(row);
  }
  return rows;
}
function rememberGroup(process:ChildProcess|undefined){
  if(!process?.pid)return;
  const group=ownedGroups.get(process);check(group,"unregistered child group");
  if(!group.closed)groupMembers(group);
}
function child(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, pipeStderr=false, pipeStdout=false) {
  const process=spawn(command,args,{cwd,env,detached:true,stdio:["ignore",pipeStdout?"pipe":"ignore",pipeStderr?"pipe":"ignore"]});
  // Readiness/build checks still fail; an unhandled spawn event must not bypass finally.
  process.on("error",()=>{});
  if(process.pid){
    const row=identity(process.pid),group:OwnedGroup={pgid:process.pid,leaderStart:row?.start,known:new Map(),closed:false};
    ownedGroups.set(process,group);
    if(row){check(row.pgid===process.pid&&row.sid===process.pid&&row.uid===globalThis.process.getuid?.(),"child must own detached group/session");group.known.set(row.pid,row.start);}
  }
  return process;
}
function ownChromeAnnouncement(process:ChildProcess,ownedPort:number){
  check(process.stderr,"owned Chrome announcement pipe required");
  const state:{uuid:string|undefined;invalid:boolean}={uuid:undefined,invalid:false};
  let retained="",seen=0;
  process.stderr.on("data",(chunk:Buffer)=>{
    // Always drain, but never retain more than16KiB or emit raw child stderr.
    if(state.uuid||state.invalid)return;
    seen+=chunk.length;if(seen>16384){state.invalid=true;retained="";return;}
    retained+=chunk.toString("utf8");
    const lines=retained.split(/\r?\n/);retained=lines.pop()??"";
    for(const line of lines){
      if(!line.startsWith("DevTools listening on "))continue;
      const match=/^DevTools listening on ws:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/devtools\/browser\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(line);
      if(!match||Number(match[1])!==ownedPort){state.invalid=true;retained="";return;}
      state.uuid=match[2];retained="";return;
    }
  });
  process.stderr.once("error",()=>{state.invalid=true;retained="";});
  return state;
}
async function waitGroupEmpty(group:OwnedGroup,milliseconds:number){
  const deadline=Date.now()+milliseconds;
  while(Date.now()<deadline){
    if(groupPids(group.pgid).length===0){await delay(50);if(groupPids(group.pgid).length===0){group.closed=true;return true;}}
    else groupMembers(group); // Detected reuse/unknown is a failure, never permission to kill.
    await delay(50);
  }
  return false;
}
async function stop(process: ChildProcess | undefined) {
  if(!process?.pid)return;
  const group=ownedGroups.get(process);check(group,"unregistered child group");if(group.closed)return;
  if(await waitGroupEmpty(group,100))return;
  const signal=(name:NodeJS.Signals)=>{
    const members=groupMembers(group);if(members.length===0)return;
    // No argv/environment scan: signal only this registered, identity-checked PG.
    try{globalThis.process.kill(-group.pgid,name);}catch(error){if((error as NodeJS.ErrnoException).code!=="ESRCH")throw error;}
  };
  signal("SIGTERM");if(await waitGroupEmpty(group,5000))return;
  signal("SIGKILL");check(await waitGroupEmpty(group,5000),"owned process group still nonempty");
}

type Fixture = ProtocolSetup & {
  slot:string;accountId:string;userId:string;token:string;expiresAt:string;
  completionRequests:number;completionStatus:number;resultRequests:number;
};
type CutObservation={responsePresent:boolean;headersSentBefore:boolean|null;responseEndedBefore:boolean|null;socketPresent:boolean;socketDestroyedBefore:boolean|null;socketDestroyedAfter:boolean|null;responseDestroyedAfter:boolean|null;socketClosedByObservation:boolean|null};
let lastLateNavigationDiagnostic:Record<string,unknown>|null=null;
let lastTransportDiagnostic:Record<string,unknown>|null=null;
const transportObservations:Array<Record<string,unknown>>=[];
const diagnosticBool=(value:unknown)=>typeof value==="boolean"?value:null;
const diagnosticCount=(value:unknown)=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0&&value<=1_000_000?value:null;
type Arm = { frontendRequestOrdinal?:number; cutObservation?:()=>CutObservation; enhanced: boolean; actionKey:string; received: ReturnType<typeof deferred>; dispatch: ReturnType<typeof deferred>;
  response: ReturnType<typeof deferred>; status: number; outgoing?: import("node:http").ServerResponse;
  headers?: import("node:http").IncomingHttpHeaders; chunks: Buffer[]; size: number; terminal: boolean };
function frontendProxy() {
  let nextPort:number|undefined,frontAuthority:string|undefined; let armed: Arm | undefined; let active: Arm | undefined;
  const observed = { passwordPosts: 0, native303: 0, native200:0, recoveryGets: 0 };
  const frontendSockets=new Set<Socket>(),frontendRequests=new WeakMap<Socket,number>();
  const activeFrontendResponses=new Set<import("node:http").ServerResponse>();
  const server = createServer((incoming, outgoing) => {
    const requestOrdinal=(frontendRequests.get(incoming.socket)??0)+1;frontendRequests.set(incoming.socket,requestOrdinal);
    activeFrontendResponses.add(outgoing);outgoing.once("finish",()=>activeFrontendResponses.delete(outgoing));outgoing.once("close",()=>activeFrontendResponses.delete(outgoing));
    if(!nextPort||!frontAuthority){outgoing.writeHead(503).end();return;}
    const requestTarget=incoming.url;
    if(!requestTarget?.startsWith("/")||requestTarget.startsWith("//")||/[\\\r\n#]/.test(requestTarget)||incoming.headers.host!==frontAuthority){outgoing.writeHead(404).end();return;}
    const port=nextPort,host=frontAuthority;
    const url=new URL(requestTarget,"http://127.0.0.1");
    if(url.origin!=="http://127.0.0.1"){outgoing.writeHead(404).end();return;}
    const passwordPost = incoming.method === "POST" && url.pathname === PASSWORD_PATH;
    if (incoming.method === "GET" && url.pathname === PASSWORD_PATH && url.searchParams.has("result")) observed.recoveryGets++;
    const plan = passwordPost ? armed : undefined;
    if (passwordPost) { observed.passwordPosts++; armed = undefined; }
    if (plan) { active = plan; plan.frontendRequestOrdinal=requestOrdinal;plan.enhanced = typeof incoming.headers["next-action"] === "string";
      plan.actionKey=hash(`POST\0${incoming.url}\0${incoming.headers["next-action"]??""}`);plan.received.resolve(); }
    const forward = () => {
      const upstream = httpRequest({protocol:"http:",hostname:"127.0.0.1",port,path:requestTarget,
        method:incoming.method,agent:false,
        headers:{...incoming.headers,host,"x-forwarded-host":host,"x-forwarded-proto":"http"}},(response)=>{
        response.once("error", () => outgoing.destroy());
        if (passwordPost && response.statusCode === 303) observed.native303++;
        if(passwordPost&&!incoming.headers["next-action"]&&response.statusCode===200)observed.native200++;
        if (!plan) { outgoing.writeHead(response.statusCode ?? 502, {...response.headers,connection:"close"}); response.pipe(outgoing); return; }
        plan.status = response.statusCode ?? 0; plan.headers = response.headers; plan.outgoing = outgoing;
        response.on("data", (chunk: Buffer) => {
          plan.size += chunk.length;
          if (plan.size > 2 * 1024 * 1024) { response.destroy(); outgoing.destroy(); return; }
          plan.chunks.push(chunk); // Bounded, private in-memory transport only; never logged/uploaded.
        });
        response.once("end", () => { plan.terminal = response.complete; plan.response.resolve(); });
      });
      upstream.once("socket", (socket) => { owned.sockets.add(socket); socket.once("close", () => owned.sockets.delete(socket)); });
      upstream.once("error", () => outgoing.destroy());
      incoming.once("aborted", () => upstream.destroy());
      incoming.pipe(upstream);
    };
    if (plan) void plan.dispatch.promise.then(forward); else forward();
  });
  server.on("connection",socket=>{frontendSockets.add(socket);socket.once("close",()=>frontendSockets.delete(socket));});
  const owned = ownServer(server);
  return {server,observed,
    async prepareFirstFrontendRequest(){
      check(activeFrontendResponses.size===0,"no active frontend response before controlled connection drain");
      const closed=frontendSockets.size;for(const socket of frontendSockets)socket.destroy();
      await until(async()=>frontendSockets.size===0,"owned frontend connections drained before controlled action",5000);
      return closed;
    },
    setNextPort(port:number){check(nextPort===undefined&&Number.isInteger(port)&&port>0&&port<=65535,"one owned Next port");nextPort=port;},
    setFrontAuthority(host:string){check(frontAuthority===undefined&&/^127\.0\.0\.1:[1-9]\d{0,4}$/.test(host)&&Number(host.split(":")[1])<=65535,"owned front authority");frontAuthority=host;},
    arm() {
      check(!armed && !active, "one owned action interception");
      const plan: Arm = { enhanced: false, actionKey:"", received: deferred(), dispatch: deferred(), response: deferred(),
        status: 0, chunks: [], size: 0, terminal: false };
      armed = plan; return plan;
    },
    flush(plan: Arm) { check(plan.outgoing && plan.headers && plan.terminal, "complete held Action response"); plan.outgoing.writeHead(plan.status, plan.headers); plan.outgoing.flushHeaders(); },
    cut(plan: Arm) {
      const response=plan.outgoing,socket=response?.socket;
      const before={responsePresent:Boolean(response),headersSentBefore:diagnosticBool(response?.headersSent),responseEndedBefore:diagnosticBool(response?.writableEnded),socketPresent:Boolean(socket),socketDestroyedBefore:diagnosticBool(socket?.destroyed)};
      plan.cutObservation=()=>({responsePresent:before.responsePresent,headersSentBefore:before.headersSentBefore,responseEndedBefore:before.responseEndedBefore,socketPresent:before.socketPresent,socketDestroyedBefore:before.socketDestroyedBefore,socketDestroyedAfter:diagnosticBool(socket?.destroyed),responseDestroyedAfter:diagnosticBool(response?.destroyed),socketClosedByObservation:diagnosticBool(socket?.closed)});
      plan.outgoing?.destroy(); plan.chunks = []; active = undefined;
    },
    release(plan: Arm) { check(plan.outgoing && plan.headers && plan.terminal, "complete held Action response");
      if (!plan.outgoing.destroyed) { plan.outgoing.writeHead(plan.status, plan.headers); plan.outgoing.end(Buffer.concat(plan.chunks)); }
      plan.chunks = []; active = undefined;
    },
    async close() { armed?.dispatch.resolve(); active?.outgoing?.destroy(); armed = undefined; active = undefined; await owned.close(); },
  };
}

type NextBuildDiagnostic={stage:string;frameworksValidated:boolean;compilerDependenciesResolved:boolean;templatesPrepared:boolean;capabilityPrepared:boolean;
  childRegistered:boolean;exitCode:number|null;signal:string|null;timedOut:boolean;spawnErrorCode:string|null;
  stdoutBytes:number;stderrBytes:number;captureTruncated:boolean;categories:string[];typescriptCodes:string[];
  modules:string[];locations:Array<{path:string;line:number|null;column:number|null}>;rawOutputSuppressed:true};
let nextBuildDiagnostic:NextBuildDiagnostic|undefined;
function buildOutputCapture(process:ChildProcess){
  check(process.stdout&&process.stderr,"owned build output pipes required");
  const buffers:Record<"stdout"|"stderr",Buffer>={stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)};
  const bytes={stdout:0,stderr:0};
  for(const name of ["stdout","stderr"] as const)process[name]!.on("data",(chunk:Buffer)=>{
    bytes[name]+=chunk.length;buffers[name]=Buffer.from(Buffer.concat([buffers[name],chunk]).subarray(-32768));
  });
  return {summarize(repo:string,project:string,capabilities:string[]){
    if(bytes.stdout>32768||bytes.stderr>32768){
      buffers.stdout=Buffer.alloc(0);buffers.stderr=Buffer.alloc(0);
      return {stdoutBytes:bytes.stdout,stderrBytes:bytes.stderr,captureTruncated:true,categories:["diagnostic-output-overflow"],typescriptCodes:[],modules:[],locations:[],rawOutputSuppressed:true as const};
    }
    let text=Buffer.concat([buffers.stdout,Buffer.from("\n"),buffers.stderr]).toString("utf8");
    // Redact known raw/URL/JSON/base64 variants before deriving any allowed field.
    const values=new Set<string>();
    for(const capability of capabilities.filter(Boolean)){
      values.add(capability);values.add(encodeURIComponent(capability));values.add(Buffer.from(capability).toString("base64"));
      values.add(JSON.stringify(capability).slice(1,-1));
    }
    for(const capability of [...values].sort((a,b)=>b.length-a.length))text=text.split(capability).join("[CAPABILITY]");
    text=text.replace(/\x1b\[[0-9;]*[A-Za-z]/g,"").replace(/\r/g,"");
    const rules:Array<[string,RegExp]>=[["module-resolution",/Module not found|Cannot find module|Can't resolve/i],
      ["typescript",/Type error:|error TS\d{4}|TS\d{4}/], ["syntax",/SyntaxError|Parsing .* failed|Unexpected token/i],
      ["next-config",/Invalid next\.config|Unrecognized key|Failed to load next\.config/i],
      ["turbopack",/Turbopack.*(?:error|failed)|Error.*Turbopack/i],
      ["prerender",/Error occurred prerendering|Failed to collect page data/i],
      ["resource",/ENOMEM|EAGAIN|heap out of memory|EACCES/] ];
    const categories=rules.filter(([,pattern])=>pattern.test(text)).map(([name])=>name);
    const typescriptCodes=[...new Set(text.match(/\bTS\d{4}\b/g)??[])].slice(0,8);
    const modules:string[]=[];
    for(const match of text.matchAll(/(?:Can't resolve|Cannot find module)\s+["']([^"'\n]{1,200})["']/gi)){
      const value=match[1]!;
      if(!value.startsWith("/")&&!value.startsWith("..")&&/^[A-Za-z0-9@_./+-]+$/.test(value)&&!/(?:CAPABILITY|chrome-profile|capability|\.env|_private)/i.test(value)&&!modules.includes(value))modules.push(value);
      if(modules.length>=8)break;
    }
    const locations:Array<{path:string;line:number|null;column:number|null}>=[];
    for(const match of text.matchAll(/([A-Za-z0-9_@./+\[\]()-]+\.(?:tsx?|jsx?|mjs|json|css))(?::(\d+)(?::(\d+))?)?/g)){
      const raw=match[1]!,clean=raw.replace(/^\[project\]\//,"").replace(/^\.\//,"");
      const absolute=raw.startsWith("/")?resolve(raw):resolve(clean.startsWith("apps/")||clean.startsWith("packages/")?repo:project,clean);
      let path:string|undefined;
      if(absolute.startsWith(project+"/"))path="fixture/"+absolute.slice(project.length+1);
      else if(absolute.startsWith(repo+"/")){
        const relative=absolute.slice(repo.length+1);
        if(/^(?:apps\/web\/|apps\/backend\/src\/evaluation\/|packages\/)/.test(relative))path="repo/"+relative;
      }
      if(!path||/(?:CAPABILITY|chrome-profile|capability|\.env|_private)/i.test(path))continue;
      const location={path,line:match[2]?Number(match[2]):null,column:match[3]?Number(match[3]):null};
      if(!locations.some(prior=>JSON.stringify(prior)===JSON.stringify(location)))locations.push(location);
      if(locations.length>=12)break;
    }
    // No raw line, source preview, arbitrary error message/payload, or profile path escapes.
    buffers.stdout=Buffer.alloc(0);buffers.stderr=Buffer.alloc(0);
    return {stdoutBytes:bytes.stdout,stderrBytes:bytes.stderr,captureTruncated:bytes.stdout>32768||bytes.stderr>32768,
      categories,typescriptCodes,modules,locations,rawOutputSuppressed:true as const};
  }};
}
let phase = "admission";
let receiptPath: string | undefined;
let observedSourceRevision = "unreported";
const completedScenarios: Array<Record<string, string | number | boolean>> = [];
async function prepareReceiptDirectory() {
  const requested = process.env.GET350_NEXT_PROTOCOL_ARTIFACT_DIR;
  const runnerTemp = process.env.RUNNER_TEMP;
  check(requested && runnerTemp, "explicit runner-temp receipt directory required");
  const parent = await realpath(runnerTemp), output = resolve(requested);
  check(await realpath(dirname(output)) === parent && basename(output) === "get350-next-protocol-evidence", "receipt directory outside owned runner-temp slot");
  try { await mkdir(output, {mode:0o700}); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const stat = await lstat(output);
  check(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid?.(), "receipt directory identity");
  check((await readdir(output)).length === 0, "receipt directory must start empty");
  await chmod(output,0o700); receiptPath = join(output,"receipt.json");
}
async function writeReceipt(value: Record<string,unknown>) {
  if (receiptPath) await writeFile(receiptPath,JSON.stringify(value)+"\n",{mode:0o600,flag:"wx"});
}
async function main() {
  check(process.platform === "linux" && Number(process.versions.node.split(".")[0]) >= 22 && typeof WebSocket === "function", "Linux Node22+ with built-in WebSocket required");
  check(process.env.GET350_NEXT_PROTOCOL === "1", "explicit protocol flag required; no skip");
  await prepareReceiptDirectory();
  if (/^[0-9a-f]{40}$/.test(process.env.GITHUB_SHA ?? "")) observedSourceRevision = process.env.GITHUB_SHA!;
  const database = process.env.DATABASE_URL;
  check(database, "owned protocol PG required; no skip");
  const db = new URL(database);
  check(db.protocol === "postgresql:" && db.hostname === "127.0.0.1" && /^\/get350_[a-z0-9_]+$/.test(db.pathname), "dedicated loopback get350 database required");
  const chrome = process.env.GET350_CHROME_PATH || "/usr/bin/google-chrome";
  check(chrome.startsWith("/"), "absolute existing Chrome path required"); await access(chrome);
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const web = join(repo, "apps/web"), runtime = await mkdtemp(join(tmpdir(), "get350-next-protocol-"));
  const project = await mkdtemp(join(web, ".get350-next-protocol-"));
  await chmod(runtime, 0o700); await chmod(project, 0o700);
  const controlKey = secret(), authSecret = secret(), sourceCwd = process.cwd();
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, LANG: "C.UTF-8", TZ: "UTC", TMPDIR: runtime,
    NODE_ENV: "test", LOG_LEVEL: "silent", NEXT_TELEMETRY_DISABLED: "1", CI: "true",
    XDG_CONFIG_HOME: join(runtime,"xdg-config"), XDG_CACHE_HOME: join(runtime,"xdg-cache"),
    DATABASE_URL: database, CHAT_MEDIA_STORAGE_PROVIDER: "local", CHAT_MEDIA_LOCAL_DIRECTORY: join(runtime, "chat-media") };
  // Before any production import, remove provider/key/policy/env inheritance.
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env); process.chdir(runtime);
  let pool: PgPool | undefined, app: Awaited<ReturnType<typeof import("../app.js")["buildApp"]>> | undefined;
  let next: ChildProcess | undefined, chromeProcess: ChildProcess | undefined, build: ChildProcess | undefined;
  let passedSummary: Record<string, unknown> | undefined;
  let frameworkCheck: (()=>Promise<void>) | undefined;
  const scenarioSummaries = completedScenarios;
  let cdp: ProtocolCdp | undefined, controlOwned: ReturnType<typeof ownServer> | undefined;
  const proxy = frontendProxy(), fixtures = new Map<string, Fixture>();
  try {
    phase = "actual Git source binding"; actualSource = await bindSource(repo);
    phase = "owned PG admission";
    const { Pool } = await import("pg"); pool = new Pool({ connectionString: database });
    const empty = (await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM users")).rows[0];
    check(empty?.count === "0", "protocol PG must be migrated and empty");
    const { buildApp } = await import("../app.js");
    const { createRealIdentity, newAccountSlug } = await import("../modules/accountIdentity.js");
    const { insertSession } = await import("../modules/auth.js");
    const { encodePasswordCredential } = await import("../modules/passwordCredential.js");
    const { createMemoryMailSink } = await import("../lib/mail.js");
    const { TalentSignalClient } = await import("@talent-signal/contracts");
    const config: BackendConfig = { allowedOrigins: [], appleSignInAudiences: [], appleSignInEnabled: false,
      googleSignInAudiences: [], databaseUrl: database, host: "127.0.0.1", port: 0,
      passwordAuthEnabled: true, passwordRegistrationEnabled: false, simulatedAuthEnabled: false,
      sessionTtlSeconds: 28_800, retentionSweepIntervalMs: 60_000, internalLabEnabled: false,
      chatMediaStorage: { provider: "local", directory: join(runtime, "chat-media") } };
    app = await buildApp({ pool, config, remoteChatProvider: null, privateConversationProvider: null,
      personResearchProvider: null, screenshotContact: null, labProviders: new Map(), labCIVerifier: null,
      labJobWorkerEnabled: false, conversationQueueWorkerEnabled: false,
      voiceTranscriber: { async transcribe() { throw new Error("Voice is outside this protocol fixture"); } },
      mail: createMemoryMailSink().delivery });
    const backendHttp={completionRequests:0};
    app.addHook("onRequest",async(request)=>{if(request.method==="POST"&&request.url==="/v1/account/login-methods/complete")backendHttp.completionRequests++;});
    app.addHook("preHandler", async (request) => {
      const body = request.body as { attempt_id?: string } | undefined;
      const f = [...fixtures.values()].find((entry) => entry.grant.attempt_id === body?.attempt_id);
      if (request.method === "POST" && request.url === "/v1/account/login-methods/complete" && f) f.completionRequests++;
      if (request.method === "POST" && request.url === "/v1/account/login-methods/result" && f) f.resultRequests++;
    });
    app.addHook("onResponse", async (request, reply) => {
      if (request.method !== "POST" || request.url !== "/v1/account/login-methods/complete") return;
      const body = request.body as { attempt_id?: string };
      const f = [...fixtures.values()].find((entry) => entry.grant.attempt_id === body.attempt_id);
      if (f) f.completionStatus = reply.statusCode;
    });
    const backend = await app.listen({ host: "127.0.0.1", port: 0 });
    const makeFixture = async (slot: string) => {
      check(!fixtures.has(slot), "fixture slot is one-use");
      const accountId = randomUUID(), userId = randomUUID(), beforePassword = secret();
      const client = await pool!.connect();
      let session: Awaited<ReturnType<typeof insertSession>>;
      try {
        await client.query("BEGIN");
        await createRealIdentity(client, { accountId, userId, accountName: "GET350 synthetic protocol", accountSlug: newAccountSlug(),
          email: `get350-${userId}@example.test`, displayName: "Synthetic protocol", kind: "password_human", emailVerifiedAt: new Date() });
        await client.query("INSERT INTO password_credentials(account_id,user_id,password_scrypt) VALUES($1,$2,$3)", [accountId, userId, await encodePasswordCredential(beforePassword)]);
        const identity = (await client.query<{ email: string; display_name: string; kind: "password_human"; username: string | null; slug: string; name: string; account_role: "admin" | "member" }>(
          "SELECT u.email,u.display_name,u.kind,u.username,u.account_role,a.slug,a.name FROM users u JOIN accounts a ON a.id=u.account_id WHERE u.id=$1", [userId])).rows[0]!;
        session = await insertSession(client, config, { accountId, accountName: identity.name, accountSlug: identity.slug, displayName: identity.display_name,
          role: identity.account_role, userEmail: identity.email, userId, userKind: identity.kind, username: identity.username }, "talent-signal-web");
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      const sessionId = (await pool!.query<{ id: string }>("SELECT id FROM sessions WHERE account_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1", [accountId, userId])).rows[0]!.id;
      const sdk = new TalentSignalClient(backend, session!.access_token);
      const settings = await sdk.accountSettings();
      // Exact real Web wrapper channel: JSON is not trusted Origin; no HTTP Origin is sent.
      const grant = await sdk.startLoginMethodChange({ id: randomUUID(), intent: "change_password", origin: "server-derived", client_label: "talent-signal-web",
        expected_account_revision: settings.workspace.revision, expected_user_revision: settings.user.revision,
        step_up: { kind: "password", password: beforePassword } }, AbortSignal.timeout(10_000));
      check(grant.provider_challenge===null,"password grant has no provider challenge");
      const row = (await pool!.query<{ origin: string; client_label: string; session_id: string; created_at: Date; expires_at: Date; consumed_at: Date | null }>(
        "SELECT origin,client_label,session_id,created_at,expires_at,consumed_at FROM credential_change_attempts WHERE id=$1", [grant.attempt_id])).rows[0]!;
      check(row.origin === "client:talent-signal-web" && row.client_label === "talent-signal-web" && row.session_id === sessionId && row.consumed_at === null, "real Web grant origin/session binding");
      const f: Fixture = { slot, ref: randomUUID(), handle: secret(), accountId, userId, token: session!.access_token, grant, settings,
        upstreamReauth:{provider:"google",challengeId:randomUUID(),nonce:secret(),step:"awaiting-reauth"},
        createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(), completionRequests: 0, completionStatus: 0, resultRequests: 0,
        claims: { backendSessionId: sessionId, backendAccessToken: session!.access_token, backendAccountId: accountId, backendAccountName: session!.account.name,
          backendAccountSlug: session!.account.slug, backendExpiresAt: session!.expires_at, backendRole: session!.user.role, backendUserId: userId, backendUsername: session!.user.username??null } };
      fixtures.set(slot, f); return f;
    };
    const fingerprint = async (f: Fixture) => {
      const row = (await pool!.query(`SELECT
        (SELECT to_jsonb(p) FROM password_credentials p WHERE p.account_id=a.id AND p.user_id=u.id) AS credential,
        (SELECT to_jsonb(c) FROM credential_change_attempts c WHERE c.id=$3) AS attempt,
        (SELECT to_jsonb(e) FROM account_access_events e WHERE e.id=$3) AS audit,a.settings_revision,u.profile_revision
        FROM accounts a JOIN users u ON u.account_id=a.id AND u.id=$2 WHERE a.id=$1`, [f.accountId, f.userId, f.grant.attempt_id])).rows[0];
      check(row, "synthetic business fingerprint row"); return hash(JSON.stringify(row));
    };
    const control = createServer(async (request, response) => {
      if (request.method !== "POST" || request.headers["x-get350-control"] !== controlKey) { response.writeHead(403).end(); return; }
      try {
        const chunks: Buffer[] = []; let size = 0;
        for await (const chunk of request) { size += chunk.length; check(size < 2048, "control envelope bound"); chunks.push(Buffer.from(chunk)); }
        const body = JSON.parse(Buffer.concat(chunks).toString()) as { slot?: string; handle?: string };
        const f = request.url === "/session" ? [...fixtures.values()].find((entry) => entry.handle === body.handle) : fixtures.get(body.slot ?? "");
        if (!f || !["/session", "/setup"].includes(request.url ?? "")) { response.writeHead(404).end(); return; }
        response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        response.end(JSON.stringify(request.url === "/session" ? f.claims : { ref: f.ref, handle: f.handle, grant: f.grant, settings: f.settings, claims: f.claims, createdAt: f.createdAt, upstreamReauth:f.upstreamReauth }));
      } catch { response.writeHead(400).end(); }
    });
    controlOwned = ownServer(control); const controlUrl = await listen(control), front = await listen(proxy.server);
    proxy.setFrontAuthority(new URL(front).host);
    phase = "production Next build";
    nextBuildDiagnostic={stage:"framework-lookup",frameworksValidated:false,compilerDependenciesResolved:false,templatesPrepared:false,capabilityPrepared:false,
      childRegistered:false,exitCode:null,signal:null,timedOut:false,spawnErrorCode:null,stdoutBytes:0,stderrBytes:0,captureTruncated:false,
      categories:[],typescriptCodes:[],modules:[],locations:[],rawOutputSuppressed:true};
    const requireWeb = createRequire(join(web, "package.json"));
    const lock=await readFile(join(repo,"pnpm-lock.yaml"),"utf8"),frameworks:Record<string,string>={};
    const packageVersion=async(name:string)=>{
      const value=JSON.parse(await readFile(requireWeb.resolve(`${name}/package.json`),"utf8")) as {version?:unknown};
      check(typeof value.version==="string","installed framework version required");return value.version;
    };
    for(const name of ["next","react","react-dom"]){
      const selected=lockedWebVersion(lock,name);check(await packageVersion(name)===selected,"installed framework must match actual lock");frameworks[name]=selected;
    }
    frameworkCheck=async()=>{for(const [name,version] of Object.entries(frameworks))check(await packageVersion(name)===version,"installed framework changed during run");};
    nextBuildDiagnostic.frameworksValidated=true;nextBuildDiagnostic.stage="compiler-dependencies";
    for (const dependency of ["typescript", "@types/react/package.json", "@types/node/package.json"]) requireWeb.resolve(dependency);
    nextBuildDiagnostic.compilerDependenciesResolved=true;nextBuildDiagnostic.stage="write-temporary-project";
    await writeProtocolApp(project, repo);
    nextBuildDiagnostic.templatesPrepared=true;nextBuildDiagnostic.stage="write-private-capability";
    const nextEnv: NodeJS.ProcessEnv = { ...env, NODE_ENV: "production", AUTH_SECRET: authSecret, AUTH_URL: front,
      TALENT_SIGNAL_ALLOW_LAN_HTTP: "true", TALENT_SIGNAL_BACKEND_URL: backend, GET350_CONTROL_URL: controlUrl, GET350_CONTROL_KEY: controlKey };
    // Capability/provenance file is private, never a CI artifact, removed in finally.
    await writeFile(join(runtime, "capability.json"), JSON.stringify({ front, controlUrl, controlKey }), { mode: 0o600, flag: "wx" });
    nextBuildDiagnostic.capabilityPrepared=true;nextBuildDiagnostic.stage="spawn-requested";
    build = child(process.execPath, [requireWeb.resolve("next/dist/bin/next"), "build", project], web, nextEnv,true,true);
    nextBuildDiagnostic.childRegistered=Boolean(build.pid);nextBuildDiagnostic.stage="child-running";
    const output=buildOutputCapture(build);
    const databaseParts=[database,db.href,db.username,db.password,`${db.username}:${db.password}`];
    for(const value of [db.username,db.password,`${db.username}:${db.password}`]){try{databaseParts.push(decodeURIComponent(value));}catch{}}
    let buildCode:number|null=null;
    try{
      buildCode = await bounded(new Promise<number | null>((ok, bad) => {
        build!.once("error",(error)=>{const code=(error as NodeJS.ErrnoException).code;nextBuildDiagnostic!.spawnErrorCode=code&&/^[A-Z0-9_]{1,32}$/.test(code)?code:"OTHER";bad(new Error("Owned Next child error"));});
        // close waits for the dedicated stdout/stderr pipes to drain after exit.
        build!.once("close",(code,signal)=>{nextBuildDiagnostic!.exitCode=code;nextBuildDiagnostic!.signal=signal;ok(code);});
      }), "Next build budget", 300_000);
      nextBuildDiagnostic.stage=buildCode===0?"child-closed-zero":"child-closed-nonzero";
    }catch(error){
      nextBuildDiagnostic.timedOut=error instanceof Error&&error.message==="Next build budget";
      nextBuildDiagnostic.stage=nextBuildDiagnostic.timedOut?"child-timeout":"child-failed";
      throw error;
    }finally{
      Object.assign(nextBuildDiagnostic,output.summarize(repo,project,[authSecret,controlKey,...databaseParts]));
    }
    check(!nextBuildDiagnostic.captureTruncated,"Next build diagnostic output overflow");
    check(buildCode === 0, "real Next build failed");
    await stop(build); build = undefined;
    const reservation = createServer(); const reserved = await listen(reservation); const nextPort = new URL(reserved).port;
    await new Promise<void>((ok) => reservation.close(() => ok()));
    next = child(process.execPath, [requireWeb.resolve("next/dist/bin/next"), "start", project, "--hostname", "127.0.0.1", "--port", nextPort], web, nextEnv);
    proxy.setNextPort(Number(nextPort));
    await until(async () => { try { return (await fetch(front, { redirect: "error", signal: AbortSignal.timeout(1000) })).ok; } catch { return false; } }, "real Next readiness", 60_000);
    phase = "owned Chrome";
    const profile = join(runtime, "chrome-profile"); await mkdir(profile, { mode: 0o700 });
    const debugReservation=createServer(),debugReserved=await listen(debugReservation),debugPort=Number(new URL(debugReserved).port);
    await new Promise<void>((ok)=>debugReservation.close(()=>ok()));
    chromeProcess = child(chrome, ["--headless=new", "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
      "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-sync", "--disable-extensions", "--password-store=basic", "about:blank"], runtime, env, true);
    const announcement=ownChromeAnnouncement(chromeProcess,debugPort);
    await until(async()=>Boolean(announcement.uuid)||announcement.invalid||chromeProcess?.exitCode!==null||chromeProcess?.signalCode!==null,"owned child DevTools announcement",15_000);
    const expectedBrowserUUID=announcement.uuid;
    check(expectedBrowserUUID&&!announcement.invalid&&chromeProcess.exitCode===null&&chromeProcess.signalCode===null,"owned child Chrome endpoint proof required");
    rememberGroup(chromeProcess);
    // The announcement is comparison-only; it never supplies a network URL.
    cdp=await ProtocolCdp.connect(debugPort,expectedBrowserUUID);
    const version = await cdp.call<{ product: string }>("Browser.getVersion");
    const flowBaselines=new Map<string,ProtocolFlow>();
    const flowUnchanged=async(page:ProtocolPage,f:Fixture)=>{
      const baseline=flowBaselines.get(f.ref);check(baseline,"initial real flow baseline required");
      check(JSON.stringify(await page.inspect(f.ref,controlKey))===JSON.stringify(baseline),"flow createdAt/exp/iat/jti/envelope changed");
    };
    const open = async (f: Fixture) => {
      const page = await ProtocolPage.create(cdp!, front);
      await page.navigate(front); await page.ready(); await page.setup(f.slot, controlKey);
      flowBaselines.set(f.ref,await page.inspect(f.ref,controlKey));
      await page.navigate(front + PASSWORD_PATH); await page.ready();
      check(await page.attribute('input[name="operationRef"]', "value") === f.ref, "real rendered operation ref");
      await flowUnchanged(page,f);return page;
    };
    const applied = async (page: ProtocolPage, f: Fixture) => {
      await until(() => page.messageIncludes("已保存并核验。"), "real applied UI");
      check(!(await page.has('input[name="newPassword"]')), "applied UI is read-only");
      check(f.completionRequests === 1 && f.completionStatus === 200, "one real successful completion");
      const row = (await pool!.query<{ expires_at: Date; consumed_at: Date | null }>("SELECT expires_at,consumed_at FROM credential_change_attempts WHERE id=$1", [f.grant.attempt_id])).rows[0]!;
      check(row.expires_at.toISOString() === f.expiresAt && row.consumed_at !== null, "original consumed grant TTL");
    };
    // Scenario 1: actual enhanced Action, both response-loss boundaries.
    for (const boundary of ["before-headers", "after-headers"] as const) {
      lastTransportDiagnostic=null;
      phase = `loss:${boundary}`; const f = await makeFixture(boundary), page = await open(f);
      let observeTransport:(()=>Record<string,unknown>)|undefined;
      try {
        const visibleHref = await page.attribute(`a[href*="?result="]`, "href"); check(visibleHref, "production visible GET recovery link");
        const frontendConnectionsDrained=await proxy.prepareFirstFrontendRequest();
        const pending = await fingerprint(f), beforePosts=page.observed.passwordPosts, plan = proxy.arm();
        const wirePostsBefore=proxy.observed.passwordPosts;
        await page.fillPassword(secret()); await page.click('button[type="submit"]'); await bounded(plan.received.promise, "Action dispatch gate");
        const action=await page.passwordAction(beforePosts);
        observeTransport=()=>{const cut=plan.cutObservation?.();return {boundary,frontendConnectionsDrained:diagnosticCount(frontendConnectionsDrained),firstFrontendRequestOrdinal:diagnosticCount(plan.frontendRequestOrdinal),backendCompletionRequests:diagnosticCount(f.completionRequests),backendCompletionStatus:diagnosticCount(f.completionStatus),backendResultRequests:diagnosticCount(f.resultRequests),
          wirePasswordPosts:diagnosticCount(proxy.observed.passwordPosts),wirePasswordPostDelta:diagnosticCount(proxy.observed.passwordPosts-wirePostsBefore),recoveryGets:diagnosticCount(proxy.observed.recoveryGets),
          browserPasswordPosts:diagnosticCount(page.observed.passwordPosts),browserPasswordPostDelta:diagnosticCount(page.observed.passwordPosts-beforePosts),browserActionHeaders:diagnosticCount(page.observed.actionHeaders),
          browserFailedPasswordRequests:diagnosticCount(page.observed.failedPasswordRequests),browserFinishedPasswordRequests:diagnosticCount(page.observed.finishedPasswordRequests),blockedExternalRequests:diagnosticCount(page.observed.blockedExternal),
          actionResponseReceived:diagnosticBool(action.responseReceived),actionStatus:diagnosticCount(action.status),actionFinished:diagnosticBool(action.finished),actionFailed:diagnosticBool(action.failed),cut:cut?{responsePresent:cut.responsePresent,headersSentBefore:cut.headersSentBefore,responseEndedBefore:cut.responseEndedBefore,socketPresent:cut.socketPresent,socketDestroyedBefore:cut.socketDestroyedBefore,socketDestroyedAfter:cut.socketDestroyedAfter,responseDestroyedAfter:cut.responseDestroyedAfter,socketClosedByObservation:cut.socketClosedByObservation}:null};};
        check(plan.enhanced&&action.enhanced&&action.keyHash===plan.actionKey,"held HTTP and exact CDP Action must match");
        check(plan.frontendRequestOrdinal===1,"controlled Action is first HTTP request on frontend connection");
        check(await page.currentUrl() === new URL(visibleHref, front).href, "product checkpoint must exist before dispatch");
        check(f.completionRequests === 0 && await fingerprint(f) === pending, "gate precedes producer");
        plan.dispatch.resolve(); await bounded(plan.response.promise, "real complete Action response");
        await until(async () => f.completionStatus === 200, "real producer200");
        check(plan.status === 200 && plan.terminal && Number(f.completionRequests) === 1, "real complete upstream Action");
        const committed = await fingerprint(f), priorGets=proxy.observed.recoveryGets;
        if (boundary === "after-headers") { proxy.flush(plan); await until(async () => action.responseReceived&&action.status===200,"same Action responseReceived before body loss"); }
        proxy.cut(plan); await until(async()=>action.failed,"same Action transport loss");
        let observedError=false,observedAutoGet=false;
        await until(async()=>{
          const editor=await page.has('input[name="newPassword"]')||await page.has('input[name="passwordMode"][value="save"]');
          if(editor)return false;
          observedError=await page.textIncludes("section > p","页面没有收到更改结果。请通过只读页面核对结果。")&&await page.visible("section > p");
          observedAutoGet=!observedError&&proxy.observed.recoveryGets>priorGets&&f.resultRequests>0&&
            await page.messageIncludes("已保存并核验。")&&await page.attribute('input[name="operationRef"]',"value")===f.ref&&
            await page.attribute('input[name="passwordMode"]',"value")==="check";
          return observedError||observedAutoGet;
        },"actual Error recovery or verified read-only automatic GET; never stale editor");
        await flowUnchanged(page,f);
        // Follow the actual visible production GET recovery link, then reload.
        // Never construct a result URL or repair a missing history checkpoint.
        const recoverySelector = `a[href=${JSON.stringify(visibleHref)}]`;
        await until(() => page.has(recoverySelector), "visible production GET recovery");
        await page.click(recoverySelector); await applied(page, f);
        check(await fingerprint(f) === committed, "first GET recovery is business-read-only");await flowUnchanged(page,f);
        await page.reload(); await applied(page, f);
        check(await fingerprint(f) === committed && f.resultRequests >= 2, "repeat GET same receipt and no replay");await flowUnchanged(page,f);
        check(page.observed.passwordPosts===beforePosts+1,"no second browser Action");
        check(page.observed.blockedExternal === 0, "no external browser request");
        scenarioSummaries.push({scenario:"enhanced-loss",boundary,checkpointBeforeDispatch:true,producerStatus:f.completionStatus,
          completionRequests:f.completionRequests,resultRequests:f.resultRequests,fullActionReceived:true,businessFingerprintUnchanged:true,
          postHeadersObserved:boundary==="after-headers",heldActionMatched:true,errorUIObserved:observedError,
          automaticReadOnlyGetObserved:observedAutoGet,flowEnvelopeUnchanged:true,externalBrowserRequests:page.observed.blockedExternal});
        lastTransportDiagnostic=observeTransport?.()??null;if(lastTransportDiagnostic)transportObservations.push(lastTransportDiagnostic);
      } catch(error) {
        // Capture before closing the page so cleanup-generated events cannot masquerade as the cut outcome.
        try{lastTransportDiagnostic=observeTransport?.()??null;}catch{lastTransportDiagnostic={observationCaptureFailed:true};}
        throw error;
      } finally { await page.close(); }
    }
    // Scenario 2: browser-native no-JS validation, then actual303 -> GET.
    lastTransportDiagnostic=null;
    phase = "native:no-js"; const native = await makeFixture("native"), nativePage = await open(native);
    try {
      await nativePage.call("Emulation.setScriptExecutionDisabled", { value: true });
      await nativePage.navigate(front + PASSWORD_PATH);
      await until(() => nativePage.has('input[name="newPassword"]'), "native real form");
      const baseline = await fingerprint(native), initialPosts = proxy.observed.passwordPosts, initialBackendPosts=backendHttp.completionRequests, native200=proxy.observed.native200;
      await nativePage.fillPassword("short"); await nativePage.click('button[type="submit"]'); await delay(300);
      check(proxy.observed.passwordPosts === initialPosts && native.completionRequests === 0 && await fingerprint(native) === baseline, "native minlength prevents dispatch");
      await flowUnchanged(nativePage,native);
      phase="native:server-local-rejection";
      await nativePage.setAttribute('input[name="newPassword"]',"minlength","0");
      await nativePage.click('button[type="submit"]');
      await until(async()=>proxy.observed.native200===native200+1&&await nativePage.messageIncludes("新密码需要 8 到 128 个字符。"),"real native local rejection formState");
      check(await nativePage.has('input[name="newPassword"]')&&await nativePage.attribute('input[name="passwordMode"]',"value")==="save"&&await nativePage.attribute('input[name="operationRef"]',"value")===native.ref,"server-rejected same-operation form remains editing");
      check(nativePage.observed.native303===0&&proxy.observed.passwordPosts===initialPosts+1&&backendHttp.completionRequests===initialBackendPosts&&await fingerprint(native)===baseline,"one native rejected POST, no303/no backend complete");
      await flowUnchanged(nativePage,native);
      phase="native:valid-save";
      await nativePage.fillPassword(secret()); await nativePage.click('button[type="submit"]'); await applied(nativePage, native);
      check(Number(nativePage.observed.native303) === 1 && proxy.observed.native303 >= 1, "actual native303 followed by GET");
      check((await nativePage.currentUrl()).includes(`result=${native.ref}`), "received native redirect gives GET URL");await flowUnchanged(nativePage,native);
      const committed = await fingerprint(native); await nativePage.reload(); await applied(nativePage, native);
      await nativePage.quiet();
      check(await fingerprint(native) === committed && nativePage.observed.blockedExternal === 0, "native GET reload never resubmits");await flowUnchanged(nativePage,native);
      check(proxy.observed.passwordPosts === initialPosts + 2 && nativePage.observed.passwordPosts === 2, "native validation sent no hidden Action POST");
      scenarioSummaries.push({scenario:"native-no-js",nativeHtmlMode:"isolated-password-fixture",htmlMinlengthPreventedPost:true,serverValidationPosts:1,savePosts:1,serverValidationEditingPreserved:true,flowEnvelopeUnchanged:true,passwordPosts:nativePage.observed.passwordPosts,
        actual303:nativePage.observed.native303,completionRequests:native.completionRequests,businessFingerprintUnchanged:true,
        nativeTotalResponseLossAutoGetClaimed:false});
    } finally { await nativePage.close(); }
    // Scenario 3: late real A response cannot overwrite B or clear B's sealed cookie.
    phase = "late:A-B"; const a = await makeFixture("late-a"), page = await open(a);
    try {
      await proxy.prepareFirstFrontendRequest();
      const beforePosts=page.observed.passwordPosts,plan = proxy.arm(); await page.fillPassword(secret()); await page.click('button[type="submit"]');
      await bounded(plan.received.promise, "late A dispatch"); const action=await page.passwordAction(beforePosts);check(plan.enhanced&&action.enhanced&&action.keyHash===plan.actionKey,"late A held/CDP request match"); check(plan.frontendRequestOrdinal===1,"controlled Action is first HTTP request on frontend connection");plan.dispatch.resolve();
      await bounded(plan.response.promise, "late A response held"); await until(async () => a.completionStatus === 200, "late A real commit");
      check(a.completionRequests === 1 && plan.status === 200 && plan.terminal, "late A committed before B");
      const aCommitted = await fingerprint(a), b = await makeFixture("late-b"), bPending = await fingerprint(b);
      await page.setup(b.slot, controlKey);flowBaselines.set(b.ref,await page.inspect(b.ref,controlKey));await page.click("#fixture-next-navigation");
      try {
        await until(async () => await page.attribute('input[name="operationRef"]', "value") === b.ref, "real Next client navigation to B");
      } catch(error) {
        const diagnostic:Record<string,unknown>={network:page.navigationObservation(),domScope:"unobserved",fixtureTargetInHistory:null,passwordEditor:null,
          heldAction:{responseReceived:action.responseReceived,finished:action.finished,failed:action.failed},captureFailed:false};
        try{
          const ref=await page.attribute('input[name="operationRef"]',"value");diagnostic.domScope=ref===b.ref?"b":ref===a.ref?"a":ref===undefined?"absent":"other";
          const url=new URL(await page.currentUrl());diagnostic.fixtureTargetInHistory=url.origin===front&&url.pathname===PASSWORD_PATH&&url.searchParams.get("fixtureNavigation")==="b";
          diagnostic.passwordEditor=await page.has('input[name="newPassword"]');
        }catch{diagnostic.captureFailed=true;}
        // Capture primitives before closing the page; never emit raw URLs, refs, response bodies or cookies.
        lastLateNavigationDiagnostic=diagnostic;
        // Failure-only, non-atomic observation; never replaces the original timeout or makes this scenario pass.
        try {
          const probe:Record<string,unknown>={originalFailureSnapshot:structuredClone(diagnostic),
            bVisibleImmediatelyBeforeRelease:null,releaseAttempted:false,released:false,samples:0,sampleReadFailures:0,lastSampleReadError:null,
            bEditorObserved:false,lastBEditorVisible:null,bTargetInHistory:null,
            bEnvelopeUnchanged:null,aBusinessFingerprintUnchanged:null,bBusinessFingerprintUnchanged:null,
            observationTimedOut:false,windowExhausted:false,captureFailed:false};
          diagnostic.postFailureReleaseObservation=probe;
          let observationOpen=true;
          try {
            const deadline=Date.now()+4_000;
            await bounded((async()=>{
              const preRef=await page.attribute('input[name="operationRef"]',"value");if(!observationOpen)return;
              const preEditor=await page.has('input[name="newPassword"]');if(!observationOpen)return;
              probe.bVisibleImmediatelyBeforeRelease=preRef===b.ref&&preEditor;
              probe.releaseAttempted=true;proxy.release(plan);probe.released=true;
              let samples=0,sampleReadFailures=0;
              while(observationOpen&&Date.now()<deadline){
                let ref:string|undefined,editor:boolean;
                try{
                  ref=await page.attribute('input[name="operationRef"]',"value");if(!observationOpen)return;
                  if(Date.now()>=deadline){probe.windowExhausted=true;return;}
                  editor=await page.has('input[name="newPassword"]');if(!observationOpen)return;
                  if(Date.now()>=deadline){probe.windowExhausted=true;return;}
                }catch(sampleError){
                  if(!observationOpen)return;
                  if(Date.now()>=deadline){probe.windowExhausted=true;return;}
                  sampleReadFailures=Math.min(sampleReadFailures+1,1_000);probe.sampleReadFailures=sampleReadFailures;
                  probe.lastSampleReadError=cdpCommandErrorObservation(sampleError);
                  await delay(50);if(!observationOpen)return;
                  if(Date.now()>=deadline){probe.windowExhausted=true;return;}
                  continue;
                }
                const bEditor=ref===b.ref&&editor;
                probe.samples=++samples;probe.lastBEditorVisible=bEditor;
                if(bEditor)probe.bEditorObserved=true;
                if((action.finished||action.failed)&&bEditor)break;
                await delay(50);
              }
              if(!observationOpen)return;
              probe.windowExhausted=Date.now()>=deadline;
              const url=new URL(await page.currentUrl());if(!observationOpen)return;
              probe.bTargetInHistory=url.origin===front&&url.pathname===PASSWORD_PATH&&url.searchParams.get("fixtureNavigation")==="b";
              const flow=await page.inspect(b.ref,controlKey);if(!observationOpen)return;
              probe.bEnvelopeUnchanged=JSON.stringify(flow)===JSON.stringify(flowBaselines.get(b.ref));
              const aNow=await fingerprint(a);if(!observationOpen)return;
              probe.aBusinessFingerprintUnchanged=aNow===aCommitted;
              const bNow=await fingerprint(b);if(!observationOpen)return;
              probe.bBusinessFingerprintUnchanged=bNow===bPending;
            })(),"post-failure late A observation budget",4_500);
          }catch(probeError){
            probe.captureFailed=true;
            probe.observationTimedOut=probeError instanceof Error&&probeError.message==="post-failure late A observation budget";
          }finally{
            observationOpen=false;
            probe.heldAction={responseReceived:action.responseReceived,finished:action.finished,failed:action.failed};
            probe.aCompletionRequests=diagnosticCount(a.completionRequests);probe.bCompletionRequests=diagnosticCount(b.completionRequests);
            probe.browserPasswordPosts=diagnosticCount(page.observed.passwordPosts);
            probe.noSecondActionObserved=page.observed.passwordPosts===beforePosts+1;
          }
        }catch{diagnostic.postFailureReleaseObservation={captureFailed:true};}
        throw error;
      }
      await flowUnchanged(page,b);
      proxy.release(plan);
      await until(async()=>action.finished||action.failed,"same held late A transport settled");
      await page.quiet();
      check(await page.attribute('input[name="operationRef"]', "value") === b.ref && await page.has('input[name="newPassword"]'), "late A must not replace B editor");
      check(!(await page.messageIncludes("已保存并核验。")),"late A cannot display success for B");await flowUnchanged(page,b);
      check(page.observed.passwordPosts===beforePosts+1,"late A was not replayed");
      check(a.completionRequests === 1 && await fingerprint(a) === aCommitted && await fingerprint(b) === bPending && b.completionRequests === 0 && page.observed.blockedExternal === 0, "late response has no B business effects");
      scenarioSummaries.push({scenario:"late-A-B",aCompletionRequests:a.completionRequests,bCompletionRequests:b.completionRequests,
        bCookiePreserved:true,bFlowEnvelopeUnchanged:true,bEditorPreserved:true,heldActionMatched:true,bBusinessFingerprintUnchanged:true,
        aResponseFinished:action.finished,aResponseCancelled:action.failed});
    } finally { await page.close(); }
    passedSummary = { fixture: "GET350_NEXT_PROTOCOL", passed: true, logicalScenarios: 3,
      observedSourceRevision, scenarios:scenarioSummaries, transportObservations, enhancedLossBoundaries: 2, runtimeVersions:{node:process.versions.node,...frameworks,chrome:version.product},
      realPGProducer: true, AuthJsOAuthAcceptance: false, maintenanceDisabled: false,
      providerExecutionWorkersDisabled: true, chromeChildEndpointOwned:true, summariesContainBodiesOrSecrets: false,
      source:actualSource };
  } finally {
    let cleanupFailed = false;
    // Snapshot descendants while the owned leader still exists, before Browser.close.
    try{rememberGroup(chromeProcess);}catch{cleanupFailed=true;}
    if (cdp) { try { await cdp.call("Browser.close"); } catch {} cdp.close(); }
    for (const cleanup of [...[...ownedGroups.keys()].reverse().map(owned=>()=>stop(owned)),
      () => proxy.close(), () => controlOwned?.close(), () => app?.close(), () => pool?.end()]) {
      try { await cleanup(); } catch { cleanupFailed = true; }
    }
    process.chdir(sourceCwd);
    // Unknown/nonempty groups fail and retain private work roots; do not pretend
    // runner-level recycling was our own verified cleanup.
    const groupsEmpty=[...ownedGroups.values()].every(group=>group.closed);
    if(!groupsEmpty)cleanupFailed=true;
    if(groupsEmpty)try {
      check(await realpath(project) === project && dirname(project) === web && basename(project).startsWith(".get350-next-protocol-"), "owned project cleanup scope");
      await rm(project, { recursive: true });
    } catch { cleanupFailed = true; }
    if(groupsEmpty)try {
      check(await realpath(runtime) === runtime && basename(runtime).startsWith("get350-next-protocol-"), "owned runtime cleanup scope");
      await rm(runtime, { recursive: true });
    } catch { cleanupFailed = true; }
    try { if(actualSource)await sourceMatches(repo,actualSource); if(frameworkCheck)await frameworkCheck(); } catch { cleanupFailed = true; }
    check(!cleanupFailed, "owned fixture cleanup failed");
  }
  check(passedSummary, "protocol did not reach all three scenarios");
  passedSummary.sourceUnchangedDuringRun=true;
  passedSummary.ownedProcessGroupsEmpty=[...ownedGroups.values()].every(group=>group.closed);
  passedSummary.ownedProcessGroupCount=ownedGroups.size;
  phase = "passed"; await writeReceipt(passedSummary); console.log(JSON.stringify(passedSummary));
}
void main().catch(async (error:unknown) => {
  const failure = {fixture:"GET350_NEXT_PROTOCOL",passed:false,failureCode:error instanceof Error?(FIXTURE_FAILURE_CODES.get(error.message)??"UNCLASSIFIED_ERROR"):"NON_ERROR_THROWN",lastSetupHttpStatus:typeof lastSetupHttpStatus==="number"&&Number.isInteger(lastSetupHttpStatus)&&lastSetupHttpStatus>=100&&lastSetupHttpStatus<=599?lastSetupHttpStatus:null,transportDiagnostic:lastTransportDiagnostic,networkQuietDiagnostic:lastQuietNetworkObservation,lateNavigationDiagnostic:lastLateNavigationDiagnostic,cdpCommandErrorDiagnostic:cdpCommandErrorObservation(error),phase,observedSourceRevision,source:actualSource??"not-bound",nextBuildDiagnostic:nextBuildDiagnostic??"not-started",ownedProcessGroupsEmpty:[...ownedGroups.values()].every(group=>group.closed),ownedProcessGroupCount:ownedGroups.size,scenarios:completedScenarios};
  try { await writeReceipt(failure); } catch { /* CI still fails; never upload private diagnostics instead. */ }
  console.error(JSON.stringify(failure)); process.exitCode = 1;
});
