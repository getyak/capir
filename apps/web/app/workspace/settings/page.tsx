import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { settingsReturnPath, settingsSectionFrom } from "@/lib/settings-return-path";
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
  searchParams: Promise<{ section?: string | string[] }>;
}) {
  const requested = (await searchParams).section;
  const session = await auth();
  if (!session?.user) {
    // Preserve only a schema-validated section so returning from login opens
    // the requested pane. The helper is the single place that builds this path,
    // and it can only ever return a fixed same-origin settings route, so an
    // unknown, repeated or malformed value cannot become a redirect target.
    redirect(`/login?callbackUrl=${encodeURIComponent(settingsReturnPath(requested))}`);
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
      sessionFingerprint(currentClaims!.backendAccessToken) === operation!.sessionFingerprint;
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
      avatarUrl={data?.user.kind === "lab_human" ? null : session.user.image ?? null}
      labEnabled={labEnabled}
      section={section}
      sessionVersion={sessionVersion}
      webRelease={readWebReleaseIdentity()}
      webReleaseObservedAt={new Date().toISOString()}
    />
  );
}
