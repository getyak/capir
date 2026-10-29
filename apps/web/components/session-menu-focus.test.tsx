// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("./workspace-session-request", () => ({ workspaceSessionFetch: request }));
import { SessionRowMenu } from "./workspace-session-row";
import { LocaleProvider } from "./locale-provider";

it("returns focus to the same row menu after cancelling Rename", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  request.mockResolvedValue(Response.json({ session_version: "binding", detail: { session_id: id, state: "active", revision: 3, title: "Synthetic conversation" } }));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(<LocaleProvider locale="en"><SessionRowMenu organization={{ archived: false, pinned: false, onToggle: () => {}, rowLabel: "Synthetic conversation", session: { id, binding: "binding", scope: "scope" } }} /></LocaleProvider>));
    const trigger = host.querySelector("button")!;
    await act(async () => trigger.click());
    const rename = [...document.querySelectorAll("button")].find(button => button.textContent === "Rename")!;
    await act(async () => rename.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    const cancel = [...document.querySelectorAll("button")].find(button => button.textContent === "Cancel")!;
    await act(async () => cancel.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
