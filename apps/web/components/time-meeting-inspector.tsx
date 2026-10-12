"use client";
import { useEffect, useState } from "react";
import { MeetingDraftRecordSchema, type MeetingDraftRecord } from "@talent-signal/contracts";
import { meetingDraftCalendarValue, meetingDraftExpiryLabel } from "@/lib/meeting-calendar";
import { matchesTypeBox } from "@/lib/typebox-validation";
import { timeRequest } from "@/lib/time-workspace-client";
import { CalendarDraftReview } from "./calendar-draft-review";
import { MeetingDraftDismiss } from "./meeting-draft-actions";
import styles from "./time-workspace.module.css";
export function TimeMeetingInspector({ id, revision, binding, returnHref, refreshKey }: { id: string; revision: number; binding: string; returnHref: string; refreshKey: number }) {
  const [result, setResult] = useState<{ key: string; draft?: MeetingDraftRecord; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const key = `${id}:${revision}:${binding}:${refreshKey}:${retry}`;
  useEffect(() => {
    const controller = new AbortController();
    timeRequest(`/api/meeting-drafts/${id}`, binding, { method: "POST", body: JSON.stringify({ expected_revision: revision }), signal: controller.signal }).then((payload) => {
      if (!matchesTypeBox(MeetingDraftRecordSchema, payload.draft)) throw new Error("会议草稿暂时无法读取。");
      // Client admission: the response must be the exact requested draft at the
      // revision bound to this request. A schema-valid mismatched record is a
      // read failure, never rendered or bound to another draft's persistence.
      if (payload.draft.id !== id || payload.draft.revision !== revision) throw new Error("会议草稿暂时无法读取。");
      if (!controller.signal.aborted) setResult({ key, draft: payload.draft });
    }).catch((error: unknown) => { if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : "读取失败。" }); });
    return () => controller.abort();
  }, [key, id, revision, binding]);
  if (result?.key !== key) return <p role="status">正在核对草稿来源…</p>;
  if (result.error || !result.draft) return <div role="alert" className={styles.notice}><p>{result.error}</p><button type="button" onClick={() => setRetry((v) => v + 1)}>重新读取</button></div>;
  const draft = result.draft, calendar = meetingDraftCalendarValue(draft);
  return calendar ? <><CalendarDraftReview draft={calendar} persistence={{ draftId: id, expiresAt: draft.expires_at, revision: draft.revision, sessionVersion: binding }} /><MeetingDraftDismiss draftId={id} expiresAt={draft.expires_at} expiresLabel={meetingDraftExpiryLabel(draft)} revision={draft.revision} returnHref={returnHref} sessionVersion={binding} /></> : <p>草稿来源不再可用。</p>;
}
