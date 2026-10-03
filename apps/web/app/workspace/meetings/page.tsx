import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { TimeWorkspace } from "@/components/time-workspace";
import { backendSessionRecoveryHref, isBackendSessionExpiredError } from "@/lib/backend-session";
import { dateInZone, type TimePerson } from "@/lib/time-workspace";
import { readBackendSessionClaims } from "@/lib/server/backendAuth";
import { loadPeopleDirectory } from "@/lib/server/localBackend";
import { readMeetingDraft } from "@/lib/server/meetingDrafts";
import { isWorkspaceSessionId, workspaceSessionsBinding } from "@/lib/server/workspaceSessions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { description: "回看联系与对话，为下一次沟通留出时间。", robots: { follow: false, index: false }, title: "时间 · capri" };
export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  if (!(await auth())?.user) redirect("/login?callbackUrl=%2Fworkspace%2Fmeetings");
  const claims = await readBackendSessionClaims();
  if (!claims) redirect(backendSessionRecoveryHref("/workspace/meetings"));
  const requested = await searchParams;
  let people: TimePerson[] = [], peopleError: string | null = null;
  let legacyDraft: { id: string; day: string; zone: string; revision: number; unavailable: boolean } | null = null;
  try {
    const directory = await loadPeopleDirectory();
    people = directory.people.map((person) => ({ id: person.id, label: person.display_label, context: person.contexts.map((c) => c.display_label).join(" / "), contextId: person.contexts.length === 1 ? person.contexts[0]!.id : null }));
  } catch (error) {
    if (isBackendSessionExpiredError(error)) redirect(backendSessionRecoveryHref("/workspace/meetings"));
    peopleError = "人物筛选暂时无法读取，可继续查看时间记录。";
  }
  if (requested.draft && isWorkspaceSessionId(requested.draft)) {
    try {
      const draft = await readMeetingDraft(requested.draft);
      if (draft.content_available && draft.status === "needs_review" && draft.starts_at && draft.time_zone) legacyDraft = { id: draft.id, day: dateInZone(draft.starts_at, draft.time_zone), zone: draft.time_zone, revision: draft.revision, unavailable: false };
      else legacyDraft = { id: requested.draft, day: "", zone: "UTC", revision: 1, unavailable: true };
    } catch (error) {
      if (isBackendSessionExpiredError(error)) redirect(backendSessionRecoveryHref("/workspace/meetings"));
      legacyDraft = { id: requested.draft, day: "", zone: "UTC", revision: 1, unavailable: true };
    }
  }
  return <TimeWorkspace binding={workspaceSessionsBinding(claims)} people={people} peopleError={peopleError} legacyDraft={legacyDraft} />;
}
