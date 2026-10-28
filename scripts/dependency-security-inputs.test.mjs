import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));

// Follow live importer links; stale directories in .pnpm cannot satisfy these probes.
function dependencyEntry(importer, dependencies) {
  let require = createRequire(join(root, importer, "package.json"));
  let entry;
  for (const name of dependencies) {
    entry = require.resolve(name);
    require = createRequire(entry);
  }
  return entry;
}

const mcp = ["@anthropic-ai/claude-agent-sdk", "@modelcontextprotocol/sdk/server/index.js"];
const uriEntries = [
  dependencyEntry("apps/agent", [...mcp, "ajv", "fast-uri"]),
  dependencyEntry("apps/backend", ["fastify", "@fastify/ajv-compiler", "fast-uri"]),
];
const undiciEntry = dependencyEntry("apps/web", [
  "@assistant-ui/react", "assistant-cloud", "ai", "@ai-sdk/provider-utils", "undici",
]);
const bodyParserEntry = dependencyEntry("apps/agent", [...mcp, "express", "body-parser"]);
const qsEntry = dependencyEntry("apps/agent", [...mcp, "express", "qs"]);
const require = createRequire(import.meta.url);

// GHSA-6pq8-jhm2-2vcw: bind the probe to Express's actual SDK dependency,
// rather than another (already patched) qs installation in the store.
test("MCP Express qs survives comma arrays with non-callable toString elements", () => {
  const qs = require(qsEntry);
  const inputs = [
    qs.parse("a[0][toString]=x", { allowPrototypes: true }),
    JSON.parse('{"a":[{"toString":"x"}]}'),
    qs.parse("a[0][b]=c", { plainObjects: true }),
  ];
  for (const encodeValuesOnly of [false, true]) {
    const options = { arrayFormat: "comma", encodeValuesOnly };
    for (const input of inputs) {
      assert.equal(qs.stringify(input, options), "a=%5Bobject%20Object%5D");
    }
    assert.equal(qs.stringify({ a: ["one", "two"] }, options),
      encodeValuesOnly ? "a=one,two" : "a=one%2Ctwo");
  }
});

// Exercise the real AJV/fast-uri and serializer graph through its Backend importer.
// https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/
test("Backend Fastify still validates and serializes referenced JSON schemas", async () => {
  const fastify = require(dependencyEntry("apps/backend", ["fastify"]));
  const server = fastify();
  try {
    const id = "https://schema.example.test/item.json";
    server.addSchema({
      $id: id, type: "object", properties: { name: { type: "string" } },
      required: ["name"], additionalProperties: false,
    });
    server.post("/item", {
      schema: { body: { $ref: id }, response: { 200: { $ref: id } } },
    }, async (request) => request.body);
    const valid = await server.inject({ method: "POST", url: "/item", payload: { name: "synthetic" } });
    assert.equal(valid.statusCode, 200);
    assert.deepEqual(valid.json(), { name: "synthetic" });
    const invalid = await server.inject({ method: "POST", url: "/item", payload: {} });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await server.close();
  }
});

// https://github.com/advisories/GHSA-w74x-v6f9-j3xg
// https://github.com/advisories/GHSA-wjr9-j795-jxcr
for (const entry of uriEntries) {
  test(`resolved fast-uri rejects scheme/host confusion: ${entry}`, () => {
    const uri = require(entry);
    for (const encoded of ["%6Aavascript:alert(1)", "%u006Aavascript:alert(1)"]) {
      assert.notEqual(uri.parse(encoded).scheme, "javascript");
      assert.notEqual(uri.normalize(encoded), "javascript:alert(1)");
      // Published 3.1.9/4.2.3 reject malformed schemes instead of returning a URI.
      assert.throws(() => uri.resolve("https://a.example/", encoded), {
        message: "URI scheme is malformed.",
      });
    }
    assert.equal(uri.equal("%68ttp://a/", "http://a/"), false);
    assert.equal(uri.normalize("https://EXAMPLE.com/a"), "https://example.com/a");
    assert.equal(uri.resolve("https://example.com/a/", "../b"), "https://example.com/b");
  });
  test(`resolved fast-uri rejects ambiguous authority: ${entry}`, () => {
    const uri = require(entry);
    for (const input of ["http://a@b@evil.example/", "http://exa\tmple.com/", "http://exa\nmple.com/", "http://exa\rmple.com/"]) {
      assert.ok(uri.parse(input).error, `ambiguous authority must be rejected: ${JSON.stringify(input)}`);
    }
    assert.equal(uri.parse("https://example.com/a").host, "example.com");
  });
}

function childProbe(source, entry) {
  const child = spawnSync(process.execPath, ["-e", source, entry], {
    encoding: "utf8", timeout: 10_000,
  });
  assert.equal(child.status, 0, `bounded dependency probe failed: ${child.stderr || child.error}`);
  assert.match(child.stdout, /PROBE_OK/);
}

// A small limit exercises retained object counts without allocating a large payload.
// https://github.com/nodejs/undici/commit/789ef26461c648480433846607154f52d74ec9ab
test("AI SDK undici bounds tiny SSE fields and unfinished chunks", () => {
  childProbe(`
    const assert = require('node:assert/strict');
    const { dirname, join } = require('node:path');
    const { EventSourceStream } = require(join(dirname(process.argv[1]), 'lib/web/eventsource/eventsource-stream.js'));
    (async () => {
      for (const kind of ['fields', 'chunks']) {
        const stream = new EventSourceStream({ maxEventSize: 4096 });
        let failure;
        stream.on('error', error => { failure = error; });
        if (kind === 'fields') stream.write(Buffer.from('data:\\n'.repeat(1025)));
        else for (let i = 0; i < 1025; i++) stream.write(Buffer.from('A'));
        await new Promise(resolve => setImmediate(resolve));
        stream.destroy();
        assert.match(failure?.message || '', /EventSource message size exceeded/);
      }
      const stream = new EventSourceStream({ maxEventSize: 4096 });
      const messages = [];
      stream.on('data', value => messages.push(value));
      const done = require('node:events').once(stream, 'end');
      stream.end(Buffer.from('data: hello\\n\\n'));
      await done;
      assert.equal(messages[0].options.data, 'hello');
      console.log('PROBE_OK');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `, undiciEntry);
});

// https://github.com/nodejs/undici/commit/1325a87dfb3492f8e87e6b0a84b3bda4e82e3436
test("AI SDK undici survives excessive encodings followed by an early close", () => {
  childProbe(`
    const assert = require('node:assert/strict');
    const { once } = require('node:events');
    const { fetch, Client } = require(process.argv[1]);
    (async () => {
      let closed;
      const socketClosed = new Promise(resolve => { closed = resolve; });
      const server = require('node:net').createServer(socket => {
        socket.on('error', () => {});
        socket.once('close', closed);
        socket.once('data', () => socket.end('HTTP/1.1 200 OK\\r\\nContent-Encoding: ' +
          Array(6).fill('gzip').join(', ') + '\\r\\nContent-Length: 1\\r\\nConnection: close\\r\\n\\r\\n'));
      });
      await once(server.listen(0, '127.0.0.1'), 'listening');
      const url = 'http://127.0.0.1:' + server.address().port;
      const client = new Client(url);
      try {
        await assert.rejects(fetch(url, { dispatcher: client }), error => {
          assert.match(error.cause?.message || '', /content-encoding/);
          return true;
        });
        await socketClosed;
      } finally { await client.close(); server.close(); }
      console.log('PROBE_OK');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `, undiciEntry);
});

test("MCP Express body parser survives trailing bytes after a gzip frame", () => {
  childProbe(`
    const assert = require('node:assert/strict');
    const http = require('node:http');
    const parser = require(process.argv[1]).json();
    const body = Buffer.concat([require('node:zlib').gzipSync('{"a":1}'), Buffer.from([0]), Buffer.alloc(100 * 1024, 0x58)]);
    const server = http.createServer((req, res) => parser(req, res, error => {
      if (error) throw error;
      res.end(JSON.stringify(req.body));
    }));
    server.listen(0, '127.0.0.1', () => {
      const client = http.request({ host: '127.0.0.1', port: server.address().port, method: 'POST', agent: false,
        headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Content-Length': body.length } }, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          assert.equal(res.statusCode, 200);
          assert.equal(data, '{"a":1}');
          setTimeout(() => server.close(() => console.log('PROBE_OK')), 200);
        });
      });
      client.on('error', error => { throw error; });
      client.setTimeout(2000, () => { throw Error('request did not finish'); });
      client.end(body);
    });
  `, bodyParserEntry);
});

// Isolate an uncaught decompressor error so the test runner survives a regression.
// https://github.com/expressjs/body-parser/commit/1260c3845f54502a05a87594f09a334786bb34d7
test("MCP Express body parser survives trailing compressed bytes and drains the request", () => {
  childProbe(`
    const assert = require('node:assert/strict');
    const http = require('node:http');
    const parser = require(process.argv[1]).json();
    const first = Buffer.concat([require('node:zlib').deflateSync('{"a":1}'), Buffer.from([0])]);
    const trailing = Buffer.alloc(1024);
    let client;
    const server = http.createServer((req, res) => parser(req, res, error => {
      if (error) throw error;
      req.on('end', () => res.end(JSON.stringify(req.body)));
      client.end(trailing);
    }));
    server.listen(0, '127.0.0.1', () => {
      client = http.request({ host: '127.0.0.1', port: server.address().port, method: 'POST', agent: false,
        headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'deflate',
          'Content-Length': first.length + trailing.length } }, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          assert.equal(res.statusCode, 200);
          assert.equal(data, '{"a":1}');
          server.close(() => console.log('PROBE_OK'));
        });
      });
      client.on('error', error => { throw error; });
      client.setTimeout(2000, () => { throw Error('request did not drain'); });
      client.write(first);
    });
  `, bodyParserEntry);
});
