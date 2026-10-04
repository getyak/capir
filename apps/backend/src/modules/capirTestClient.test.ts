import http from "node:http";

import { CapirTestProvisioningClient } from "@talent-signal/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Runtime transport discipline for the provisioning client (P1).
 *
 * A hostile or misrouted endpoint must never receive the provisioning
 * credential, the create password or the trusted Web consumer key through a
 * followed redirect, and every request is bounded by a timeout. Transport
 * failures surface as one stable sanitized error with no URL, header or body
 * material. Synthetic canaries only; canary values are asserted as booleans so
 * they can never appear in a failure report.
 */

const CANARY_PASSWORD = "synthetic-redirect-probe-password";
const CANARY_CONSUMER = "synthetic-redirect-consumer";
const CANARY_PROVISIONER = "synthetic-redirect-provisioner";

type Observation = {
  method: string;
  passwordPresent: boolean;
  provisioningKeyPresent: boolean;
  consumerKeyPresent: boolean;
};

const observations: Observation[] = [];
let receiver: http.Server;
let receiverOrigin: string;
let redirector: http.Server;
let origin: string;
let silent: http.Server;
let silentOrigin: string;

beforeAll(async () => {
  receiver = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    observations.push({
      method: req.method ?? "unknown",
      passwordPresent: body.includes(CANARY_PASSWORD),
      provisioningKeyPresent: (req.headers.authorization ?? "").includes(CANARY_PROVISIONER),
      consumerKeyPresent: (req.headers["x-capir-web-consumer-key"] ?? "").includes(CANARY_CONSUMER),
    });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ run: { id: "synthetic" } }));
  });
  await new Promise<void>((resolve) => receiver.listen(0, "127.0.0.1", resolve));
  const address = receiver.address();
  if (typeof address === "string" || address === null) throw new Error("receiver address");
  receiverOrigin = `http://127.0.0.1:${address.port}`;

  redirector = http.createServer((req, res) => {
    res.writeHead(307, { location: `${receiverOrigin}${req.url}` });
    res.end();
  });
  await new Promise<void>((resolve) => redirector.listen(0, "127.0.0.1", resolve));
  const redirectAddress = redirector.address();
  if (typeof redirectAddress === "string" || redirectAddress === null) throw new Error("redirector address");
  origin = `http://127.0.0.1:${redirectAddress.port}`;

  // Never answers: bounded timeout must fire.
  silent = http.createServer(() => {
    /* intentionally silent */
  });
  await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
  const silentAddress = silent.address();
  if (typeof silentAddress === "string" || silentAddress === null) throw new Error("silent address");
  silentOrigin = `http://127.0.0.1:${silentAddress.port}`;
});

afterAll(async () => {
  for (const server of [receiver, redirector, silent]) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeAllConnections?.();
  }
});

describe("CapirTestProvisioningClient transport discipline", () => {
  it("rejects every redirected provisioning request without forwarding any credential", async () => {
    const client = new CapirTestProvisioningClient(origin, {
      provisioningKey: CANARY_PROVISIONER,
      backendOrigin: origin,
    });
    const failures: string[] = [];
    let createCode = "";
    let exchangeCode = "";
    try {
      await client.create({
        request_id: "10000000-0000-4000-8000-000000000001",
        username: "synthetic",
        password: CANARY_PASSWORD,
        preset: "empty",
        duration_hours: 1,
        web_origin: "https://web.test.invalid",
      });
    } catch (error) {
      createCode = (error as { code?: string }).code ?? "";
      failures.push(String((error as Error).message));
    }
    try {
      await client.exchangeHandoff(CANARY_CONSUMER, {
        handoff_secret: "A".repeat(43),
        web_origin: "https://web.test.invalid",
      });
    } catch (error) {
      exchangeCode = (error as { code?: string }).code ?? "";
      failures.push(String((error as Error).message));
    }

    expect(createCode, "create must fail with the stable transport code").toBe("CAPIR_TEST_TRANSPORT_FAILED");
    expect(exchangeCode, "exchange must fail with the stable transport code").toBe("CAPIR_TEST_TRANSPORT_FAILED");
    expect(observations.length, "no redirected request may reach the receiver").toBe(0);
    const report = failures.join("\n");
    expect(report.includes(CANARY_PASSWORD), "failures must not echo the password canary").toBe(false);
    expect(report.includes(CANARY_CONSUMER), "failures must not echo the consumer key canary").toBe(false);
    expect(report.includes(CANARY_PROVISIONER), "failures must not echo the provisioning key canary").toBe(false);
    expect(report.includes(receiverOrigin), "failures must not echo the redirect target").toBe(false);
    expect(report.includes(origin), "failures must not echo the request URL").toBe(false);
  });

  it("bounds a request that never receives a response", async () => {
    const client = new CapirTestProvisioningClient(silentOrigin, {
      provisioningKey: CANARY_PROVISIONER,
      backendOrigin: silentOrigin,
      timeoutMs: 250,
    });
    const started = Date.now();
    let code = "";
    try {
      await client.status("10000000-0000-4000-8000-000000000002");
    } catch (error) {
      code = (error as { code?: string }).code ?? "";
    }
    const elapsed = Date.now() - started;
    expect(code, "a silent endpoint must fail with the stable transport code").toBe("CAPIR_TEST_TRANSPORT_FAILED");
    expect(elapsed, "the timeout must be bounded").toBeLessThan(5_000);
  });

  it("still performs a normal provisioning request against a direct server", async () => {
    const direct = http.createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      observations.push({
        method: req.method ?? "unknown",
        passwordPresent: body.includes(CANARY_PASSWORD),
        provisioningKeyPresent: (req.headers.authorization ?? "").includes(CANARY_PROVISIONER),
        consumerKeyPresent: (req.headers["x-capir-web-consumer-key"] ?? "").includes(CANARY_CONSUMER),
      });
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          schema_version: "capir-test.v1",
          run: {
            id: "10000000-0000-4000-8000-000000000003",
            request_id: "10000000-0000-4000-8000-000000000004",
            account_id: "10000000-0000-4000-8000-000000000005",
            user_id: "10000000-0000-4000-8000-000000000006",
            username: "synthetic",
            email: "synthetic@lab.invalid",
            preset: "empty",
            preset_version: "1",
            preset_digest: "0".repeat(64),
            counts: { contacts: 0, observations: 0, tasks: 0 },
            state: "ready",
            expires_at: "2030-01-01T00:00:00.000Z",
            cleanup_error: null,
            login_url: "https://web.test.invalid/capir/test-entry",
          },
        }),
      );
    });
    await new Promise<void>((resolve) => direct.listen(0, "127.0.0.1", resolve));
    const address = direct.address();
    if (typeof address === "string" || address === null) throw new Error("direct address");
    try {
      const client = new CapirTestProvisioningClient(`http://127.0.0.1:${address.port}`, {
        provisioningKey: CANARY_PROVISIONER,
        backendOrigin: "https://api.test.invalid",
      });
      const run = await client.create({
        request_id: "10000000-0000-4000-8000-000000000004",
        username: "synthetic",
        password: CANARY_PASSWORD,
        preset: "empty",
        duration_hours: 1,
        web_origin: "https://web.test.invalid",
      });
      expect(run.username).toBe("synthetic");
      expect(observations.length).toBe(1);
    } finally {
      await new Promise<void>((resolve) => direct.close(() => resolve()));
      direct.closeAllConnections?.();
    }
  });
});
