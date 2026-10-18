import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { CONTRACT_VERSION } from "@talent-signal/contracts";
const section = vi.hoisted(() => vi.fn());
vi.mock("./relationship-workspace/relationship-resource-section", () => ({ RelationshipResourceSection: section }));
import { RelationshipWorkspaceApp } from "./relationship-workspace-app";
it("forwards the dedicated time binding through the actual workspace app", () => {
  section.mockImplementation(() => null);
  renderToStaticMarkup(createElement(RelationshipWorkspaceApp, {
    initialAccountId: "synthetic-account", initialSessionVersion: "contact-only-binding",
    initialSourceSyncBinding: "time-binding", initialAgentHistory: null, initialIdentityResolutionCase: null,
    initialKnowledgeSnapshot: null, initialWorkspace: null,
    initialRelationshipScope: { contract_version: CONTRACT_VERSION, person: { id: "synthetic-person", display_label: "Synthetic person" }, relationship_context: { id: "synthetic-context", display_label: "Synthetic context" } },
    initialReturnSessionId: null, initialError: null, initialSessionRecoveryHref: null,
  }));
  expect(section).toHaveBeenCalled();
  expect(section.mock.calls[0]![0]).toMatchObject({ sessionBinding: "time-binding", personId: "synthetic-person", relationshipContextId: "synthetic-context" });
});
