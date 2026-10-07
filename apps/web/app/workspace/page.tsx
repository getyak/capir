import { randomUUID } from "node:crypto";
import { TalentSignalClient } from "@talent-signal/contracts";
import { backendAuthBaseUrl } from "@/lib/server/backendAuth";
import { mintMemoryEntryCapability } from "@/lib/server/memoryEntryCapability";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { TalentSignalHttpError } from "@talent-signal/contracts";
import { auth } from "@/auth";
import {
  validReturnSessionId,
  withReturnSession,
} from "@/components/session-return-navigation";
import { readBackendSessionClaims } from "@/lib/server/backendAuth";
import { contactHandoffSessionVersion } from "@/lib/server/contact-handoff-session";
import { RelationshipWorkspaceApp } from "@/components/relationship-workspace-app";
import { WorkspaceApp } from "@/components/workspace-app";
import {
  backendSessionRecoveryHref,
  backendSessionIsExpired,
  isBackendSessionExpiredError,
} from "@/lib/backend-session";
import {
  isIntegrationMode,
  loadRelationshipWorkspaceInitialRead,
} from "@/lib/server/localBackend";
import { loadCandidateWorkspace } from "@/lib/server/candidateWorkspace";
import {
  workspaceSessionDraftStorageScope,
  workspaceSessionsBinding,
} from "@/lib/server/workspaceSessions";
import { WorkspaceNewConversation } from "@/components/new-conversation";
import WorkspaceLoading from "./loading";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "工作区",
  description:
    "账号专属的对话画布：从一条消息开始，始终关联可核验的来源。",
  robots: {
    follow: false,
    index: false,
  },
};

export default async function WorkspacePage({
  searchParams,
}: {
  searchParams: Promise<{
    draft_session?: string;
    capture?: string;
    context?: string;
    identity_case?: string;
    intent?: string;
    person?: string;
    session?: string;
    surface?: string;
  }>;
}) {
  const parameters = await searchParams;
  const requestedCapture =
    parameters.capture &&
    /^[0-9a-f-]{36}$/i.test(parameters.capture)
      ? parameters.capture
      : undefined;
  const requestedPerson =
    parameters.person &&
    /^[0-9a-f-]{36}$/i.test(parameters.person)
      ? parameters.person
      : undefined;
  const requestedContext =
    parameters.context &&
    /^[0-9a-f-]{36}$/i.test(parameters.context)
      ? parameters.context
      : undefined;
  const requestedIdentityCase =
    parameters.identity_case &&
    /^[0-9a-f-]{36}$/i.test(parameters.identity_case)
      ? parameters.identity_case
      : undefined;
  const requestedReturnSession = validReturnSessionId(parameters.session);
  const session = await auth();
  if (!session?.user) {
    const callbackParameters = new URLSearchParams();
    if (requestedCapture) {
      callbackParameters.set("capture", requestedCapture);
    } else if (requestedPerson && requestedContext) {
      callbackParameters.set("person", requestedPerson);
      callbackParameters.set("context", requestedContext);
    }
    if (requestedIdentityCase) {
      callbackParameters.set("identity_case", requestedIdentityCase);
    }
    if (requestedReturnSession) {
      callbackParameters.set("session", requestedReturnSession);
    }
    const callbackUrl =
      callbackParameters.size > 0
        ? `/workspace?${callbackParameters.toString()}`
        : "/workspace";
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  }

  const scopedRequest = Boolean(
    requestedCapture ||
      requestedPerson ||
      requestedContext ||
      requestedIdentityCase ||
      requestedReturnSession ||
      parameters.surface,
  );

  // The default authenticated entry is an unscoped conversation canvas. It uses
  // the existing unscoped Session/Agent controller and never redirects to Today
  // or embeds the CRM dashboard.
  if (scopedRequest && parameters.draft_session) redirect("/workspace");
  if (!scopedRequest) {
    const claims = await readBackendSessionClaims();
    const current =
      claims && !backendSessionIsExpired(claims.backendExpiresAt) ? claims : null;
    const draftSessionId = validReturnSessionId(parameters.draft_session) ?? randomUUID();
    if (current && parameters.draft_session) {
      const client = new TalentSignalClient(backendAuthBaseUrl(), current.backendAccessToken);
      try {
        await client.getAgentSession(draftSessionId, AbortSignal.timeout(8_000));
      } catch (error) {
        // A stopped/revoked test entry can outlive its backend session in the
        // browser cookie. Reuse the existing reauthentication flow instead of
        // presenting a server error or trusting the stale draft capability.
        if (error instanceof TalentSignalHttpError && error.status === 401) {
          redirect("/login?reason=backend_session_expired&callbackUrl=%2Fworkspace");
        }
        if (!(error instanceof TalentSignalHttpError) || error.status !== 404) throw error;
        // An absent locator only grants create/admit authority, never Memory access.
        return <WorkspaceNewConversation accountId={current.backendAccountId}
          sessionBinding={workspaceSessionsBinding(current)} sessionVersion={contactHandoffSessionVersion(current)}
          storageScope={workspaceSessionDraftStorageScope(current)}
          bootstrap={{ sessionId: draftSessionId, capability: mintMemoryEntryCapability(current, { purpose: "chat", sessionId: draftSessionId, stage: "bootstrap" }) }}/>;
      }
      redirect(`/workspace/sessions/${draftSessionId}`);
    }
    return (
      <WorkspaceNewConversation
        bootstrap={current ? { sessionId: draftSessionId, capability: mintMemoryEntryCapability(current, { purpose: "chat", sessionId: draftSessionId, stage: "bootstrap" }) } : null}
        accountId={current?.backendAccountId ?? null}
        sessionBinding={
          current ? workspaceSessionsBinding(current) : null
        }
        sessionVersion={
          current ? contactHandoffSessionVersion(current) : null
        }
        storageScope={
          current ? workspaceSessionDraftStorageScope(current) : null
        }
      />
    );
  }

  if (isIntegrationMode()) {
    const { surface } = parameters;
    if (surface === "loading") {
      return <WorkspaceLoading />;
    }
    let initialRead: Awaited<
      ReturnType<typeof loadRelationshipWorkspaceInitialRead>
    > | null = null;
    let integrationError: string | null = null;
    let sessionRecoveryHref: string | null = null;
    try {
      initialRead = await loadRelationshipWorkspaceInitialRead({
        captureId: requestedCapture,
        personId: requestedPerson,
        relationshipContextId: requestedContext,
        identityCaseId: requestedIdentityCase,
      });
      integrationError = initialRead.warnings.join(" ") || null;
    } catch (caught) {
      if (
        caught instanceof TalentSignalHttpError &&
        caught.code === "PERSON_MERGED" &&
        caught.details &&
        typeof caught.details === "object"
      ) {
        const details = caught.details as Record<string, unknown>;
        const retainedPersonId = String(
          details.merged_into_person_id ?? "",
        );
        const retainedContextId = String(
          details.relationship_context_id ?? "",
        );
        if (
          /^[0-9a-f-]{36}$/i.test(retainedPersonId) &&
          /^[0-9a-f-]{36}$/i.test(retainedContextId)
        ) {
          redirect(
            withReturnSession(
              `/workspace?person=${encodeURIComponent(
                retainedPersonId,
              )}&context=${encodeURIComponent(retainedContextId)}`,
              requestedReturnSession,
            ),
          );
        }
      }
      if (isBackendSessionExpiredError(caught)) {
        integrationError = caught.message;
        const callbackParameters = new URLSearchParams();
        if (requestedCapture) {
          callbackParameters.set("capture", requestedCapture);
        } else if (requestedPerson && requestedContext) {
          callbackParameters.set("person", requestedPerson);
          callbackParameters.set("context", requestedContext);
        } else {
          callbackParameters.set("surface", "desk");
        }
        if (requestedIdentityCase) {
          callbackParameters.set("identity_case", requestedIdentityCase);
        }
        if (requestedReturnSession) {
          callbackParameters.set("session", requestedReturnSession);
        }
        sessionRecoveryHref = backendSessionRecoveryHref(
          `/workspace?${callbackParameters.toString()}`,
        );
      } else {
        const status =
          caught &&
          typeof caught === "object" &&
          "status" in caught &&
          typeof caught.status === "number"
            ? caught.status
            : null;
        if (status !== 404) {
          integrationError =
            "无法连接账号专属的本地后端，当前不声称任何状态已经核验。";
        }
      }
    }
    const browserClaims = await readBackendSessionClaims();
    return (
      <RelationshipWorkspaceApp
        initialSessionVersion={browserClaims ? contactHandoffSessionVersion(browserClaims) : null}
        initialAccountId={initialRead?.accountId ?? null}
        initialAgentHistory={initialRead?.agentHistory ?? null}
        initialCaptureOpen={parameters.intent === "capture"}
        initialCreateOpen={parameters.intent === "create-contact"}
        initialIdentityResolutionCase={
          initialRead?.identityResolutionCase ?? null
        }
        initialKnowledgeSnapshot={initialRead?.knowledgeSnapshot ?? null}
        initialRelationshipScope={initialRead?.relationshipScope ?? null}
        initialReturnSessionId={requestedReturnSession}
        initialWorkspace={initialRead?.workspace ?? null}
        initialError={integrationError}
        initialSessionRecoveryHref={sessionRecoveryHref}
      />
    );
  }

  const { dataset, source } = await loadCandidateWorkspace();

  return (
    <WorkspaceApp
      dataset={dataset}
      source={source}
      user={{
        email: session.user.email,
        name: session.user.name,
      }}
    />
  );
}
