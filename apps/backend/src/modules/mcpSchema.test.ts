import { describe, expect, it } from "vitest";

import {
  assertSupportedInputSchema,
  displayJson,
  isMcpSchemaUnsupportedError,
  looksLikeSecret,
  redactKnownSecrets,
  redactSecrets,
  validateToolArguments,
} from "./mcpSchema.js";

const nestedSchema = {
  $defs: {
    entry: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 40 },
        tags: { type: "array", items: { type: "string", maxLength: 12 } },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  type: "object",
  properties: {
    query: { type: "string", minLength: 1 },
    limit: { type: "integer", minimum: 1, maximum: 20 },
    entries: { type: "array", maxItems: 3, items: { $ref: "#/$defs/entry" } },
    nested: {
      type: "array",
      items: { type: "array", items: { type: "number" } },
    },
    mode: { enum: ["fast", "slow"] },
  },
  required: ["query"],
  additionalProperties: false,
};

describe("bounded MCP input schema validation", () => {
  it("accepts nested arrays and local references when arguments match", () => {
    const result = validateToolArguments(
      JSON.stringify(nestedSchema),
      JSON.stringify({
        entries: [{ name: "one", tags: ["a"] }, { name: "two" }],
        mode: "fast",
        nested: [[1, 2], [3]],
        query: "hello",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("reports the failing path for nested array and reference problems", () => {
    const badItem = validateToolArguments(
      JSON.stringify(nestedSchema),
      JSON.stringify({ query: "hello", entries: [{ name: "ok" }, { tags: ["x"] }] }),
    );
    expect(badItem).toMatchObject({ ok: false, path: "$.entries[1].name" });

    const badNested = validateToolArguments(
      JSON.stringify(nestedSchema),
      JSON.stringify({ query: "hello", nested: [[1, "two"]] }),
    );
    expect(badNested).toMatchObject({ ok: false, path: "$.nested[0][1]" });

    const unknownField = validateToolArguments(
      JSON.stringify(nestedSchema),
      JSON.stringify({ query: "hello", surprise: 1 }),
    );
    expect(unknownField).toMatchObject({ ok: false, path: "$.surprise" });
  });

  it("enforces enum, bounds and required fields", () => {
    expect(
      validateToolArguments(JSON.stringify(nestedSchema), JSON.stringify({ query: "q", mode: "other" })),
    ).toMatchObject({ ok: false, path: "$.mode" });
    expect(
      validateToolArguments(JSON.stringify(nestedSchema), JSON.stringify({ query: "q", limit: 99 })),
    ).toMatchObject({ ok: false, path: "$.limit" });
    expect(
      validateToolArguments(JSON.stringify(nestedSchema), JSON.stringify({})),
    ).toMatchObject({ ok: false, path: "$.query" });
  });

  it("fails closed on remote regex patterns without executing them", () => {
    const evil = {
      type: "object",
      properties: { code: { type: "string", pattern: "^(a+)+$" } },
    };
    // Time bounded: the validator refuses the pattern instead of running
    // catastrophic backtracking against a long input.
    const started = Date.now();
    for (const schema of [evil, { type: "string", pattern: "^(a+)+$" }]) {
      expect(() => assertSupportedInputSchema(schema)).toThrow();
      const result = validateToolArguments(
        JSON.stringify(schema),
        JSON.stringify({ code: "a".repeat(24) + "!" }),
      );
      expect(result.ok).toBe(false);
    }
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("validates declared constraints instead of silently ignoring them", () => {
    const uriSchema = {
      type: "object",
      properties: { link: { type: "string", format: "uri" } },
      required: ["link"],
    };
    expect(
      validateToolArguments(JSON.stringify(uriSchema), JSON.stringify({ link: "not a uri" })),
    ).toMatchObject({ ok: false, path: "$.link" });
    expect(
      validateToolArguments(JSON.stringify(uriSchema), JSON.stringify({ link: "https://example.test/mcp" })),
    ).toMatchObject({ ok: true });
    const objectSchema = {
      type: "object",
      properties: { a: { type: "string" }, b: { type: "string" } },
      minProperties: 2,
    };
    expect(
      validateToolArguments(JSON.stringify(objectSchema), JSON.stringify({ a: "x" })),
    ).toMatchObject({ ok: false });
    const listSchema = {
      type: "object",
      properties: { tags: { type: "array", uniqueItems: true, items: { type: "string" } } },
    };
    expect(
      validateToolArguments(JSON.stringify(listSchema), JSON.stringify({ tags: ["x", "y", "x"] })),
    ).toMatchObject({ ok: false, path: "$.tags[2]" });
    expect(
      validateToolArguments(JSON.stringify(listSchema), JSON.stringify({ tags: ["x", "y"] })),
    ).toMatchObject({ ok: true });
  });

  it("rejects unsupported schemas safely instead of guessing", () => {
    for (const schema of [
      { type: "object", properties: { a: { $ref: "https://evil.example/schema.json" } } },
      { type: "object", properties: { a: { oneOf: [{ type: "string" }, { type: "number" }] } } },
      { type: "object", properties: { a: { $ref: "#/$defs/a", type: "string" } }, $defs: { a: { type: "string" } } },
      { type: "object", properties: { a: { $ref: "#/$defs/missing" } }, $defs: {} },
      { type: "object", properties: { a: { type: "any" } } },
      { type: "object", properties: { a: {} } },
      "not a schema",
    ]) {
      let threw = false;
      try {
        assertSupportedInputSchema(schema);
      } catch (error) {
        threw = true;
        expect(isMcpSchemaUnsupportedError(error)).toBe(true);
      }
      expect(threw).toBe(true);
      const result = validateToolArguments(JSON.stringify(schema), JSON.stringify({ a: 1 }));
      expect(result.ok).toBe(false);
    }
  });

  it("bounds schema size and depth", () => {
    const wide = {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 80 }, (_, index) => [`p${index}`, { type: "string" }]),
      ),
    };
    expect(() => assertSupportedInputSchema(wide)).toThrow();
    let deep: Record<string, unknown> = { type: "string" };
    for (let index = 0; index < 12; index += 1) {
      deep = { type: "array", items: deep };
    }
    expect(() => assertSupportedInputSchema(deep)).toThrow();
  });
});

describe("secret redaction for every persisted or echoed surface", () => {
  it("redacts secret-shaped keys and values", () => {
    const redacted = redactSecrets({
      api_key: "abc",
      authorization: "Bearer xyz",
      nested: { password: "hunter2", keep: "visible" },
      token_like: "tsmcp_abcdefghijklmnop",
    }) as Record<string, unknown>;
    expect(redacted.api_key).toBe("[redacted]");
    expect(redacted.authorization).toBe("[redacted]");
    expect((redacted.nested as Record<string, unknown>).password).toBe("[redacted]");
    expect((redacted.nested as Record<string, unknown>).keep).toBe("visible");
    expect(redacted.token_like).toBe("[redacted]");
    expect(JSON.stringify(redacted)).not.toContain("hunter2");
  });

  it("removes known secret values from remote echo", () => {
    const echo = "error: Bearer super-secret-value refused (super-secret-value)";
    const cleaned = redactKnownSecrets(echo, ["super-secret-value"]);
    expect(cleaned).not.toContain("super-secret-value");
    expect(cleaned).toContain("[redacted]");
  });

  it("keeps display JSON bounded and redacted", () => {
    const text = displayJson({ password: "p".repeat(50), long: "x".repeat(20_000) }, 1_000);
    expect(text.length).toBeLessThanOrEqual(1_000);
    expect(text).not.toContain("ppppp");
  });

  it("classifies secret-looking values", () => {
    expect(looksLikeSecret("client_secret", "short")).toBe(true);
    expect(looksLikeSecret("name", "Bearer abcdef")).toBe(true);
    expect(looksLikeSecret("name", "ordinary text")).toBe(false);
  });
});

it("redacts hostile JSON keys as inert own properties without prototype mutation", () => {
  const output = redactSecrets(JSON.parse('{"__proto__":{"polluted":true,"password":"private"},"constructor":{"prototype":{"polluted":true}},"keep":"visible"}')) as Record<string, unknown>;
  expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
  expect(Object.hasOwn(output, "__proto__")).toBe(true);
  expect(Object.getOwnPropertyDescriptor(output, "__proto__")?.get).toBeUndefined();
  expect(JSON.stringify(output)).toContain('"password":"[redacted]"');
  expect(JSON.stringify(output)).not.toContain('"private"');
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
});
