import { once } from "node:events";
import { createServer, request as httpRequest, type ClientRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { bindLegacyChatTransport } from "./legacyChatTransport.js";

async function fixture() {
  const bindings = new Map<string,ReturnType<typeof bindLegacyChatTransport>>();
  const replies = new Map<string,ServerResponse>();
  const readers = new Map<string,{ promise: Promise<void>; resolve: () => void }>();
  const clients: ClientRequest[] = [];
  const server = createServer((request,reply) => {
    const id = request.url!;
    bindings.set(id,bindLegacyChatTransport(request,reply)); replies.set(id,reply);
    request.on("end",() => readers.get(id)!.resolve());
    request.resume();
  });
  server.listen(0,"127.0.0.1"); await once(server,"listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("synthetic loopback server not ready");
  const open = async (id: string) => {
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    readers.set(id,{ promise,resolve });
    const request = httpRequest({ hostname: "127.0.0.1",port: address.port,path: id,method: "POST",agent: false });
    request.on("error",() => {}); // A deliberate TCP close is observed at its actual server boundary.
    let response!: IncomingMessage;
    const completed = new Promise<void>(done => request.on("response",reply => { response = reply; reply.resume(); reply.on("end",done); }));
    clients.push(request); request.end("synthetic complete body"); await promise;
    return { request,completed,signal: bindings.get(id)!.signal,response: () => response };
  };
  return { open,replies,async close() {
    for (const client of clients) client.destroy();
    for (const reply of replies.values()) if (!reply.writableFinished) reply.destroy();
    for (const binding of bindings.values()) binding.dispose();
    await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve()));
  } };
}

describe("real loopback legacy HTTP transport", () => {
  it("does not cancel after normal body completion or a finished response", async () => {
    const f = await fixture();
    try {
      const owner = await f.open("/owner");
      await new Promise(resolve => setTimeout(resolve,5));
      expect(owner.signal.aborted).toBe(false);
      f.replies.get("/owner")!.end("synthetic answer"); await owner.completed;
      await new Promise(resolve => setTimeout(resolve,5));
      expect(owner.signal.aborted).toBe(false);
    } finally { await f.close(); }
  });

  it("separates a duplicate waiter's real close from the owner's real close", async () => {
    const f = await fixture();
    try {
      const owner = await f.open("/owner"), waiter = await f.open("/waiter");
      const waiterStopped = once(waiter.signal,"abort"); waiter.request.destroy(); await waiterStopped;
      expect(waiter.signal.aborted).toBe(true); expect(owner.signal.aborted).toBe(false);
      const ownerStopped = once(owner.signal,"abort"); owner.request.destroy(); await ownerStopped;
      expect(owner.signal.aborted).toBe(true);
    } finally { await f.close(); }
  });
});
