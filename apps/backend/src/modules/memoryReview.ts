/**
 * GET-40 three-scope Memory review barrel. The domain is split into small
 * modules: policy (pure rules), store (row/provenance access), stage (bounded
 * proposal), read (purpose-bound review), commit (atomic receipt/undo), and
 * recall (authorization-first reads + lifecycle propagation).
 */
export {
  MEMORY_PROPOSAL_TTL_MS,
  MEMORY_REVIEW_SCOPE_TTL_MS,
  allowedScopeForSurface,
  checkMemoryDependence,
  classifyMemoryAdmission,
  classifyTemporalRelation,
  contactReclaimIsSafe,
  decisionWritesNewItem,
  defaultSelectionForChange,
  describesProhibitedPersonInference,
  editedTextIsUserAugmented,
  evidenceIsAvailable,
  isExactDuplicate,
  isIndependentlyUnderstandable,
  normalizeMemoryText,
  surfaceAllowsScope,
  undoIsCompensable,
  validateMemorySelection,
  type AdmissionContext,
  type AdmissionResult,
  type MemoryAllowedScope,
  type MemoryDependence,
  type SelectionCandidate,
  type SelectionValidation,
} from "./memoryReviewPolicy.js";
export {
  currentStableHandleOwner,
  emptySourceAuthority,
  deriveContactStatus,
  resolveIdentityBinding,
  resolveSessionSourceAuthority,
  type IdentityBinding,
  type IdentityBindingInput,
  type MemoryAdmittedArtifact,
  type MemorySourceAuthority,
} from "./memoryReviewStore.js";
export {
  proposalRecord,
  rebaseMemoryProposal,
  regenerateMemoryProposal,
  stageMemoryProposal,
  type MemoryProposalRegenerator,
  type MemoryRegenerationImage,
  type MemoryRegenerationImageLoader,
  type MemoryRegenerationInput,
  type RebaseRequest,
  type RebaseResult,
  type StagedProposal,
} from "./memoryReviewStage.js";
export {
  assertReviewCredential,
  dismissMemoryReview,
  filterUnavailableProposalItems,
  hashReviewCredential,
  listMemoryProposals,
  mintReviewCredential,
  openMemoryReview,
  readMemoryReview,
  saveMemoryReviewDraft,
  visibleItems,
  visibleReviewItems,
} from "./memoryReviewRead.js";
export {
  commitMemoryReview,
  decideMemoryReviewItem,
  decideMemoryContactOnly,
  mutateMemoryItem,
  readMemoryItem,
  readMemoryOperation,
  receiptSourceAvailable,
  undoMemoryCommit,
  type MemoryCommitResult,
} from "./memoryReviewCommit.js";
export {
  invalidateMemoriesForArtifactIds,
  invalidateMemoriesForCaptureIds,
  invalidateMemoriesForSessionIds,
  recallMemories,
  sweepExpiredMemoryProposals,
  type MemoryRecallRequest,
} from "./memoryReviewRecall.js";
export { resolveMemoryPursuitScopes } from "./memoryPursuitScopes.js";
export {
  readMemoryScopedOperationView,
  undoMemoryScopedOperation,
  type ScopedOperationQuery,
} from "./memoryReviewOperationView.js";
