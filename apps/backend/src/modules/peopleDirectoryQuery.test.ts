import * as contracts from "@talent-signal/contracts";
import { expect, it } from "vitest";

type QueryResult = { ok: true; query: string }
  | { ok: false; reason: "invalid_type" | "too_long" | "invalid_unicode" };
type QueryParser = (value: unknown, options?: { allowMissing?: boolean }) => QueryResult;

function parser(): QueryParser {
  // The test-only baseline already has this public namespace. A not-yet
  // implemented export must fail an API assertion, not module/TS resolution.
  const candidate: unknown = Reflect.get(contracts, "parsePeopleDirectoryQuery");
  expect(typeof candidate).toBe("function");
  return candidate as QueryParser;
}

it("publishes callable complete-query admission through the existing contracts namespace", () => {
  parser();
  expect(Reflect.get(contracts, "PEOPLE_DIRECTORY_QUERY_MAX_SCALARS")).toBe(500);
  expect(Reflect.get(contracts, "PEOPLE_DIRECTORY_QUERY_MAX_UTF8_BYTES")).toBe(2048);
});

it("preserves complete distinguishing tails and applies only whole-query NFKC/trim", () => {
  const parse = parser(), prefix = `Directory ${"a".repeat(170)}`;
  const first = `${prefix} first`, second = `${prefix} second`;
  expect(first.slice(0, 160)).toBe(second.slice(0, 160));
  expect(parse(first)).toEqual({ ok: true, query: first });
  expect(parse(second)).toEqual({ ok: true, query: second });
  expect(parse("  Ｒｅａｄｅｒ\u3000")).toEqual({ ok: true, query: "Reader" });
});

it("admits 500 supplementary scalars as complete UTF8 text and explicitly refuses the next scalar", () => {
  const parse = parser(), admitted = "😀".repeat(500);
  expect(Buffer.byteLength(admitted, "utf8")).toBe(2000);
  expect(parse(admitted)).toEqual({ ok: true, query: admitted });
  expect(parse(`${admitted}a`)).toEqual({ ok: false, reason: "too_long" });
});

it("bounds both the original draft and complete normalization instead of trimming or clipping into admission", () => {
  const parse = parser();
  expect(parse(`${" ".repeat(500)}a`)).toEqual({ ok: false, reason: "too_long" });
  expect(parse("ﬃ".repeat(170))).toEqual({ ok: false, reason: "too_long" });
  expect(parse(`${"ﬃ".repeat(166)}ab`)).toEqual({ ok: true, query: `${"ffi".repeat(166)}ab` });
});

it("keeps optional missing and empty semantics separate from a provided wrong type", () => {
  const parse = parser();
  expect(parse(undefined, { allowMissing: true })).toEqual({ ok: true, query: "" });
  expect(parse("")).toEqual({ ok: true, query: "" });
  expect(parse(" \t\n ")).toEqual({ ok: true, query: "" });
  for (const value of [undefined, null, 42, false, ["Reader"], Object("Reader")]) {
    expect(parse(value)).toEqual({ ok: false, reason: "invalid_type" });
  }
  expect(parse(null, { allowMissing: true })).toEqual({ ok: false, reason: "invalid_type" });
});

it("refuses NUL and unpaired surrogates without silently repairing text or rejecting ordinary controls", () => {
  const parse = parser();
  for (const query of ["Reader\0Tail", "Reader\ud800Tail", "Reader\udfffTail"]) {
    expect(parse(query)).toEqual({ ok: false, reason: "invalid_unicode" });
  }
  expect(parse("Reader\nTail")).toEqual({ ok: true, query: "Reader\nTail" });
});

it("does not inspect or coerce an object and does not mutate caller options", () => {
  const parse = parser();
  let inspected = 0;
  const rejectInspection = () => { inspected++; throw new Error("Synthetic query coercion."); };
  const value = new Proxy({}, { get: rejectInspection, ownKeys: rejectInspection,
    getOwnPropertyDescriptor: rejectInspection, getPrototypeOf: rejectInspection });
  const options = Object.freeze({ allowMissing: true });
  expect(parse(value, options)).toEqual({ ok: false, reason: "invalid_type" });
  expect(inspected).toBe(0);
  expect(options).toEqual({ allowMissing: true });
});
