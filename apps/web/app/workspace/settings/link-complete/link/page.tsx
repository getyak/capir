import { redirect } from "next/navigation";

import { readAuthOperation } from "@/lib/server/stagedAuth";
import { StagedTargetLinkForm } from "../staged-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "连接登录方式", robots: { index: false, follow: false } };

/**
 * Read-only continuation of a staged linking operation: the current identity
 * is already verified; the new provider's own proof is collected next. The
 * sealed attempt and its challenge stay server-side.
 */
export default async function StagedTargetLinkPage() {
  const operation = await readAuthOperation();
  if (!operation || !operation.attempt || operation.step !== "awaiting-target" || !operation.targetProvider) {
    redirect("/workspace/settings?section=account&link=error");
  }
  return (
    <StagedTargetLinkForm
      targetProvider={operation.targetProvider}
      note="当前身份已验证。继续连接新的登录方式；完成后仍是你现在的账户。"
      scope={{
        operationRef: operation.ref,
        accountId: operation.accountId,
        userId: operation.userId,
        accountRevision: operation.accountRevision,
        userRevision: operation.userRevision,
      }}
    />
  );
}
