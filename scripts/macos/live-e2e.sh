#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_PROJECT="talent-signal-macos-e2e-$$"
BACKEND_PORT="${MACOS_E2E_BACKEND_PORT:-44317}"
POSTGRES_PORT="${MACOS_E2E_POSTGRES_PORT:-55434}"
RESPONSE_LOSS_PROXY_PORT="${MACOS_E2E_RESPONSE_LOSS_PROXY_PORT:-44318}"
LIVE_E2E_ENDPOINTS_FILE="/tmp/talent-signal-macos-live-e2e-endpoints.json"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
ARTIFACT_DIR="${MACOS_E2E_ARTIFACT_DIR:-$REPOSITORY_ROOT/output/evaluation/2026-08-31-macos-relationship-workbench/system/live-e2e-$RUN_ID}"
DERIVED_DATA="$(mktemp -d "${TMPDIR:-/tmp}/talent-signal-macos-live-e2e.XXXXXX")"
RESULT_BUNDLE="$ARTIFACT_DIR/native-live-e2e.xcresult"
RESPONSE_LOSS_PROXY_PID=""

mkdir -p "$ARTIFACT_DIR"

if lsof -nP -iTCP:"$BACKEND_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Loopback port $BACKEND_PORT is already in use; live E2E did not start." >&2
  exit 1
fi
if lsof -nP -iTCP:"$POSTGRES_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Loopback port $POSTGRES_PORT is already in use; live E2E did not start." >&2
  exit 1
fi
if lsof -nP -iTCP:"$RESPONSE_LOSS_PROXY_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Loopback port $RESPONSE_LOSS_PROXY_PORT is already in use; live E2E did not start." >&2
  exit 1
fi

capture_compose_evidence() {
  BACKEND_PORT="$BACKEND_PORT" POSTGRES_PORT="$POSTGRES_PORT" \
    docker compose -p "$COMPOSE_PROJECT" ps --format json \
    > "$ARTIFACT_DIR/compose-services.jsonl" 2>/dev/null || true
  BACKEND_PORT="$BACKEND_PORT" POSTGRES_PORT="$POSTGRES_PORT" \
    docker compose -p "$COMPOSE_PROJECT" logs --no-color api migrate seed \
    2>/dev/null \
    | sed -E 's/(Bearer )[A-Za-z0-9._~-]+/\1[redacted]/g' \
    > "$ARTIFACT_DIR/docker-services.log" || true
  curl -fsS "http://127.0.0.1:$RESPONSE_LOSS_PROXY_PORT/__response_loss_proxy/state" \
    > "$ARTIFACT_DIR/response-loss-proxy-state.json" 2>/dev/null || true
}

terminate_process_tree() {
  local parent_pid="$1"
  local child_pid
  while read -r child_pid; do
    [[ -n "$child_pid" ]] || continue
    terminate_process_tree "$child_pid"
  done < <(pgrep -P "$parent_pid" 2>/dev/null || true)
  kill "$parent_pid" >/dev/null 2>&1 || true
}

cleanup() {
  capture_compose_evidence
  if [[ -n "$RESPONSE_LOSS_PROXY_PID" ]]; then
    terminate_process_tree "$RESPONSE_LOSS_PROXY_PID"
    wait "$RESPONSE_LOSS_PROXY_PID" >/dev/null 2>&1 || true
  fi
  if [[ "${KEEP_MACOS_E2E_SERVICES:-0}" != "1" ]]; then
    BACKEND_PORT="$BACKEND_PORT" POSTGRES_PORT="$POSTGRES_PORT" \
      docker compose -p "$COMPOSE_PROJECT" down --volumes --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -f "$LIVE_E2E_ENDPOINTS_FILE"
  rm -rf "$DERIVED_DATA"
}
trap cleanup EXIT

cd "$REPOSITORY_ROOT"

BACKEND_PORT="$BACKEND_PORT" POSTGRES_PORT="$POSTGRES_PORT" \
  TALENT_SIGNAL_DETERMINISTIC_PROPOSAL_E2E=true \
  docker compose -p "$COMPOSE_PROJECT" up --build --wait

API_BASE_URL="http://127.0.0.1:$BACKEND_PORT" \
  node scripts/macos/seed-live-e2e.mjs \
  | tee "$ARTIFACT_DIR/synthetic-seed.json"

UPSTREAM_BASE_URL="http://127.0.0.1:$BACKEND_PORT" \
RESPONSE_LOSS_PROXY_PORT="$RESPONSE_LOSS_PROXY_PORT" \
RESPONSE_LOSS_PROXY_DROP_RESOURCE_CAPTURE=false \
RESPONSE_LOSS_PROXY_BLOCK_OPERATION_LOOKUPS=4 \
  pnpm --filter @talent-signal/backend fixture:response-loss-proxy \
  > "$ARTIFACT_DIR/response-loss-proxy.log" 2>&1 &
RESPONSE_LOSS_PROXY_PID=$!
for _ in {1..60}; do
  if curl -fsS "http://127.0.0.1:$RESPONSE_LOSS_PROXY_PORT/__response_loss_proxy/state" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
curl -fsS "http://127.0.0.1:$RESPONSE_LOSS_PROXY_PORT/__response_loss_proxy/state" >/dev/null

export TS_MACOS_RESPONSE_LOSS_PROXY_URL="http://127.0.0.1:$RESPONSE_LOSS_PROXY_PORT"
export TS_MACOS_BACKEND_URL="http://127.0.0.1:$BACKEND_PORT"
jq -n \
  --arg backend_url "$TS_MACOS_BACKEND_URL" \
  --arg response_loss_proxy_url "$TS_MACOS_RESPONSE_LOSS_PROXY_URL" \
  '{backend_url: $backend_url, response_loss_proxy_url: $response_loss_proxy_url}' \
  > "$LIVE_E2E_ENDPOINTS_FILE"

./scripts/macos/generate.sh

xcodebuild \
  -quiet \
  -project apps/macos/TalentSignalMac.xcodeproj \
  -scheme TalentSignalMac \
  -destination "platform=macOS" \
  -derivedDataPath "$DERIVED_DATA" \
  -resultBundlePath "$RESULT_BUNDLE" \
  CODE_SIGNING_ALLOWED=NO \
  'OTHER_SWIFT_FLAGS=$(inherited) -DTS_MACOS_LIVE_E2E' \
  -only-testing:TalentSignalMacTests/LiveBackendRelationshipServiceTests \
  test \
  2>&1 | tee "$ARTIFACT_DIR/native-live-e2e.log"

xcrun xcresulttool get test-results summary --path "$RESULT_BUNDLE" \
  > "$ARTIFACT_DIR/native-live-e2e-summary.json"

latest_task_id="$(
  docker exec "$COMPOSE_PROJECT-postgres-1" \
    psql -U talent_signal_local -d talent_signal_local -Atc \
    "select id from agent_tasks order by created_at desc limit 1;"
)"
login_json="$(
  curl -fsS -X POST "http://127.0.0.1:$BACKEND_PORT/v1/auth/simulated-login" \
    -H 'content-type: application/json' \
    --data '{"account_slug":"fixture-alpha","user_email":"recruiter@alpha.local","client_label":"macos-live-e2e-readback"}'
)"
access_token="$(jq -r '.access_token' <<<"$login_json")"
curl -fsS "http://127.0.0.1:$BACKEND_PORT/v1/agent-tasks/$latest_task_id" \
  -H "authorization: Bearer $access_token" \
  | jq '{
      contract_version,
      task: (.task | {
        id, workspace_id, pursuit_id, status, task_revision,
        semantic_snapshot, latest_run, latest_sequence, external_effects
      })
    }' \
  > "$ARTIFACT_DIR/canonical-task-readback.json"

docker exec "$COMPOSE_PROJECT-postgres-1" \
  psql -U talent_signal_local -d talent_signal_local -Atc \
  "select jsonb_build_object(
      'id', id,
      'operation_id', operation_id,
      'operation_kind', operation_kind,
      'status', status,
      'proposal_id', proposal_id,
      'outcome', outcome,
      'entity_ref', jsonb_build_object(
        'type', 'pursuit',
        'id', pursuit_id,
        'before_revision', before_revision,
        'after_revision', after_revision
      ),
      'changed_fields', changed_fields,
      'external_effects', external_effects,
      'summary', summary,
      'occurred_at', occurred_at
    ) from pursuit_receipts
    where operation_kind = 'review_pursuit_proposal'
    order by occurred_at desc limit 1;" \
  | jq '.' > "$ARTIFACT_DIR/canonical-pursuit-receipt.json"

docker exec "$COMPOSE_PROJECT-postgres-1" \
  psql -U talent_signal_local -d talent_signal_local -Atc \
  "with revoked as (
      select * from source_authorization_decisions
      where decision = 'revoke'
      order by decided_at desc limit 1
    )
    select jsonb_build_object(
      'root_capture_id', revoked.root_capture_id,
      'decision', revoked.decision,
      'authorization_state', revoked.authorization_state,
      'capture_version', revoked.capture_version,
      'decided_at', revoked.decided_at,
      'proposal_statuses', coalesce((
        select jsonb_agg(jsonb_build_object('id', proposals.id, 'status', proposals.status))
        from pursuit_proposals proposals
        where proposals.capture_id = revoked.root_capture_id
      ), '[]'::jsonb),
      'decision_bundle_statuses', coalesce((
        select jsonb_agg(jsonb_build_object('id', bundles.id, 'status', bundles.status))
        from agent_decision_bundles bundles
        join pursuit_proposals proposals on proposals.id = bundles.proposal_id
        where proposals.capture_id = revoked.root_capture_id
      ), '[]'::jsonb),
      'proposal_receipt_count', (
        select count(*)
        from pursuit_receipts receipts
        join pursuit_proposals proposals on proposals.id = receipts.proposal_id
        where proposals.capture_id = revoked.root_capture_id
      )
    ) from revoked;" \
  | jq '.' > "$ARTIFACT_DIR/revoked-evidence-readback.json"

proposal_task_id="$(
  docker exec "$COMPOSE_PROJECT-postgres-1" \
    psql -U talent_signal_local -d talent_signal_local -Atc \
    "select bundles.task_id
     from agent_decision_bundles bundles
     join pursuit_receipts receipts
       on receipts.account_id = bundles.account_id
      and receipts.proposal_id = bundles.proposal_id
     where receipts.operation_kind = 'review_pursuit_proposal'
     order by receipts.occurred_at desc limit 1;"
)"
curl -fsS "http://127.0.0.1:$BACKEND_PORT/v1/agent-tasks/$proposal_task_id" \
  -H "authorization: Bearer $access_token" \
  | jq '{
      contract_version,
      task: (.task | {
        id, workspace_id, pursuit_id, status, task_revision,
        semantic_snapshot, latest_run, decision_bundle,
        latest_sequence, external_effects
      })
    }' \
  > "$ARTIFACT_DIR/canonical-proposal-task-readback.json"

capture_compose_evidence
echo "Native live E2E passed. Evidence: $ARTIFACT_DIR"
