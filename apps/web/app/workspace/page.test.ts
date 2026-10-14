import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn() }));
vi.mock("@/auth", () => ({ auth: fixture.auth }));
vi.mock("@/lib/server/localBackend", () => ({ isIntegrationMode: () => true, loadRelationshipWorkspaceInitialRead: fixture.load }));
vi.mock("@/lib/server/backendAuth", () => ({ readBackendSessionClaims: async () => null, backendAuthBaseUrl: () => "http://127.0.0.1:4317" }));
vi.mock("@/lib/server/candidateWorkspace", () => ({ loadCandidateWorkspace: vi.fn() }));
vi.mock("@/components/relationship-workspace-app", () => ({ RelationshipWorkspaceApp: () => null }));
vi.mock("@/components/workspace-app", () => ({ WorkspaceApp: () => null }));
vi.mock("@/components/new-conversation", () => ({ WorkspaceNewConversation: () => null }));
import WorkspacePage from "./page";
import { BackendSessionExpiredError } from "@/lib/backend-session";

const parameters = { surface: "desk", intent: "create-contact", session: "33333333-3333-4333-8333-333333333333" };
const callback = "/workspace?surface=desk&intent=create-contact&session=33333333-3333-4333-8333-333333333333";
beforeEach(() => { vi.clearAllMocks(); fixture.auth.mockResolvedValue({ user: { id: "synthetic" } }); });

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
