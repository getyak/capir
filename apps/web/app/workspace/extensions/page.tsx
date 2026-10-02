import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { WorkspaceExtensions } from "@/components/workspace-extensions";
import {
  backendSessionRecoveryHref,
  isBackendSessionExpiredError,
} from "@/lib/backend-session";
import {
  CONTRACT_VERSION,
  type McpClientGrant,
  type McpConnection,
  type McpEndpointsResponse,
} from "@talent-signal/contracts";
import { readBackendSessionClaims } from "@/lib/server/backendAuth";
import { contactHandoffSessionVersion } from "@/lib/server/contact-handoff-session";
import { loadMcpExtensionSnapshot } from "@/lib/server/mcpExtensions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description: "双向 MCP 扩展：连接外部服务，或按范围提供只读接入。",
  robots: { follow: false, index: false },
  title: "扩展 · capri",
};

const UNCONFIGURED_ENDPOINTS: McpEndpointsResponse = {
  authorization_scheme: null,
  configured: false,
  contract_version: CONTRACT_VERSION,
  note: "扩展服务暂时不可用，未显示端点。",
  public_origin: null,
  streamable_http_url: null,
};

export default async function ExtensionsPage() {
  if (!(await auth())?.user) {
    redirect("/login?callbackUrl=%2Fworkspace%2Fextensions");
  }
  const claims = await readBackendSessionClaims();
  if (!claims) redirect(backendSessionRecoveryHref("/workspace/extensions"));

  let connections: McpConnection[] = [];
  let grants: McpClientGrant[] = [];
  let endpoints = UNCONFIGURED_ENDPOINTS;
  let error: string | null = null;
  try {
    const snapshot = await loadMcpExtensionSnapshot();
    connections = snapshot.connections;
    grants = snapshot.grants;
    endpoints = snapshot.endpoints;
  } catch (caught) {
    if (isBackendSessionExpiredError(caught)) {
      redirect(backendSessionRecoveryHref("/workspace/extensions"));
    }
    error = "账号专属后端或扩展契约暂时不可用。";
  }

  return (
    <WorkspaceExtensions
      connections={connections}
      endpoints={endpoints}
      error={error}
      grants={grants}
      recoveryHref={null}
      sessionVersion={contactHandoffSessionVersion(claims)}
    />
  );
}
