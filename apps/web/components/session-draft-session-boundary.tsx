"use client";

import { clearAllSessionOrganization } from "@/lib/workspace-session-organization";
import { useEffect } from "react";

import {
  prunePendingSessionDrafts,
} from "./session-workbench/session-draft-pending";

export function SessionDraftSessionBoundary({
  storageScope,
}: {
  storageScope: string | null;
}) {
  useEffect(() => {
    if (storageScope) prunePendingSessionDrafts(storageScope);
    else {
      // Missing credentials may be temporary expiry or a failed read. Keep
      // bounded owner-partitioned text quarantined until verified re-entry.
      // Explicit sign-out clears it in the account form; another verified
      // scope prunes it above. A null scope never permits reading a draft.
      clearAllSessionOrganization();
    }
  }, [storageScope]);
  return null;
}
