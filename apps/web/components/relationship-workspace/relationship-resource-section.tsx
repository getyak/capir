import type { ResourceCaptureResponse } from "@talent-signal/contracts";

import { RelationshipResourceComposer } from "./relationship-resource-composer";

export function RelationshipResourceSection({
  open,
  onCommitted,
  onEvidenceChanged,
  onIdentityCorrected,
  onReviewCapture,
  onScreenshot,
  personId,
  relationshipContextId,
  scopeLabel,
  sessionBinding = null,
}: {
  open: boolean;
  onCommitted: (receipts: ResourceCaptureResponse[]) => void;
  onEvidenceChanged: (
    announcement?: string,
    relationshipRemoved?: boolean,
  ) => void | Promise<void>;
  onIdentityCorrected: (input: {
    captureId: string;
    captureIdsRebound: number;
    personId: string;
    relationshipContextId: string;
  }) => Promise<"opened" | "session_expired" | "unavailable">;
  onReviewCapture: (captureId: string) => void | Promise<void>;
  onScreenshot: () => void;
  personId: string;
  relationshipContextId: string;
  scopeLabel: string;
  sessionBinding?: string | null;
}) {
  if (!open) {
    return null;
  }

  return (
    <RelationshipResourceComposer
      onCommitted={onCommitted}
      onEvidenceChanged={onEvidenceChanged}
      onIdentityCorrected={onIdentityCorrected}
      onReviewCapture={onReviewCapture}
      onScreenshot={onScreenshot}
      personId={personId}
      relationshipContextId={relationshipContextId}
      scopeLabel={scopeLabel}
      sessionBinding={sessionBinding}
    />
  );
}
