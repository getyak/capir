import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { settingsReturnPath, settingsSectionFrom } from "@/lib/settings-return-path";
import { settingsConnectHints, settingsConnectPath } from "@/lib/login-continuity";
import { SettingsWorkspace } from "@/components/settings-workspace";
import { readBackendSessionClaims } from "@/lib/server/backendAuth";
import { contactHandoffSessionVersion } from "@/lib/server/contact-handoff-session";
import { backendSessionIsExpired } from "@/lib/backend-session";
import { loadAccountSettings } from "@/lib/server/accountBackend";
import { readWebReleaseIdentity } from "@/lib/web-release";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "设置",
  description: "账号、空间与界面偏好。",
  robots: { index: false, follow: false },
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    section?: string | string[];
    connect?: string | string[];
    returnTo?: string | string[];
  }>;
}) {
  const parameters = await searchParams;
  const requested = parameters.section;
  // GET-141 navigation hints only: an allowlisted provider whose connecting
  // panel opens preselected, and a sanitized same-origin target to continue
  // after a verified link. Neither is proof of a collision or a link result.
  const connectHints = settingsConnectHints({
    connect: parameters.connect,
    returnTo: parameters.returnTo,
  });
  const session = await auth();
  if (!session?.user) {
    // Preserve a schema-validated section AND the validated connect/return
    // hints inside the callback URL, so a session expiry at the connection
    // entry resumes the same journey after login. The helper can only ever
    // return fixed same-origin settings paths; unknown or malformed values
    // collapse instead of becoming a redirect target.
    redirect(
      `/login?callbackUrl=${encodeURIComponent(
        settingsConnectPath({
          returnPath: settingsReturnPath(requested),
          connect: connectHints.connect,
          returnTo: connectHints.returnTo,
        }),
      )}`,
    );
  }

  let data: Awaited<ReturnType<typeof loadAccountSettings>> | null = null;
  try {
    data = await loadAccountSettings();
  } catch {
    /* Render no account data from fixtures or stale JWT claims. */
  }

  // Read-only projection of any in-flight recovery flow: only the flow ref,
  // role state, provider and absolute expiry are ever exposed to the client.
  let recovery: {
    operationRef: string | null;
    roles: {
      current: { provider: string; expiresAt: string } | null;
      duplicate: { provider: string; expiresAt: string } | null;
    };
  } = { operationRef: null, roles: { current: null, duplicate: null } };
  try {
    const {
      readAuthOperation, readAuthProof, validateRecoveryProof, flowExpiresAt,
      sessionFingerprint, AUTH_PROOF_TTL_SECONDS,
    } = await import("@/lib/server/stagedAuth");
    const operation = await readAuthOperation();
    // The flow must describe the CURRENT authoritative session: same account,
    // user, bearer fingerprint and both revisions. A stale or foreign flow
    // renders NO verified status even if its proofs were once valid.
    const currentClaims = await readBackendSessionClaims().catch(() => null);
    const flowMatchesCurrent =
      Boolean(operation && data && currentClaims) &&
      operation!.accountId === data!.workspace.id &&
      operation!.userId === data!.user.id &&
      operation!.accountRevision === data!.workspace.revision &&
      operation!.userRevision === data!.user.revision &&
      sessionFingerprint(currentClaims!) === operation!.sessionFingerprint;
    if (operation && operation.roleChallenges && flowMatchesCurrent) {
      // Authoritative status: a proof is shown as verified only when its role,
      // provider, challenge and age all validate against the frozen flow.
      const validated = {
        current: validateRecoveryProof({ operation, proof: await readAuthProof("current"), role: "current" }),
        duplicate: validateRecoveryProof({ operation, proof: await readAuthProof("duplicate"), role: "duplicate" }),
      };
      const expiry = (proofStagedAt: string | undefined) => {
        const flowEnd = Date.parse(flowExpiresAt(operation));
        const proofEnd = proofStagedAt
          ? Date.parse(proofStagedAt) + AUTH_PROOF_TTL_SECONDS * 1000
          : flowEnd;
        return new Date(Math.min(flowEnd, proofEnd)).toISOString();
      };
      recovery = {
        operationRef: operation.ref,
        roles: {
          current: validated.current && operation.roleChallenges.current
            ? {
                provider: operation.roleChallenges.current.provider,
                expiresAt: expiry(validated.current.stagedAt),
              }
            : null,
          duplicate: validated.duplicate && operation.roleChallenges.duplicate
            ? {
                provider: operation.roleChallenges.duplicate.provider,
                expiresAt: expiry(validated.duplicate.stagedAt),
              }
            : null,
        },
      };
    }
  } catch {
    /* Unreadable staged state renders no recovery status. */
  }

  const labEnabled = data?.lab_enabled === true;
  let section = settingsSectionFrom(requested);
  if (section === "testing" && !labEnabled) section = "overview";

  let sessionVersion: string | null = null;
  try {
    const claims = await readBackendSessionClaims();
    if (claims && !backendSessionIsExpired(claims.backendExpiresAt)) {
      sessionVersion = contactHandoffSessionVersion(claims);
    }
  } catch {
    /* An unreadable session leaves the preference pane read-only, not faked. */
  }

  return (
    <SettingsWorkspace recovery={recovery}
      initial={data}
      connect={connectHints.connect}
      connectReturnTo={connectHints.returnTo}
      avatarUrl={data?.user.kind === "lab_human" ? null : session.user.image ?? null}
      labEnabled={labEnabled}
      section={section}
      sessionVersion={sessionVersion}
      webRelease={readWebReleaseIdentity()}
      webReleaseObservedAt={new Date().toISOString()}
    />
  );
}
