"use client";

import { useState } from "react";
import type { McpConnection } from "@talent-signal/contracts";
import styles from "./mcp.module.css";

type Schema = Record<string, unknown>;
type Tool = McpConnection["tools"][number];
function object(value: unknown): Schema | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Schema : null;
}
function readSchema(raw: string | null): Schema | null {
  try { return object(JSON.parse(raw ?? "{}")); } catch { return null; }
}
function primitive(schema: Schema): boolean {
  return ["string", "number", "integer", "boolean"].includes(String(schema.type)) || Array.isArray(schema.enum);
}

/** The server remains the authority for the original schema; these controls only collect input. */
export function McpToolForm({ tool, disabled, onSubmit }: {
  tool: Tool; disabled: boolean; onSubmit: (argumentsJson: string) => Promise<void>;
}) {
  const schema = readSchema(tool.input_schema);
  const properties = object(schema?.properties) ?? {};
  const required = Array.isArray(schema?.required) ? schema.required : [];
  const fields = Object.entries(properties).slice(0, 64);
  const structured = schema !== null && object(schema.properties) !== null && (schema.type === "object" || schema.type === undefined) && Object.keys(properties).length <= 64 && !["allOf", "anyOf", "oneOf", "if", "$ref"].some((key) => key in schema) && fields.every(([, value]) => object(value));
  const [values, setValues] = useState<Record<string, string>>({});
  const [advanced, setAdvanced] = useState("{}");
  const [error, setError] = useState<string | null>(null);
  function value(name: string, field: Schema): string {
    if (values[name] !== undefined) return values[name]!;
    if (field.default === undefined) return "";
    if (Array.isArray(field.enum)) return `enum:${field.enum.findIndex((item) => JSON.stringify(item) === JSON.stringify(field.default))}`;
    return typeof field.default === "object" ? JSON.stringify(field.default) : String(field.default);
  }
  return <form className={styles.form} onSubmit={(event) => {
    event.preventDefault();
    try {
      let args: unknown;
      if (!structured) args = JSON.parse(advanced);
      else {
        const result: Record<string, unknown> = {};
        for (const [name, raw] of fields) {
          const field = object(raw)!;
          const input = value(name, field);
          if (input === "") {
            if (required.includes(name)) throw new Error(`请填写 ${String(field.title ?? name)}。`);
            continue;
          }
          if (Array.isArray(field.enum)) {
            const index = Number(input.startsWith("enum:") ? input.slice(5) : field.enum.findIndex((item) => String(item) === input));
            if (!Number.isInteger(index) || index < 0 || index >= field.enum.length) throw new Error(`请选择 ${name}。`);
            result[name] = field.enum[index];
          }
          else if (field.type === "boolean") result[name] = input === "true";
          else if (field.type === "number" || field.type === "integer") {
            const number = Number(input);
            if (!Number.isFinite(number) || (field.type === "integer" && !Number.isInteger(number))) throw new Error(`${name} 需要有效数字。`);
            result[name] = number;
          } else if (primitive(field)) result[name] = input;
          else result[name] = JSON.parse(input);
        }
        args = result;
      }
      setError(null);
      void onSubmit(JSON.stringify(args));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "请检查参数。"); }
  }}>
    {structured ? fields.map(([name, raw]) => {
      const field = object(raw)!;
      const isRequired = required.includes(name);
      const current = value(name, field);
      const update = (next: string) => setValues((existing) => ({ ...existing, [name]: next }));
      const enumeration = Array.isArray(field.enum) ? field.enum : null;
      return <label className={styles.field} key={name}>
        <span>{String(field.title ?? name)}{isRequired ? " · 必填" : " · 可选"}</span>
        {enumeration ? <select disabled={disabled} required={isRequired} value={current.startsWith("enum:") ? current : current === "" ? "" : `enum:${enumeration.findIndex((item) => String(item) === current)}`} onChange={(event) => update(event.target.value)}>
          <option value="">请选择</option>{enumeration.map((item, index) => <option value={`enum:${index}`} key={index}>{String(item)}</option>)}
        </select> : field.type === "boolean" ? <select disabled={disabled} required={isRequired} value={current} onChange={(event) => update(event.target.value)}><option value="">请选择</option><option value="true">是</option><option value="false">否</option></select>
          : !primitive(field) ? <textarea disabled={disabled} required={isRequired} maxLength={16000} value={current} onChange={(event) => update(event.target.value)} placeholder={field.type === "array" ? "[]" : "{}"} aria-label={`${name}（高级 JSON）`} />
          : <input disabled={disabled} required={isRequired} value={current} onChange={(event) => update(event.target.value)} type={field.type === "number" || field.type === "integer" ? "number" : "text"} step={field.type === "integer" ? 1 : "any"} min={typeof field.minimum === "number" ? field.minimum : undefined} max={typeof field.maximum === "number" ? field.maximum : undefined} minLength={typeof field.minLength === "number" ? field.minLength : undefined} maxLength={typeof field.maxLength === "number" ? Math.min(field.maxLength, 16000) : 16000} pattern={typeof field.pattern === "string" ? field.pattern : undefined} placeholder={name === "repoName" ? "facebook/react" : undefined} />}
        {typeof field.description === "string" ? <small className={styles.hint}>{field.description}</small> : null}
        {!primitive(field) ? <small className={styles.hint}>复杂参数使用 JSON，提交时仍会校验原始结构。</small> : null}
      </label>;
    }) : <label className={styles.field}><span>高级调用参数（JSON）</span><textarea disabled={disabled} maxLength={16000} value={advanced} onChange={(event) => setAdvanced(event.target.value)} /><small className={styles.hint}>此工具使用复杂输入结构；参数会在下一张确认卡片中展示。</small></label>}
    {structured && fields.length === 0 ? <p className={styles.hint}>此工具无需填写参数。</p> : null}
    {error ? <p role="alert" className={styles.notice}>{error}</p> : null}
    <button className={styles.primary} disabled={disabled} type="submit">提交精确调用请求（{tool.name}）</button>
    <small className={styles.hint}>提交后查看完整参数并确认执行；填写参数不会调用工具。</small>
  </form>;
}
