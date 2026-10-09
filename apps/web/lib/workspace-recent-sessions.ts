import { isSessionId, sessionDisplayTitle } from "@/components/session-workbench/session-view";

export type RecentSession = { id: string; title: string; unread: boolean; expiresAt: number };

/** Reject unbound responses and exclude unavailable records before rendering titles. */
export function recentSessionRows(payload: unknown, binding: string, now = Date.now(), limit = 8): RecentSession[] | null {
  if (!payload || typeof payload !== "object" || !("session_version" in payload) || payload.session_version !== binding || !("sessions" in payload) || !Array.isArray(payload.sessions)) return null;
  const rows: RecentSession[] = [];
  for (const row of payload.sessions) {
    if (!row || typeof row !== "object" || !isSessionId(row.session_id) || row.state !== "active" || typeof row.expires_at !== "string" || !(Date.parse(row.expires_at) > now) || typeof row.title !== "string") continue;
    if (rows.some(item => item.id === row.session_id)) continue;
    rows.push({ id: row.session_id, title: sessionDisplayTitle(row.title), unread: row.is_unread === true, expiresAt: Date.parse(row.expires_at) });
    if (rows.length >= Math.max(1, Math.min(200, limit))) break;
  }
  return rows;
}

export function unexpiredRecentSessions(rows: RecentSession[], now = Date.now()): RecentSession[] {
  return rows.filter(row => row.expiresAt > now);
}
