/** No browser dependency: Node 22 WebSocket + the official CDP domains. */
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PASSWORD_PATH } from "./get350NextProtocolApp.js";

// Last observed setup status only; never headers, body or a capability.
export let lastSetupHttpStatus:number|null=null;
// Associate bounded diagnostics with the same rejected Error, not cleanup calls.
export type CdpCommandErrorObservation={method:string;code:number|null;kind:string};
const CDP_COMMAND_METHODS=new Map(["Browser.close","Browser.getVersion","DOM.enable","DOM.focus","DOM.getAttributes","DOM.getBoxModel","DOM.getDocument","DOM.getOuterHTML","DOM.querySelector","DOM.scrollIntoViewIfNeeded","DOM.setAttributeValue","Emulation.setScriptExecutionDisabled","Fetch.continueRequest","Fetch.enable","Fetch.failRequest","Input.dispatchKeyEvent","Input.dispatchMouseEvent","Input.insertText","Network.enable","Network.setCacheDisabled","Network.setUserAgentOverride","Page.enable","Page.getNavigationHistory","Page.navigate","Page.reload","Runtime.callFunctionOn","Runtime.evaluate","Runtime.releaseObject","Target.attachToTarget","Target.createBrowserContext","Target.createTarget","Target.disposeBrowserContext"].map(value=>[value,value] as const));
const CDP_ERROR_MESSAGE_KINDS=new Map<string,string>([["Could not find node with given id","NODE_NOT_FOUND"],["No node with given id found","NODE_NOT_FOUND"],["Node is detached from document","NODE_DETACHED"],["Cannot find context with specified id","CONTEXT_NOT_FOUND"],["Cannot find default execution context","CONTEXT_NOT_FOUND"],["Execution context was destroyed.","CONTEXT_DESTROYED"],["Execution context was destroyed","CONTEXT_DESTROYED"],["Could not compute box model.","BOX_MODEL_UNAVAILABLE"],["Could not find object with given id","OBJECT_NOT_FOUND"],["Could not find document","DOCUMENT_NOT_FOUND"],["Cannot find frame with id","FRAME_NOT_FOUND"],["Target closed.","TARGET_CLOSED"],["Not attached to an active page","PAGE_NOT_ATTACHED"]]);
const CDP_COMMAND_ERROR_OBSERVATIONS=new WeakMap<Error,CdpCommandErrorObservation>();
export function cdpCommandErrorObservation(error:unknown):CdpCommandErrorObservation|null{
  return error instanceof Error?CDP_COMMAND_ERROR_OBSERVATIONS.get(error)??null:null;
}

export type QuietNetworkObservation={pending:number|null;started:number|null;finished:number|null;failed:number|null;lastEventAgeMs:number|null;truncated:boolean;active:Array<{method:string;resourceType:string;routeClass:string;currentMainDocument:boolean|null;ageMs:number|null}>}|{captureFailed:true};
export let lastQuietNetworkObservation:QuietNetworkObservation|null=null;
const OBSERVED_NETWORK_TYPES=new Map(["Document","Stylesheet","Image","Media","Font","Script","TextTrack","XHR","Fetch","Prefetch","EventSource","WebSocket","Manifest","SignedExchange","Ping","CSPViolationReport","Preflight","Other"].map(value=>[value,value] as const));
// Exact allowlists only: unknown browser messages never escape as text or hashes.
const B_NAVIGATION_FAILURE_KINDS=new Map(["net::ERR_ABORTED","net::ERR_CONTENT_LENGTH_MISMATCH","net::ERR_INCOMPLETE_CHUNKED_ENCODING","net::ERR_INVALID_CHUNKED_ENCODING","net::ERR_CONNECTION_CLOSED","net::ERR_CONNECTION_RESET","net::ERR_EMPTY_RESPONSE","net::ERR_FAILED","net::ERR_HTTP_RESPONSE_CODE_FAILURE"].map(value=>[value,value] as const));
const B_NAVIGATION_MIME_KINDS=new Map([["text/x-component","RSC"],["text/html","HTML"],["application/json","JSON"]]);
const safeNetworkCount=(value:unknown)=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0&&value<=1_000_000?value:null;
function observedRouteClass(value:string){try{const url=new URL(value);if(url.pathname===PASSWORD_PATH)return "password";if(url.pathname==="/__get350/setup")return "fixture-setup";if(url.pathname==="/__get350/inspect")return "fixture-inspect";if(url.pathname.startsWith("/_next/"))return "next-resource";if(url.protocol==="data:")return "embedded";if(url.pathname==="/")return "root-document";return "other";}catch{return "unclassified";}}
export type ProtocolAction = {requestId:string;keyHash:string;ordinal:number;enhanced:boolean;responseReceived:boolean;status:number;finished:boolean;failed:boolean};
export type ProtocolFlow = {matches:boolean;live:boolean;hasAttempt:boolean;validEnvelope:boolean;
  createdAtHash:string;expHash:string;iatHash:string;jtiHash:string;envelopeHash:string};
type Params = Record<string, unknown>;
type Message = { id?: number; sessionId?: string; method?: string; params?: Params; result?: unknown; error?: unknown };
export class ProtocolCdp {
  private sequence = 0;
  private waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; method:string }>();
  private handlers = new Map<string, Set<(params: Params) => void>>();
  private constructor(private socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as Message;
      if (message.id !== undefined) {
        const pending = this.waiting.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer); this.waiting.delete(message.id);
        if (message.error) {
          const error=new Error("CDP command rejected");
          const detail:{code?:unknown;message?:unknown}=typeof message.error==="object"&&message.error!==null?message.error as {code?:unknown;message?:unknown}:{};
          CDP_COMMAND_ERROR_OBSERVATIONS.set(error,Object.freeze({
            method:CDP_COMMAND_METHODS.get(pending.method)??"OTHER",
            code:typeof detail.code==="number"&&Number.isSafeInteger(detail.code)&&detail.code>=-32768&&detail.code<=32767?detail.code:null,
            kind:typeof detail.message==="string"?CDP_ERROR_MESSAGE_KINDS.get(detail.message)??"OTHER":"OTHER",
          }));
          pending.reject(error);
        }
        else pending.resolve(message.result);
      } else if (message.method) {
        for (const handler of this.handlers.get(`${message.sessionId ?? ""}:${message.method}`) ?? []) handler(message.params ?? {});
      }
    });
    socket.addEventListener("close", () => {
      for (const pending of this.waiting.values()) { clearTimeout(pending.timer); pending.reject(new Error("Owned CDP socket closed")); }
      this.waiting.clear();
    });
  }
  static async connect(ownedPort:number,expectedBrowserUUID:string) {
    if(!Number.isInteger(ownedPort)||ownedPort<1||ownedPort>65535)throw new Error("Invalid owned Chrome port");
    const metadata=await fetch(`http://127.0.0.1:${ownedPort}/json/version`,{redirect:"error",signal:AbortSignal.timeout(5000)});
    if(!metadata.ok)throw new Error("Owned Chrome metadata unavailable");
    const value=await metadata.json() as {webSocketDebuggerUrl?:unknown};
    if(typeof value.webSocketDebuggerUrl!=="string")throw new Error("Missing owned Chrome endpoint");
    const parsed=new URL(value.webSocketDebuggerUrl);
    const browser=/^\/devtools\/browser\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(parsed.pathname)?.[1];
    if(parsed.protocol!=="ws:"||parsed.hostname!=="127.0.0.1"||parsed.port!==String(ownedPort)||parsed.username||parsed.password||parsed.search||parsed.hash||!browser||browser!==expectedBrowserUUID)throw new Error("Unrelated Chrome endpoint refused");
    // Authority comes solely from our reserved port, never a file or page input.
    const socket=new WebSocket(`ws://127.0.0.1:${ownedPort}/devtools/browser/${browser}`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error("CDP connection timeout")); }, 10_000);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP connection failed")); }, { once: true });
    });
    return new ProtocolCdp(socket);
  }
  call<T = Params>(method: string, params: Params = {}, sessionId?: string): Promise<T> {
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10_000);
      this.waiting.set(id, { resolve: (value) => resolve(value as T), reject, timer, method });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(session: string, method: string, handler: (params: Params) => void) {
    const key = `${session}:${method}`;
    if (!this.handlers.has(key)) this.handlers.set(key, new Set());
    this.handlers.get(key)!.add(handler);
    return () => { this.handlers.get(key)?.delete(handler); };
  }
  close() { this.socket.close(); }
}

export async function until(condition: () => Promise<boolean>, label: string, milliseconds = 20_000) {
  const deadline = Date.now() + milliseconds;
  while (Date.now() < deadline) {
    try { if (await condition()) return; } catch { /* A document/context may be replaced during real navigation. */ }
    await delay(50);
  }
  throw new Error(`Protocol condition timed out: ${label}`);
}

export class ProtocolPage {
  readonly observed = { passwordPosts: 0, actionHeaders: 0, native303: 0, failedPasswordRequests: 0, finishedPasswordRequests: 0, blockedExternal: 0 };
  private passwordRequests = new Set<string>();
  private bNavigationRequests = new Set<string>();
  private bNavigation = {passwordGets:0,targetGets:0,responseReceived:0,finished:0,failed:0,lastStatus:null as number|null,
    lastResourceType:"UNOBSERVED",lastMimeKind:"UNOBSERVED",failureKind:"UNOBSERVED",canceled:null as boolean|null,blocked:null as boolean|null};
  private actions = new Map<string,ProtocolAction>();
  private activeRequests = new Set<string>();
  private requestMetadata=new Map<string,{method:string;resourceType:string;routeClass:string;loaderId:string;startedAt:number}>();
  private networkTotals={started:0,finished:0,failed:0};
  private mainLoaderId="";
  private networkChangedAt = Date.now();
  private disposers: Array<() => void> = [];
  private constructor(private cdp: ProtocolCdp, readonly session: string, readonly context: string, private origin: string) {}
  static async create(cdp: ProtocolCdp, origin: string) {
    const { browserContextId } = await cdp.call<{ browserContextId: string }>("Target.createBrowserContext");
    const { targetId } = await cdp.call<{ targetId: string }>("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await cdp.call<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    const page = new ProtocolPage(cdp, sessionId, browserContextId, origin);
    page.disposers.push(cdp.on(sessionId,"Page.frameNavigated",params=>{try{const frame=params.frame as {parentId?:unknown;loaderId?:unknown};if(frame&&!frame.parentId&&typeof frame.loaderId==="string")page.mainLoaderId=frame.loaderId;}catch{}}));
    page.disposers.push(cdp.on(sessionId, "Fetch.requestPaused", (params) => {
      const request = params.request as { url: string };
      const local = request.url.startsWith("data:") || request.url === "about:blank" || new URL(request.url).origin === origin;
      if (!local) page.observed.blockedExternal++;
      void page.call(local ? "Fetch.continueRequest" : "Fetch.failRequest", local
        ? { requestId: params.requestId } : { requestId: params.requestId, errorReason: "BlockedByClient" }).catch(() => {});
    }));
    page.disposers.push(cdp.on(sessionId, "Network.requestWillBeSent", (params) => {
      const request = params.request as { url: string; method: string; headers:Record<string,string> };
      page.activeRequests.add(String(params.requestId)); page.networkChangedAt = Date.now();
      try{page.networkTotals.started++;
      page.requestMetadata.set(String(params.requestId),{method:request.method==="GET"?"GET":request.method==="POST"?"POST":"OTHER",resourceType:typeof params.type==="string"?(OBSERVED_NETWORK_TYPES.get(params.type)??"Other"):"Other",routeClass:observedRouteClass(request.url),loaderId:typeof params.loaderId==="string"?params.loaderId:"",startedAt:Date.now()});}catch{}
      if (new URL(request.url).pathname !== PASSWORD_PATH) return;
      try{if(request.method==="GET"){
        page.bNavigation.passwordGets++;const url=new URL(request.url);
        if(url.origin===origin&&url.searchParams.get("fixtureNavigation")==="b"){
          page.bNavigation.targetGets++;page.bNavigationRequests.add(String(params.requestId));
          page.bNavigation.lastResourceType=typeof params.type==="string"?(OBSERVED_NETWORK_TYPES.get(params.type)??"Other"):"Other";
        }
      }}catch{}
      if (request.method === "POST") {
        const requestId=String(params.requestId),url=new URL(request.url);
        page.passwordRequests.add(requestId);page.observed.passwordPosts++;
        const action=Object.entries(request.headers).find(([name])=>name.toLowerCase()==="next-action")?.[1]??"";
        const keyHash=createHash("sha256").update(`POST\0${url.pathname}${url.search}\0${action}`).digest("hex");
        page.actions.set(requestId,{requestId,keyHash,ordinal:page.observed.passwordPosts,enhanced:Boolean(action),responseReceived:false,status:0,finished:false,failed:false});
      }
      const redirect = params.redirectResponse as { status?: number } | undefined;
      if (request.method === "GET" && redirect?.status === 303) page.observed.native303++;
    }));
    page.disposers.push(cdp.on(sessionId, "Network.responseReceived", (params) => {
      try{if(page.bNavigationRequests.has(String(params.requestId))){
        page.bNavigation.responseReceived++;const response=params.response as {status:number;mimeType?:unknown},status=response.status;
        page.bNavigation.lastStatus=Number.isInteger(status)&&status>=100&&status<=599?status:null;
        page.bNavigation.lastMimeKind=typeof response.mimeType==="string"?(B_NAVIGATION_MIME_KINDS.get(response.mimeType)??"OTHER"):"UNOBSERVED";
      }}catch{}
      if (page.passwordRequests.has(String(params.requestId))) page.observed.actionHeaders++;
      const action=page.actions.get(String(params.requestId));
      if(action){action.responseReceived=true;action.status=(params.response as {status:number}).status;}
    }));
    page.disposers.push(cdp.on(sessionId, "Network.loadingFailed", (params) => {
      page.activeRequests.delete(String(params.requestId)); page.networkChangedAt = Date.now();
      try{page.networkTotals.failed++;page.requestMetadata.delete(String(params.requestId));}catch{}
      try{if(page.bNavigationRequests.has(String(params.requestId))){
        page.bNavigation.failed++;
        page.bNavigation.failureKind=typeof params.errorText==="string"?(B_NAVIGATION_FAILURE_KINDS.get(params.errorText)??"OTHER"):"UNOBSERVED";
        page.bNavigation.canceled=typeof params.canceled==="boolean"?params.canceled:null;
        page.bNavigation.blocked=typeof params.blockedReason==="string";
      }}catch{}
      if (page.passwordRequests.has(String(params.requestId))) page.observed.failedPasswordRequests++;
      const action=page.actions.get(String(params.requestId));if(action)action.failed=true;
    }));
    page.disposers.push(cdp.on(sessionId, "Network.loadingFinished", (params) => {
      page.activeRequests.delete(String(params.requestId)); page.networkChangedAt = Date.now();
      try{page.networkTotals.finished++;page.requestMetadata.delete(String(params.requestId));}catch{}
      try{if(page.bNavigationRequests.has(String(params.requestId)))page.bNavigation.finished++;}catch{}
      if (page.passwordRequests.has(String(params.requestId))) page.observed.finishedPasswordRequests++;
      const action=page.actions.get(String(params.requestId));if(action)action.finished=true;
    }));
    for (const method of ["Page.enable", "DOM.enable"]) await page.call(method);
    await page.call("Network.enable", { maxPostDataSize: 0 });
    await page.call("Network.setCacheDisabled", { cacheDisabled: true });
    await page.call("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    return page;
  }
  call<T = Params>(method: string, params: Params = {}) { return this.cdp.call<T>(method, params, this.session); }
  async evaluate<T>(expression: string) {
    const response = await this.call<{ result: { value?: T }; exceptionDetails?: unknown }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    // Never mirror the expression, exception details, DOM or returned data to logs.
    if (response.exceptionDetails) throw new Error("Fixture page evaluation failed");
    return response.result.value as T;
  }
  private async pageFunction<T>(functionDeclaration:string,values:unknown[]):Promise<T>{
    const global=await this.call<{result:{objectId?:string};exceptionDetails?:unknown}>("Runtime.evaluate",{expression:"globalThis",returnByValue:false});
    const objectId=global.result.objectId;
    if(global.exceptionDetails||!objectId)throw new Error("Missing current fixture page context");
    try{
      const response=await this.call<{result:{value?:T};exceptionDetails?:unknown}>("Runtime.callFunctionOn",{
        objectId,functionDeclaration,arguments:values.map(value=>({value})),awaitPromise:true,returnByValue:true});
      if(response.exceptionDetails)throw new Error("Fixture page function failed");
      return response.result.value as T;
    }finally{await this.call("Runtime.releaseObject",{objectId}).catch(()=>{});}
  }
  async navigate(url: string) {
    if (new URL(url).origin !== this.origin) throw new Error("Cross-origin fixture navigation refused");
    await this.documentLoad(async () => {
      const result = await this.call<{ errorText?: string }>("Page.navigate", { url });
      if (result.errorText) throw new Error("Fixture navigation failed");
    });
  }
  private async documentLoad(start: () => Promise<unknown>) {
    let resolve!: () => void;
    const loaded = new Promise<void>((done) => { resolve = done; });
    const dispose = this.cdp.on(this.session, "Page.loadEventFired", () => resolve());
    const timer = setTimeout(() => resolve(), 20_000);
    let actualLoad = false;
    const mark = this.cdp.on(this.session, "Page.loadEventFired", () => { actualLoad = true; });
    try { await start(); await loaded; if (!actualLoad) throw new Error("Real page load timed out"); }
    finally { clearTimeout(timer); dispose(); mark(); }
  }
  reload() { return this.documentLoad(() => this.call("Page.reload", { ignoreCache: true })); }
  async quiet() {
    lastQuietNetworkObservation=null;
    try{return await until(async () => this.activeRequests.size === 0 && Date.now() - this.networkChangedAt > 250, "settled real network");}
    catch(error){
      try{const now=Date.now(),active:Array<{method:string;resourceType:string;routeClass:string;currentMainDocument:boolean|null;ageMs:number|null}>=[];
      for(const id of [...this.activeRequests].slice(0,16)){const meta=this.requestMetadata.get(id);active.push({method:meta?.method??"UNOBSERVED",resourceType:meta?.resourceType??"Other",routeClass:meta?.routeClass??"unclassified",currentMainDocument:meta?.loaderId&&this.mainLoaderId?meta.loaderId===this.mainLoaderId:null,ageMs:meta?safeNetworkCount(now-meta.startedAt):null});}
      lastQuietNetworkObservation={pending:safeNetworkCount(this.activeRequests.size),started:safeNetworkCount(this.networkTotals.started),finished:safeNetworkCount(this.networkTotals.finished),failed:safeNetworkCount(this.networkTotals.failed),lastEventAgeMs:safeNetworkCount(now-this.networkChangedAt),truncated:this.activeRequests.size>16,active};}catch{lastQuietNetworkObservation={captureFailed:true};}
      throw error;
    }
  }
  navigationObservation(){
    const n=this.bNavigation;return {passwordGets:safeNetworkCount(n.passwordGets),targetGets:safeNetworkCount(n.targetGets),
      responseReceived:safeNetworkCount(n.responseReceived),finished:safeNetworkCount(n.finished),failed:safeNetworkCount(n.failed),lastStatus:n.lastStatus,
      lastResourceType:n.lastResourceType,lastMimeKind:n.lastMimeKind,failureKind:n.failureKind,canceled:n.canceled,blocked:n.blocked};
  }
  async currentUrl() {
    const history = await this.call<{ currentIndex: number; entries: Array<{ url: string }> }>("Page.getNavigationHistory");
    return history.entries[history.currentIndex]!.url;
  }
  async node(selector: string) {
    const { root } = await this.call<{ root: { nodeId: number } }>("DOM.getDocument", { depth: 0 });
    const { nodeId } = await this.call<{ nodeId: number }>("DOM.querySelector", { nodeId: root.nodeId, selector });
    return nodeId;
  }
  async has(selector: string) { return Boolean(await this.node(selector)); }
  async attribute(selector: string, name: string) {
    const nodeId = await this.node(selector); if (!nodeId) return undefined;
    const { attributes } = await this.call<{ attributes: string[] }>("DOM.getAttributes", { nodeId });
    for (let i = 0; i < attributes.length; i += 2) if (attributes[i] === name) return attributes[i + 1];
    return undefined;
  }
  async messageIncludes(text: string) {
    const nodeId = await this.node('[aria-live="polite"]'); if (!nodeId) return false;
    const { outerHTML } = await this.call<{ outerHTML: string }>("DOM.getOuterHTML", { nodeId });
    return outerHTML.includes(text); // Only the boolean escapes this method.
  }
  async click(selector: string) {
    const nodeId = await this.node(selector); if (!nodeId) throw new Error("Missing fixture click target");
    await this.call("DOM.scrollIntoViewIfNeeded", { nodeId });
    const { model } = await this.call<{ model: { content: number[] } }>("DOM.getBoxModel", { nodeId });
    const q = model.content, x = (q[0]! + q[2]! + q[4]! + q[6]!) / 4, y = (q[1]! + q[3]! + q[5]! + q[7]!) / 4;
    await this.call("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.call("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }
  async passwordAction(afterCount:number) {
    await until(async()=>this.observed.passwordPosts>afterCount,"specific browser Action request");
    if(this.observed.passwordPosts!==afterCount+1)throw new Error("Ambiguous browser Action dispatch");
    const action=[...this.actions.values()].find(entry=>entry.ordinal===afterCount+1);
    if(!action)throw new Error("Missing specific Action tracker");return action;
  }
  async setAttribute(selector:string,name:string,value:string){
    const nodeId=await this.node(selector);if(!nodeId)throw new Error("Missing controlled DOM target");
    await this.call("DOM.setAttributeValue",{nodeId,name,value});
  }
  async textIncludes(selector:string,text:string){
    const nodeId=await this.node(selector);if(!nodeId)return false;
    const {outerHTML}=await this.call<{outerHTML:string}>("DOM.getOuterHTML",{nodeId});return outerHTML.includes(text);
  }
  async visible(selector:string){
    const nodeId=await this.node(selector);if(!nodeId)return false;
    const {model}=await this.call<{model:{width:number;height:number}}>("DOM.getBoxModel",{nodeId});return model.width>0&&model.height>0;
  }
  async fillPassword(value: string) {
    // Bridge hydration can precede the streamed route editor becoming actionable.
    await until(()=>this.pageFunction<boolean>(
      "function(){const input=document.querySelector('input[name=\"newPassword\"]');if(!(input instanceof HTMLInputElement)||input.type!==\"password\"||!input.isConnected||input.disabled||input.readOnly||input.matches(\":disabled\")||input.closest(\"[inert]\"))return false;if(!input.checkVisibility({opacityProperty:true,visibilityProperty:true})||input.getClientRects().length===0)return false;const box=input.getBoundingClientRect();return Number.isFinite(box.width)&&Number.isFinite(box.height)&&box.width>0&&box.height>0;}",[]), "actionable production password input");
    const nodeId = await this.node('input[name="newPassword"]'); if (!nodeId) throw new Error("Missing production password input");
    await this.call("DOM.focus", { nodeId });
    await this.call("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
    await this.call("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 0, windowsVirtualKeyCode: 65 });
    await this.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", windowsVirtualKeyCode: 8 });
    await this.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", windowsVirtualKeyCode: 8 });
    await this.call("Input.insertText", { text: value });
  }
  async setup(slot: string, key: string) {
    lastSetupHttpStatus=null;
    const ready=await this.pageFunction<{ok:boolean;status:number}>(
      'async function(slot,key){const r=await fetch("/__get350/setup",{method:"POST",headers:{"content-type":"application/json","x-get350-control":key},body:JSON.stringify({slot})});await r.arrayBuffer();return {ok:r.ok,status:r.status};}',
      [slot,key]);
    lastSetupHttpStatus=Number.isInteger(ready.status)&&ready.status>=100&&ready.status<=599?ready.status:null;
    if (ready.ok!==true) throw new Error("Protected Next setup failed");
  }
  async inspect(ref: string, key: string):Promise<ProtocolFlow> {
    const value=await this.pageFunction<ProtocolFlow|null>(
      'async function(ref,key){const r=await fetch("/__get350/inspect",{method:"POST",headers:{"content-type":"application/json","x-get350-control":key},body:JSON.stringify({ref})});if(!r.ok)return null;const x=await r.json();return {matches:x.matches,live:x.live,hasAttempt:x.hasAttempt,validEnvelope:x.validEnvelope,createdAtHash:x.createdAtHash,expHash:x.expHash,iatHash:x.iatHash,jtiHash:x.jtiHash,envelopeHash:x.envelopeHash};}',
      [ref,key]);
    if(!value || !value.matches || !value.live || !value.hasAttempt || !value.validEnvelope ||
      ![value.createdAtHash,value.expHash,value.iatHash,value.jtiHash,value.envelopeHash].every(digest=>typeof digest==="string"&&/^[0-9a-f]{64}$/.test(digest)))throw new Error("Invalid real flow-cookie inspection");
    return value;
  }
  async ready() {
    await until(() => this.evaluate<boolean>('document.readyState==="complete"&&document.documentElement.dataset.get350Ready==="true"'), "fixture hydration");
    await this.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true))))');
  }
  async close() { for (const dispose of this.disposers) dispose(); await this.cdp.call("Target.disposeBrowserContext", { browserContextId: this.context }); }
}
