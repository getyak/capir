import { ProtocolCdp, until } from "./get350NextProtocolCdp.js";
import { requireProtocol } from "./get452DirectoryProtocolHost.js";

export const directoryInput = 'form[action="/workspace/people"] input[name="query"]';
const observer = `(() => {
  const state = { paste:0, composing:0, composed:0, input:0 };
  Object.defineProperty(window,"__get452Events",{value:state});
  for (const [type,key] of [["paste","paste"],["compositionstart","composing"],["compositionend","composed"],["input","input"]])
    document.addEventListener(type,event=>{if(event.isTrusted && event.target instanceof HTMLInputElement && event.target.name==="query")state[key]++;},true);
})()`;
const cookieReasons = new Set(["NameValuePairExceedsMaxSize", "DisallowedCharacter", "SameSiteNoneInsecure", "SecureOnly", "SyntaxError"]);
const resourceKinds = new Set(["Document", "Stylesheet", "Image", "Media", "Font", "Script", "TextTrack", "XHR", "Fetch", "Prefetch", "EventSource", "WebSocket", "Manifest", "SignedExchange", "Ping", "CSPViolationReport", "Preflight", "FedCM", "Other"]);
const schemeKinds = new Map([["http:", "http"], ["https:", "https"], ["data:", "data"], ["about:", "about"], ["blob:", "blob"]]);
const initiatorKinds = new Set(["parser", "script", "preload", "SignedExchange", "preflight", "FedCM", "other"]);
function metadataKind(path: string): string {
  return path === "/favicon.ico" ? "favicon" : path === "/manifest.webmanifest" ? "manifest" : path === "/icon" ? "icon" : "none";
}
function routeKind(path: string): string {
  return path === "/login" ? "login" : path === "/onboarding" ? "onboarding" : path === "/workspace/people" ? "directory"
    : path === "/api/auth/persistent" ? "auth_persistent" : path === "/api/auth/session" ? "auth_session"
      : path.startsWith("/api/auth/callback/") ? "auth_callback" : path.startsWith("/api/auth/") ? "auth_other"
        : path.startsWith("/_next/") ? "asset" : "other";
}
type FetchObservation = { decision: "continue" | "fail"; command: "requested" | "acknowledged" | "rejected"; correlation: "matched" | "ambiguous" };
type ExtraObservation = "unobserved" | "seen" | "ambiguous";
function clickProbe(value: unknown, target: string): Record<string, unknown> {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const finite = (key: string) => typeof row[key] === "number" && Number.isFinite(row[key])
    ? Math.round(Math.max(-1_000_000, Math.min(1_000_000, row[key] as number)) * 1000) / 1000 : null;
  const flag = (key: string) => typeof row[key] === "boolean" ? row[key] : null;
  const tag = (key: string) => ["INPUT", "BUTTON", "LABEL", "DIV", "HEADER", "NAV", "MAIN", "FORM", "SECTION", "ASIDE", "BODY", "HTML", "SPAN", "A", "SVG", "NONE"].includes(row[key] as string) ? row[key] : "OTHER";
  return { target, found: flag("found"), disabled: flag("disabled"), connected: flag("connected"), active: flag("active"),
    targetTag: tag("targetTag"), hitTag: tag("hitTag"),
    hitRelation: ["self", "descendant", "ancestor", "other", "none"].includes(row.hitRelation as string) ? row.hitRelation : "unknown",
    left: finite("left"), top: finite("top"), width: finite("width"), height: finite("height"),
    viewportWidth: finite("viewportWidth"), viewportHeight: finite("viewportHeight"), scrollY: finite("scrollY"),
    scrollBehavior: ["auto", "smooth"].includes(row.scrollBehavior as string) ? row.scrollBehavior : "other" };
}
type IconLifetime = { id:string; ordinal:number; requestOrder:number; mainDocumentReceiveCountAtRequest:number; reportedDocumentRoute:string;
  reportedFrameRelation:"main"|"other"|"unobserved"; ambiguous:boolean; responseStatus:number|null; responseOrder:number|null;
  finished:number; failed:number; terminalOrder:number|null; canceled:boolean|null; failure:"aborted"|"failed"|"connection_closed"|"other"|"unobserved" };
export class DirectoryProtocolPage {
  readonly observed = { blockedExternal: 0, runtimeErrors: 0, consoleErrors: 0, cookieBlocks: {} as Record<string, number>, maxRequestTargetBytes: 0,
    lastDocumentStatus: null as number | null, lastDocumentRoute: "unobserved", httpErrors: {} as Record<string, number> };
  private disposers: Array<() => void> = [];
  private active = new Set<string>();
  // Network settlement belongs to the committed document. Keep the global
  // transport ledger above intact: a replaced document's request may never
  // report a terminal event, and replacement does not prove it finished.
  private documentActive = new Set<string>();
  private documentCommitted = false;
  private replacedDocumentRequests = 0;
  private activeKinds = new Map<string, { route: string; method: string; type: string; scheme: string; metadata: string; initiator: string; responseSeen: boolean; responseType: string; fetch: FetchObservation | null;
    singleHop: boolean; loaderId: string; frameId: string; requestExtra: ExtraObservation; responseExtra: ExtraObservation; extraStatus: number | null; dataSeen: boolean }>();
  private unmatchedFetchPausesUpTo1024 = 0;
  private httpStatuses = new Map<string, number>();
  private changedAt = Date.now();
  private observerFailed = false;
  private lastClickProbe: Record<string, unknown> | null = null;
  private mainLoaderId = "";
  private transportIds = new Set<string>();
  private transportHistorySaturated = false;
  private iconIds=new Set<string>();
  private iconLifetime:IconLifetime[]=[];
  private iconOrder=0;
  private iconHistoryInvalid=false;
  private iconHistorySaturated=false;
  private mainDocumentSequence=0;
  private mainDocumentRoute="unobserved";
  private mainFrame="";
  private iconRouteAudit:ReturnType<ProtocolCdp["watchTerminalRoutes"]>|undefined;
  private iconTick(){if(this.iconOrder>=4096){this.iconHistorySaturated=true;return 4096;}return ++this.iconOrder;}
  private documentRoute(value:unknown){
    try{if(typeof value!=="string")return "unobserved";const url=new URL(value);return url.origin===this.origin?routeKind(url.pathname):"other_origin";}
    catch{return "unobserved";}
  }
  private noteMainDocument(value:Record<string,unknown>){
    try{const frame=value.frame as {parentId?:unknown;id?:unknown;url?:unknown}|undefined;
      if(!frame||frame.parentId)return;
      this.iconTick();if(this.mainDocumentSequence<64)this.mainDocumentSequence++;else this.iconHistorySaturated=true;
      this.mainFrame=typeof frame.id==="string"?frame.id:"";this.mainDocumentRoute=this.documentRoute(frame.url);
    }catch{this.iconHistoryInvalid=true;}
  }
  private noteIconStart(value:Record<string,unknown>){
    try{const request=value.request as {url?:unknown;method?:unknown}|undefined;
      if(request?.method!=="GET"||typeof request.url!=="string")return;
      const url=new URL(request.url);if(url.origin!==this.origin||url.pathname!=="/icon")return;
      const id=value.requestId;if(typeof id!=="string"){this.iconHistoryInvalid=true;return;}
      if(this.iconLifetime.length>=64){this.iconHistorySaturated=true;return;}
      const previous=this.iconLifetime.filter(row=>row.id===id);for(const row of previous)row.ambiguous=true;
      this.iconIds.add(id);const frame=typeof value.frameId==="string"?value.frameId:"";
      this.iconLifetime.push({id,ordinal:this.iconLifetime.length+1,requestOrder:this.iconTick(),mainDocumentReceiveCountAtRequest:this.mainDocumentSequence,
        reportedDocumentRoute:this.documentRoute(value.documentURL),reportedFrameRelation:!frame||!this.mainFrame?"unobserved":frame===this.mainFrame?"main":"other",
        ambiguous:previous.length>0||this.activeKinds.get(id)?.singleHop!==true,responseStatus:null,responseOrder:null,
        finished:0,failed:0,terminalOrder:null,canceled:null,failure:"unobserved"});
    }catch{this.iconHistoryInvalid=true;}
  }
  private noteIconResponse(value:Record<string,unknown>){
    try{const status=(value.response as {status?:unknown}|undefined)?.status;
      const rows=this.iconLifetime.filter(row=>row.id===value.requestId);if(!rows.length)return;const order=this.iconTick();
      for(const row of rows){row.responseStatus=typeof status==="number"&&Number.isInteger(status)&&status>=100&&status<=599?status:null;row.responseOrder=order;}
    }catch{this.iconHistoryInvalid=true;}
  }
  private noteIconTerminal(value:Record<string,unknown>,failed:boolean){
    try{const rows=this.iconLifetime.filter(row=>row.id===value.requestId);if(!rows.length)return;
      const order=this.iconTick();
      for(const row of rows){if(rows.length>1)row.ambiguous=true;
        if(failed)row.failed=Math.min(4096,row.failed+1);else row.finished=Math.min(4096,row.finished+1);
        row.terminalOrder=order;row.canceled=typeof value.canceled==="boolean"?value.canceled:null;
        row.failure=!failed?"unobserved":value.errorText==="net::ERR_ABORTED"?"aborted":value.errorText==="net::ERR_FAILED"?"failed":value.errorText==="net::ERR_CONNECTION_CLOSED"?"connection_closed":typeof value.errorText==="string"?"other":"unobserved";
      }
    }catch{this.iconHistoryInvalid=true;}
  }
  private firstTransportObservation(id: string): boolean {
    // Never evict a terminal/early ID and later mistake it for a first hop.
    // Saturation degrades only diagnostics; the original gate is unchanged.
    if (this.transportHistorySaturated || this.transportIds.has(id)) return false;
    if (this.transportIds.size >= 4096) { this.transportHistorySaturated = true; return false; }
    this.transportIds.add(id); return true;
  }
  private constructor(private cdp: ProtocolCdp, readonly session: string, readonly context: string, readonly origin: string) {}
  static async create(cdp: ProtocolCdp, origin: string) {
    const { browserContextId } = await cdp.call<{ browserContextId: string }>("Target.createBrowserContext");
    let page: DirectoryProtocolPage | undefined;
    try {
      const { targetId } = await cdp.call<{ targetId: string }>("Target.createTarget", { url: "about:blank", browserContextId });
      const { sessionId } = await cdp.call<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
      page = new DirectoryProtocolPage(cdp, sessionId, browserContextId, origin);
      const current = page;
      current.iconRouteAudit=cdp.watchTerminalRoutes(sessionId,current.iconIds);
      current.disposers.push(current.iconRouteAudit.dispose);
      current.disposers.push(cdp.on(sessionId, "Page.frameNavigated", value => {
        const frame = value.frame as { parentId?: unknown; id?: unknown; loaderId?: unknown } | undefined;
        if (!frame || frame.parentId) return;
        if (typeof frame.id !== "string" || !frame.id || typeof frame.loaderId !== "string" || !frame.loaderId) {
          current.documentCommitted = false; current.changedAt = Date.now(); return;
        }
        if (current.documentCommitted && current.mainFrame === frame.id && current.mainLoaderId === frame.loaderId) return;
        current.mainLoaderId = frame.loaderId;
        // Use Playwright's committed-document boundary, retaining every known
        // current-loader request, including navigation and early subresources.
        // Unknown-loader/other-frame requests remain blockers. No resource type or
        // pathname (including icons) is exempted from the current document.
        for (const id of current.documentActive) {
          const request = current.activeKinds.get(id);
          if (!request || request.frameId !== frame.id || !request.loaderId || request.loaderId === frame.loaderId) continue;
          current.documentActive.delete(id);
          current.replacedDocumentRequests = Math.min(4096, current.replacedDocumentRequests + 1);
        }
        current.documentCommitted = true;
        current.changedAt = Date.now();
      }));
      current.disposers.push(cdp.on(sessionId, "Fetch.requestPaused", value => {
        let observation: FetchObservation | undefined;
        try {
          const request = value.request as { url: string };
          const local = request.url === "about:blank" || request.url.startsWith("data:") || new URL(request.url).origin === origin;
          if (!local) current.observed.blockedExternal++;
          observation = { decision: local ? "continue" : "fail", command: "requested", correlation: "matched" };
          const pending = typeof value.networkId === "string" ? current.activeKinds.get(value.networkId) : undefined;
          if (pending && !pending.fetch) pending.fetch = observation;
          else if (pending?.fetch) pending.fetch.correlation = "ambiguous";
          else current.unmatchedFetchPausesUpTo1024 = Math.min(1024, current.unmatchedFetchPausesUpTo1024 + 1);
          // Capture this exact hop's observation, not a future map lookup. A
          // redirect replaces activeKinds, so its old command ACK cannot attach
          // itself to the new hop. An unmatched early pause is never guessed.
          const observedFetch = observation;
          void current.call(local ? "Fetch.continueRequest" : "Fetch.failRequest", local
            ? { requestId: value.requestId } : { requestId: value.requestId, errorReason: "BlockedByClient" })
            .then(() => { observedFetch.command = "acknowledged"; },
              () => { observedFetch.command = "rejected"; current.observerFailed = true; });
        } catch { if (observation) observation.command = "rejected"; current.observerFailed = true; }
      }));
      current.disposers.push(cdp.on(sessionId, "Network.requestWillBeSent", value => {
        try {
          const request = value.request as { url: string; method: string }, url = new URL(request.url);
          const initiator = value.initiator as { type?: unknown } | undefined;
          if (url.origin === origin) current.observed.maxRequestTargetBytes = Math.max(current.observed.maxRequestTargetBytes, Buffer.byteLength(url.pathname + url.search));
          requireProtocol(current.active.size < 1024, "BROWSER_REQUEST_BUDGET");
          const firstObservation = current.firstTransportObservation(String(value.requestId));
          const singleHop = firstObservation && !current.activeKinds.has(String(value.requestId)) && !value.redirectResponse;
          current.active.add(String(value.requestId)); current.changedAt = Date.now();
          current.documentActive.add(String(value.requestId));
          current.activeKinds.set(String(value.requestId), { route: routeKind(url.pathname),
            method: ["GET", "POST"].includes(request.method) ? request.method : "OTHER",
            type: typeof value.type === "string" && resourceKinds.has(value.type) ? value.type : "Other",
            scheme: schemeKinds.get(url.protocol) ?? "other", metadata: url.origin === origin ? metadataKind(url.pathname) : "none",
            initiator: typeof initiator?.type === "string" && initiatorKinds.has(initiator.type) ? initiator.type : "UNOBSERVED", responseSeen: false, responseType: "UNOBSERVED", fetch: null,
            singleHop, loaderId: typeof value.loaderId === "string" ? value.loaderId : "", frameId: typeof value.frameId === "string" ? value.frameId : "",
            requestExtra: singleHop ? "unobserved" : "ambiguous", responseExtra: singleHop ? "unobserved" : "ambiguous", extraStatus: null, dataSeen: false });
        } catch { current.observerFailed = true; }
      }));
      // Passive diagnostics only. ExtraInfo may precede its ordinary event and
      // RequestId is shared by redirect hops. Never guess an early event or
      // attach an old hop's information to a redirect/reused live entry.
      // No headers, cookies, bodies, URL/hash or raw loader/request IDs leave
      // this observer. Unobserved never means that a request was not sent.
      current.disposers.push(cdp.on(sessionId, "Network.requestWillBeSentExtraInfo", value => {
        const pending = current.activeKinds.get(String(value.requestId));
        if (!pending) { current.firstTransportObservation(String(value.requestId)); return; }
        pending.requestExtra = pending.singleHop && pending.requestExtra === "unobserved" ? "seen" : "ambiguous";
      }));
      current.disposers.push(cdp.on(sessionId, "Network.dataReceived", value => {
        const pending = current.activeKinds.get(String(value.requestId));
        if (pending?.singleHop) pending.dataSeen = true;
        else if (!pending) current.firstTransportObservation(String(value.requestId));
      }));
      for (const event of ["Network.loadingFinished", "Network.loadingFailed"]) current.disposers.push(cdp.on(sessionId, event, value => {
        current.firstTransportObservation(String(value.requestId));
        current.active.delete(String(value.requestId)); current.activeKinds.delete(String(value.requestId)); current.changedAt = Date.now();
        current.documentActive.delete(String(value.requestId));
      }));
      current.disposers.push(cdp.on(sessionId, "Network.responseReceived", value => {
        try {
          const response = value.response as { url: string; status: number }, path = new URL(response.url).pathname;
          const route = path === "/login" ? "login" : path === "/onboarding" ? "onboarding" : path === "/workspace/people" ? "directory"
            : path.startsWith("/api/auth/") ? "auth" : path.startsWith("/_next/") ? "asset" : "other";
          requireProtocol(Number.isInteger(response.status) && response.status >= 100 && response.status <= 599, "BROWSER_HTTP_STATUS");
          const requestKind = current.activeKinds.get(String(value.requestId));
          if (requestKind) {
            requestKind.responseSeen = true;
            requestKind.responseType = typeof value.type === "string" && resourceKinds.has(value.type) ? value.type : "Other";
          } else current.firstTransportObservation(String(value.requestId));
          const statusKey = `${routeKind(path)}:${requestKind?.method ?? "UNOBSERVED"}:${requestKind?.type ?? "Other"}:${response.status}`;
          current.httpStatuses.set(statusKey, (current.httpStatuses.get(statusKey) ?? 0) + 1);
          if (value.type === "Document") { current.observed.lastDocumentStatus = response.status; current.observed.lastDocumentRoute = route; }
          if (response.status >= 400) current.observed.httpErrors[route] = (current.observed.httpErrors[route] ?? 0) + 1;
        } catch { current.observerFailed = true; }
      }));
      current.disposers.push(cdp.on(sessionId, "Network.responseReceivedExtraInfo", value => {
        const pending = current.activeKinds.get(String(value.requestId));
        if (pending) {
          const status: unknown = value.statusCode;
          if (pending.singleHop && pending.responseExtra === "unobserved" && typeof status === "number"
            && Number.isInteger(status) && status >= 100 && status <= 599) {
            pending.responseExtra = "seen"; pending.extraStatus = status;
          } else { pending.responseExtra = "ambiguous"; pending.extraStatus = null; }
        } else current.firstTransportObservation(String(value.requestId));
        // Deliberately never inspect headers, cookieLine or cookie.value.
        const blocked = value.blockedCookies;
        if (!Array.isArray(blocked)) return;
        for (const item of blocked) {
          const reasons = (item as { blockedReasons?: unknown }).blockedReasons;
          if (!Array.isArray(reasons)) { current.observerFailed = true; continue; }
          for (const reason of reasons) {
            const key = typeof reason === "string" && cookieReasons.has(reason) ? reason : "OTHER";
            current.observed.cookieBlocks[key] = (current.observed.cookieBlocks[key] ?? 0) + 1;
          }
        }
      }));
      current.disposers.push(cdp.on(sessionId, "Runtime.exceptionThrown", () => { current.observed.runtimeErrors++; }));
      current.disposers.push(cdp.on(sessionId, "Runtime.consoleAPICalled", value => { if (value.type === "error") current.observed.consoleErrors++; }));
      // Passive lifetime callbacks are installed after the original handlers.
      // No lifecycle observation retires a request or changes quietness.
      current.disposers.push(cdp.on(sessionId,"Page.frameNavigated",value=>current.noteMainDocument(value)));
      current.disposers.push(cdp.on(sessionId,"Network.requestWillBeSent",value=>current.noteIconStart(value)));
      current.disposers.push(cdp.on(sessionId,"Network.responseReceived",value=>current.noteIconResponse(value)));
      current.disposers.push(cdp.on(sessionId,"Network.loadingFinished",value=>current.noteIconTerminal(value,false)));
      current.disposers.push(cdp.on(sessionId,"Network.loadingFailed",value=>current.noteIconTerminal(value,true)));
      for (const method of ["Page.enable", "Runtime.enable", "Network.enable"]) await current.call(method);
      await current.call("Network.setCacheDisabled", { cacheDisabled: true });
      await current.call("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
      await current.call("Page.addScriptToEvaluateOnNewDocument", { source: observer });
      await cdp.call("Browser.grantPermissions", { browserContextId, origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
      return current;
    } catch (error) {
      if (page) await page.close(); else await cdp.call("Target.disposeBrowserContext", { browserContextId });
      throw error;
    }
  }
  call<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}) { return this.cdp.call<T>(method, params, this.session); }
  async evaluate<T>(expression: string): Promise<T> {
    const result = await this.call<{ result: { value?: T }; exceptionDetails?: unknown }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    requireProtocol(!result.exceptionDetails, "BROWSER_EVALUATION"); return result.result.value as T;
  }
  async navigate(path: string) {
    const url = new URL(path, this.origin); requireProtocol(url.origin === this.origin, "BROWSER_ORIGIN");
    const result = await this.call<{ errorText?: unknown }>("Page.navigate", { url: url.href });
    requireProtocol(!result.errorText, "BROWSER_NAVIGATION");
  }
  url() { return this.evaluate<string>("location.href"); }
  async quiet() {
    await until(async () => this.documentCommitted && !this.documentActive.size && Date.now() - this.changedAt >= 250, "GET452 network settlement");
    requireProtocol(!this.observerFailed, "BROWSER_OBSERVER");
  }
  async ready(selector: string) {
    await until(() => this.evaluate<boolean>(`document.readyState!=="loading" && !!document.querySelector(${JSON.stringify(selector)})`), "GET452 production DOM");
    // Verify meaningful production markup, never a fabricated ready marker.
    requireProtocol(await this.evaluate<boolean>('document.title.length>0 && !!document.querySelector("main") && !document.querySelector("nextjs-portal")'), "BROWSER_PAGE_IDENTITY");
  }
  async click(selector: string) {
    this.lastClickProbe = null;
    const rect = await this.evaluate<{ x: number; y: number; visible: boolean; probe: unknown } | null>(`(() => { const e=document.querySelector(${JSON.stringify(selector)});if(!(e instanceof HTMLElement))return null;e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2),visible=r.width>0&&r.height>0&&!e.hasAttribute("disabled")&&hit?.closest(${JSON.stringify(selector)})===e;return{x:r.x+r.width/2,y:r.y+r.height/2,visible,probe:{found:true,disabled:e.hasAttribute("disabled"),connected:e.isConnected,active:document.activeElement===e,targetTag:e.tagName,hitTag:hit?.tagName??"NONE",hitRelation:!hit?"none":hit===e?"self":e.contains(hit)?"descendant":hit.contains(e)?"ancestor":"other",left:r.left,top:r.top,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight,scrollY,scrollBehavior:getComputedStyle(document.documentElement).scrollBehavior}};})()`);
    const target = selector === "#account-email" ? "identifier" : selector === "#account-password" ? "password"
      : selector === directoryInput ? "directory_query" : selector === 'form:has(#account-email) button[type="submit"]' ? "login_submit"
        : selector === 'form[action="/workspace/people"] button[type="submit"]' ? "directory_submit" : "other";
    // Closed geometry only, captured by the original evaluation at its exact
    // failed hit test. Never serialize selector, attributes, text or values.
    this.lastClickProbe = clickProbe(rect?.probe, target);
    requireProtocol(rect?.visible, "BROWSER_CLICK_TARGET");
    await this.call("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await this.call("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  }
  async key(key: string, code: string, virtual: number, modifiers = 0, commands?: string[]) {
    await this.call("Input.dispatchKeyEvent", { type: virtual === 13 ? "keyDown" : "rawKeyDown", key, code, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual, modifiers,
      ...(virtual === 13 ? { text: "\r", unmodifiedText: "\r" } : {}), ...(commands ? { commands } : {}) });
    await this.call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: virtual, nativeVirtualKeyCode: virtual, modifiers });
  }
  async fill(selector: string, text: string) {
    await this.click(selector); await this.key("a", "KeyA", 65, 2); await this.key("Backspace", "Backspace", 8);
    await this.call("Input.insertText", { text });
  }
  async paste(text: string) {
    await this.click(directoryInput); await this.key("a", "KeyA", 65, 2); await this.key("Backspace", "Backspace", 8);
    await this.evaluate(`navigator.clipboard.writeText(${JSON.stringify(text)}).then(()=>true)`);
    await this.key("v", "KeyV", 86, 2);
  }
  value() { return this.evaluate<string>(`document.querySelector(${JSON.stringify(directoryInput)})?.value ?? ""`); }
  async submit() { await this.click('form[action="/workspace/people"] button[type="submit"]'); }
  async historyEntry() {
    const history = await this.call<{ currentIndex: number; entries: Array<{ id: number }> }>("Page.getNavigationHistory");
    const entry = history.entries[history.currentIndex]; requireProtocol(entry, "BROWSER_HISTORY_ENTRY"); return entry.id;
  }
  historyGo(id: number) { return this.call("Page.navigateToHistoryEntry", { entryId: id }); }
  async cookies() {
    const result = await this.cdp.call<{ cookies: Array<{ name: string; httpOnly: boolean }> }>("Storage.getCookies", { browserContextId: this.context });
    const session = result.cookies.filter(cookie => /^talent-signal\.session-v2(?:\.\d+)?$/.test(cookie.name));
    return { primary: session.length > 0 && session.every(cookie => cookie.httpOnly), callback: result.cookies.some(cookie => cookie.name === "talent-signal.callback-url") };
  }
  assertHealthy() {
    requireProtocol(!this.observerFailed, "BROWSER_OBSERVER");
    requireProtocol(!this.observed.blockedExternal && !this.observed.runtimeErrors && !this.observed.consoleErrors, "BROWSER_HEALTH");
  }
  async health() {
    await this.quiet(); this.assertHealthy();
  }
  diagnostics() {
    const pending = new Map<string, number>(), metadata = new Map<string, number>(), fetch = new Map<string, number>(), transport = new Map<string, number>();
    for (const entry of this.activeKinds.values()) {
      const key = `${entry.route}:${entry.method}:${entry.type}`; pending.set(key, (pending.get(key) ?? 0) + 1);
      // Every segment is a closed category. No URL/path/query, initiator URL/stack or request ID is serialized.
      const detail = `${entry.scheme}:${entry.metadata}:${entry.route}:${entry.method}:${entry.type}:${entry.responseType}:${entry.initiator}:${entry.responseSeen ? "response_seen" : "awaiting_response"}`;
      metadata.set(detail, (metadata.get(detail) ?? 0) + 1);
      const fetched = `${detail}:${entry.fetch ? "pause_seen" : "pause_unobserved"}:${entry.fetch?.decision ?? "UNOBSERVED"}:${entry.fetch?.command ?? "UNOBSERVED"}:${entry.fetch?.correlation ?? "UNOBSERVED"}`;
      fetch.set(fetched, (fetch.get(fetched) ?? 0) + 1);
      const loader = !entry.loaderId || !this.mainLoaderId ? "loader_unobserved" : entry.loaderId === this.mainLoaderId ? "loader_current" : "loader_other";
      const extra = `${detail}:${entry.singleHop ? "single_hop" : "redirect_or_reused"}:${loader}:request_extra_${entry.requestExtra}:response_extra_${entry.responseExtra}${entry.extraStatus === null ? "" : `_${entry.extraStatus}`}:${entry.dataSeen ? "data_seen" : "data_unobserved"}`;
      transport.set(extra, (transport.get(extra) ?? 0) + 1);
    }
    return { ...this.observed, cookieBlocks: { ...this.observed.cookieBlocks }, httpErrors: { ...this.observed.httpErrors },
      observerFailed: this.observerFailed, activeRequests: this.active.size,
      clickProbeVersion: 1, lastClickProbe: this.lastClickProbe ? { ...this.lastClickProbe } : null,
      settlementVersion: 1, settlement: { basis: "committed_main_document", documentCommitted: this.documentCommitted,
        activeRequests: this.documentActive.size, replacedDocumentRequests: this.replacedDocumentRequests,
        unterminatedPriorDocumentRequests: [...this.active].filter(id => !this.documentActive.has(id)).length },
      pendingKinds: Object.fromEntries([...pending].sort(([a], [b]) => a.localeCompare(b))),
      pendingMetadataVersion: 1, pendingMetadata: Object.fromEntries([...metadata].sort(([a], [b]) => a.localeCompare(b))),
      pendingFetchVersion: 1, pendingFetch: Object.fromEntries([...fetch].sort(([a], [b]) => a.localeCompare(b))),
      pendingTransportVersion: 1, pendingTransport: Object.fromEntries([...transport].sort(([a], [b]) => a.localeCompare(b))),
      transportHistorySaturated: this.transportHistorySaturated,
      iconLifetimeVersion:1,iconLifetime:{invalid:this.iconHistoryInvalid,saturated:this.iconHistorySaturated,
        routeAudit:this.iconRouteAudit?.status()??{invalid:true,saturated:false},
        mainDocumentSequence:this.mainDocumentSequence,currentMainDocumentRoute:this.mainDocumentRoute,
        entries:this.iconLifetime.map(row=>({ordinal:row.ordinal,requestOrder:row.requestOrder,mainDocumentReceiveCountAtRequest:row.mainDocumentReceiveCountAtRequest,
          reportedDocumentRoute:row.reportedDocumentRoute,reportedFrameRelation:row.reportedFrameRelation,ambiguous:row.ambiguous,responseStatus:row.responseStatus,responseOrder:row.responseOrder,
          finished:row.finished,failed:row.failed,terminalOrder:row.terminalOrder,canceled:row.canceled,failure:row.failure,
          stillInOriginalActiveLedger:this.active.has(row.id),terminalRoutes:this.iconRouteAudit?.forRequest(row.id)??null}))},
      unmatchedFetchPausesUpTo1024: this.unmatchedFetchPausesUpTo1024,
      httpStatuses: Object.fromEntries([...this.httpStatuses].sort(([a], [b]) => a.localeCompare(b))) };
  }
  async surface() {
    // Presence only. Never return text, field values, HTML, attributes, URLs or error messages.
    const value = await this.evaluate<Record<string, unknown>>(`(() => {
      const identifier=document.querySelector("#account-email"),password=document.querySelector("#account-password"),
        directory=document.querySelector(${JSON.stringify(directoryInput)}),submit=document.querySelector('form:has(#account-email) button[type="submit"]');
      return {identifier:!!identifier,password:!!password,submit:!!submit,directory:!!directory,
        identifierDisabled:identifier instanceof HTMLInputElement?identifier.disabled:null,
        passwordDisabled:password instanceof HTMLInputElement?password.disabled:null,
        submitDisabled:submit instanceof HTMLButtonElement?submit.disabled:null,
        onboarding:!!document.querySelector("#onboarding-title"),main:!!document.querySelector("main"),
        overlay:!!document.querySelector("nextjs-portal"),alerts:document.querySelectorAll('[role="alert"]').length,
        active:identifier&&document.activeElement===identifier?"identifier":password&&document.activeElement===password?"password":directory&&document.activeElement===directory?"directory":submit&&document.activeElement===submit?"submit":"other"};
    })()`);
    const bool = (key: string) => typeof value[key] === "boolean" ? value[key] : null;
    return { identifier: bool("identifier"), password: bool("password"), submit: bool("submit"), directory: bool("directory"),
      identifierDisabled: bool("identifierDisabled"), passwordDisabled: bool("passwordDisabled"), submitDisabled: bool("submitDisabled"),
      onboarding: bool("onboarding"), main: bool("main"), overlay: bool("overlay"),
      alerts: typeof value.alerts === "number" && Number.isSafeInteger(value.alerts) && value.alerts >= 0 ? Math.min(value.alerts, 1000) : null,
      active: typeof value.active === "string" && ["identifier", "password", "directory", "submit", "other"].includes(value.active) ? value.active : "unobserved" };
  }
  async close() {
    for (const dispose of this.disposers) dispose();
    await this.cdp.call("Target.disposeBrowserContext", { browserContextId: this.context });
  }
}
