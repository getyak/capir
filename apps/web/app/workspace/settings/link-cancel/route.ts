import { redirect } from "next/navigation";

import { readAuthOperation, clearStagedAuth } from "@/lib/server/stagedAuth";
import { continuityReturnTo } from "@/lib/login-continuity";

export const dynamic = "force-dynamic";

/**
 * Ref-specific exit for a cancelled staged operation. Only the matched
 * operation is cleared, and only ITS sanitized return hint survives into a
 * neutral cancelled result (no panel reopen, no success claim). A missing or
 * foreign ref never clears or exposes a newer operation and gets the generic
 * recoverable outcome instead.
 */
export async function GET(request: Request): Promise<never> {
  const ref = new URL(request.url).searchParams.get("ref");
  const operation = await readAuthOperation();
  if (ref && operation && operation.ref === ref) {
    const returnTo = continuityReturnTo(operation.returnTo);
    await clearStagedAuth();
    redirect(
      `/workspace/settings?link=cancelled${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`,
    );
  }
  redirect("/workspace/settings?link=error");
}
