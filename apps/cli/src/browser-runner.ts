/**
 * Owned detached browser runner (`dist/browser-runner.js`).
 *
 * Launched by the CLI with a private IPC pipe. The handoff secret travels in
 * the IPC message only. The runner opens an isolated Playwright Chromium
 * context (no saved auth state, no parent Web bearer), performs the private
 * one-use handoff POST through the context request jar (the real Web flow),
 * navigates only to /workspace, verifies the rendered contract for its
 * explicit purpose, reports the actual launch receipt, then stays alive until
 * its browser closes, the run expires, the session is revoked, or its owner
 * terminates it.
 *
 * Purposes:
 * - `test-run` (operator test accounts): the private POST carries the exact
 *   Origin of the configured Web origin plus the nonsecret expected run id;
 *   verification compares the canonical banner run/account/user/username and
 *   dataset counts/expiry against the CLI-expected values.
 * - `sandbox` (default; frozen legacy strict-replay semantics): the legacy
 *   exchange path and people-directory DOM contract are preserved verbatim.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  evaluateSandboxEntryVerification,
  evaluateTestEntryVerification,
  runnerHeadless,
  type EntryObservation,
  type RunnerLaunchMessage,
  type RunnerReceipt,
  type RunnerVerification,
  type SandboxEntryObservation,
} from "./runner.js";
import { redactSecrets, redactText, redactValue } from "./output.js";

const VERIFY_TIMEOUT_MS = 45_000;
const RECHECK_INTERVAL_MS = 20_000;

/** Private one-use handoff exchange route of the configured Web origin. */
export const TEST_ENTRY_EXCHANGE_PATH = "/api/capir/test-entry";
/** Frozen legacy sandbox handoff exchange path. */
export const SANDBOX_HANDOFF_PATH = "/capir/handoff";

// DOM contract with the Web canonical test banner
// (apps/web/components/capir-test-banner.tsx): exactly one rendered element
// carries the authoritative session state, run identity, run expiry and
// dataset verification state/counts derived from the live operator-owned run.
const RUN_VERIFICATION_SELECTOR = "[data-capir-run-verification]";
const SESSION_STATE_SELECTOR = "[data-capir-session-state]";

/** Minimal surface of Playwright's APIRequestContext used by the exchange. */
export interface HandoffRequester {
  post(
    url: string,
    options: Record<string, unknown>,
  ): Promise<{
    status(): number;
    headers(): Record<string, string>;
    text(): Promise<string>;
  }>;
}

export interface HandoffPostInput {
  exchangeUrl: string;
  /** Exact configured Web origin; sent as the Origin header of the private POST. */
  origin: string;
  handoffSecret: string;
  /** Nonsecret expected run id of the target test run (test-run purpose). */
  runId?: string;
}

/**
 * The one private handoff POST of the test-run purpose. The secret travels in
 * the POST body only; the exact Origin header is always sent so the Web gate
 * can require it, redirects are refused, and acceptance is a 303 to
 * /workspace.
 */
export async function postTestHandoff(
  requester: HandoffRequester,
  input: HandoffPostInput,
): Promise<{ accepted: boolean; status: number; location: string | null }> {
  const response = await requester.post(input.exchangeUrl, {
    data: {
      handoff_secret: input.handoffSecret,
      ...(input.runId === undefined ? {} : { run_id: input.runId }),
    },
    headers: { "content-type": "application/json", origin: input.origin },
    timeout: 30_000,
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  const location = response.headers()["location"] ?? null;
  return {
    accepted: response.status() === 303 && location === "/workspace",
    status: response.status(),
    location,
  };
}

/** Frozen legacy sandbox exchange: body secret only, no Origin header. */
export async function postSandboxHandoff(
  requester: HandoffRequester,
  input: { exchangeUrl: string; handoffSecret: string },
): Promise<{ accepted: boolean; status: number; location: string | null }> {
  const response = await requester.post(input.exchangeUrl, {
    data: { handoff_secret: input.handoffSecret },
    headers: { "content-type": "application/json" },
    timeout: 30_000,
    maxRedirects: 0,
    failOnStatusCode: false,
  });
  const location = response.headers()["location"] ?? null;
  return {
    accepted: response.status() === 303 && location === "/workspace",
    status: response.status(),
    location,
  };
}

/** One browser-side turn: hydration cannot interleave these DOM reads. */
export async function sampleEntryDom(page: import("playwright").Page): Promise<EntryObservation> {
  return page.evaluate(() => {
    const root = document.querySelector("[data-capir-run-verification]");
    const attribute = (name: string) => root?.getAttribute(name) ?? null;
    const count = (name: string) => {
      const raw = attribute(name);
      return raw === null ? 0 : Number(raw);
    };
    return {
      banner_state: attribute("data-capir-session-state"),
      demo_expiry: attribute("data-capir-demo-expiry"),
      dataset_state: attribute("data-capir-dataset-state"),
      dataset_counts: {
        contacts: count("data-capir-contacts"),
        observations: count("data-capir-observations"),
        tasks: count("data-capir-tasks"),
      },
      run_id: attribute("data-capir-run-id"),
      account_id: attribute("data-capir-account-id"),
      user_id: attribute("data-capir-user-id"),
      username: attribute("data-capir-username"),
    };
  });
}

/** Frozen legacy sandbox DOM contract (people directory). */
export async function sampleLegacyEntryDom(
  page: import("playwright").Page,
): Promise<SandboxEntryObservation> {
  return page.evaluate(() => ({
    banner_state: document.querySelector("[data-capir-session-state]")
      ?.getAttribute("data-capir-session-state") ?? null,
    demo_expiry: document.querySelector("[data-capir-demo-expiry]")
      ?.getAttribute("data-capir-demo-expiry") ?? null,
    directory_state: document.querySelector("[data-people-directory-state]")
      ?.getAttribute("data-people-directory-state") ?? null,
    people_links: document.querySelectorAll(
      'section[aria-label="常用人物"] a[href*="person="], a[href^="/workspace/people/"]',
    ).length,
  }));
}

function send(receipt: RunnerReceipt): void {
  process.send?.(receipt);
}

/** Known secrets of the current launch message, scrubbed from every receipt file. */
let receiptSecrets: string[] = [];

function writeReceipt(directory: string | undefined, receipt: unknown, name = "runner-receipt.json"): void {
  if (!directory) return;
  try {
    mkdirSync(directory, { recursive: true });
    const serialized = redactSecrets(
      JSON.stringify(redactValue(receipt), null, 2),
      receiptSecrets,
    );
    writeFileSync(join(directory, name), `${serialized}\n`);
  } catch {
    /* receipts are best effort; never fail the run on artifact writes */
  }
}

async function handle(message: RunnerLaunchMessage): Promise<void> {
  receiptSecrets = [message.handoff_secret];
  const purpose = message.purpose === "test-run" ? "test-run" : "sandbox";
  const headless = runnerHeadless(message);
  const startedAt = new Date().toISOString();
  let browser: import("playwright").Browser | null = null;
  let context: import("playwright").BrowserContext | null = null;
  const observations: string[] = [];
  let verification: RunnerVerification | undefined;
  let finalized = false;
  const receipt = (extra: Partial<RunnerReceipt>): RunnerReceipt =>
    ({
      ok: false,
      launched: false,
      pid: process.pid,
      sandbox_id: message.sandbox_id,
      entry_path: message.entry_path,
      browser: { name: "chromium", version: browser?.version() ?? null, headless },
      ...(verification ? { verification } : {}),
      ...extra,
    }) as RunnerReceipt;

  const shutdown = async (finalExtra: Partial<RunnerReceipt>) => {
    const final = receipt(finalExtra);
    finalized = true;
    writeReceipt(message.receipt_dir, {
      started_at: startedAt,
      ...final,
      observations,
    });
    try {
      await context?.close();
    } catch {
      /* already closed */
    }
    try {
      await browser?.close();
    } catch {
      /* already closed */
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    observations.push(`${new Date().toISOString()} terminated by owner`);
    void shutdown({ ok: true, launched: true });
  });

  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({
      headless,
      ...(headless && process.env.CAPIR_TEST_CHROME_EXECUTABLE
        ? { executablePath: process.env.CAPIR_TEST_CHROME_EXECUTABLE } : {}),
    });
    context = await browser.newContext(); // isolated: no storage state, no parent session
  } catch (error) {
    send(
      receipt({
        ok: false,
        launched: false,
        error: {
          code: "CAPIR_BROWSER_LAUNCH_FAILED",
          message: `Chromium could not launch: ${error instanceof Error ? error.message : String(error)}`,
        },
      }),
    );
    writeReceipt(message.receipt_dir, { started_at: startedAt, observations });
    process.exit(0);
    return;
  }

  // Private one-use handoff POST through the context request jar — the real
  // Web flow. The secret is body-only and never enters a URL.
  try {
    const exchangeUrl =
      purpose === "test-run"
        ? new URL(TEST_ENTRY_EXCHANGE_PATH, message.web_origin).toString()
        : new URL(SANDBOX_HANDOFF_PATH, message.web_origin).toString();
    const exchanged =
      purpose === "test-run"
        ? await postTestHandoff(context.request, {
            exchangeUrl,
            origin: message.web_origin,
            handoffSecret: message.handoff_secret,
            ...(message.expected ? { runId: message.expected.run_id } : {}),
          })
        : await postSandboxHandoff(context.request, {
            exchangeUrl,
            handoffSecret: message.handoff_secret,
          });
    if (!exchanged.accepted) {
      const failure = {
        ok: false,
        launched: true,
        error: {
          code: "CAPIR_BROWSER_HANDOFF_FAILED",
          message: `The Web handoff exchange returned HTTP ${exchanged.status} with location ${redactText(String(exchanged.location))}`,
        },
      };
      send(receipt(failure));
      await shutdown(failure);
      return;
    }
    observations.push(
      `${new Date().toISOString()} Web handoff exchange completed with HTTP 303`,
    );
  } catch (error) {
    const failure = {
      ok: false,
      launched: true,
      error: {
        code: "CAPIR_BROWSER_HANDOFF_FAILED",
        message: `The Web handoff exchange failed: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
    send(receipt(failure));
    await shutdown(failure);
    return;
  }

  const page = await context.newPage();
  try {
    await page.goto(new URL("/workspace", message.web_origin).toString(), {
      waitUntil: "domcontentloaded",
      timeout: VERIFY_TIMEOUT_MS,
    });
    const deadline = Date.now() + 30_000;
    let verdictReason = "";
    if (purpose === "test-run") {
      await page.waitForSelector(RUN_VERIFICATION_SELECTOR, { timeout: VERIFY_TIMEOUT_MS });
      const preset: "daily" | "empty" = message.scenario_id === "daily" ? "daily" : "empty";
      let observation: EntryObservation = {
        banner_state: null, demo_expiry: null, dataset_state: null,
        dataset_counts: { contacts: 0, observations: 0, tasks: 0 },
        run_id: null, account_id: null, user_id: null, username: null,
      };
      let lastSample = "";
      do {
        observation = await sampleEntryDom(page);
        const counts = observation.dataset_counts;
        const sample = `dataset_state=${observation.dataset_state ?? "missing"} counts=${counts.contacts}/${counts.observations}/${counts.tasks} run=${observation.run_id ?? "missing"}`;
        if (sample !== lastSample) {
          observations.push(`${new Date().toISOString()} observed ${sample}`);
          lastSample = sample;
        }
        if (observation.banner_state === "active" &&
            (observation.dataset_state === "ready" || observation.dataset_state === "error")) break;
        await page.waitForTimeout(1000);
      } while (Date.now() < deadline);
      const expected = message.expected;
      const verdict = expected
        ? evaluateTestEntryVerification(observation, expected, preset, message.sandbox_expires_at)
        : {
            passed: false, settled: false, settled_empty: false,
            reason: "no expected run identity was supplied for the test-run purpose",
          };
      verdictReason = verdict.reason;
      verification = {
        banner_state: observation.banner_state,
        demo_expiry: observation.demo_expiry,
        dataset_state: observation.dataset_state,
        dataset_counts: observation.dataset_counts,
        run_id: observation.run_id,
        account_id: observation.account_id,
        user_id: observation.user_id,
        username: observation.username,
        settled: verdict.settled,
        settled_empty: verdict.settled_empty,
        preset_expectation: preset,
        passed: verdict.passed,
        observations: [
          ...observations,
          `${new Date().toISOString()} rendered workspace verified: dataset_state=${observation.dataset_state ?? "missing"} counts=${observation.dataset_counts.contacts}/${observation.dataset_counts.observations}/${observation.dataset_counts.tasks}${verdict.reason ? ` (${verdict.reason})` : ""}`,
        ],
      };
    } else {
      await page.waitForSelector(SESSION_STATE_SELECTOR, { timeout: VERIFY_TIMEOUT_MS });
      const peopleExpectation: "people" | "no-people" =
        message.scenario_id === "daily" ? "people" : "no-people";
      let observation: SandboxEntryObservation = {
        banner_state: null, demo_expiry: null, directory_state: null, people_links: 0,
      };
      let lastSample = "";
      do {
        observation = await sampleLegacyEntryDom(page);
        const sample = `directory_state=${observation.directory_state ?? "missing"} people_links=${observation.people_links}`;
        if (sample !== lastSample) {
          observations.push(`${new Date().toISOString()} observed ${sample}`);
          lastSample = sample;
        }
        if (observation.banner_state === "active" && observation.directory_state === "ready" &&
            (peopleExpectation === "people" ? observation.people_links >= 1 : true)) break;
        await page.waitForTimeout(1000);
      } while (Date.now() < deadline);
      const verdict = evaluateSandboxEntryVerification(
        observation,
        peopleExpectation,
        message.sandbox_expires_at,
      );
      verdictReason = verdict.reason;
      verification = {
        banner_state: observation.banner_state,
        demo_expiry: observation.demo_expiry,
        directory_state: observation.directory_state,
        people_links: observation.people_links,
        settled: verdict.settled,
        settled_empty: verdict.settled_empty,
        scenario_expectation: peopleExpectation,
        passed: verdict.passed,
        observations: [
          ...observations,
          `${new Date().toISOString()} rendered workspace verified: directory_state=${observation.directory_state ?? "missing"} people_links=${observation.people_links}${verdict.reason ? ` (${verdict.reason})` : ""}`,
        ],
      };
    }
    const excerpt = (await page.textContent("body"))?.replace(/\s+/g, " ").trim().slice(0, 4000) ?? "";
    writeReceipt(
      message.receipt_dir,
      {
        started_at: startedAt,
        sandbox_id: message.sandbox_id,
        entry_path: message.entry_path,
        rendered_text_excerpt: excerpt,
      },
      "rendered-excerpt.json",
    );
    writeReceipt(message.receipt_dir, {
      started_at: startedAt,
      sandbox_id: message.sandbox_id,
      entry_path: message.entry_path,
      verification,
      observations,
    });
    if (message.receipt_dir) {
      try {
        await page.screenshot({
          path: join(message.receipt_dir, "workspace-entry.png"),
          fullPage: false,
        });
      } catch {
        /* screenshots are best effort */
      }
    }
    send(receipt({ ok: verification.passed, launched: true }));
    void verdictReason;
  } catch (error) {
    const failure = {
      ok: false,
      launched: true,
      error: {
        code: "CAPIR_VERIFICATION_FAILED",
        message: `The rendered workspace could not be verified: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
    send(receipt(failure));
    await shutdown(failure);
    return;
  }

  // Read a separate request with this isolated cookie jar. Never reload or
  // navigate the user's active page during periodic revocation checks.
  const expiryTimer = setTimeout(
    () => void shutdown({ ok: true, launched: true }),
    Math.max(1000, Date.parse(message.sandbox_expires_at) - Date.now()),
  );
  const recheck = setInterval(() => {
    void (async () => {
      try {
        const probe = await context.request.get(new URL("/workspace", message.web_origin).toString(), {
          timeout: 30_000, maxRedirects: 0, failOnStatusCode: false,
        });
        const html = probe.status() === 200 ? await probe.text() : "";
        const state = html.match(/data-capir-session-state="(active|revoked)"/)?.[1] ?? "missing";
        if (state !== "active") {
          clearInterval(recheck);
          clearTimeout(expiryTimer);
          observations.push(
          `${new Date().toISOString()} background session read became "${state}" (consistent with grant revocation or expiry)`,
          );
          await shutdown({ ok: true, launched: true });
          return;
        }
        observations.push(`${new Date().toISOString()} background recheck: session state "${state}"`);
        writeReceipt(message.receipt_dir, {
          started_at: startedAt,
          sandbox_id: message.sandbox_id,
          verification,
          observations,
        });
      } catch {
        /* transient background read failures do not end the session */
      }
    })();
  }, RECHECK_INTERVAL_MS);
  browser.on("disconnected", () => {
    clearInterval(recheck);
    clearTimeout(expiryTimer);
    if (!finalized) {
      writeReceipt(message.receipt_dir, {
        started_at: startedAt,
        verification,
        observations: [...observations, `${new Date().toISOString()} browser closed`],
      });
    }
    process.exit(0);
  });
}

process.on("message", (message: RunnerLaunchMessage) => {
  void handle(message).catch((error: unknown) => {
    send({
      ok: false,
      launched: false,
      pid: process.pid,
      sandbox_id: message.sandbox_id,
      entry_path: message.entry_path,
      browser: { name: "chromium", version: null, headless: runnerHeadless(message) },
      error: {
        code: "CAPIR_BROWSER_LAUNCH_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
    });
    process.exit(0);
  });
});
