/** Real full-application Next/Auth.js/Chrome/PG gate. Never run on a resident host. */
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ProtocolCdp, until } from "./get350NextProtocolCdp.js";
import { DirectoryProtocolPage, directoryInput } from "./get452DirectoryProtocolBrowser.js";
import { createDirectoryFixture, type DirectoryFixture } from "./get452DirectoryProtocolFixture.js";
import { bindDirectorySource } from "./get452DirectoryProtocolSource.js";
import { childOwnsListeningPort, chromeAnnouncement, DirectoryProtocolFailure, ownedChild, rememberChild, requireProtocol, reservePort, stopChild } from "./get452DirectoryProtocolHost.js";

const cases = ["ordinary_login_onboarding", "long_tail_database_search", "unicode_login_callback", "backend_session_recovery",
  "trusted_paste_and_refusal", "ime_commit_guard", "history_back_forward", "clear_focus", "mobile375_geometry"] as const;
type CaseName = typeof cases[number];
type Status = "not_started" | "running" | "passed" | "failed";
const unicode = "😀".repeat(499) + "🚀";
const directory = (query: string) => "/workspace/people?query=" + encodeURIComponent(query);
const fieldValue = (selector: string) => `document.querySelector(${JSON.stringify(selector)})?.value`;
async function currentDirectory(page: DirectoryProtocolPage, query: string) {
  await until(async () => {
    const url = new URL(await page.url());
    return url.pathname === "/workspace/people" && url.searchParams.get("query") === query && await page.value() === query;
  }, "GET452 exact directory query");
  await page.ready(directoryInput); await page.quiet();
}
async function login(page: DirectoryProtocolPage, fixture: DirectoryFixture, query: string, first: boolean) {
  const before = fixture.observationCount(), logins = fixture.counters().passwordLogins;
  await page.ready("#account-email"); await page.quiet();
  const loginUrl = new URL(await page.url());
  requireProtocol(loginUrl.pathname === "/login" && loginUrl.searchParams.get("callbackUrl") === directory(query), "LOGIN_FULL_CALLBACK");
  requireProtocol(await page.evaluate<string>(fieldValue('input[name="redirectTo"]')) === directory(query), "LOGIN_HIDDEN_CALLBACK");
  await page.fill("#account-email", fixture.email); await page.fill("#account-password", fixture.password);
  await page.click('form:has(#account-email) button[type="submit"]');
  if (first) {
    await page.ready("#onboarding-title"); await page.quiet();
    const url = new URL(await page.url());
    requireProtocol(url.pathname === "/onboarding" && url.searchParams.get("callbackUrl") === directory(query), "ONBOARDING_FULL_CALLBACK");
    await page.click('section[aria-labelledby="onboarding-title"] > button[type="button"]');
    await until(() => fixture.onboardingWasSkipped(), "GET452 canonical onboarding receipt");
  }
  await currentDirectory(page, query);
  requireProtocol((await page.cookies()).primary, "REAL_AUTH_SESSION_COOKIE");
  requireProtocol(fixture.seen(query, before) && fixture.counters().passwordLogins === logins + 1, "REAL_AUTHORIZED_BACKEND_SEARCH");
}
async function search(page: DirectoryProtocolPage, fixture: DirectoryFixture, query: string) {
  const before = fixture.observationCount();
  await page.fill(directoryInput, query); await page.submit(); await currentDirectory(page, query);
  requireProtocol(fixture.seen(query, before), "FULL_QUERY_BACKEND_DELIVERY");
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
    source: unknown; chrome: string | null; cases: Record<CaseName, Status>; observations: unknown[]; backend: unknown } = {
    schema: "get452-directory-next.v1", status: "failed", phase: "source", failure: null, cleanup: false,
    source: null, chrome: null, cases: Object.fromEntries(cases.map(name => [name, "not_started"])) as Record<CaseName, Status>, observations: [], backend: null,
  };
  let next: ChildProcess | undefined, chrome: ChildProcess | undefined, cdp: ProtocolCdp | undefined;
  let fixture: DirectoryFixture | undefined;
  const pages: DirectoryProtocolPage[] = [];
  const run = async (name: CaseName, operation: () => Promise<void>) => {
    receipt.phase = name; receipt.cases[name] = "running";
    try { await operation(); receipt.cases[name] = "passed"; } catch (error) { receipt.cases[name] = "failed"; throw error; }
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
      NEXT_TELEMETRY_DISABLED: "1" };
    receipt.phase = "full_next_start";
    next = ownedChild(process.execPath, [source.next, "start", source.web, "--hostname", "127.0.0.1", "--port", String(port)], source.web, nextEnv);
    await until(async () => {
      requireProtocol(next?.pid && next.exitCode === null && next.signalCode === null, "NEXT_CHILD_EXIT");
      try { return childOwnsListeningPort(next, port) && (await fetch(origin + "/login", { redirect: "error", signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
    }, "GET452 full Next startup", 60_000);
    rememberChild(next); requireProtocol(childOwnsListeningPort(next, port), "NEXT_OWNED_LISTENER");
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
      await ordinary.navigate(directory("Directory")); await login(ordinary, data, "Directory", true);
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
      await long.navigate(directory(unicode)); await login(long, data, unicode, false); await long.health();
      requireProtocol(long.observed.maxRequestTargetBytes > 10_000, "OBSERVED_NESTED_CALLBACK_TRANSPORT");
    });
    await run("backend_session_recovery", async () => {
      await ordinary.quiet(); const denials = data.counters().renewalDenials;
      requireProtocol((await ordinary.cookies()).callback, "EXISTING_ORDINARY_CALLBACK_COOKIE");
      await data.revokeBrowserLogin(data.tailA); // Exact login captured by its genuine successful search; no cookie mutation.
      await ordinary.navigate(directory(unicode)); await ordinary.ready("#account-email");
      requireProtocol(data.counters().renewalDenials > denials, "REAL_BACKEND_RENEWAL_DENIAL");
      await login(ordinary, data, unicode, false); await ordinary.health();
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
      await until(() => long.evaluate<boolean>('window.__get452Events.composing>0 && !!document.querySelector(\'form[action="/workspace/people"] button[type="submit"]\')?.disabled'), "GET452 trusted composition start");
      await long.key("Enter", "Enter", 229); await long.quiet();
      requireProtocol(data.observationCount() === before && await long.url() === beforeUrl, "IME_CANDIDATE_NO_DISPATCH");
      const committed = "中文-尾部";
      await long.call("Input.insertText", { text: committed });
      await until(() => long.evaluate<boolean>('window.__get452Events.composed>0 && !document.querySelector(\'form[action="/workspace/people"] button[type="submit"]\')?.disabled'), "GET452 trusted composition commit");
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
      await long.click('form[action="/workspace/people"] a');
      await until(() => long.evaluate<boolean>(`location.pathname==="/workspace/people" && !new URL(location.href).searchParams.has("query") && document.querySelector(${JSON.stringify(directoryInput)})?.value==="" && document.activeElement===document.querySelector(${JSON.stringify(directoryInput)})`), "GET452 clear readback focus");
      await long.health();
    });
    await run("mobile375_geometry", async () => {
      await long.call("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
      await search(long, data, unicode);
      requireProtocol(await long.evaluate<boolean>(`(() => {const f=document.querySelector('form[action="/workspace/people"]'),i=f?.querySelector('input[name="query"]'),b=f?.querySelector('button[type="submit"]');if(!f||!i||!b)return false;const a=f.getBoundingClientRect(),x=i.getBoundingClientRect(),y=b.getBoundingClientRect();return innerWidth===375&&document.documentElement.scrollWidth<=innerWidth+1&&a.left>=0&&a.right<=innerWidth+1&&x.width>=100&&y.width>=32&&y.height>=32&&x.right<=y.left+1&&x.left>=a.left&&y.right<=a.right+1;})()`), "MOBILE375_GEOMETRY");
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
    receipt.failure = error instanceof DirectoryProtocolFailure ? error.code : "UNCLASSIFIED_PROTOCOL_FAILURE";
  } finally {
    receipt.observations = pages.map(page => ({ ...page.observed })); receipt.backend = fixture?.counters() ?? null;
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
