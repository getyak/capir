#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
check_project="${BACKEND_CHECK_PROJECT:-talent-signal-backend-check-$$}"
artifact_dir="${BACKEND_CHECK_ARTIFACT_DIR:-$repo_root/output/evaluation/overnight/backend}"
pursuit_domain_artifact_dir="${PURSUIT_DOMAIN_ARTIFACT_DIR:-$repo_root/output/evaluation/2026-08-24-v1-prd-01}"
pursuit_proposal_artifact_dir="${PURSUIT_PROPOSAL_ARTIFACT_DIR:-$repo_root/output/evaluation/2026-08-24-v1-prd-04}"
pursuit_evidence_artifact_dir="${PURSUIT_EVIDENCE_ARTIFACT_DIR:-$repo_root/output/evaluation/2026-08-24-v1-prd-07}"
agent_artifact_dir="${AGENT_CONTROL_PLANE_ARTIFACT_DIR:-$repo_root/output/evaluation/2026-08-24-v1-prd-03}"

mkdir -p \
  "$artifact_dir" \
  "$pursuit_domain_artifact_dir" \
  "$pursuit_proposal_artifact_dir" \
  "$pursuit_evidence_artifact_dir" \
  "$agent_artifact_dir"

free_loopback_port() {
  ruby -rsocket -e '
    server = TCPServer.new("127.0.0.1", 0)
    print server.addr[1]
    server.close
  '
}

export POSTGRES_PORT="${POSTGRES_PORT:-$(free_loopback_port)}"
export BACKEND_PORT="${BACKEND_PORT:-$(free_loopback_port)}"
export PNPM_CONFIG_IGNORE_SCRIPTS=true

capture_service_evidence() {
  docker compose \
    --project-directory "$repo_root" \
    -p "$check_project" \
    ps --format json > "$artifact_dir/compose-services.jsonl" 2>/dev/null || true

  docker compose \
    --project-directory "$repo_root" \
    -p "$check_project" \
    logs --no-color api migrate seed \
    2>/dev/null \
    | sed -E 's/(Bearer )[A-Za-z0-9._~-]+/\1[redacted]/g' \
    > "$artifact_dir/docker-services.log" || true
}

down_check_project() {
  docker compose \
    --project-directory "$repo_root" \
    -p "$check_project" \
    down --volumes --remove-orphans >/dev/null 2>&1 || true
}

finish() {
  capture_service_evidence
  down_check_project
}
trap finish EXIT

down_check_project

(
  cd "$repo_root"
  pnpm install --frozen-lockfile --ignore-scripts
)
"$repo_root/apps/backend/scripts/ci.sh"

docker compose \
  --project-directory "$repo_root" \
  -p "$check_project" \
  up --build --wait

API_BASE_URL="http://127.0.0.1:$BACKEND_PORT" \
DATABASE_URL="postgresql://talent_signal_local:talent_signal_local_only@127.0.0.1:$POSTGRES_PORT/talent_signal_local" \
node "$repo_root/apps/backend/dist/evaluation/runEvidenceReviewAuthorityEvaluation.js" \
  > "$artifact_dir/evidence-review-authority-runtime.json"

API_BASE_URL="http://127.0.0.1:$BACKEND_PORT" \
EVALUATION_ARTIFACT_DIR="$artifact_dir" \
node "$repo_root/apps/backend/dist/evaluation/runEvaluation.js"

API_BASE_URL="http://127.0.0.1:$BACKEND_PORT" \
EVALUATION_ARTIFACT_DIR="$pursuit_domain_artifact_dir" \
node "$repo_root/apps/backend/dist/evaluation/runPursuitDomainEvaluation.js"

API_BASE_URL="http://127.0.0.1:$BACKEND_PORT" \
EVALUATION_ARTIFACT_DIR="$pursuit_proposal_artifact_dir" \
node "$repo_root/apps/backend/dist/evaluation/runPursuitProposalEvaluation.js"

API_BASE_URL="http://127.0.0.1:$BACKEND_PORT" \
DATABASE_URL="postgresql://talent_signal_local:talent_signal_local_only@127.0.0.1:$POSTGRES_PORT/talent_signal_local" \
EVALUATION_ARTIFACT_DIR="$pursuit_evidence_artifact_dir" \
node "$repo_root/apps/backend/dist/evaluation/runPursuitEvidenceIntegrityEvaluation.js"

API_BASE_URL="http://127.0.0.1:$BACKEND_PORT" \
EVALUATION_DATABASE_URL="postgresql://talent_signal_local:talent_signal_local_only@127.0.0.1:$POSTGRES_PORT/talent_signal_local" \
EVALUATION_ARTIFACT_DIR="$agent_artifact_dir" \
node "$repo_root/apps/backend/dist/evaluation/runAgentControlPlaneEvaluation.js"

API_BASE_URL="http://127.0.0.1:$BACKEND_PORT" \
EVALUATION_DATABASE_URL="postgresql://talent_signal_local:talent_signal_local_only@127.0.0.1:$POSTGRES_PORT/talent_signal_local" \
EVALUATION_ARTIFACT_DIR="$agent_artifact_dir" \
node "$repo_root/apps/backend/dist/evaluation/runGovernedAgentTaskEvaluation.js"

capture_service_evidence
