"use client";

import { clearAllSessionOrganization } from "@/lib/workspace-session-organization";
import { useEffect } from "react";

import {
  clearAllPendingSessionDrafts,
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
      clearAllPendingSessionDrafts();
      clearAllSessionOrganization();
    }
  }, [storageScope]);
  return null;
}
