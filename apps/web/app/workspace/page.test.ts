import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), claims: vi.fn() }));
vi.mock("@/auth", () => ({ auth: fixture.auth }));
vi.mock("@/lib/server/localBackend", () => ({ isIntegrationMode: () => true, loadRelationshipWorkspaceInitialRead: fixture.load }));
vi.mock("@/lib/server/backendAuth", () => ({ readBackendSessionClaims: fixture.claims, authSecret: () => "get131-synthetic-only-secret", backendAuthBaseUrl: () => "http://127.0.0.1:4317" }));
vi.mock("@/lib/server/candidateWorkspace", () => ({ loadCandidateWorkspace: vi.fn() }));
vi.mock("@/components/relationship-workspace-app", () => ({ RelationshipWorkspaceApp: () => null }));
vi.mock("@/components/workspace-app", () => ({ WorkspaceApp: () => null }));
vi.mock("@/components/new-conversation", () => ({ WorkspaceNewConversation: () => null }));
import WorkspacePage from "./page";
import { BackendSessionExpiredError } from "@/lib/backend-session";
import { TalentSignalClient, TalentSignalHttpError } from "@talent-signal/contracts";

const parameters = { surface: "desk", intent: "create-contact", session: "33333333-3333-4333-8333-333333333333" };
const callback = "/workspace?surface=desk&intent=create-contact&session=33333333-3333-4333-8333-333333333333";
beforeEach(() => { vi.clearAllMocks(); fixture.auth.mockResolvedValue({ user: { id: "synthetic" } }); fixture.claims.mockResolvedValue(null); });

it("a signed-out identity entry resumes the draft locator after ordinary login", async () => {
  fixture.auth.mockResolvedValue(null);
  const caught = await WorkspacePage({ searchParams: Promise.resolve(parameters) }).then(() => null, (error: unknown) => error as { digest: string });
  expect(caught).toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;/) });
  const login = new URL(caught!.digest.split(";")[2]!, "https://workspace.invalid");
  expect(login.pathname).toBe("/login");
  expect(login.searchParams.get("callbackUrl")).toBe(callback);
});

it("a backend401 preserves the same draft locator for deliberate reauthentication", async () => {
  fixture.load.mockRejectedValue(new BackendSessionExpiredError());
  const result = await WorkspacePage({ searchParams: Promise.resolve(parameters) });
  const recovery = new URL(result.props.initialSessionRecoveryHref, "https://workspace.invalid");
  expect(recovery.searchParams.get("callbackUrl")).toBe(callback);
  expect(recovery.searchParams.get("reason")).toBe("backend_session_expired");
  expect(result.props.initialCreateOpen).toBe(true);
});

it("does not retain an arbitrary intent or form data in an unauthenticated callback", async () => {
  fixture.auth.mockResolvedValue(null);
  const caught = await WorkspacePage({ searchParams: Promise.resolve({ surface: "desk", intent: "delete-person", name: "private", token: "secret" }) }).then(() => null, (error: unknown) => error as { digest: string });
  const login = new URL(caught!.digest.split(";")[2]!, "https://workspace.invalid");
  expect(login.searchParams.get("callbackUrl")).toBe("/workspace");
});

it("retains the existing evidence locator and valid return Session during signed-out recovery", async () => {
  fixture.auth.mockResolvedValue(null);
  const person = "11111111-1111-4111-8111-111111111111";
  const context = "22222222-2222-4222-8222-222222222222";
  const caught = await WorkspacePage({ searchParams: Promise.resolve({ person, context, session: parameters.session }) }).then(() => null, (error: unknown) => error as { digest: string });
  const login = new URL(caught!.digest.split(";")[2]!, "https://workspace.invalid");
  expect(login.searchParams.get("callbackUrl")).toBe(`/workspace?person=${person}&context=${context}&session=33333333-3333-4333-8333-333333333333`);
});

import { workspaceSessionsBinding } from "@/lib/server/workspaceSessions";
import { contactHandoffSessionVersion } from "@/lib/server/contact-handoff-session";
import type { BackendSessionClaims } from "@/lib/server/backendAuth";
it("passes the actual owner time binding separately through the real workspace page", async () => {
  const claims: BackendSessionClaims = { backendAccountId: "synthetic-account", backendAccountName: "Synthetic account", backendAccountSlug: "synthetic-account", backendUserId: "synthetic-user", backendUsername: "synthetic-owner", backendRole: "admin", backendAccessToken: "synthetic-test-token", backendExpiresAt: new Date(Date.now() + 3_600_000).toISOString() };
  fixture.claims.mockResolvedValue(claims);
  fixture.load.mockResolvedValue(null);
  const result = await WorkspacePage({ searchParams: Promise.resolve(parameters) });
  expect(result.props.initialSourceSyncBinding).toBe(workspaceSessionsBinding(claims));
  expect(result.props.initialSessionVersion).toBe(contactHandoffSessionVersion(claims));
  expect(result.props.initialSourceSyncBinding).not.toBe(result.props.initialSessionVersion);
});

it("opens a fresh draft locator in the unscoped canvas without entering the relationship workspace", async () => {
  const draft = "66666666-6666-4666-8666-666666666666";
  fixture.claims.mockResolvedValue({ backendAccountId: "synthetic-account", backendAccountName: "Synthetic account", backendAccountSlug: "synthetic-account", backendUserId: "synthetic-user", backendUsername: "synthetic-owner", backendRole: "admin", backendAccessToken: "synthetic-test-token", backendExpiresAt: "2099-01-01T00:00:00Z" });
  const read = vi.spyOn(TalentSignalClient.prototype, "getAgentSession").mockRejectedValue(new TalentSignalHttpError(404, "NOT_FOUND", "Synthetic absent draft", null));
  try {
    const result = await WorkspacePage({ searchParams: Promise.resolve({ draft_session: draft, intent: "compose" }) });
    expect(result.props.bootstrap.sessionId).toBe(draft);
    expect(result.props.bootstrap.capability).toEqual(expect.any(String));
    expect(result.props.accountId).toBe("synthetic-account");
    expect(fixture.load).not.toHaveBeenCalled();
    expect(result.props.initialScope).toBeUndefined();
  } finally { read.mockRestore(); }
});
