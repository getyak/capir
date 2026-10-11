import type { ChildProcess } from "node:child_process";

export type ResearchWorkerJob =
  | {
      kind: "store-start";
      store: "public" | "person";
      stateRoot: string;
      record: unknown;
    }
  | {
      kind: "store-complete";
      store: "public" | "person";
      stateRoot: string;
      receipt: unknown;
    }
  | {
      kind: "store-commit-artifact";
      store: "public" | "person";
      stateRoot: string;
      scope: unknown;
      candidate: unknown;
      candidateFingerprint: string;
    }
  | {
      kind: "store-commit-no-action";
      store: "public" | "person";
      stateRoot: string;
      scope: unknown;
      candidate: unknown;
      candidateFingerprint: string;
    }
  | {
      kind: "hold-admission";
      runDirectory: string;
      runID: string;
      holdUntil: "release" | "kill";
    }
  | {
      kind: "read-record";
      path: string;
    }
  | {
      kind: "research-command";
      stateRoot: string;
      runID: string;
      holdProvider: boolean;
    }
  | {
      kind: "person-command";
      stateRoot: string;
      runID: string;
      holdProvider: boolean;
    };

export interface ResearchWorkerEvent {
  event: string;
  [key: string]: unknown;
}

export interface ResearchWorkerCommit {
  artifactID?: string;
  noActionID?: string;
  status?: "draft";
  replayed: boolean;
  createdAt: string;
}

export interface ResearchWorkerResult extends ResearchWorkerEvent {
  ok: boolean;
  error?: string;
  errorName?: string;
  receipt?: unknown;
  committed?: ResearchWorkerCommit;
  status?: string;
  replayedTerminal?: boolean;
  artifactFile?: string | null;
  present?: boolean;
}

export interface ResearchWorkerHandle {
  readonly child: ChildProcess;
  /** Every event received so far, in order (never consumed). */
  readonly log: ResearchWorkerEvent[];
  readonly result: Promise<ResearchWorkerResult>;
  send(commandName: string): void;
  waitFor(name: string, timeoutMs?: number): Promise<ResearchWorkerEvent>;
  kill(signal?: NodeJS.Signals): void;
  /** Kills only this handle's child and settles its pending waiters/result. */
  cleanup(): Promise<void>;
}

export function ensureFreshHostBuild(): Promise<string>;
export function spawnResearchWorker(job: ResearchWorkerJob): ResearchWorkerHandle;
/** Terminates and settles every worker spawned by this module instance. */
export function cleanupResearchWorkers(): Promise<void>;
