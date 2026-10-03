/** Read-only projection. No raw evidence, pending proposals or credentials. */
export type PersonContextPreview = {
  session_version: string;
  person: {
    id: string;
    label: string;
    headline: string | null;
    avatarUrl: string | null;
    contexts: { id: string; label: string }[];
  };
  memory: {
    id: string;
    scope: "person" | "relationship";
    text: string;
    kind: string;
    timeStatus: string;
    speaker: string | null;
    observedAt: string | null;
    evidenceRetained: boolean;
  }[];
  history: { id: string; title: string; updatedAt: string }[];
  historyUnavailable: boolean;
};
