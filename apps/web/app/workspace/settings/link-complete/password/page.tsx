import { redirect } from "next/navigation";

import { readAuthOperation } from "@/lib/server/stagedAuth";
import { StagedPasswordForm } from "../staged-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "设置新密码", robots: { index: false, follow: false } };

/**
 * Read-only render of the new-password step. The sealed attempt stays
 * server-side; only the new password crosses the form, submitted through a
 * server action.
 */
export default async function StagedPasswordPage() {
  const operation = await readAuthOperation();
  if (
    !operation ||
    !operation.attempt ||
    (operation.intent !== "set_password" && operation.intent !== "change_password")
  ) {
    redirect("/workspace/settings?section=account&link=error");
  }
  return (
    <StagedPasswordForm
      intent={operation.intent}
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
