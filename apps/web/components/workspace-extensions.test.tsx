// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_VERSION } from "@talent-signal/contracts";
import { WorkspaceExtensions } from "./workspace-extensions";

vi.mock("./mcp/mcp-directory", () => ({ McpDirectoryPanel: () => createElement("section", { "data-mcp-directory": true }, "Remote catalog") }));
vi.mock("./use-workspace-session-recovery", () => ({ useWorkspaceSessionRecovery: () => ({ sessionRecoveryHref: null }) }));
let mount: HTMLDivElement;
let root: Root;
beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); mount = document.createElement("div"); document.body.appendChild(mount); root = createRoot(mount); });
afterEach(async () => { await act(async () => root.unmount()); mount.remove(); vi.unstubAllGlobals(); });

describe("WorkspaceExtensions", () => {
  it("contains one inbound connection owner inside main and preserves the outbound client tab", async () => {
    await act(async () => root.render(createElement(WorkspaceExtensions, {
      connections: [], grants: [], endpoints: { authorization_scheme: null, configured: false, contract_version: CONTRACT_VERSION, note: "not configured", public_origin: null, streamable_http_url: null }, error: null, sessionVersion: "test-session", recoveryHref: null,
    })));
    expect(mount.querySelectorAll("main")).toHaveLength(1);
    expect(mount.querySelectorAll("main [data-mcp-directory]")).toHaveLength(1);
    expect(mount.textContent).not.toContain("保存地址");
    const outbound = mount.querySelector('#extensions-tab-outbound') as HTMLButtonElement;
    await act(async () => outbound.click());
    expect(mount.querySelector("[data-mcp-directory]")).toBeNull();
    expect(outbound.getAttribute("aria-selected")).toBe("true");
    expect(mount.querySelector('#extensions-outbound')).not.toBeNull();
    await act(async () => outbound.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(mount.querySelectorAll("main [data-mcp-directory]")).toHaveLength(1);
    expect(document.activeElement?.id).toBe("extensions-tab-inbound");
  });
});
