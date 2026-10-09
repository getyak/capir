import "server-only";

import {
  TalentSignalClient,
  type CompareLabScenarioRequest,
  type CreateRealityReceiptRequest,
  type LabJobRequest,
  type LabJobReview,
  type LabRegressionRequest,
  type PromoteRealityReceiptRequest,
  type RunLabScenarioRequest,
  type StartLabSessionRequest,
} from "@talent-signal/contracts";

import { authenticatedBackendClient as signedInBackendClient } from "./backendAuth";
import { isPursuitIntegrationMode } from "./pursuitBackend";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const DEFAULT_ACCOUNT_SLUG = "fixture-alpha";
const DEFAULT_USER_EMAIL = "recruiter@alpha.local";

function backendUrl(): URL {
  const parsed = new URL(
    process.env.TALENT_SIGNAL_BACKEND_URL?.trim() ??
      "http://127.0.0.1:4317",
  );
  if (parsed.protocol === "https:") return parsed;
  if (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname)) {
    return parsed;
  }
  throw new Error(
    "capri Lab must use HTTPS, except for an explicit loopback integration.",
  );
}

export async function authenticatedLabClient(label: string): Promise<TalentSignalClient> {
  const signedIn = await signedInBackendClient();
  if (signedIn) { signedIn.setClientPlatform("web"); return signedIn; }
  const url = backendUrl();
  if (!LOOPBACK_HOSTS.has(url.hostname) || !isPursuitIntegrationMode()) {
    throw new Error("Production Web-to-backend identity exchange is not configured for Lab.");
  }
  const client = new TalentSignalClient(url.origin);
  client.setClientPlatform("web");
  await client.login({
    account_slug:
      process.env.TALENT_SIGNAL_BACKEND_ACCOUNT_SLUG ?? DEFAULT_ACCOUNT_SLUG,
    user_email:
      process.env.TALENT_SIGNAL_BACKEND_USER_EMAIL ?? DEFAULT_USER_EMAIL,
    client_label: label,
  });
  return client;
}

export async function loadLabManifest() {
  return (await authenticatedLabClient("web-lab-manifest")).getLabManifest();
}

export async function createLabSession(request: StartLabSessionRequest) {
  return (await authenticatedLabClient("web-lab-session")).startLabSession(request);
}

export async function createLabRun(
  sessionId: string,
  request: RunLabScenarioRequest,
) {
  return (await authenticatedLabClient("web-lab-run")).runLabScenario(
    sessionId,
    request,
  );
}

export async function createLabComparison(
  sessionId: string,
  request: CompareLabScenarioRequest,
) {
  return (await authenticatedLabClient("web-lab-comparison")).compareLabScenario(
    sessionId,
    request,
  );
}

export async function createLabRealityReceipt(
  sessionId: string,
  request: CreateRealityReceiptRequest,
) {
  return (await authenticatedLabClient("web-lab-receipt")).createRealityReceipt(
    sessionId,
    request,
  );
}

export async function promoteLabRealityReceipt(
  receiptId: string,
  request: PromoteRealityReceiptRequest,
) {
  return (await authenticatedLabClient("web-lab-promotion")).promoteRealityReceipt(
    receiptId,
    request,
  );
}

export async function loadLabJobCatalog() {
  return (await authenticatedLabClient("web-lab-job-catalog")).getLabJobCatalog();
}

export async function createLabJob(request: LabJobRequest) {
  return (await authenticatedLabClient("web-lab-job-create")).startLabJob(request);
}

export async function loadLabJob(jobId: string) {
  return (await authenticatedLabClient("web-lab-job-read")).getLabJob(jobId);
}

export async function cancelLabJob(jobId: string) {
  return (await authenticatedLabClient("web-lab-job-cancel")).cancelLabJob(jobId);
}

export async function reviewLabJob(jobId: string, review: LabJobReview) {
  return (await authenticatedLabClient("web-lab-job-review")).reviewLabJob(
    jobId,
    review,
  );
}

export async function loadLabRegressions() {
  return (await authenticatedLabClient("web-lab-regression-list")).listLabRegressions();
}

export async function loadLabRegression(regressionId: string) {
  return (await authenticatedLabClient("web-lab-regression-read")).getLabRegression(
    regressionId,
  );
}

export async function createLabRegression(request: LabRegressionRequest) {
  return (await authenticatedLabClient("web-lab-regression-create")).saveLabRegression(
    request,
  );
}
