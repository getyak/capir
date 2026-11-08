/** Real full-application Next/Auth.js/Chrome/PG gate. Never run on a resident host. */
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { get as getHttp, type ClientRequest, type IncomingMessage } from "node:http";
import { ProtocolCdp, until, cdpCommandErrorObservation } from "./get350NextProtocolCdp.js";
import { DirectoryProtocolPage, directoryInput } from "./get452DirectoryProtocolBrowser.js";
import { createDirectoryFixture, type DirectoryFixture } from "./get452DirectoryProtocolFixture.js";
import { bindDirectorySource } from "./get452DirectoryProtocolSource.js";
import { observeDirectoryIconServer } from "./get452IconServerObservation.js";
import { childOwnsListeningPort, chromeAnnouncement, DirectoryProtocolFailure, ownedChild, rememberChild, requireProtocol, reservePort, stopChild } from "./get452DirectoryProtocolHost.js";

const cases = ["ordinary_login_onboarding", "long_tail_database_search", "unicode_login_callback", "backend_session_recovery",
  "trusted_paste_and_refusal", "ime_commit_guard", "history_back_forward", "clear_focus", "mobile375_geometry"] as const;
type CaseName = typeof cases[number];
type Status = "not_started" | "running" | "passed" | "failed";
const unicode = "😀".repeat(499) + "🚀";
const directory = (query: string) => "/workspace/people?query=" + encodeURIComponent(query);
const fieldValue = (selector: string) => `document.querySelector(${JSON.stringify(selector)})?.value`;
type LoginCheckpoint = "directory_navigation" | "login_form" | "login_network_settlement" | "login_callback_binding"
  | "fill_identifier" | "fill_password" | "credentials_readback" | "submit_password"
  | "onboarding_form" | "onboarding_network_settlement" | "onboarding_callback_binding"
  | "submit_onboarding_skip" | "onboarding_readback" | "directory_readback" | "auth_cookie_presence"
  | "backend_login_search_receipt" | "recovery_login_form";
type LoginFields = { identifierEqual: boolean; passwordEqual: boolean };
type SearchCheckpoint = "fill" | "submit" | "directory_url" | "directory_field" | "directory_ready" | "directory_quiet" | "backend" | "complete";
type SearchContext = { page: DirectoryProtocolPage; expectedQuery: string; checkpoint: SearchCheckpoint;
  urlDirectoryMatch: boolean | null; urlQueryMatch: boolean | null; inputMatch: boolean | null };
type SearchDiagnostic = Pick<SearchContext, "checkpoint" | "urlDirectoryMatch" | "urlQueryMatch" | "inputMatch"> & {
  state: Awaited<ReturnType<DirectoryProtocolPage["directoryFailureState"]>> | null };
let activeSearch: SearchContext | null = null;
function searchCheckpoint(page: DirectoryProtocolPage, query: string, checkpoint: SearchCheckpoint) {
  let state = activeSearch;
  if (!state || state.page !== page || state.expectedQuery !== query) {
    state = { page, expectedQuery: query, checkpoint, urlDirectoryMatch: null, urlQueryMatch: null, inputMatch: null };
    activeSearch = state;
  }
  state.checkpoint = checkpoint; return state;
}
type UntilFailure = "DIRECTORY_QUERY_TIMEOUT" | "DIRECTORY_DOM_TIMEOUT" | "DIRECTORY_NETWORK_TIMEOUT" | "ONBOARDING_RECEIPT_TIMEOUT"
  | "NEXT_STARTUP_TIMEOUT" | "CHROME_ANNOUNCEMENT_TIMEOUT" | "COMPOSITION_START_TIMEOUT" | "COMPOSITION_COMMIT_TIMEOUT" | "CLEAR_READBACK_TIMEOUT";
const untilFailures = new Map<string, UntilFailure>([
  ["Protocol condition timed out: GET452 exact directory query", "DIRECTORY_QUERY_TIMEOUT"],
  ["Protocol condition timed out: GET452 production DOM", "DIRECTORY_DOM_TIMEOUT"],
  ["Protocol condition timed out: GET452 network settlement", "DIRECTORY_NETWORK_TIMEOUT"],
  ["Protocol condition timed out: GET452 canonical onboarding receipt", "ONBOARDING_RECEIPT_TIMEOUT"],
  ["Protocol condition timed out: GET452 full Next startup", "NEXT_STARTUP_TIMEOUT"],
  ["Protocol condition timed out: GET452 owned Chrome announcement", "CHROME_ANNOUNCEMENT_TIMEOUT"],
  ["Protocol condition timed out: GET452 trusted composition start", "COMPOSITION_START_TIMEOUT"],
  ["Protocol condition timed out: GET452 trusted composition commit", "COMPOSITION_COMMIT_TIMEOUT"],
  ["Protocol condition timed out: GET452 clear readback focus", "CLEAR_READBACK_TIMEOUT"],
]);
function untilFailure(error: unknown): UntilFailure | null {
  try {
    const message = error instanceof Error ? Object.getOwnPropertyDescriptor(error, "message") : undefined;
    return message && "value" in message && typeof message.value === "string" ? untilFailures.get(message.value) ?? null : null;
  } catch { return null; }
}
type IconServerProbe = { attempted: boolean; outcome: "not_attempted" | "eof" | "timeout" | "body_limit" | "request_failed" | "read_failed" | "redirect_refused";
  status: number | null; mime: "image/png" | "other" | "unobserved"; eof: boolean; withinBodyLimit: boolean; pngSignature: boolean };
function probeIconServer(port: number): Promise<IconServerProbe> {
  return new Promise(resolve => {
    const result: IconServerProbe = { attempted: true, outcome: "request_failed", status: null, mime: "unobserved",
      eof: false, withinBodyLimit: true, pngSignature: false };
    let request: ClientRequest | undefined, response: IncomingMessage | undefined, settled = false, bytes = 0, prefixBytes = 0;
    const deadline = performance.now() + 3_000;
    const prefix = Buffer.alloc(8), signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const finish = (outcome: IconServerProbe["outcome"]) => {
      if (settled) return;
      settled = true; clearTimeout(timer); result.outcome = performance.now() >= deadline ? "timeout" : outcome;
      result.pngSignature = prefixBytes === 8 && prefix.equals(signature);
      request?.destroy(); response?.destroy(); resolve({ ...result });
    };
    // One total deadline includes connecting, headers and the entire bounded
    // body. Node HTTP does not follow redirects or attach browser cookies/Auth.
    const timer = setTimeout(() => finish("timeout"), 3_000);
    try {
      // Explicit options cannot inherit URL credentials, cookies, a redirect
      // target, proxy environment or another request's Agent/session state.
      request = getHttp({ hostname: "127.0.0.1", port, path: "/icon", agent: false, headers: { Accept: "image/png" } }, incoming => {
        if (settled) { incoming.destroy(); return; }
        response = incoming;
        result.status = Number.isInteger(incoming.statusCode) && incoming.statusCode! >= 100 && incoming.statusCode! <= 599
          ? incoming.statusCode! : null;
        const mime = incoming.headers["content-type"];
        result.mime = typeof mime === "string" && mime.split(";", 1)[0]!.trim().toLowerCase() === "image/png" ? "image/png" : "other";
        if (result.status !== null && result.status >= 300 && result.status < 400) { finish("redirect_refused"); return; }
        incoming.on("data", (chunk: unknown) => {
          if (settled) return;
          if (performance.now() >= deadline) { finish("timeout"); return; }
          if (!Buffer.isBuffer(chunk)) { finish("read_failed"); return; }
          if (bytes + chunk.byteLength > 64 * 1024) { result.withinBodyLimit = false; finish("body_limit"); return; }
          bytes += chunk.byteLength;
          const take = Math.min(8 - prefixBytes, chunk.byteLength);
          if (take) { chunk.copy(prefix, prefixBytes, 0, take); prefixBytes += take; }
        });
        incoming.once("end", () => { if (settled) return; result.eof = incoming.complete; finish(result.eof ? "eof" : "read_failed"); });
        incoming.once("aborted", () => finish("read_failed"));
        incoming.once("error", () => finish("read_failed"));
      });
      request.once("error", () => finish("request_failed"));
    } catch { finish("request_failed"); }
  });
}
async function currentDirectory(page: DirectoryProtocolPage, query: string) {
  const state = searchCheckpoint(page, query, "directory_url");
  await until(async () => {
    state.checkpoint = "directory_url"; state.urlDirectoryMatch = null; state.urlQueryMatch = null; state.inputMatch = null;
    const url = new URL(await page.url());
    state.urlDirectoryMatch = url.pathname === "/workspace/people"; state.urlQueryMatch = url.searchParams.get("query") === query;
    if (state.urlDirectoryMatch && state.urlQueryMatch) state.checkpoint = "directory_field";
    const matched = url.pathname === "/workspace/people" && url.searchParams.get("query") === query && await page.value() === query;
    if (state.urlDirectoryMatch && state.urlQueryMatch) state.inputMatch = matched;
    return matched;
  }, "GET452 exact directory query");
  state.checkpoint = "directory_ready"; await page.ready(directoryInput);
  state.checkpoint = "directory_quiet"; await page.quiet();
  state.checkpoint = "complete";
}
async function login(page: DirectoryProtocolPage, fixture: DirectoryFixture, query: string, first: boolean,
  note: (checkpoint: LoginCheckpoint, fields?: LoginFields) => void) {
  const before = fixture.observationCount(), logins = fixture.counters().passwordLogins;
  note("login_form"); await page.ready("#account-email");
  note("login_network_settlement"); await page.quiet();
  note("login_callback_binding");
  const loginUrl = new URL(await page.url());
  requireProtocol(loginUrl.pathname === "/login" && loginUrl.searchParams.get("callbackUrl") === directory(query), "LOGIN_FULL_CALLBACK");
  requireProtocol(await page.evaluate<string>(fieldValue('input[name="redirectTo"]')) === directory(query), "LOGIN_HIDDEN_CALLBACK");
  note("fill_identifier"); await page.fill("#account-email", fixture.email);
  note("fill_password"); await page.fill("#account-password", fixture.password);
  const fields = {
    identifierEqual: await page.evaluate<boolean>(`${fieldValue("#account-email")}===${JSON.stringify(fixture.email)}`),
    passwordEqual: await page.evaluate<boolean>(`${fieldValue("#account-password")}===${JSON.stringify(fixture.password)}`),
  };
  note("credentials_readback", fields);
  requireProtocol(fields.identifierEqual && fields.passwordEqual, "LOGIN_FIELDS_NOT_FILLED");
  note("submit_password");
  await page.click('form:has(#account-email) button[type="submit"]');
  if (first) {
    note("onboarding_form"); await page.ready("#onboarding-title");
    note("onboarding_network_settlement"); await page.quiet();
    note("onboarding_callback_binding");
    const url = new URL(await page.url());
    requireProtocol(url.pathname === "/onboarding" && url.searchParams.get("callbackUrl") === directory(query), "ONBOARDING_FULL_CALLBACK");
    note("submit_onboarding_skip"); await page.click('section[aria-labelledby="onboarding-title"] > button[type="button"]');
    note("onboarding_readback");
    await until(() => fixture.onboardingWasSkipped(), "GET452 canonical onboarding receipt");
  }
  note("directory_readback");
  await currentDirectory(page, query);
  note("auth_cookie_presence");
  requireProtocol((await page.cookies()).primary, "REAL_AUTH_SESSION_COOKIE");
  note("backend_login_search_receipt");
  requireProtocol(fixture.seen(query, before) && fixture.counters().passwordLogins === logins + 1, "REAL_AUTHORIZED_BACKEND_SEARCH");
}
async function search(page: DirectoryProtocolPage, fixture: DirectoryFixture, query: string) {
  const before = fixture.observationCount();
  const state = searchCheckpoint(page, query, "fill");
  state.urlDirectoryMatch = null; state.urlQueryMatch = null; state.inputMatch = null;
  await page.fill(directoryInput, query); state.checkpoint = "submit";
  await page.submit(); await currentDirectory(page, query);
  state.checkpoint = "backend";
  requireProtocol(fixture.seen(query, before), "FULL_QUERY_BACKEND_DELIVERY");
  state.checkpoint = "complete";
}

async function main() {
  requireProtocol(process.platform === "linux" && Number(process.versions.node.split(".")[0]) >= 22
    && typeof WebSocket === "function" && process.env.GITHUB_ACTIONS === "true" && process.env.GET452_NEXT_PROTOCOL === "1", "HOSTED_EXPLICIT_GATE");
  requireProtocol(/^\d+$/.test(process.env.GITHUB_RUN_ID ?? "") && /^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT ?? ""), "HOSTED_RUN_IDENTITY");
  const runnerTemp = process.env.RUNNER_TEMP, requested = process.env.GET452_NEXT_PROTOCOL_ARTIFACT_DIR;
  requireProtocol(runnerTemp && isAbsolute(runnerTemp) && requested && isAbsolute(requested), "ARTIFACT_ADMISSION");
  const runnerRoot = await realpath(runnerTemp);
  requireProtocol(relative(runnerRoot, requested) === "get452-directory-next-evidence", "ARTIFACT_SCOPE");
  await mkdir(requested, { mode: 0o700 });
  requireProtocol(await realpath(requested) === requested && (await stat(requested)).isDirectory(), "ARTIFACT_REALPATH");
  const runtime = await mkdtemp(join(runnerRoot, "get452-directory-runtime-"));
  const receipt: { schema: string; status: "failed" | "passed"; phase: string; failure: string | null; cleanup: boolean;
    source: unknown; chrome: string | null; cases: Record<CaseName, Status>; observations: unknown[]; backend: unknown;
    diagnosticVersion: 1; checkpoint: LoginCheckpoint | null; loginFields: LoginFields | null; failureSurfaces: unknown[];
    searchDiagnosticVersion: 1; searchDiagnostic: SearchDiagnostic | null; commandError: ReturnType<typeof cdpCommandErrorObservation>;
    iconServerProbe: IconServerProbe; iconServerBeforeFailure: ReturnType<ReturnType<typeof observeDirectoryIconServer>["snapshot"]> | null } = {
    schema: "get452-directory-next.v1", status: "failed", phase: "source", failure: null, cleanup: false,
    source: null, chrome: null, cases: Object.fromEntries(cases.map(name => [name, "not_started"])) as Record<CaseName, Status>, observations: [], backend: null,
    diagnosticVersion: 1, checkpoint: null, loginFields: null, failureSurfaces: [], iconServerBeforeFailure: null,
    searchDiagnosticVersion: 1, searchDiagnostic: null, commandError: null,
    iconServerProbe: { attempted: false, outcome: "not_attempted", status: null, mime: "unobserved", eof: false, withinBodyLimit: false, pngSignature: false },
  };
  let next: ChildProcess | undefined, chrome: ChildProcess | undefined, cdp: ProtocolCdp | undefined;
  let fixture: DirectoryFixture | undefined;
  let readyPort: number | undefined;
  let iconObserver: ReturnType<typeof observeDirectoryIconServer> | undefined;
  const pages: DirectoryProtocolPage[] = [];
  const run = async (name: CaseName, operation: () => Promise<void>) => {
    activeSearch = null;
    receipt.phase = name; receipt.cases[name] = "running"; receipt.checkpoint = null; receipt.loginFields = null;
    try { await operation(); receipt.cases[name] = "passed"; } catch (error) { receipt.cases[name] = "failed"; throw error; }
  };
  const note = (checkpoint: LoginCheckpoint, fields?: LoginFields) => {
    receipt.checkpoint = checkpoint;
    if (checkpoint === "login_form") receipt.loginFields = null;
    if (fields) receipt.loginFields = fields;
  };
  try {
    const source = await bindDirectorySource(); receipt.source = source.receipt;
    receipt.phase = "disposable_database";
    fixture = await createDirectoryFixture(runtime, process.env.DATABASE_URL ?? "");
    const data = fixture;
    const chromePath = process.env.GET452_CHROME_PATH;
    requireProtocol(chromePath && isAbsolute(chromePath) && (await stat(chromePath)).isFile(), "CHROME_BINARY");
    const env: NodeJS.ProcessEnv = {};
    for (const name of ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR"]) if (process.env[name]) env[name] = process.env[name];
    const port = await reservePort(), origin = `http://127.0.0.1:${port}`;
    const nextEnv: NodeJS.ProcessEnv = { ...env, NODE_ENV: "production", AUTH_SECRET: randomBytes(48).toString("base64url"), AUTH_URL: origin,
      AUTH_TRUST_HOST: "true", TALENT_SIGNAL_ALLOW_LAN_HTTP: "true", TALENT_SIGNAL_BACKEND_URL: data.backend,
      TALENT_SIGNAL_INTEGRATION_MODE: "true", TALENT_SIGNAL_PASSWORD_AUTH_ENABLED: "true", TALENT_SIGNAL_PASSWORD_REGISTRATION_ENABLED: "false",
      NEXT_TELEMETRY_DISABLED: "1", GITHUB_ACTIONS: "true", GET452_ICON_OBSERVER: "1", GET452_ICON_OBSERVER_PORT: String(port) };
    receipt.phase = "full_next_start";
    next = ownedChild(process.execPath, ["--import", pathToFileURL(join(source.repo, "apps/backend/src/evaluation/get452IconServerObserver.mjs")).href, source.next, "start", source.web, "--hostname", "127.0.0.1", "--port", String(port)], source.web, nextEnv, false, true);
    iconObserver = observeDirectoryIconServer(next);
    await until(async () => {
      requireProtocol(next?.pid && next.exitCode === null && next.signalCode === null, "NEXT_CHILD_EXIT");
      try { return childOwnsListeningPort(next, port) && (await fetch(origin + "/login", { redirect: "error", signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
    }, "GET452 full Next startup", 60_000);
    rememberChild(next); requireProtocol(childOwnsListeningPort(next, port), "NEXT_OWNED_LISTENER");
    readyPort = port;
    receipt.phase = "owned_chrome";
    const profile = join(runtime, "chrome"); await mkdir(profile, { mode: 0o700 });
    const debugPort = await reservePort();
    chrome = ownedChild(chromePath, ["--headless=new", "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
      "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-sync", "--disable-extensions", "--password-store=basic", "about:blank"], runtime, env, true);
    const announcement = chromeAnnouncement(chrome, debugPort);
    await until(async () => Boolean(announcement.uuid) || announcement.invalid || chrome?.exitCode !== null || chrome?.signalCode !== null, "GET452 owned Chrome announcement", 15_000);
    requireProtocol(announcement.uuid && !announcement.invalid && chrome.exitCode === null && chrome.signalCode === null, "CHROME_CHILD_ENDPOINT");
    rememberChild(chrome); cdp = await ProtocolCdp.connect(debugPort, announcement.uuid);
    const version = await cdp.call<{ product: string }>("Browser.getVersion");
    requireProtocol(/^(?:HeadlessChrome|Chrome)\/\d+(?:\.\d+){1,3}$/.test(version.product), "CHROME_VERSION"); receipt.chrome = version.product;
    const ordinary = await DirectoryProtocolPage.create(cdp, origin); pages.push(ordinary);
    await run("ordinary_login_onboarding", async () => {
      note("directory_navigation"); await ordinary.navigate(directory("Directory")); await login(ordinary, data, "Directory", true, note);
      requireProtocol((await ordinary.cookies()).callback, "ORDINARY_CALLBACK_COOKIE");
      await ordinary.health();
    });
    await run("long_tail_database_search", async () => {
      await search(ordinary, data, data.tailA);
      requireProtocol(await ordinary.evaluate<boolean>(`!!document.getElementById(${JSON.stringify("person-" + data.personA)}) && !document.getElementById(${JSON.stringify("person-" + data.personB)})`), "DATABASE_TAIL_DISTINCTION");
      await ordinary.health();
    });
    const long = await DirectoryProtocolPage.create(cdp, origin); pages.push(long);
    await run("unicode_login_callback", async () => {
      requireProtocol([...unicode].length === 500 && Buffer.byteLength(unicode) === 2000 && encodeURIComponent(unicode).length === 6000, "UNICODE_VECTOR");
      note("directory_navigation"); await long.navigate(directory(unicode)); await login(long, data, unicode, false, note); await long.health();
      requireProtocol(long.observed.maxRequestTargetBytes > 10_000, "OBSERVED_NESTED_CALLBACK_TRANSPORT");
    });
    await run("backend_session_recovery", async () => {
      await ordinary.quiet(); const denials = data.counters().renewalDenials;
      requireProtocol((await ordinary.cookies()).callback, "EXISTING_ORDINARY_CALLBACK_COOKIE");
      await data.revokeBrowserLogin(data.tailA); // Exact login captured by its genuine successful search; no cookie mutation.
      note("directory_navigation"); await ordinary.navigate(directory(unicode));
      note("recovery_login_form"); await ordinary.ready("#account-email");
      requireProtocol(data.counters().renewalDenials > denials, "REAL_BACKEND_RENEWAL_DENIAL");
      await login(ordinary, data, unicode, false, note); await ordinary.health();
    });
    await run("trusted_paste_and_refusal", async () => {
      const rejected = unicode + "x", priorUrl = await long.url();
      await long.paste(rejected); await long.quiet(); const searches = data.observationCount();
      requireProtocol(await long.value() === rejected, "PASTE_RAW_DRAFT");
      await long.key("Enter", "Enter", 13); await long.quiet();
      requireProtocol(data.observationCount() === searches && await long.url() === priorUrl && await long.value() === rejected, "EXPLICIT_REFUSAL_NO_SEARCH");
      requireProtocol(await long.evaluate<boolean>(`(() => { const e=document.querySelector(${JSON.stringify(directoryInput)});return e?.getAttribute("aria-invalid")==="true" && e.selectionStart===${rejected.length} && e.selectionEnd===${rejected.length} && document.activeElement===e && !!document.querySelector('[role="alert"]') && window.__get452Events.paste>0;})()`), "PASTE_TRUSTED_REFUSAL_CARET");
      await long.paste(data.tailB); await long.submit(); await currentDirectory(long, data.tailB);
      requireProtocol(data.seen(data.tailB), "TRUSTED_PASTE_FULL_DELIVERY"); await long.health();
    });
    await run("ime_commit_guard", async () => {
      await long.fill(directoryInput, ""); await long.quiet(); const before = data.observationCount(), beforeUrl = await long.url();
      await long.call("Input.imeSetComposition", { text: "中", selectionStart: 1, selectionEnd: 1 });
      await until(() => long.evaluate<boolean>('window.__get452Events.composing>0 && !!document.querySelector(\'main#main-content form[action="/workspace/people"] button[type="submit"]\')?.disabled'), "GET452 trusted composition start");
      await long.key("Enter", "Enter", 229); await long.quiet();
      requireProtocol(data.observationCount() === before && await long.url() === beforeUrl, "IME_CANDIDATE_NO_DISPATCH");
      const committed = "中文-尾部";
      await long.call("Input.insertText", { text: committed });
      await until(() => long.evaluate<boolean>('window.__get452Events.composed>0 && !document.querySelector(\'main#main-content form[action="/workspace/people"] button[type="submit"]\')?.disabled'), "GET452 trusted composition commit");
      requireProtocol(await long.value() === committed, "IME_COMMITTED_TEXT");
      await long.key("Enter", "Enter", 13); await currentDirectory(long, committed);
      requireProtocol(data.seen(committed, before), "IME_EXPLICIT_SUBMIT"); await long.health();
    });
    await run("history_back_forward", async () => {
      await search(long, data, data.tailA); const a = await long.historyEntry();
      await search(long, data, data.tailB); const b = await long.historyEntry();
      requireProtocol(a !== b, "HISTORY_REAL_ENTRIES");
      await long.historyGo(a); await currentDirectory(long, data.tailA);
      await long.historyGo(b); await currentDirectory(long, data.tailB); await long.health();
    });
    await run("clear_focus", async () => {
      await long.click('main#main-content form[action="/workspace/people"] a');
      await until(() => long.evaluate<boolean>(`location.pathname==="/workspace/people" && !new URL(location.href).searchParams.has("query") && document.querySelector(${JSON.stringify(directoryInput)})?.value==="" && document.activeElement===document.querySelector(${JSON.stringify(directoryInput)})`), "GET452 clear readback focus");
      await long.health();
    });
    await run("mobile375_geometry", async () => {
      await long.call("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
      await search(long, data, unicode);
      requireProtocol(await long.evaluate<boolean>(`(() => {const f=document.querySelector('main#main-content form[action="/workspace/people"]'),i=f?.querySelector('input[name="query"]'),b=f?.querySelector('button[type="submit"]');if(!f||!i||!b)return false;const a=f.getBoundingClientRect(),x=i.getBoundingClientRect(),y=b.getBoundingClientRect();return innerWidth===375&&document.documentElement.scrollWidth<=innerWidth+1&&a.left>=0&&a.right<=innerWidth+1&&x.width>=100&&y.width>=32&&y.height>=32&&x.right<=y.left+1&&x.left>=a.left&&y.right<=a.right+1;})()`), "MOBILE375_GEOMETRY");
      await long.health();
    });
    receipt.phase = "source_readback";
    for (const page of pages) await page.health();
    await source.assertUnchanged();
    // No await between this final cumulative observation and the pass decision.
    for (const page of pages) page.assertHealthy();
    requireProtocol(cases.every(name => receipt.cases[name] === "passed"), "CASE_COMPLETENESS");
    receipt.status = "passed";
  } catch (error) {
    receipt.status = "failed";
    receipt.failure = error instanceof DirectoryProtocolFailure ? error.code : untilFailure(error) ?? "UNCLASSIFIED_PROTOCOL_FAILURE";
    try { receipt.commandError = cdpCommandErrorObservation(error); } catch { receipt.commandError = null; }
    // Fix both passive observations before surface reads or the separate Node probe.
    // Server counts describe this owned listener, not a guessed CDP hop or browser EOF.
    receipt.iconServerBeforeFailure = iconObserver?.snapshot() ?? null;
    // Capture pending/counter facts before an asynchronous diagnostic can settle them.
    receipt.observations = pages.map(page => page.diagnostics()); receipt.backend = fixture?.counters() ?? null;
    const search = activeSearch;
    if (search) {
      receipt.searchDiagnostic = { checkpoint: search.checkpoint, urlDirectoryMatch: search.urlDirectoryMatch,
        urlQueryMatch: search.urlQueryMatch, inputMatch: search.inputMatch, state: null };
      // One read after the original failure/passive facts are fixed, never a retry or gate.
      try { receipt.searchDiagnostic.state = await search.page.directoryFailureState(search.expectedQuery); }
      catch { /* Keep the original failure and explicit null diagnostic. */ }
    }
    for (const [pageIndex, page] of pages.entries()) {
      try { receipt.failureSurfaces.push({ pageIndex, available: true, surface: await page.surface() }); }
      catch { receipt.failureSurfaces.push({ pageIndex, available: false }); }
    }
    // The original failure and all browser observations are already fixed.
    // This is one separate anonymous server-path observation, never a browser
    // retry/warm-up, success condition or replacement for the failed request.
    try {
      if (readyPort && next?.exitCode === null && next.signalCode === null && childOwnsListeningPort(next, readyPort)) receipt.iconServerProbe = await probeIconServer(readyPort);
    } catch { /* Keep the original failure and explicit not_attempted diagnostic. */ }
  } finally {
    if (receipt.failure === null) {
      receipt.observations = pages.map(page => page.diagnostics()); receipt.backend = fixture?.counters() ?? null;
    }
    let clean = true;
    for (const page of pages) try { await page.close(); } catch { clean = false; }
    try { cdp?.close(); } catch { clean = false; }
    for (const child of [chrome, next]) try { await stopChild(child); } catch { clean = false; }
    try { await fixture?.close(); } catch { clean = false; }
    // Keep an unclean runtime for investigation; never remove an active group's profile.
    if (clean) try { await rm(runtime, { recursive: true, force: false }); } catch { clean = false; }
    receipt.cleanup = clean;
    if (!clean) { receipt.status = "failed"; receipt.failure ??= "CLEANUP_FAILED"; }
    await writeFile(join(requested, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  }
  if (receipt.status !== "passed") throw new DirectoryProtocolFailure("HOSTED_PROTOCOL_FAILED");
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write("GET452 full Next protocol failed; inspect its sanitized receipt.\n"); process.exitCode = 1; });
}
