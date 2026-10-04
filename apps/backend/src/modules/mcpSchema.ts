import { createHash } from "node:crypto";

/**
 * Bounded validation of tool arguments against the original discovered input
 * schema, plus secret redaction for every persisted or echoed surface.
 *
 * The input schema is remote capability metadata and therefore untrusted.
 * Validation supports exactly the bounded structural subset this product can
 * decide safely: object/array/nested-array shapes, primitive types, enum and
 * const, numeric and length bounds, and local `#/$defs/...` references. Any
 * construct outside that subset is rejected as unsupported so a hostile
 * server cannot smuggle authority through a schema the product never
 * understood. There is no evaluation of remote `$ref` targets, combinators,
 * conditionals, or formats.
 */

export const MCP_SCHEMA_MAX_CHARS = 20_000;
export const MCP_SCHEMA_MAX_DEPTH = 8;
export const MCP_SCHEMA_MAX_PROPERTIES = 60;
export const MCP_SCHEMA_MAX_ARRAY_ITEMS = 200;
export const MCP_SCHEMA_MAX_ENUM = 100;

export type McpJsonValue =
  | null
  | boolean
  | number
  | string
  | McpJsonValue[]
  | { [key: string]: McpJsonValue };

export interface McpSchemaProblem {
  path: string;
  message: string;
}

interface SchemaContext {
  defs: Map<string, unknown>;
  seenRefs: Set<string>;
}

const PRIMITIVES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unsupported(reason: string): never {
  const error = new Error(reason);
  error.name = "McpSchemaUnsupportedError";
  throw error;
}

export function isMcpSchemaUnsupportedError(error: unknown): error is Error {
  return error instanceof Error && error.name === "McpSchemaUnsupportedError";
}

/**
 * Structural check that a discovered schema is a supported bounded object
 * schema. Throws `McpSchemaUnsupportedError` otherwise. Returns the schema
 * unchanged for validation.
 */
export function assertSupportedInputSchema(schema: unknown): Record<string, unknown> {
  if (!isRecord(schema)) unsupported("The tool input schema is not a JSON object.");
  const serialized = JSON.stringify(schema);
  if (serialized.length > MCP_SCHEMA_MAX_CHARS) {
    unsupported("The tool input schema exceeds the size limit.");
  }
  const defs = new Map<string, unknown>();
  const collect = (node: unknown, depth: number) => {
    if (depth > MCP_SCHEMA_MAX_DEPTH) unsupported("The tool input schema is nested too deeply.");
    if (Array.isArray(node)) {
      for (const item of node) collect(item, depth + 1);
      return;
    }
    if (!isRecord(node)) return;
    for (const key of ["$defs", "definitions"] as const) {
      const group = node[key];
      if (group === undefined) continue;
      if (!isRecord(group)) unsupported("The tool input schema has an invalid definition group.");
      for (const [name, value] of Object.entries(group)) {
        if (defs.has(name)) unsupported("The tool input schema repeats a definition name.");
        defs.set(name, value);
      }
    }
    for (const value of Object.values(node)) collect(value, depth + 1);
  };
  collect(schema, 0);
  walkSchema(schema, { defs, seenRefs: new Set() }, "", 0, "check");
  return schema;
}

function resolveRef(ref: unknown, context: SchemaContext): unknown {
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    unsupported("The tool input schema references an external definition.");
  }
  const match = /^#\/(?:\$defs|definitions)\/([^/]+)$/u.exec(ref);
  if (!match) unsupported("The tool input schema uses an unsupported reference target.");
  const name = decodeURIComponent(match[1]!);
  const target = context.defs.get(name);
  if (target === undefined) unsupported("The tool input schema references a missing definition.");
  return target;
}

function walkSchema(
  node: unknown,
  context: SchemaContext,
  path: string,
  depth: number,
  mode: "check" | "validate",
  value?: McpJsonValue,
): void {
  if (depth > MCP_SCHEMA_MAX_DEPTH) unsupported("The tool input schema is nested too deeply.");
  if (!isRecord(node)) unsupported("The tool input schema contains a non-object schema.");
  if ("$ref" in node) {
    if (Object.keys(node).some((key) => key !== "$ref" && key !== "description" && key !== "$comment")) {
      unsupported("The tool input schema mixes references with sibling constraints.");
    }
    const ref = node.$ref;
    const key = String(ref);
    if (context.seenRefs.has(key)) {
      // Recursive definitions are only supported one level deep per branch so
      // validation always terminates on a bounded structure.
      unsupported("The tool input schema uses a recursive reference.");
    }
    context.seenRefs.add(key);
    walkSchema(resolveRef(ref, context), context, path, depth + 1, mode, value);
    context.seenRefs.delete(key);
    return;
  }
  for (const forbidden of ["oneOf", "anyOf", "allOf", "not", "if", "then", "else", "patternProperties", "dependentSchemas", "propertyNames", "$dynamicRef", "$recursiveRef"]) {
    if (forbidden in node) {
      unsupported(`The tool input schema uses "${forbidden}", which this build does not support.`);
    }
  }
  const type = node.type;
  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type];
    if (types.length === 0 || types.some((entry) => typeof entry !== "string" || !PRIMITIVES.has(entry))) {
      unsupported("The tool input schema declares an unsupported type.");
    }
    if (types.length > 2) unsupported("The tool input schema declares too many types.");
    if (mode === "validate") validateType(types as string[], node, context, path, depth, value ?? null);
    else checkShape(node, context, path, depth, types as string[]);
    return;
  }
  // Typeless schemas decide nothing safely; enum/const-only is accepted.
  if (mode === "validate") {
    validateConstEnum(node, path, value);
    return;
  }
  if (node.enum === undefined && node.const === undefined) {
    unsupported("The tool input schema has an undecided type.");
  }
  checkEnumConst(node, path);
}

function checkEnumConst(node: Record<string, unknown>, path: string): void {
  if (node.const !== undefined && !isJsonValue(node.const)) {
    unsupported("The tool input schema has an invalid constant.");
  }
  if (node.enum !== undefined) {
    if (!Array.isArray(node.enum) || node.enum.length === 0 || node.enum.length > MCP_SCHEMA_MAX_ENUM) {
      unsupported("The tool input schema has an unsupported enum.");
    }
    if (node.enum.some((entry) => !isJsonValue(entry))) {
      unsupported("The tool input schema has an invalid enum entry.");
    }
  }
  void path;
}

function isJsonValue(value: unknown): value is McpJsonValue {
  if (value === null) return true;
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function checkShape(
  node: Record<string, unknown>,
  context: SchemaContext,
  path: string,
  depth: number,
  types: string[],
): void {
  checkEnumConst(node, path);
  if (types.includes("object")) {
    const properties = node.properties;
    if (properties !== undefined) {
      if (!isRecord(properties)) unsupported("The tool input schema has invalid properties.");
      const names = Object.keys(properties);
      if (names.length > MCP_SCHEMA_MAX_PROPERTIES) {
        unsupported("The tool input schema declares too many properties.");
      }
      for (const [name, child] of Object.entries(properties)) {
        walkSchema(child, context, `${path}.${name}`, depth + 1, "check");
      }
    }
    const required = node.required;
    if (required !== undefined && (!Array.isArray(required) || required.some((entry) => typeof entry !== "string"))) {
      unsupported("The tool input schema has an invalid required list.");
    }
    const additional = node.additionalProperties;
    if (additional !== undefined && typeof additional !== "boolean" && additional !== false) {
      if (isRecord(additional)) walkSchema(additional, context, `${path}.*`, depth + 1, "check");
      else unsupported("The tool input schema has an invalid additionalProperties entry.");
    }
  }
  if (types.includes("array")) {
    const items = node.items;
    if (items !== undefined) walkSchema(items, context, `${path}[]`, depth + 1, "check");
  }
  for (const key of ["minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum"]) {
    const bound = node[key];
    if (bound !== undefined && (typeof bound !== "number" || !Number.isFinite(bound))) {
      unsupported("The tool input schema has an invalid numeric bound.");
    }
  }
  // Remote regex is never executed: a bounded pattern check cannot be
  // guaranteed safe against catastrophic backtracking, so `pattern` is
  // explicitly unsupported and fails closed at compile time.
  if (node.pattern !== undefined) {
    unsupported("The tool input schema uses a regex pattern, which this build does not support.");
  }
  if (node.format !== undefined) {
    if (typeof node.format !== "string" || !SUPPORTED_FORMATS.has(node.format)) {
      unsupported("The tool input schema uses a format this build does not support.");
    }
  }
  for (const key of ["contains", "minContains", "maxContains", "prefixItems",
    "dependentRequired", "unevaluatedProperties", "unevaluatedItems"]) {
    if (key in node) {
      unsupported(`The tool input schema uses "${key}", which this build does not support.`);
    }
  }
  for (const key of ["minProperties", "maxProperties"]) {
    const bound = node[key];
    if (bound !== undefined && (typeof bound !== "number" || !Number.isInteger(bound) || bound < 0)) {
      unsupported("The tool input schema has an invalid property-count bound.");
    }
  }
  if (node.uniqueItems !== undefined && typeof node.uniqueItems !== "boolean") {
    unsupported("The tool input schema has an invalid uniqueItems flag.");
  }
}

const SUPPORTED_FORMATS = new Set(["uri", "date-time", "email"]);

const EMAIL_FIX = /^[^\s@]{1,64}@[^\s@]{1,255}$/u;

/** Bounded, self-authored format checks; remote patterns are never executed. */
function validateFormat(format: string, value: string, path: string): void {
  if (value.length > 2_048) throw problem(path, "This text is too long for its format.");
  if (format === "uri") {
    try {
      const url = new URL(value);
      if (!url.protocol || url.protocol === ":") throw problem(path, "This value must be a valid URI.");
    } catch {
      throw problem(path, "This value must be a valid URI.");
    }
    return;
  }
  if (format === "date-time") {
    if (!Number.isFinite(Date.parse(value))) throw problem(path, "This value must be a valid date-time.");
    return;
  }
  if (format === "email" && !EMAIL_FIX.test(value)) {
    throw problem(path, "This value must be a valid email address.");
  }
}

function validateConstEnum(node: Record<string, unknown>, path: string, value: McpJsonValue | undefined): void {
  if (node.const !== undefined && JSON.stringify(node.const) !== JSON.stringify(value)) {
    throw problem(path, "This value must equal the required constant.");
  }
  if (node.enum !== undefined) {
    const allowed = node.enum as McpJsonValue[];
    if (!allowed.some((entry) => JSON.stringify(entry) === JSON.stringify(value))) {
      throw problem(path, "This value must be one of the offered choices.");
    }
  }
}

function problem(path: string, message: string): Error {
  const error = new Error(message);
  error.name = "McpSchemaValidationError";
  const normalized = path
    ? path.startsWith(".")
      ? `$${path}`
      : `$.${path}`
    : "$";
  (error as Error & { path?: string }).path = normalized;
  return error;
}

export function isMcpSchemaValidationError(error: unknown): error is Error {
  return error instanceof Error && error.name === "McpSchemaValidationError";
}

function validateType(
  types: string[],
  node: Record<string, unknown>,
  context: SchemaContext,
  path: string,
  depth: number,
  value: McpJsonValue,
): void {
  if (value === null) {
    if (!types.includes("null")) throw problem(path, "This value must not be null.");
    validateConstEnum(node, path, value);
    return;
  }
  const matches = (candidate: string): boolean =>
    (candidate === "string" && typeof value === "string") ||
    (candidate === "boolean" && typeof value === "boolean") ||
    (candidate === "number" && typeof value === "number" && Number.isFinite(value)) ||
    (candidate === "integer" && typeof value === "number" && Number.isInteger(value)) ||
    (candidate === "array" && Array.isArray(value)) ||
    (candidate === "object" && isRecord(value));
  if (!types.some(matches)) {
    throw problem(path, `This value must be ${types.join(" or ")}.`);
  }
  validateConstEnum(node, path, value);
  if (typeof value === "string") {
    const { minLength, maxLength, format } = node;
    if (typeof minLength === "number" && value.length < minLength) throw problem(path, "This text is too short.");
    if (typeof maxLength === "number" && value.length > maxLength) throw problem(path, "This text is too long.");
    if (typeof format === "string") validateFormat(format, value, path);
  }
  if (typeof value === "number") {
    const { minimum, maximum } = node;
    if (typeof minimum === "number" && value < minimum) throw problem(path, "This number is below the minimum.");
    if (typeof maximum === "number" && value > maximum) throw problem(path, "This number is above the maximum.");
  }
  if (Array.isArray(value)) {
    const { minItems, maxItems } = node;
    if (typeof minItems === "number" && value.length < minItems) throw problem(path, "This list is too short.");
    if (typeof maxItems === "number" && value.length > maxItems) throw problem(path, "This list is too long.");
    if (value.length > MCP_SCHEMA_MAX_ARRAY_ITEMS) throw problem(path, "This list exceeds the size limit.");
    if (node.uniqueItems === true) {
      const seen = new Set<string>();
      for (let index = 0; index < value.length; index += 1) {
        const key = JSON.stringify(value[index]);
        if (seen.has(key)) throw problem(`${path}[${index}]`, "This list must not contain duplicate items.");
        seen.add(key);
      }
    }
    const items = node.items;
    if (items !== undefined) {
      for (let index = 0; index < value.length; index += 1) {
        walkSchema(items, context, `${path}[${index}]`, depth + 1, "validate", value[index]!);
      }
    }
    return;
  }
  if (isRecord(value)) {
    const properties = isRecord(node.properties) ? node.properties : {};
    const required = Array.isArray(node.required) ? node.required.filter((entry): entry is string => typeof entry === "string") : [];
    for (const name of required) {
      if (!(name in value)) throw problem(`${path}.${name}`, "This field is required.");
    }
    const minProperties = node.minProperties;
    const maxProperties = node.maxProperties;
    const names = Object.keys(value);
    if (typeof minProperties === "number" && names.length < minProperties) {
      throw problem(path, "This object needs more fields.");
    }
    if (typeof maxProperties === "number" && names.length > maxProperties) {
      throw problem(path, "This object has too many fields.");
    }
    const additional = node.additionalProperties;
    for (const [name, child] of Object.entries(value)) {
      const schema = properties[name];
      if (schema !== undefined) {
        walkSchema(schema, context, `${path}.${name}`, depth + 1, "validate", child);
      } else if (additional === false || additional === undefined) {
        throw problem(`${path}.${name}`, "This field is not accepted.");
      } else if (isRecord(additional)) {
        walkSchema(additional, context, `${path}.${name}`, depth + 1, "validate", child);
      }
    }
  }
}

/**
 * Validates parsed arguments against the original bounded input schema.
 * Returns a typed problem instead of remote echo on failure.
 */
export function validateToolArguments(
  schemaText: string,
  argumentsText: string,
): { ok: true; value: Record<string, McpJsonValue> } | { ok: false; path: string; message: string } {
  let schema: unknown;
  let args: unknown;
  try {
    schema = JSON.parse(schemaText);
  } catch {
    return { ok: false, path: "$", message: "The stored tool input schema is unreadable." };
  }
  try {
    args = JSON.parse(argumentsText);
  } catch {
    return { ok: false, path: "$", message: "The tool arguments must be a JSON object." };
  }
  if (!isRecord(args)) {
    return { ok: false, path: "$", message: "The tool arguments must be a JSON object." };
  }
  try {
    assertSupportedInputSchema(schema);
    walkSchema(schema, { defs: collectDefs(schema), seenRefs: new Set() }, "", 0, "validate", args as McpJsonValue);
    return { ok: true, value: args as Record<string, McpJsonValue> };
  } catch (error) {
    if (isMcpSchemaUnsupportedError(error)) {
      return { ok: false, path: "$", message: error.message };
    }
    if (isMcpSchemaValidationError(error)) {
      return {
        ok: false,
        path: String((error as Error & { path?: string }).path ?? "$"),
        message: error.message,
      };
    }
    return { ok: false, path: "$", message: "The tool arguments could not be validated." };
  }
}

function collectDefs(schema: unknown): Map<string, unknown> {
  const defs = new Map<string, unknown>();
  const visit = (node: unknown, depth: number) => {
    if (depth > MCP_SCHEMA_MAX_DEPTH || Array.isArray(node)) {
      if (Array.isArray(node)) for (const item of node) visit(item, depth + 1);
      return;
    }
    if (!isRecord(node)) return;
    for (const key of ["$defs", "definitions"] as const) {
      const group = node[key];
      if (isRecord(group)) for (const [name, value] of Object.entries(group)) defs.set(name, value);
    }
    for (const value of Object.values(node)) visit(value, depth + 1);
  };
  visit(schema, 0);
  return defs;
}

const SECRET_KEY_PATTERN =
  /(^|_|-)(password|passwd|secret|token|api_?key|access_?key|private_?key|credential|credentials|authorization|auth_?token|refresh_?token|session_?token|passphrase|client_?secret)(_|-|$)/iu;

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /^Bearer\s+\S+/iu,
  /^tsmcp_[A-Za-z0-9_-]{8,}$/u,
  /^[A-Za-z0-9_-]{24,}$/u,
  /^nango_(?:secret_)?[A-Za-z0-9_-]{8,}$/u,
];

export function looksLikeSecret(key: string | null, value: string): boolean {
  if (key && SECRET_KEY_PATTERN.test(key)) return true;
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value.trim()));
}

const EMBEDDED_SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._\-]{6,}/giu,
  /\b(api_?key|access_?key|token|secret|password|passwd|passphrase|authorization|credential)\s*[=:]\s*[^\s,;)"']+/giu,
  /\b(tsmcp_|nango_secret_|nango_)[A-Za-z0-9_\-]{6,}/gu,
];

/** Redacts secret-shaped substrings a remote echoed inside longer text. */
export function redactEmbeddedSecrets(text: string): string {
  let output = text;
  for (const pattern of EMBEDDED_SECRET_PATTERNS) {
    output = output.replace(pattern, (match) => {
      const separator = match.includes("=") ? "=" : match.includes(":") ? ":" : " ";
      const key = match.split(/\s|[=:]|(?=Bearer)/u)[0] ?? "";
      return key.toLowerCase().startsWith("bearer")
        ? "Bearer [redacted]"
        : `${key}${separator}[redacted]`;
    });
  }
  return output;
}

/**
 * Redacts secret-shaped keys and values from any structure before it is
 * persisted, logged, echoed to a renderer, or shown to a model.
 */
export function redactSecrets(value: unknown, keyHint: string | null = null): unknown {
  if (typeof value === "string") {
    return looksLikeSecret(keyHint, value)
      ? "[redacted]"
      : redactEmbeddedSecrets(value);
  }
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item, keyHint));
  if (isRecord(value)) {
    // fromEntries defines own data properties; untrusted __proto__ keys
    // never invoke a prototype setter while retaining inert JSON content.
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key, SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redactSecrets(child, key),
    ]));
  }
  return value;
}

/** Removes exact secret values from untrusted remote echo (text or JSON). */
export function redactKnownSecrets(text: string, secrets: readonly string[]): string {
  let output = text;
  for (const secret of secrets) {
    if (secret.length < 4) continue;
    output = output.split(secret).join("[redacted]");
  }
  return output;
}

export function displayJson(value: unknown, maxChars: number): string {
  const redacted = redactSecrets(value);
  let text: string;
  try {
    text = JSON.stringify(redacted, null, 2);
  } catch {
    text = String(redacted);
  }
  if (text.length > maxChars) return `${text.slice(0, maxChars - 1)}…`;
  return text;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
