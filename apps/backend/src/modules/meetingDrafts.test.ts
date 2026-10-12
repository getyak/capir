import { describe, expect, it, vi } from "vitest";
import type { ChatResponseBlock } from "@talent-signal/contracts";

import type { DatabaseClient } from "../database/pool.js";
import { listMeetingDrafts, recordMeetingDraftsForTask } from "./meetingDrafts.js";
import { sweepMeetingDraftRetention } from "./meetingDraftRoutes.js";

const auth = {
  accountId: "10000000-0000-4000-8000-000000000001",
  accountSlug: "workspace",
  userId: "20000000-0000-4000-8000-000000000002",
  userEmail: "owner@example.test",
  sessionId: "30000000-0000-4000-8000-000000000003",
  userKind: "password_human" as const,
};
const sessionID = "40000000-0000-4000-8000-000000000004";
const taskID = "50000000-0000-4000-8000-000000000005";
const calendarBlock = (sourceRequestID = taskID): ChatResponseBlock => ({
  id: "60000000-0000-4000-8000-000000000006",
  kind: "action_proposal",
  title: "会议草稿",
  body: "请核对时间。",
  status: "needs_review",
  citation_dependency_ids: [],
  requires_user_decision: true,
  calendar_draft: {
    id: "70000000-0000-4000-8000-000000000007",
    title: "与陈夏会谈",
    starts_at: "2026-09-17T01:30:00.000Z",
    ends_at: "2026-09-17T02:00:00.000Z",
    time_zone: "Asia/Shanghai",
    source_request_id: sourceRequestID,
    source_excerpt: "周四上午九点半可以。",
    reference_time: "2026-09-16T00:00:00.000Z",
    status: "needs_review",
    external_effect: "none",
  },
});

describe("meeting draft task binding", () => {
  it("keeps Lab accounts out and isolates an ordinary account sweep failure", async () => {
    const first = "90000000-0000-4000-8000-000000000009";
    const second = "a0000000-0000-4000-8000-00000000000a";
    const accountFailure = new Error("isolated database failure");
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ account_id: first }, { account_id: second }] })
      .mockRejectedValueOnce(accountFailure)
      .mockResolvedValueOnce({ rows: [] });
    const warn = vi.fn();
    await sweepMeetingDraftRetention(
      { log: { warn } } as never,
      { query } as never,
    );
    expect(query).toHaveBeenNthCalledWith(
      1,
      "DELETE FROM meeting_draft_list_snapshots WHERE expires_at<=statement_timestamp()",
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("w.target_account_id=d.account_id"),
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      "SELECT redact_unavailable_meeting_drafts($1)",
      [first],
    );
    expect(query).toHaveBeenNthCalledWith(
      4,
      "SELECT redact_unavailable_meeting_drafts($1)",
      [second],
    );
    expect(warn).toHaveBeenCalledWith(
      { err: accountFailure },
      "meeting draft retention sweep skipped one account",
    );
  });

  it("continues sensitive redaction when ephemeral snapshot cleanup fails", async () => {
    const accountID = "90000000-0000-4000-8000-000000000009";
    const snapshotFailure = new Error("snapshot lock");
    const query = vi
      .fn()
      .mockRejectedValueOnce(snapshotFailure)
      .mockResolvedValueOnce({ rows: [{ account_id: accountID }] })
      .mockResolvedValueOnce({ rows: [] });
    const warn = vi.fn();

    await sweepMeetingDraftRetention(
      { log: { warn } } as never,
      { query } as never,
    );

    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("w.target_account_id=d.account_id"),
    );
    expect(query).toHaveBeenNthCalledWith(
      3,
      "SELECT redact_unavailable_meeting_drafts($1)",
      [accountID],
    );
    expect(warn).toHaveBeenCalledWith(
      { err: snapshotFailure },
      "meeting draft list snapshot cleanup skipped",
    );
  });
  it("records only after the exact user Session task authority is present", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{
          expires_at: new Date("2026-09-30T00:00:00.000Z"),
          session_expires_at: new Date("2026-10-01T00:00:00.000Z"),
        }],
      })
      .mockResolvedValueOnce({ rows: [{}] });
    await recordMeetingDraftsForTask({ query } as unknown as DatabaseClient, auth, {
      blocks: [calendarBlock()],
      messageID: "80000000-0000-4000-8000-000000000008",
      sessionID,
      taskID,
    });
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("t.actor_user_id=$2"),
      [auth.accountId, auth.userId, taskID, sessionID],
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("record_meeting_draft"),
      expect.arrayContaining([
        auth.accountId,
        "70000000-0000-4000-8000-000000000007",
        auth.userId,
        taskID,
        sessionID,
      ]),
    );
  });

  it("rejects a calendar draft whose source request is another task", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        expires_at: new Date("2026-09-30T00:00:00.000Z"),
        session_expires_at: new Date("2026-10-01T00:00:00.000Z"),
      }],
    });
    await expect(
      recordMeetingDraftsForTask({ query } as unknown as DatabaseClient, auth, {
        blocks: [calendarBlock("90000000-0000-4000-8000-000000000009")],
        sessionID,
        taskID,
      }),
    ).rejects.toMatchObject({ code: "MEETING_DRAFT_SOURCE_MISMATCH", statusCode: 409 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("does nothing when a response contains no calendar proposal", async () => {
    const query = vi.fn();
    const { calendar_draft: _calendarDraft, ...plainBlock } = calendarBlock();
    await recordMeetingDraftsForTask({ query } as unknown as DatabaseClient, auth, {
      blocks: [plainBlock],
      sessionID,
      taskID,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    ["blank excerpt", { source_excerpt: "   " }],
    ["invalid timezone", { time_zone: "Mars/Olympus" }],
    ["invalid start", { starts_at: "not-a-date" }],
    ["invalid end", { ends_at: "not-a-date" }],
    ["invalid reference", { reference_time: "not-a-date" }],
    ["interval beyond seven days", {
      ends_at: "2026-09-25T02:00:00.000Z",
    }],
  ])("rejects %s before persistence", async (_name, override) => {
    const block = calendarBlock();
    Object.assign(block.calendar_draft!, override);
    const query = vi.fn().mockResolvedValue({
      rows: [{
        expires_at: new Date("2026-09-30T00:00:00.000Z"),
        session_expires_at: new Date("2026-10-01T00:00:00.000Z"),
      }],
    });
    await expect(
      recordMeetingDraftsForTask({ query } as unknown as DatabaseClient, auth, {
        blocks: [block],
        sessionID,
        taskID,
      }),
    ).rejects.toMatchObject({ code: "MEETING_DRAFT_SOURCE_MISMATCH" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("rejects non-canonical and PostgreSQL-overflow cursor microseconds", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const cursor = Buffer.from(JSON.stringify({
      v: 3,
      scope: "all",
      snapshot_id: "70000000-0000-4000-8000-000000000007",
      before_us: "9223372036854775808",
      before_id: "60000000-0000-4000-8000-000000000006",
    })).toString("base64url");
    await expect(
      listMeetingDrafts(
        { query } as unknown as DatabaseClient,
        auth,
        cursor,
      ),
    ).rejects.toMatchObject({ code: "MEETING_DRAFT_CURSOR_INVALID" });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("bounds snapshot materialization before returning a cursor", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 5_001, rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      listMeetingDrafts({ query } as unknown as DatabaseClient, auth),
    ).rejects.toMatchObject({
      code: "MEETING_DRAFT_LIST_TOO_LARGE",
      statusCode: 413,
    });
    expect(query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("LIMIT $5"),
      [auth.accountId, auth.userId, expect.any(String), "all", 5_001],
    );
    expect(query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining("DELETE FROM meeting_draft_list_snapshots"),
      [auth.accountId, auth.userId, expect.any(String)],
    );
  });
});
