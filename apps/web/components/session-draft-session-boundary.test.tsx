// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { readConversationDraft, writeConversationDraft } from "@/lib/conversation-local";
import { clearAllPendingSessionDrafts } from "./session-workbench/session-draft-pending";
import { SessionDraftSessionBoundary } from "./session-draft-session-boundary";

let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; localStorage.clear(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

it("quarantines an unreadable owner until a verified scope or explicit logout resolves it", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const id = "11111111-1111-4111-8111-111111111111";
  writeConversationDraft("owner-a", id, { value: "Unsent synthetic draft", updatedAt: new Date().toISOString(), expiresAt: Date.now() + 60_000, writer: "writer-a" });
  const mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
  await act(async () => root!.render(<SessionDraftSessionBoundary storageScope={null} />));
  expect(readConversationDraft("owner-a", id)?.value).toBe("Unsent synthetic draft");
  await act(async () => root!.render(<SessionDraftSessionBoundary storageScope="owner-b" />));
  expect(readConversationDraft("owner-a", id)).toBeNull();
  writeConversationDraft("owner-b", id, { value: "Own draft", updatedAt: new Date().toISOString(), expiresAt: Date.now() + 60_000, writer: "writer-b" });
  clearAllPendingSessionDrafts();
  expect(readConversationDraft("owner-b", id)).toBeNull();
});
