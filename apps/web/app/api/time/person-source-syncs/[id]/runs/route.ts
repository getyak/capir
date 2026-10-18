import { loadPersonSourceSyncRuns } from "@/lib/server/timeWorkspace";
import { timeAccess, timeFailure, timeReply } from "@/lib/server/timeWorkspaceBoundary";
import { isWorkspaceSessionId } from "@/lib/server/workspaceSessions";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

/** Bounded run history: honest observed outcomes, no-store owner reads. */
export async function GET(request: Request, context: Context) {
  try {
    const { binding } = await timeAccess(request);
    const { id } = await context.params;
    if (!isWorkspaceSessionId(id)) return timeReply({ message: "记录标识无效。" }, 400);
    return timeReply({ ...await loadPersonSourceSyncRuns(id), session_version: binding });
  } catch (error) { return timeFailure(error); }
}
