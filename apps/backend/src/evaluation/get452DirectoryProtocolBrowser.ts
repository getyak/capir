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
export class DirectoryProtocolPage {
  readonly observed = { blockedExternal: 0, runtimeErrors: 0, consoleErrors: 0, cookieBlocks: {} as Record<string, number>, maxRequestTargetBytes: 0,
    lastDocumentStatus: null as number | null, lastDocumentRoute: "unobserved", httpErrors: {} as Record<string, number> };
  private disposers: Array<() => void> = [];
  private active = new Set<string>();
  private changedAt = Date.now();
  private observerFailed = false;
  private constructor(private cdp: ProtocolCdp, readonly session: string, readonly context: string, readonly origin: string) {}
  static async create(cdp: ProtocolCdp, origin: string) {
    const { browserContextId } = await cdp.call<{ browserContextId: string }>("Target.createBrowserContext");
    let page: DirectoryProtocolPage | undefined;
    try {
      const { targetId } = await cdp.call<{ targetId: string }>("Target.createTarget", { url: "about:blank", browserContextId });
      const { sessionId } = await cdp.call<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
      page = new DirectoryProtocolPage(cdp, sessionId, browserContextId, origin);
      const current = page;
      current.disposers.push(cdp.on(sessionId, "Fetch.requestPaused", value => {
        try {
          const request = value.request as { url: string };
          const local = request.url === "about:blank" || request.url.startsWith("data:") || new URL(request.url).origin === origin;
          if (!local) current.observed.blockedExternal++;
          void current.call(local ? "Fetch.continueRequest" : "Fetch.failRequest", local
            ? { requestId: value.requestId } : { requestId: value.requestId, errorReason: "BlockedByClient" }).catch(() => { current.observerFailed = true; });
        } catch { current.observerFailed = true; }
      }));
      current.disposers.push(cdp.on(sessionId, "Network.requestWillBeSent", value => {
        try {
          const request = value.request as { url: string }, url = new URL(request.url);
          if (url.origin === origin) current.observed.maxRequestTargetBytes = Math.max(current.observed.maxRequestTargetBytes, Buffer.byteLength(url.pathname + url.search));
          requireProtocol(current.active.size < 1024, "BROWSER_REQUEST_BUDGET");
          current.active.add(String(value.requestId)); current.changedAt = Date.now();
        } catch { current.observerFailed = true; }
      }));
      for (const event of ["Network.loadingFinished", "Network.loadingFailed"]) current.disposers.push(cdp.on(sessionId, event, value => { current.active.delete(String(value.requestId)); current.changedAt = Date.now(); }));
      current.disposers.push(cdp.on(sessionId, "Network.responseReceived", value => {
        try {
          const response = value.response as { url: string; status: number }, path = new URL(response.url).pathname;
          const route = path === "/login" ? "login" : path === "/onboarding" ? "onboarding" : path === "/workspace/people" ? "directory"
            : path.startsWith("/api/auth/") ? "auth" : path.startsWith("/_next/") ? "asset" : "other";
          requireProtocol(Number.isInteger(response.status) && response.status >= 100 && response.status <= 599, "BROWSER_HTTP_STATUS");
          if (value.type === "Document") { current.observed.lastDocumentStatus = response.status; current.observed.lastDocumentRoute = route; }
          if (response.status >= 400) current.observed.httpErrors[route] = (current.observed.httpErrors[route] ?? 0) + 1;
        } catch { current.observerFailed = true; }
      }));
      current.disposers.push(cdp.on(sessionId, "Network.responseReceivedExtraInfo", value => {
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
    await until(async () => !this.active.size && Date.now() - this.changedAt >= 250, "GET452 network settlement");
    requireProtocol(!this.observerFailed, "BROWSER_OBSERVER");
  }
  async ready(selector: string) {
    await until(() => this.evaluate<boolean>(`document.readyState!=="loading" && !!document.querySelector(${JSON.stringify(selector)})`), "GET452 production DOM");
    // Verify meaningful production markup, never a fabricated ready marker.
    requireProtocol(await this.evaluate<boolean>('document.title.length>0 && !!document.querySelector("main") && !document.querySelector("nextjs-portal")'), "BROWSER_PAGE_IDENTITY");
  }
  async click(selector: string) {
    const rect = await this.evaluate<{ x: number; y: number; visible: boolean } | null>(`(() => { const e=document.querySelector(${JSON.stringify(selector)});if(!(e instanceof HTMLElement))return null;e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,visible:r.width>0&&r.height>0&&!e.hasAttribute("disabled")&&document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest(${JSON.stringify(selector)})===e};})()`);
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
  async close() {
    for (const dispose of this.disposers) dispose();
    await this.cdp.call("Target.disposeBrowserContext", { browserContextId: this.context });
  }
}
