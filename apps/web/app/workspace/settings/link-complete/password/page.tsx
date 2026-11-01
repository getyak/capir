import { redirect } from "next/navigation";

import { completeStagedPassword, type LoginMethodActionState } from "../../login-methods/actions";
import { flowIsLive, readAuthOperation } from "@/lib/server/stagedAuth";
import { StagedPasswordForm } from "../staged-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "设置新密码", robots: { index: false, follow: false } };

/**
 * Read-only render of the new-password step. The sealed attempt stays
 * server-side; only the new password crosses the form, submitted through a
 * server action.
 */
export default async function StagedPasswordPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const operation = await readAuthOperation();
  if (
    !operation ||
    !flowIsLive(operation) ||
    !operation.attempt ||
    (operation.intent !== "set_password" && operation.intent !== "change_password")
  ) {
    redirect("/workspace/settings?section=account&link=error");
  }
  const query = await searchParams;
  const resultRef = typeof query.result === "string" ? query.result : undefined;
  if (query.result !== undefined && (!resultRef || resultRef !== operation.ref)) {
    redirect("/workspace/settings?section=account&link=error");
  }
  let initialState: LoginMethodActionState | undefined;
  if (resultRef) {
    const check = new FormData();
    for (const [name, value] of Object.entries({
      passwordMode: "check", operationRef: operation.ref,
      accountId: operation.accountId, userId: operation.userId,
      accountRevision: String(operation.accountRevision), userRevision: String(operation.userRevision),
    })) check.set(name, value);
    // The existing guarded read branch returns only projected state; GET
    // cannot authorize another completion or expose the held attempt secret.
    initialState = await completeStagedPassword({}, check);
  }
  return (
    <StagedPasswordForm
      key={operation.ref}
      resultRef={resultRef}
      initialState={initialState}
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
