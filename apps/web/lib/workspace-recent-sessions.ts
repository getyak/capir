import { isSessionId, sessionDisplayTitle } from "@/components/session-workbench/session-view";

export type RecentSession = {
  id: string;
  title: string;
  unread: boolean;
  expiresAt: number;
  /** Real person identity behind the row, when the Session has one. */
  personId: string | null;
  personLabel: string;
};

/** Reject unbound responses and exclude unavailable records before rendering titles. */
export function recentSessionRows(payload: unknown, binding: string, now = Date.now()): RecentSession[] | null {
  if (!payload || typeof payload !== "object" || !("session_version" in payload) || payload.session_version !== binding || !("sessions" in payload) || !Array.isArray(payload.sessions)) return null;
  const rows: RecentSession[] = [];
  for (const row of payload.sessions) {
    if (!row || typeof row !== "object" || !isSessionId(row.session_id) || row.state !== "active" || typeof row.expires_at !== "string" || !(Date.parse(row.expires_at) > now) || typeof row.title !== "string") continue;
    if (rows.some(item => item.id === row.session_id)) continue;
    rows.push({
      id: row.session_id,
      title: sessionDisplayTitle(row.title),
      unread: row.is_unread === true,
      expiresAt: Date.parse(row.expires_at),
      personId: typeof row.person_id === "string" && row.person_id ? row.person_id : null,
      personLabel: typeof row.person_label === "string" ? row.person_label : "",
    });
    if (rows.length === 8) break;
  }
  return rows;
}

export function unexpiredRecentSessions(rows: RecentSession[], now = Date.now()): RecentSession[] {
  return rows.filter(row => row.expiresAt > now);
}
