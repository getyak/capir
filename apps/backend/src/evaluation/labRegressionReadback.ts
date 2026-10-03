import { CONTRACT_VERSION } from "@talent-signal/contracts";

const UUID = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const MAX_BYTES = 512_000;

export function labReadbackURL(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/"
    || !(url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)))) {
    throw new Error("LAB_BACKEND_REQUIRES_HTTPS_OR_LOOPBACK_ORIGIN");
  }
  return url;
}

/** Explicitly selected origin only; no redirect can carry its credential elsewhere. */
export async function readLabRegressionFromBackend(input: {
  baseURL: string; token: string; regressionID: string; runID: string;
}, fetcher: typeof fetch = fetch): Promise<{ bundle: unknown; job: unknown }> {
  const baseURL = labReadbackURL(input.baseURL);
  if (!UUID.test(input.regressionID) || !UUID.test(input.runID)) throw new Error("LAB_READBACK_ID_INVALID");
  if (!input.token.trim() || /[\r\n]/.test(input.token)) throw new Error("LAB_READBACK_TOKEN_REQUIRED");
  async function get(path: string): Promise<Record<string, unknown>> {
    const response = await fetcher(new URL(path, baseURL), { headers: { authorization: `Bearer ${input.token}` },
      redirect: "error", signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!response.ok) throw new Error(`LAB_READBACK_HTTP_${response.status}`);
    if (!response.body) throw new Error("LAB_READBACK_EMPTY");
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) throw new Error("LAB_READBACK_TOO_LARGE");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>; }
    catch { throw new Error("LAB_READBACK_INVALID_JSON"); }
  }
  const bundle = await get(`/v1/lab/regressions/${input.regressionID}/export`);
  const envelope = await get(`/v1/lab/experiment-jobs/${input.runID}`);
  if (bundle.id !== input.regressionID || envelope.contract_version !== CONTRACT_VERSION
    || (envelope.job as { id?: unknown } | undefined)?.id !== input.runID) throw new Error("LAB_READBACK_BINDING_MISMATCH");
  // Recheck source lifetime after fetching the derived run. A concurrent deletion must not be hidden by a stale export.
  const current = await get(`/v1/lab/regressions/${input.regressionID}/export`);
  if (current.id !== bundle.id || current.content_hash !== bundle.content_hash) throw new Error("LAB_READBACK_SOURCE_CHANGED");
  return { bundle, job: envelope.job };
}
