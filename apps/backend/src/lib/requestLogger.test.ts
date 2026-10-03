import { Writable } from "node:stream";
import Fastify from "fastify";
import { expect, it } from "vitest";
import { requestLoggerOptions } from "./requestLogger.js";

it("redacts ephemeral conversation content and credentials while keeping diagnostic codes", async () => {
  let output = "";
  const stream = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done(); } });
  const app = Fastify({ logger: { ...requestLoggerOptions("info"), stream } });
  app.log.info({ code: "PRIVATE_CONVERSATION_TIMEOUT", body: {
    messages: [{ role: "user", content: "private-content-canary" }],
    password: "password-canary", access_token: "token-canary",
    code: "desktop-code-canary", verifier: "desktop-verifier-canary",
    state: "desktop-state-canary", cancel_secret: "desktop-cancel-canary",
  }, headers: { authorization: "authorization-canary" } });
  await app.close();
  expect(output).toContain("PRIVATE_CONVERSATION_TIMEOUT");
  for (const canary of ["private-content-canary", "password-canary", "token-canary", "authorization-canary",
    "desktop-code-canary", "desktop-verifier-canary", "desktop-state-canary", "desktop-cancel-canary"]) expect(output).not.toContain(canary);
});

it("automatic request logs keep paths but never query proofs", async () => {
  let output = "";
  const stream = new Writable({ write(chunk, _encoding, done) { output += String(chunk); done(); } });
  const app = Fastify({ logger: { ...requestLoggerOptions("info"), stream } });
  app.get("/v1/desktop-browser-login/:id/grant", () => ({ status: "prepared" }));
  await app.inject("/v1/desktop-browser-login/example/grant?state=url-state-canary&web_origin=origin-canary");
  await app.close();
  expect(output).toContain("/v1/desktop-browser-login/example/grant");
  expect(output).not.toContain("url-state-canary");
  expect(output).not.toContain("origin-canary");
});
