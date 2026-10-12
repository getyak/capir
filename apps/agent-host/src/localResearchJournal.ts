import {
  isLocalRecordCounter,
  isLocalRecordEnum,
  isLocalRecordFingerprint,
  isLocalRecordObject,
  isLocalRecordTimestamp,
  readPersistedJsonlLines,
  readPersistedJsonRecord,
  type LocalRecordParser,
} from "./localResearchFiles.js";

/**
 * Narrow local journal integrity validation shared by the actual public and
 * person research stores.
 *
 * The producers write each event only after its checkpoint write and publish a
 * terminal receipt only before the matching terminal event append, so an
 * interrupted publication can leave a checkpoint or receipt that claims a
 * journal record which was never appended. This module reads the append-only
 * journal with the accepted private-file guarantees and derives the evidence a
 * recovery decision needs: complete JSONL records, the exact Run ID, a safe
 * contiguous sequence from 1, one supported event kind per record with its
 * essential shape, and at most one final terminal event. Cross-record
 * agreement is then checked against the checkpoint and terminal receipt.
 *
 * Every failure is one fixed content-free error: persisted record content is
 * never promoted into errors or logs, and no missing history is synthesized.
 */

const LOCAL_JOURNAL_EVENT_KINDS = [
  "tool_call",
  "provider_result",
  "terminal",
] as const;

export type LocalResearchJournalEventKind =
  (typeof LOCAL_JOURNAL_EVENT_KINDS)[number];

/** Fixed content-free message for any structural journal record failure. */
export const LOCAL_JOURNAL_CORRUPT_MESSAGE =
  "The persisted local research journal record is corrupt.";

/**
 * Fixed content-free message when the checkpoint claims journal positions the
 * journal does not contain on nonterminal recovery.
 */
export const LOCAL_JOURNAL_CHECKPOINT_MISMATCH_MESSAGE =
  "The persisted local research journal does not match its checkpoint.";

/**
 * Fixed content-free message when the terminal receipt and the journal's
 * terminal evidence are missing or disagree. Such a receipt is never replayed
 * as success and such a journal is never resumed.
 */
export const LOCAL_TERMINAL_EVIDENCE_MISMATCH_MESSAGE =
  "The persisted local terminal evidence does not match its journal.";

/**
 * Fixed content-free message when recorded Run evidence (any checkpoint,
 * journal record, or terminal receipt) has no immutable Run record. The
 * evidence is never reattached to a new request's metadata and never inferred
 * from checkpoint data.
 */
export const LOCAL_RUN_EVIDENCE_ORPHANED_MESSAGE =
  "The persisted local Run evidence has no immutable Run record.";

export interface LocalResearchJournalTerminalHead {
  sequence: number;
  status: string;
  outputFingerprint: string;
}

export interface LocalResearchJournalReading {
  /** Highest contiguous journal sequence; 0 for an absent or empty journal. */
  lastSequence: number;
  /** The journal's one terminal event when the journal is complete. */
  terminal: LocalResearchJournalTerminalHead | null;
}

interface LocalResearchJournalRecordHead {
  sequence: number;
  kind: LocalResearchJournalEventKind;
  status: string;
  outputFingerprint: string | null;
}

function journalCorrupt(): Error {
  return new Error(LOCAL_JOURNAL_CORRUPT_MESSAGE);
}

function parseJournalRecord(
  runID: string,
  value: unknown,
): LocalResearchJournalRecordHead {
  // Essential shape only: metadata and optional evidence fields keep their
  // established contents (including nil/max evidence UUIDs) and are never
  // inspected here.
  if (
    !isLocalRecordObject(value) ||
    value.runID !== runID ||
    !isLocalRecordCounter(value.sequence) ||
    !isLocalRecordEnum(value.kind, LOCAL_JOURNAL_EVENT_KINDS) ||
    !isLocalRecordTimestamp(value.occurredAt) ||
    typeof value.status !== "string" ||
    value.status.length < 1 ||
    !isLocalRecordObject(value.metadata)
  ) {
    throw journalCorrupt();
  }
  const kind = value.kind;
  const toolName = value.toolName;
  const outputFingerprint = value.outputFingerprint;
  if (kind === "tool_call" && (typeof toolName !== "string" || toolName.length < 1)) {
    throw journalCorrupt();
  }
  let terminalFingerprint: string | null = null;
  if (kind === "terminal") {
    if (!isLocalRecordFingerprint(outputFingerprint)) throw journalCorrupt();
    terminalFingerprint = outputFingerprint;
  }
  return {
    sequence: value.sequence,
    kind,
    status: value.status,
    outputFingerprint: terminalFingerprint,
  };
}

/**
 * Reads and structurally validates one Run's append-only journal. Each line
 * must be one complete JSON record for the exact Run with a safe contiguous
 * sequence from 1 and one supported event kind in essential shape. A journal
 * may contain at most one terminal event, which must be the final record.
 * Malformed, torn, gapped, duplicated, foreign-Run, or unsupported records
 * raise a fixed content-free error.
 */
export async function readLocalResearchJournal(
  runID: string,
  path: string,
): Promise<LocalResearchJournalReading> {
  const lines = await readPersistedJsonlLines(path);
  let lastSequence = 0;
  let terminal: LocalResearchJournalTerminalHead | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[index] ?? "");
    } catch {
      throw journalCorrupt();
    }
    const head = parseJournalRecord(runID, parsed);
    if (head.sequence !== index + 1) throw journalCorrupt();
    lastSequence = head.sequence;
    if (head.kind === "terminal") {
      // Duplicate or nonfinal terminal evidence is corrupt, never a success.
      if (terminal !== null || index !== lines.length - 1) throw journalCorrupt();
      terminal = {
        sequence: head.sequence,
        status: head.status,
        outputFingerprint: head.outputFingerprint ?? "",
      };
    }
  }
  return { lastSequence, terminal };
}

export interface LocalResearchJournalAgreement {
  journal: LocalResearchJournalReading;
  /**
   * The persisted checkpoint's journal position, or `null` when the recovery
   * must not consult the checkpoint (complete terminal evidence).
   */
  checkpointSequence: number | null;
  /**
   * The persisted terminal receipt's status and fingerprint, or `null` when no
   * terminal receipt exists.
   */
  receipt: { status: string; outputFingerprint: string } | null;
}

/**
 * Cross-checks journal evidence against the checkpoint and terminal receipt.
 *
 * Terminal recovery: the receipt must have its matching final terminal event
 * with the same status and receipt fingerprint; the checkpoint offset is not
 * constrained because the two producers legitimately publish terminal
 * checkpoints at different offsets. Nonterminal recovery: a terminal event
 * without its receipt is dangling evidence, and the checkpoint position must
 * equal the journal's last sequence so no claimed event is absent and no
 * journal position can be reused.
 */
export function validateLocalResearchJournalAgreement(
  agreement: LocalResearchJournalAgreement,
): void {
  const { journal, checkpointSequence, receipt } = agreement;
  if (receipt !== null) {
    const terminal = journal.terminal;
    if (
      terminal === null ||
      terminal.status !== receipt.status ||
      terminal.outputFingerprint !== receipt.outputFingerprint
    ) {
      throw new Error(LOCAL_TERMINAL_EVIDENCE_MISMATCH_MESSAGE);
    }
    return;
  }
  if (journal.terminal !== null) {
    throw new Error(LOCAL_TERMINAL_EVIDENCE_MISMATCH_MESSAGE);
  }
  if ((checkpointSequence ?? 0) !== journal.lastSequence) {
    throw new Error(LOCAL_JOURNAL_CHECKPOINT_MISMATCH_MESSAGE);
  }
}

export interface LocalRunMetadataEvidencePaths {
  runID: string;
  runRecordPath: string;
  checkpointPath: string;
  journalPath: string;
  terminalPath: string;
  parseRunRecord: LocalRecordParser<unknown>;
}

/**
 * Enforces that any recorded Run evidence keeps its original immutable Run
 * record. An existing checkpoint (including a reservation checkpoint at
 * sequence 0), a nonempty journal, or a terminal receipt may never be
 * attached to new run metadata: when the Run record is absent while such
 * evidence exists, recovery fails with the fixed
 * {@link LOCAL_RUN_EVIDENCE_ORPHANED_MESSAGE} before any model, provider, or
 * gateway work, and nothing publishes replacement metadata. Fresh state with
 * no recorded evidence stays creatable, and recorded evidence with its Run
 * record is untouched. Evidence inspection and the Run-record lookup use only
 * the accepted secure readers; the lookup is repeated after inspection so a
 * concurrent first writer's freshly published real metadata record is never
 * misclassified as orphaned.
 */
export async function requireLocalRunMetadataForEvidence(
  paths: LocalRunMetadataEvidencePaths,
): Promise<void> {
  const readRunRecord = () =>
    readPersistedJsonRecord(paths.runRecordPath, paths.parseRunRecord);
  if ((await readRunRecord()) !== null) return;
  const checkpoint = await readPersistedJsonRecord(
    paths.checkpointPath,
    (value) => value,
  );
  const journal = await readLocalResearchJournal(paths.runID, paths.journalPath);
  const terminal = await readPersistedJsonRecord(paths.terminalPath, (value) => value);
  if (checkpoint === null && journal.lastSequence === 0 && terminal === null) {
    // Fresh state: no recorded evidence requires Run metadata.
    return;
  }
  if ((await readRunRecord()) !== null) return;
  throw new Error(LOCAL_RUN_EVIDENCE_ORPHANED_MESSAGE);
}
