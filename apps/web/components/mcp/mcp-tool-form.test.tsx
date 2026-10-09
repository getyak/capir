// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpToolForm } from "./mcp-tool-form";

let mount: HTMLDivElement;
let root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); mount = document.createElement("div"); document.body.appendChild(mount); root = createRoot(mount); });
afterEach(async () => { await act(async () => root.unmount()); mount.remove(); vi.unstubAllGlobals(); });
async function input(selector: string, value: string) {
  const field = mount.querySelector(selector) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function submit() { await act(async () => mount.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }
function tool(schema: unknown) { return { name: "read_wiki_structure", description: "Repository documentation", read_only: true, input_schema: JSON.stringify(schema) }; }

describe("McpToolForm", () => {
  it("collects a named DeepWiki repository without manual JSON or automatic execution", async () => {
    const onSubmit = vi.fn<(argumentsJson: string) => Promise<void>>(async () => {});
    await act(async () => root.render(createElement(McpToolForm, { tool: tool({ type: "object", properties: { repoName: { type: "string", minLength: 1, description: "Repository owner/name" } }, required: ["repoName"] }), disabled: false, onSubmit })));
    expect(mount.textContent).toContain("repoName · 必填");
    expect(mount.querySelector("textarea")).toBeNull();
    await submit();
    expect(onSubmit).not.toHaveBeenCalled();
    await input("input", "facebook/react");
    expect(onSubmit).not.toHaveBeenCalled();
    await submit();
    expect(onSubmit).toHaveBeenCalledWith('{"repoName":"facebook/react"}');
  });
  it("preserves scalar types, defaults and optional omission alongside bounded complex JSON", async () => {
    const onSubmit = vi.fn<(argumentsJson: string) => Promise<void>>(async () => {});
    await act(async () => root.render(createElement(McpToolForm, { tool: tool({ type: "object", properties: { kind: { type: "string", enum: ["brief", "full"], default: "brief" }, enabled: { type: "boolean", default: false }, limit: { type: "integer", default: 5, minimum: 1, maximum: 20 }, query: { type: "string" }, filter: { type: "object" } }, required: ["enabled", "limit"] }), disabled: false, onSubmit })));
    await input("textarea", '{"tag":"react"}');
    await submit();
    expect(JSON.parse(onSubmit.mock.calls[0]![0])).toEqual({ kind: "brief", enabled: false, limit: 5, filter: { tag: "react" } });
    expect(mount.querySelector('input[type="number"]')?.getAttribute("step")).toBe("1");
  });
  it("uses an explicit advanced form for unsupported root schemas and rejects invalid JSON", async () => {
    const onSubmit = vi.fn<(argumentsJson: string) => Promise<void>>(async () => {});
    await act(async () => root.render(createElement(McpToolForm, { tool: tool({ oneOf: [{ type: "object" }, { type: "array" }] }), disabled: false, onSubmit })));
    expect(mount.textContent).toContain("高级调用参数");
    await input("textarea", "broken");
    await submit();
    expect(onSubmit).not.toHaveBeenCalled();
    expect(mount.querySelector('[role="alert"]')).not.toBeNull();
  });
});
