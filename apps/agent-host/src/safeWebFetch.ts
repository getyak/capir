import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";

import { Parser } from "htmlparser2";
import { withAbort } from "./abortable.js";

import {
  publicResearchDomainAllowed,
  type AgentFetchedWebPage,
  type AgentPublicResearchScope,
  type AgentWebSearchResult,
} from "@talent-signal/agent";

const PAGE_BYTE_LIMIT = 1_000_000;
const ROBOTS_BYTE_LIMIT = 200_000;
const PAGE_TEXT_LIMIT = 35_000;
const FETCH_TIMEOUT_MS = 8_000;

export class AgentSafeWebFetchError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AgentSafeWebFetchError";
  }
}

export interface BrowserNetworkBudget { requests: number; bytes: number }

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }
  const [a = 0, b = 0, c = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  // Admit global unicast only: this also rejects mapped IPv4 and NAT64 forms
  // which must not bypass the IPv4 checks through a second spelling.
  const parts = normalized.split(":");
  const first = parseInt(parts[0] || "0", 16), second = parseInt(parts[1] || "0", 16);
  if (first < 0x2000 || first > 0x3fff) return true;
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/u.test(normalized) ||
    normalized.startsWith("ff") ||
    (first === 0x2001 && (second === 0xdb8 || second < 0x200)) ||
    first === 0x2002 || first === 0x3fff
  );
}

/** Broker resource for a network-none browser. No browser cookies, request
 * headers, credentials, bodies or ambient proxy are forwarded to the web. */
export async function fetchBrowserResource(
  rawURL: string, admittedOrigin: string, executionSignal: AbortSignal,
  options: { fetcher?: typeof fetch; lookup?: HostLookup; budget?: BrowserNetworkBudget } = {},
): Promise<{ status: number; headers: Record<string, string>; body: Buffer }> {
  const url = new URL(rawURL), origin = new URL(admittedOrigin);
  const signal = AbortSignal.any([executionSignal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]);
  if (rawURL.length > 2_000 || url.protocol !== "https:" || url.username || url.password
    || url.port || url.origin !== origin.origin || origin.protocol !== "https:" || origin.port) {
    throw new AgentSafeWebFetchError("BROWSER_RESOURCE_OUT_OF_SCOPE", "Only this discovered HTTPS origin is admitted.");
  }
  signal.throwIfAborted();
  const lookup = options.lookup ?? dns.lookup, transport = options.fetcher ?? pinnedHttpsFetcher(lookup);
  const budget = options.budget ?? { requests: 0, bytes: 0 };
  // Count every HTTP request and consumed body byte, including robots and its
  // redirects. The same budget object is shared across the entire browser Run.
  const fetcher: typeof fetch = async (input, init) => {
    signal.throwIfAborted();
    if (budget.requests >= 80) throw new Error("BROWSER_HTTP_LIMIT");
    if (budget.bytes > 8_000_000) throw new Error("BROWSER_RESPONSE_BYTE_LIMIT");
    budget.requests++;
    const response = await transport(input, init);
    const body = response.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        signal.throwIfAborted();
        budget.bytes += chunk.byteLength;
        if (budget.bytes > 8_000_000) throw new Error("BROWSER_RESPONSE_BYTE_LIMIT");
        controller.enqueue(chunk);
      },
    }));
    return new Response(body ?? null, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
  await assertPublicHostname(url.hostname, lookup, signal);
  await assertRobotsAllowed(url, url.hostname, signal, fetcher, lookup, origin.origin);
  signal.throwIfAborted();
  const response = await withAbort(signal, () => fetcher(url, { method: "GET", redirect: "manual",
    headers: { "user-agent": "TalentSignalLocalAgent/0.1", accept: "*/*" },
    signal }));
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel();
    const location = response.headers.get("location");
    if (!location) throw new Error("BROWSER_REDIRECT_INVALID");
    const target = new URL(location, url);
    if (target.href.length > 2_000 || target.origin !== origin.origin || target.username || target.password || target.port) throw new Error("BROWSER_REDIRECT_OUT_OF_SCOPE");
    return { status: response.status, headers: { location: target.href }, body: Buffer.alloc(0) };
  }
  const mediaType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!response.ok || !/^(?:text\/(?:html|plain|css|javascript)|application\/(?:xhtml\+xml|javascript|json)|image\/(?:png|jpeg|webp|gif|svg\+xml)|font\/(?:woff2?|ttf|otf))(?:;|$)/u.test(mediaType)) {
    await response.body?.cancel();
    throw new Error("BROWSER_RESOURCE_UNAVAILABLE");
  }
  const body = Buffer.from(await withAbort(signal, () => responseBytes(response, PAGE_BYTE_LIMIT)));
  signal.throwIfAborted();
  const headers: Record<string, string> = { "content-type": mediaType, "cache-control": "no-store" };
  const csp = response.headers.get("content-security-policy");
  if (csp && csp.length <= 8_000) headers["content-security-policy"] = csp;
  return { status: response.status, headers, body };
}

export function isBlockedWebAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

type HostLookup = typeof dns.lookup;

function pinnedHttpsFetcher(lookup: HostLookup): typeof fetch {
  return ((input: URL | RequestInfo, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(String(input));
    return new Promise<Response>((resolve, reject) => {
      const pinnedLookup: NonNullable<RequestOptions["lookup"]> = (
        hostname,
        options,
        callback,
      ) => {
        void withAbort(init?.signal ?? AbortSignal.timeout(FETCH_TIMEOUT_MS), () => lookup(hostname, { all: true, verbatim: true })).then(
          (addresses) => {
            if (
              addresses.length === 0 ||
              addresses.some(({ address }) => isBlockedWebAddress(address))
            ) {
              const error = new Error(
                "The public host resolves to a private or reserved address.",
              ) as NodeJS.ErrnoException;
              error.code = "WEB_FETCH_HOST_BLOCKED";
              callback(error, "", 0);
              return;
            }
            if (options.all) {
              callback(null, addresses);
              return;
            }
            const selected = addresses[0];
            if (!selected) {
              callback(new Error("The public host has no address."), "", 0);
              return;
            }
            callback(null, selected.address, selected.family);
          },
          (error: unknown) =>
            callback(
              error instanceof Error ? error : new Error(String(error)),
              "",
              0,
            ),
        );
      };
      const request = httpsRequest(
        url,
        {
          method: init?.method ?? "GET",
          headers: init?.headers as RequestOptions["headers"],
          signal: init?.signal ?? undefined,
          lookup: pinnedLookup,
        },
        (response) => {
          const headers = new Headers();
          for (const [name, raw] of Object.entries(response.headers)) {
            if (Array.isArray(raw)) {
              for (const item of raw) headers.append(name, item);
            } else if (raw !== undefined) {
              headers.set(name, String(raw));
            }
          }
          resolve(
            new Response(
              Readable.toWeb(response) as ReadableStream<Uint8Array>,
              {
                status: response.statusCode ?? 500,
                headers,
                ...(response.statusMessage
                  ? { statusText: response.statusMessage }
                  : {}),
              },
            ),
          );
        },
      );
      request.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "WEB_FETCH_HOST_BLOCKED") {
          reject(
            new AgentSafeWebFetchError(
              error.code,
              "The public host resolves to a private or reserved address.",
            ),
          );
          return;
        }
        reject(error);
      });
      request.end();
    });
  }) as typeof fetch;
}

async function assertPublicHostname(
  hostname: string,
  lookup: HostLookup,
  signal: AbortSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS),
): Promise<void> {
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new AgentSafeWebFetchError(
      "WEB_FETCH_HOST_BLOCKED",
      "Local and private hosts cannot be fetched by the Agent.",
    );
  }
  const directIp = isIP(hostname);
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses =
      directIp === 0
        ? await withAbort(signal, () => lookup(hostname, { all: true, verbatim: true }))
        : [{ address: hostname, family: directIp }];
  } catch {
    throw new AgentSafeWebFetchError(
      "WEB_FETCH_DNS_FAILED",
      "The public host could not be resolved safely.",
    );
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isBlockedWebAddress(address))
  ) {
    throw new AgentSafeWebFetchError(
      "WEB_FETCH_HOST_BLOCKED",
      "The public host resolves to a private or reserved address.",
    );
  }
}

async function responseBytes(response: Response, maximumBytes: number) {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maximumBytes) {
    throw new AgentSafeWebFetchError(
      "WEB_FETCH_RESPONSE_TOO_LARGE",
      "The public page exceeds the bounded fetch size.",
    );
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new AgentSafeWebFetchError(
        "WEB_FETCH_RESPONSE_TOO_LARGE",
        "The public page exceeds the bounded fetch size.",
      );
    }
    chunks.push(chunk.value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function fetchBounded(
  input: URL,
  allowedHostname: string,
  maximumBytes: number,
  signal: AbortSignal,
  fetcher: typeof fetch,
  lookup: HostLookup,
  exactOrigin?: string,
) {
  let current = new URL(input);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    if (
      current.protocol !== "https:" ||
      current.username ||
      current.password ||
      current.hostname.toLowerCase() !== allowedHostname ||
      (exactOrigin !== undefined && current.origin !== exactOrigin)
    ) {
      throw new AgentSafeWebFetchError(
        "WEB_FETCH_REDIRECT_OUT_OF_SCOPE",
        "A public-page redirect left the discovered HTTPS host.",
      );
    }
    await assertPublicHostname(current.hostname, lookup, signal);
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await fetcher(current, {
        headers: {
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
          "user-agent": "TalentSignalLocalAgent/0.1",
        },
        redirect: "manual",
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(FETCH_TIMEOUT_MS),
        ]),
      });
    } catch (error) {
      if (error instanceof AgentSafeWebFetchError) throw error;
      // Fixed operation message: an untyped transport exception message is
      // untrusted and never enters a typed fetch error or model context.
      throw new AgentSafeWebFetchError(
        "WEB_FETCH_UNAVAILABLE",
        "The public page could not be reached.",
      );
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) {
        throw new AgentSafeWebFetchError(
          "WEB_FETCH_REDIRECT_INVALID",
          "The public-page redirect has no location.",
        );
      }
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) {
      throw new AgentSafeWebFetchError(
        "WEB_FETCH_PROVIDER_FAILED",
        `The public page returned HTTP ${response.status}.`,
      );
    }
    return {
      response,
      finalUrl: current,
      bytes: await responseBytes(response, maximumBytes),
    };
  }
  throw new AgentSafeWebFetchError(
    "WEB_FETCH_REDIRECT_LIMIT_EXCEEDED",
    "The public-page redirect limit was exceeded.",
  );
}

function robotsAllows(robotsText: string, pathname: string): boolean {
  const lines = robotsText
    .split(/\r?\n/u)
    .map((line) => line.replace(/#.*$/u, "").trim())
    .filter(Boolean);
  let applies = false;
  const rules: Array<{ allow: boolean; path: string }> = [];
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      applies = value === "*";
      continue;
    }
    if (
      applies &&
      (field === "allow" || field === "disallow") &&
      value
    ) {
      rules.push({ allow: field === "allow", path: value });
    }
  }
  const matching = rules
    .filter((rule) => pathname.startsWith(rule.path))
    .sort((left, right) => right.path.length - left.path.length);
  return matching[0]?.allow ?? true;
}

async function assertRobotsAllowed(
  url: URL,
  allowedHostname: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
  lookup: HostLookup,
  exactOrigin?: string,
) {
  try {
    const result = await fetchBounded(
      new URL("/robots.txt", url.origin),
      allowedHostname,
      ROBOTS_BYTE_LIMIT,
      signal,
      fetcher,
      lookup,
      exactOrigin,
    );
    if (
      !robotsAllows(
        new TextDecoder().decode(result.bytes),
        url.pathname || "/",
      )
    ) {
      throw new AgentSafeWebFetchError(
        "WEB_FETCH_ROBOTS_DISALLOWED",
        "The discovered public page is disallowed by robots.txt.",
      );
    }
  } catch (error) {
    if (error instanceof Error && /^BROWSER_(?:HTTP_LIMIT|RESPONSE_BYTE_LIMIT)$/u.test(error.message)) throw error;
    if (
      error instanceof AgentSafeWebFetchError &&
      error.code === "WEB_FETCH_ROBOTS_DISALLOWED"
    ) {
      throw error;
    }
    // Unavailable robots does not broaden scope: only the exact discovered
    // page and host remain eligible.
  }
}

function extractText(contentType: string, bytes: Uint8Array): string {
  const decoded = new TextDecoder().decode(bytes);
  if (!contentType.includes("html") && !contentType.startsWith("text/plain")) {
    throw new AgentSafeWebFetchError(
      "WEB_FETCH_CONTENT_TYPE_UNSUPPORTED",
      "The public page is not readable text or HTML.",
    );
  }
  if (contentType.startsWith("text/plain")) {
    return decoded.normalize("NFKC").trim().slice(0, PAGE_TEXT_LIMIT);
  }
  const textParts: string[] = [];
  const ignoredTags = new Set(["noscript", "script", "style"]);
  const lineBreakTags = new Set([
    "article",
    "aside",
    "blockquote",
    "br",
    "div",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "li",
    "main",
    "nav",
    "p",
    "section",
    "table",
    "td",
    "th",
    "tr",
  ]);
  let ignoredDepth = 0;
  const parser = new Parser(
    {
      onopentag(name) {
        if (ignoredTags.has(name)) ignoredDepth += 1;
        else if (ignoredDepth === 0 && lineBreakTags.has(name)) {
          textParts.push("\n");
        }
      },
      ontext(value) {
        if (ignoredDepth === 0) textParts.push(value);
      },
      onclosetag(name) {
        if (ignoredTags.has(name)) ignoredDepth = Math.max(0, ignoredDepth - 1);
        else if (ignoredDepth === 0 && lineBreakTags.has(name)) {
          textParts.push("\n");
        }
      },
    },
    { decodeEntities: true },
  );
  parser.end(decoded);
  const text = textParts
    .join("")
    .normalize("NFKC")
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, PAGE_TEXT_LIMIT);
  if (!text) {
    throw new AgentSafeWebFetchError(
      "WEB_FETCH_CONTENT_EMPTY",
      "The public page contained no readable text.",
    );
  }
  return text;
}

export async function fetchDiscoveredPublicPage(
  scope: AgentPublicResearchScope,
  result: AgentWebSearchResult,
  signal: AbortSignal,
  options: { fetcher?: typeof fetch; lookup?: HostLookup } = {},
): Promise<Omit<AgentFetchedWebPage, "resultID">> {
  const lookup = options.lookup ?? dns.lookup;
  const fetcher = options.fetcher ?? pinnedHttpsFetcher(lookup);
  if (result.providerID !== scope.providerID) {
    throw new AgentSafeWebFetchError(
      "WEB_FETCH_PROVIDER_MISMATCH",
      "The discovered page belongs to a different search provider.",
    );
  }
  const url = new URL(result.url);
  if (
    url.protocol !== "https:" ||
    !publicResearchDomainAllowed(url.hostname, scope.authorization)
  ) {
    throw new AgentSafeWebFetchError(
      "WEB_FETCH_DOMAIN_OUT_OF_SCOPE",
      "The discovered page is outside the explicit research authorization.",
    );
  }
  const allowedHostname = url.hostname.toLowerCase();
  await assertRobotsAllowed(url, allowedHostname, signal, fetcher, lookup);
  const fetched = await fetchBounded(
    url,
    allowedHostname,
    PAGE_BYTE_LIMIT,
    signal,
    fetcher,
    lookup,
  );
  const text = extractText(
    fetched.response.headers.get("content-type")?.toLowerCase() ??
      "application/octet-stream",
    fetched.bytes,
  );
  return {
    canonicalUrl: fetched.finalUrl.toString(),
    title: result.title,
    text: text.slice(0, 20_000),
    contentHash: createHash("sha256").update(fetched.bytes).digest("hex"),
    retrievedAt: new Date().toISOString(),
    providerID: result.providerID,
  };
}
