import {purgeUnavailableRunArtifacts} from "./harnessRunFiles.js";
import type { Pool } from "pg";

import {
  runPendingSourceAuthorizationCompilationJobs,
  sweepDueSourceAuthorizations,
  type SourceAuthorizationCompilationWorkerResult,
} from "./sourceAuthorization.js";
import {
  runPendingPublicResearchJobs,
  type ResearchRetrievalWorkerResult,
} from "./research.js";
import {
  runDuePersonSourceSyncs,
  type PersonSourceSyncSweepResult,
} from "./personSourceSync.js";
import { sweepDueIdentityHandles } from "./identityHandles.js";
import { sweepDueSourceRetention } from "./sourceRetention.js";

export interface SourceLifecycleSweepResult {
  raw_sources_purged: number;
  authorizations_expired: number;
  identity_handles_expired: number;
  compilation_jobs: SourceAuthorizationCompilationWorkerResult;
  research_jobs: ResearchRetrievalWorkerResult;
  person_source_syncs: PersonSourceSyncSweepResult;
}

const activeSweeps = new WeakMap<
  Pool,
  Promise<SourceLifecycleSweepResult>
>();

async function executeSourceLifecycleSweep(
  pool: Pool,
  now: Date,
): Promise<SourceLifecycleSweepResult> {
  const rawSourcesPurged = await sweepDueSourceRetention(pool, now);
  const expirations = await sweepDueSourceAuthorizations(pool, now);
  const expiredIdentityHandles =
    await sweepDueIdentityHandles(pool, now);
  const compilationJobs =
    await runPendingSourceAuthorizationCompilationJobs(pool, {
      now,
    });
  const researchJobs = await runPendingPublicResearchJobs(pool, {
    now,
  });
  // Recurring one-person public source cycles run after source-authorization
  // expiry so an expired or revoked source stops before any dispatch.
  const personSourceSyncs = await runDuePersonSourceSyncs(pool, { now });
  await purgeUnavailableRunArtifacts(pool);
  return {
    raw_sources_purged: rawSourcesPurged,
    authorizations_expired: expirations.length,
    identity_handles_expired: expiredIdentityHandles.length,
    compilation_jobs: compilationJobs,
    research_jobs: researchJobs,
    person_source_syncs: personSourceSyncs,
  };
}

export function runSourceLifecycleSweep(
  pool: Pool,
  now = new Date(),
): Promise<SourceLifecycleSweepResult> {
  const activeSweep = activeSweeps.get(pool);
  if (activeSweep) {
    return activeSweep;
  }

  let guardedSweep: Promise<SourceLifecycleSweepResult>;
  guardedSweep = executeSourceLifecycleSweep(pool, now).finally(() => {
    if (activeSweeps.get(pool) === guardedSweep) {
      activeSweeps.delete(pool);
    }
  });
  activeSweeps.set(pool, guardedSweep);
  return guardedSweep;
}
