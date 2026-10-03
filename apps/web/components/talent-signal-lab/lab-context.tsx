"use client";

import type { LabComparison, LabEvalCase, LabManifestResponse, LabRun, LabSession, RealityReceipt } from "@talent-signal/contracts";
import { createContext, useContext } from "react";

export type LabContextValue = {
  comparison: LabComparison | null;
  error: string | null;
  evalCase: LabEvalCase | null;
  manifest: LabManifestResponse | null;
  pending: string | null;
  receipt: RealityReceipt | null;
  run: LabRun | null;
  session: LabSession | null;
  compare: () => Promise<void>;
  openLens: () => void;
  openPanel: () => void;
  promote: () => Promise<void>;
  record: () => Promise<void>;
  replay: (variant?: "baseline" | "candidate") => Promise<void>;
  start: (scenarioId: string) => Promise<void>;
};

export const LabContext = createContext<LabContextValue | null>(null);

export function useTalentSignalLab(): LabContextValue {
  const value = useContext(LabContext);
  if (!value) {
    throw new Error("capri Lab must be rendered inside its workspace shell.");
  }
  return value;
}

