import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("authority schema", () => {
  it("removes only the redundant queue clock check and keeps Session expiry authoritative", async () => {
    const sql = await readFile(new URL("./103_conversation_queue_session_expiry.sql", import.meta.url), "utf8");
    expect(sql).toContain("DROP CONSTRAINT conversation_queue_entries_check");
    expect(sql).not.toMatch(/ALTER TABLE agent_sessions|DROP TABLE|UPDATE /u);
    const manifest = JSON.parse(await readFile(new URL("./migration-manifest.json", import.meta.url), "utf8"));
    expect(manifest.migrations).toContain("103_conversation_queue_session_expiry");
  });
  it("snapshots Session list identity and immutable ordering without duplicating content", async () => {
    const sql = await readFile(
      new URL("./071_agent_session_list_snapshots.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("CREATE INDEX agent_sessions_owner_recency_idx");
    expect(sql).toContain("CREATE TABLE agent_session_list_snapshots");
    expect(sql).toContain("CREATE TABLE agent_session_list_snapshot_items");
    expect(sql).toContain("CREATE INDEX agent_session_list_snapshots_owner_idx");
    expect(sql).toContain("sort_updated_at timestamptz NOT NULL");
    expect(sql).toContain("REFERENCES agent_sessions(account_id,id) ON DELETE CASCADE");
    expect(sql).toContain("('agent_session_list_snapshots','account')");
    expect(sql).not.toContain("payload");
  });

  it("keeps meeting drafts session-bound, non-executing, and redactable", async () => {
    const sql = await readFile(
      new URL("./070_meeting_drafts.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE meeting_drafts");
    expect(sql).toContain("external_effect = 'none'");
    expect(sql).toContain("REFERENCES agent_sessions(account_id,id)");
    expect(sql).toContain("meeting_draft_source_available");
    expect(sql).toContain("redact_unavailable_meeting_drafts");
    expect(sql).toContain("CREATE TABLE meeting_draft_list_snapshots");
    expect(sql).toContain("CREATE TABLE meeting_draft_list_snapshot_items");
    expect(sql).toContain(
      "REFERENCES agent_session_chat_tasks(account_id,task_id,actor_user_id,origin_session_id)",
    );
    expect(sql).toContain(
      "REFERENCES meeting_drafts(account_id,id,created_by_user_id)",
    );
    expect(sql).toContain("status <> 'needs_review' OR dismissed_at IS NULL");
    expect(sql).toContain("DELETE FROM meeting_draft_operations operation");
    expect(sql).toContain("AFTER INSERT ON agent_session_retracted_tasks");
    expect(sql).toContain("ends_at - starts_at <= interval '7 days'");
    expect(sql).toContain("parsed.ends_at - parsed.starts_at <= interval '7 days'");
    expect(sql).not.toContain("CREATE OR REPLACE FUNCTION retract_agent_session_chat_sources");
    expect(sql).not.toContain("CREATE TABLE calendar_events");
    expect(sql).not.toContain("access_token");
  });

  it("keeps Lab sessions, replay, receipts, and promoted cases isolated from product truth", async () => {
    const sql = await readFile(
      new URL("./039_talent_signal_lab.sql", import.meta.url),
      "utf8",
    );
    for (const table of [
      "lab_sessions",
      "lab_runs",
      "lab_comparisons",
      "lab_reality_receipts",
      "lab_eval_cases",
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }
    expect(sql).toContain("canonical_isolation = true");
    expect(sql).toContain("production_data_access = false");
    expect(sql).toContain("canonical_mutation_count = 0");
    expect(sql).toContain("external_effect_count = 0");
    expect(sql).toContain("redaction_applied = true");
    expect(sql).not.toContain("REFERENCES subjects");
    expect(sql).not.toContain("REFERENCES pursuits");
    expect(sql).not.toContain("REFERENCES captures");
    expect(sql).not.toContain("REFERENCES confirmed_states");
    expect(sql).not.toContain("REFERENCES action_proposals");
    expect(sql).not.toContain("REFERENCES effect_attempts");
    expect(sql).not.toContain("candidate_score");
    expect(sql).not.toContain("acceptance_probability");
  });

  it("adds a governed Task lifecycle without duplicating domain or effect authority", async () => {
    const sql = await readFile(
      new URL("./036_governed_agent_tasks.sql", import.meta.url),
      "utf8",
    );
    for (const table of [
      "agent_tasks",
      "agent_task_runs",
      "agent_task_checkpoints",
      "agent_artifacts",
      "agent_artifact_evidence",
      "agent_clarification_requests",
      "agent_decision_bundles",
      "agent_decision_items",
      "agent_task_events",
      "agent_delivery_outbox",
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }
    expect(sql).toContain("UNIQUE (account_id, task_id, task_sequence)");
    expect(sql).toContain("FOREIGN KEY (account_id, agent_run_id)");
    expect(sql).toContain("REFERENCES agent_runs(account_id, id)");
    expect(sql).toContain("REFERENCES pursuit_proposals(account_id, id)");
    expect(sql).toContain("authority text NOT NULL CHECK (authority = 'non_canonical')");
    expect(sql).not.toContain("CREATE TABLE action_attempts");
    expect(sql).not.toContain("candidate_score");
    expect(sql).not.toContain("acceptance_probability");
    expect(sql).not.toContain("external_effect");
  });

  it("separates scrubbed telemetry from governed trace artifacts and Eval labels", async () => {
    const sql = await readFile(
      new URL("./032_eval_observability.sql", import.meta.url),
      "utf8",
    );
    for (const table of [
      "telemetry_traces",
      "telemetry_artifacts",
      "telemetry_spans",
      "telemetry_events",
      "eval_annotations",
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }
    expect(sql).toContain("content_hash text NOT NULL");
    expect(sql).toContain("retention_expires_at timestamptz NOT NULL");
    expect(sql).toContain("FOREIGN KEY (account_id, trace_id)");
    expect(sql).toContain("ADD COLUMN telemetry_trace_id text");
    expect(sql).not.toContain("candidate_score");
    expect(sql).not.toContain("personality");
  });

  it("keeps Chat media scoped, lifecycle-aware, and distinct from evidence", async () => {
    const sql = await readFile(
      new URL("./031_chat_media_assets.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE chat_media_assets");
    expect(sql).toContain("CREATE TABLE context_manifest_media");
    expect(sql).toContain("UNIQUE (account_id, media_id)");
    expect(sql).toContain("status IN ('pending', 'ready', 'failed', 'deleted')");
    expect(sql).not.toContain("evidence_fragments");
    expect(sql).not.toContain("source_resources");
  });

  it("keeps user-authored person profiles separate from evidence", async () => {
    const sql = await readFile(
      new URL("./030_person_profiles.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE person_profiles");
    expect(sql).toContain("provenance_kind = 'user_authored'");
    expect(sql).toContain(
      "FOREIGN KEY (account_id, subject_id)\n    REFERENCES subjects(account_id, id)",
    );
    expect(sql).toContain(
      "FOREIGN KEY (account_id, authored_by_user_id)\n    REFERENCES users(account_id, id)",
    );
    expect(sql).not.toContain("evidence_items");
    expect(sql).not.toContain("confirmed_states");
  });

  it("keeps reviewed public cards source-bound and rights-gates avatars", async () => {
    const sql = await readFile(
      new URL("./038_reviewed_person_public_profiles.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE reviewed_person_public_profiles");
    expect(sql).toContain("source_resource_id uuid NOT NULL");
    expect(sql).toContain("confirmed_by_user_id uuid NOT NULL");
    expect(sql).toContain("avatar_rights_basis");
    expect(sql).toContain(
      "use_avatar = false OR (\n      avatar_url IS NOT NULL AND avatar_rights_basis IS NOT NULL",
    );
    expect(sql).toContain("REFERENCES source_resources(account_id, id)");
    expect(sql).not.toContain("biography");
    expect(sql).not.toContain("candidate_score");
    expect(sql).not.toContain("acceptance_probability");

    const deletionSource = await readFile(
      new URL("../modules/captures.ts", import.meta.url),
      "utf8",
    );
    const retentionSource = await readFile(
      new URL("../modules/sourceRetention.ts", import.meta.url),
      "utf8",
    );
    expect(deletionSource).toContain(
      "DELETE FROM reviewed_person_public_profiles profiles",
    );
    expect(retentionSource).toContain(
      "SELECT 'reviewed_person_public_profile', profiles.subject_id",
    );
    expect(retentionSource).toContain(
      "DELETE FROM reviewed_person_public_profiles profiles",
    );
  });

  it("keeps password identity server-owned and account-scoped", async () => {
    const sql = await readFile(
      new URL("./028_password_auth.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE password_credentials");
    expect(sql).toContain("users_password_username_unique_idx");
    expect(sql).toContain("users_password_email_unique_idx");
    expect(sql).toContain("'password_human'");
    expect(sql).toContain("account_role IN ('admin', 'member')");
    expect(sql).toContain(
      "FOREIGN KEY (account_id, user_id) REFERENCES users(account_id, id)",
    );
  });

  it("accepts the versioned scrypt delimiter without rewriting migration history", async () => {
    const sql = await readFile(
      new URL("./029_password_credential_constraint.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain(
      "^scrypt[$]v1[$][a-f0-9]{32,128}[$][a-f0-9]{128}$",
    );
    expect(sql).toContain(
      "DROP CONSTRAINT password_credentials_password_scrypt_check",
    );
  });

  it("keeps lifecycle records in separate tables", async () => {
    const sql = await readFile(
      new URL("./001_authority.sql", import.meta.url),
      "utf8",
    );
    for (const table of [
      "captures",
      "evidence_items",
      "proposed_assertions",
      "fact_decisions",
      "confirmed_states",
      "action_proposals",
      "action_approvals",
      "effect_attempts",
      "effect_observations",
      "outcomes",
      "audit_events",
      "deletion_lineage",
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }
  });

  it("keeps meeting drafts inside verified test-workspace cleanup", async () => {
    const sql = await readFile(
      new URL("./070_meeting_drafts.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain(
      "INSERT INTO lab_test_workspace_table_manifest(table_name,scope)",
    );
    for (const table of [
      "meeting_drafts",
      "meeting_draft_operations",
      "meeting_draft_list_snapshots",
      "meeting_draft_list_snapshot_items",
    ]) {
      expect(sql).toContain(`('${table}','account')`);
    }
    expect(sql).toContain(
      "BEFORE INSERT OR UPDATE ON meeting_drafts",
    );
    expect(sql).toContain(
      "BEFORE INSERT OR UPDATE ON meeting_draft_operations",
    );
    expect(sql).toContain(
      "FOR EACH ROW EXECUTE FUNCTION lab_test_workspace_write_guard()",
    );
    expect(sql.indexOf("INSERT INTO meeting_drafts(")).toBeLessThan(
      sql.indexOf("INSERT INTO lab_test_workspace_table_manifest"),
    );
    expect(sql).toContain(
      "CASE WHEN jsonb_typeof(i.response_body->'blocks')='array'",
    );
    expect(sql).toContain(
      "jsonb_typeof(block.value->'calendar_draft')='object'",
    );
    expect(sql).toContain(
      "pg_input_is_valid(draft.value->>'starts_at','timestamptz')",
    );
    expect(sql).toContain(
      "pg_input_is_valid(draft.value->>'reference_time','timestamptz')",
    );
    expect(sql).toContain("btrim(draft.value->>'source_excerpt')<>''");
    expect(sql).toContain("FROM pg_timezone_names zone");
    expect(sql).toContain("(Z|[+-][0-9]{2}:[0-9]{2})$");
  });

  it("keeps the time workspace source-derived and schedules non-executing", async () => {
    const sql = await readFile(
      new URL("./074_time_workspace.sql", import.meta.url),
      "utf8",
    );
    for (const table of [
      "time_schedules",
      "time_schedule_operations",
      "time_activity_snapshots",
      "time_activity_snapshot_items",
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }
    expect(sql).toContain("time_activity_content");
    expect(sql).toContain("time_session_person_binding");
    expect(sql).toContain("external_effect = 'none'");
    expect(sql).toContain("last_operation_id uuid NOT NULL");
    expect(sql).toContain("status <> 'deleted' OR (");
    expect(sql).toContain("meeting_draft_source_available");
    expect(sql).toContain("pg_input_is_valid(turn.value->>'createdAt', 'timestamptz')");
    expect(sql).toContain("jsonb_array_elements");
    for (const table of [
      "time_schedules",
      "time_schedule_operations",
      "time_activity_snapshots",
      "time_activity_snapshot_items",
    ]) {
      expect(sql).toContain(`('${table}','account')`);
      expect(sql).toContain(`BEFORE INSERT OR UPDATE ON ${table}`);
    }
    expect(sql).not.toContain("access_token");
    expect(sql).not.toContain("candidate_score");
    expect(sql).not.toContain("CREATE TABLE calendar_events");
  });

  it("uses composite account-scoped relationships", async () => {
    const sql = await readFile(
      new URL("./001_authority.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("FOREIGN KEY (account_id, capture_id)");
    expect(sql).toContain("FOREIGN KEY (account_id, action_id)");
    expect(sql).toContain("FOREIGN KEY (account_id, assertion_id)");
  });

  it("adds an account-scoped source-retention receipt and lifecycle", async () => {
    const sql = await readFile(
      new URL("./002_source_retention.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE source_retention_receipts");
    expect(sql).toContain("CREATE TABLE source_retention_events");
    expect(sql).toContain("UNIQUE (account_id, capture_id)");
    expect(sql).toContain(
      "FOREIGN KEY (account_id, capture_id) REFERENCES captures(account_id, id)",
    );
    expect(sql).toContain(
      "source_access_state IN ('available', 'purged', 'deleted')",
    );
    const legacyBackfill = sql.slice(
      sql.indexOf("INSERT INTO source_retention_receipts("),
    );
    expect(legacyBackfill).toContain("'legacy_unknown'");
    expect(legacyBackfill).toContain("'legacy_unverified'");
    expect(legacyBackfill).toContain("ELSE 'purged'");
    expect(legacyBackfill).toContain("content_hash = 'legacy-unverified'");
    expect(legacyBackfill).toContain("'source_purged'");
    expect(legacyBackfill).toContain(
      "source_access_reason = 'legacy_unverified'",
    );
    expect(legacyBackfill).not.toContain(
      "'full_source',\n  'full_source',\n  'full_reviewed_source'",
    );
  });

  it("persists an idempotent source-retention derivative disposition ledger", async () => {
    const sql = await readFile(
      new URL(
        "./037_source_retention_derivative_lineage.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(sql).toContain(
      "CREATE TABLE source_retention_derivative_lineage",
    );
    expect(sql).toContain(
      "UNIQUE (account_id, receipt_id, entity_type, entity_id)",
    );
    expect(sql).toContain("'content_purged'");
    expect(sql).toContain("'access_revoked'");
    expect(sql).toContain("'audit_reference_retained'");
    expect(sql).toContain("'confirmed_state_retained'");
  });

  it("adds reviewed screenshot transcription as an explicit source scope", async () => {
    const sql = await readFile(
      new URL("./003_reviewed_extracted_text.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("'reviewed_extracted_text'");
    expect(sql).toContain(
      "DROP CONSTRAINT source_retention_receipts_source_scope_check",
    );
  });

  it("keeps automatic screenshot extraction explicitly proposed", async () => {
    const sql = await readFile(
      new URL("./047_proposed_extracted_text.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("'proposed_extracted_text'");
    expect(sql).toContain(
      "DROP CONSTRAINT source_retention_receipts_source_scope_check",
    );
  });

  it("adds multichannel resources, stable identity resolution, and compiled knowledge", async () => {
    const sql = await readFile(
      new URL("./004_relationship_resources.sql", import.meta.url),
      "utf8",
    );
    for (const table of [
      "source_resources",
      "evidence_fragments",
      "identity_handles",
      "identity_resolution_cases",
      "identity_resolution_candidates",
      "identity_resolution_decisions",
      "research_tasks",
      "research_snapshots",
      "knowledge_snapshots",
      "knowledge_blocks",
      "knowledge_dependencies",
      "context_manifests",
      "context_manifest_blocks",
      "context_manifest_evidence",
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }
    expect(sql).toContain(
      "CREATE UNIQUE INDEX identity_handles_one_confirmed_owner_idx",
    );
    expect(sql).toContain(
      "ON identity_handles(account_id, handle_type, normalized_value_hash)",
    );
    expect(sql).toContain(
      "FOREIGN KEY (account_id, subject_id)\n    REFERENCES subjects(account_id, id)",
    );
    expect(sql).toContain(
      "CREATE UNIQUE INDEX knowledge_snapshots_one_published_context_idx",
    );
    expect(sql).toContain(
      "FOREIGN KEY (account_id, knowledge_snapshot_id)\n    REFERENCES knowledge_snapshots(account_id, id)",
    );
  });

  it("scopes feature overrides to one authenticated session and freezes product adoption receipts", async () => {
    const sql = await readFile(
      new URL("./046_lab_feature_overrides.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE lab_feature_overrides");
    expect(sql).toContain("REFERENCES sessions(account_id, user_id, id)");
    expect(sql).toContain("WHERE status='active'");
    expect(sql).toContain("ADD COLUMN lab_feature_receipt jsonb");
    expect(sql).not.toContain("objective");
    expect(sql).not.toContain("evidence_fragment");
  });

  it("makes confirmed identity clues temporal and auditable", async () => {
    const sql = await readFile(
      new URL("./016_identity_handle_freshness.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("'expired'");
    expect(sql).toContain("ADD COLUMN version integer");
    expect(sql).toContain(
      "CREATE INDEX identity_handles_freshness_expiry_idx",
    );
    expect(sql).toContain(
      "CREATE TABLE identity_handle_lifecycle_events",
    );
    expect(sql).toContain(
      "FOREIGN KEY (account_id, identity_handle_id)",
    );
  });

  it("versions identity freshness policy and preserves override basis", async () => {
    const sql = await readFile(
      new URL("./017_identity_freshness_policy.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain(
      "CREATE TABLE identity_handle_freshness_policies",
    );
    expect(sql).toContain(
      "identity_handle_freshness_one_open_policy_idx",
    );
    expect(sql).toContain(
      "'identity-freshness-2026-08-07.v1'",
    );
    expect(sql).toContain("ADD COLUMN freshness_policy_version");
    expect(sql).toContain("ADD COLUMN validity_basis");
    expect(sql).toContain("ADD COLUMN validity_override_reason");
    expect(sql).toContain("'human_override'");
    expect(sql).toContain(
      "identity_handle_lifecycle_freshness_policy_fk",
    );
  });

  it("makes published freshness policy immutable and non-overlapping", async () => {
    const sql = await readFile(
      new URL(
        "./018_identity_freshness_policy_immutability.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(sql).toContain(
      "CREATE FUNCTION enforce_identity_freshness_policy_immutability",
    );
    expect(sql).toContain(
      "CREATE TRIGGER identity_freshness_policy_immutable",
    );
    expect(sql).toContain("TG_OP = 'DELETE'");
    expect(sql).toContain(
      "only one-way retirement is allowed",
    );
    expect(sql).toContain("effective intervals cannot overlap");
  });

  it("makes identity, context, and source dependencies explicit", async () => {
    const sql = await readFile(
      new URL("./005_knowledge_dependency_scope.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("'identity_binding'");
    expect(sql).toContain("'relationship_context'");
    expect(sql).toContain("'source_resource'");
    expect(sql).toContain(
      "DROP CONSTRAINT knowledge_dependencies_dependency_type_check",
    );
  });

  it("separates extraction review from attribution and records duplicate lineage", async () => {
    const sql = await readFile(
      new URL("./006_resource_intake_review.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("ADD COLUMN review_status");
    expect(sql).toContain(
      "review_status IN ('proposed', 'reviewed', 'rejected')",
    );
    expect(sql).toContain("'document_text'");
    expect(sql).toContain("ADD COLUMN duplicate_of_resource_id uuid");
    expect(sql).toContain(
      "FOREIGN KEY (account_id, duplicate_of_resource_id)",
    );
    expect(sql).toContain("'resource_intake_committed'");
    expect(sql).toContain(
      "DROP CONSTRAINT source_retention_events_reason_check",
    );
  });

  it("records every evidence-fragment review as an account-scoped decision", async () => {
    const sql = await readFile(
      new URL("./007_evidence_fragment_review.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE evidence_fragment_reviews");
    expect(sql).toContain(
      "FOREIGN KEY (account_id, fragment_id)",
    );
    expect(sql).toContain(
      "FOREIGN KEY (account_id, decided_by_user_id)",
    );
  });

  it("persists a monotonic, same-fragment evidence-review authority chain", async () => {
    const sql = await readFile(
      new URL("./027_evidence_review_authority_chain.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("ADD COLUMN prior_review_id uuid");
    expect(sql).toContain("ADD COLUMN review_revision integer");
    expect(sql).toContain(
      "UNIQUE (account_id, fragment_id, review_revision)",
    );
    expect(sql).toContain(
      "FOREIGN KEY (account_id, fragment_id, prior_review_id)",
    );
    expect(sql).toContain(
      "REFERENCES evidence_fragment_reviews(account_id, fragment_id, id)",
    );
  });

  it("binds every new research task to its governed seed resource", async () => {
    const sql = await readFile(
      new URL("./008_research_seed_lineage.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("ADD COLUMN seed_resource_id uuid");
    expect(sql).toContain(
      "FOREIGN KEY (account_id, seed_resource_id)",
    );
    expect(sql).toContain(
      "REFERENCES source_resources(account_id, id)",
    );
  });

  it("links general resource claims to their exact evidence fragments", async () => {
    const sql = await readFile(
      new URL("./009_resource_claim_provenance.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("ADD COLUMN evidence_fragment_id uuid");
    expect(sql).toContain(
      "FOREIGN KEY (account_id, evidence_fragment_id)",
    );
    expect(sql).toContain(
      "REFERENCES evidence_fragments(account_id, id)",
    );
    expect(sql).toContain(
      "CREATE UNIQUE INDEX proposed_assertions_one_resource_claim_idx",
    );
  });

  it("records reversible identity corrections and preserves retracted fact history", async () => {
    const sql = await readFile(
      new URL("./010_identity_correction.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("'retracted'");
    expect(sql).toContain(
      "CREATE TABLE identity_correction_decisions",
    );
    expect(sql).toContain("affected_capture_ids uuid[] NOT NULL");
    expect(sql).toContain(
      "FOREIGN KEY (account_id, root_capture_id)",
    );
    expect(sql).toContain(
      "CREATE INDEX identity_correction_decisions_capture_idx",
    );
  });

  it("separates effect reversal approval, execution, observation, and outcome", async () => {
    const sql = await readFile(
      new URL("./019_effect_reversals.sql", import.meta.url),
      "utf8",
    );
    for (const table of [
      "effect_reversal_approvals",
      "effect_reversal_attempts",
      "effect_reversal_observations",
      "effect_reversal_outcomes",
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }
    expect(sql).toContain("effect_reversal_approvals_one_active_idx");
    expect(sql).toContain("status IN ('active', 'revoked', 'stale', 'consumed')");
    expect(sql).toContain("match_status IN ('matched_absent', 'still_present', 'unavailable')");
  });

  it("adds an account-scoped Pursuit aggregate with auditable operations and receipts", async () => {
    const sql = await readFile(
      new URL("./020_pursuit_domain.sql", import.meta.url),
      "utf8",
    );
    for (const table of [
      "organizations",
      "pursuits",
      "pursuit_roles",
      "pursuit_role_evidence",
      "pursuit_criteria",
      "pursuit_gaps",
      "pursuit_gap_evidence",
      "pursuit_actions",
      "pursuit_operations",
      "pursuit_receipts",
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }
    expect(sql).toContain("FOREIGN KEY (account_id, pursuit_id)");
    expect(sql).toContain("FOREIGN KEY (account_id, person_id)");
    expect(sql).toContain("FOREIGN KEY (account_id, organization_id)");
    expect(sql).toContain("FOREIGN KEY (account_id, evidence_fragment_id)");
    expect(sql).toContain("jsonb_array_length(external_effects) = 0");
    expect(sql).toContain(
      "status IN ('confirming', 'applied', 'conflict', 'failed', 'unknown_locked')",
    );
    expect(sql).toContain("UNIQUE (account_id, operation_id)");
  });

  it("adds item-level Pursuit Proposal review without external effects", async () => {
    const sql = await readFile(
      new URL("./021_pursuit_proposal_review.sql", import.meta.url),
      "utf8",
    );
    for (const table of [
      "pursuit_proposals",
      "pursuit_proposal_items",
      "pursuit_proposal_item_evidence",
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }
    expect(sql).toContain("review_pursuit_proposal");
    expect(sql).toContain("'confirmed', 'edited', 'rejected', 'kept_unresolved'");
    expect(sql).toContain("FOREIGN KEY (account_id, evidence_fragment_id)");
    expect(sql).toContain("jsonb_array_length(external_effects) = 0");
    expect(sql).toContain("pursuit_operations_proposal_kind_check");
    expect(sql).toContain("pursuit_receipts_proposal_kind_check");
  });

  it("propagates Pursuit evidence authority and preserves authored order", async () => {
    const sql = await readFile(
      new URL("./022_pursuit_evidence_integrity.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("ADD COLUMN basis_kind text");
    expect(sql).toContain("pursuit_role_evidence_fragment_idx");
    expect(sql).toContain("pursuit_gap_evidence_fragment_idx");
    for (const table of [
      "pursuit_roles",
      "pursuit_criteria",
      "pursuit_gaps",
      "pursuit_actions",
    ]) {
      expect(sql).toContain(`ALTER TABLE ${table} ADD COLUMN display_order integer`);
      expect(sql).toContain(`${table}_display_order_idx`);
    }
  });

  it("persists bounded Agent trajectories without payloads or external effects", async () => {
    const sql = await readFile(
      new URL("./023_agent_control_plane.sql", import.meta.url),
      "utf8",
    );
    for (const table of [
      "agent_runs",
      "agent_run_evidence",
      "agent_run_events",
      "agent_tool_calls",
      "agent_run_outputs",
      "agent_no_actions",
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }
    expect(sql).toContain("external_effects = '[]'::jsonb");
    expect(sql).toContain(
      "FOREIGN KEY (account_id, fragment_id)",
    );
    expect(sql).toContain(
      "FOREIGN KEY (account_id, idempotency_record_id)",
    );
    expect(sql).toContain("input_fingerprint text NOT NULL");
    expect(sql).toContain("output_fingerprint text NOT NULL");
    expect(sql).not.toContain("input_payload");
    expect(sql).not.toContain("output_payload");
  });

  it("separates evidence authorization from raw-source retention", async () => {
    const sql = await readFile(
      new URL("./011_source_authorization.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain(
      "ADD COLUMN authorization_state text NOT NULL DEFAULT 'authorized'",
    );
    expect(sql).toContain(
      "ADD COLUMN authorization_reason text NOT NULL DEFAULT 'capture_authorized'",
    );
    expect(sql).toContain(
      "CREATE TABLE source_authorization_decisions",
    );
    expect(sql).toContain("affected_capture_ids uuid[] NOT NULL");
    expect(sql).toContain(
      "CREATE INDEX source_authorization_decisions_capture_idx",
    );
  });

  it("expires evidence authorization on its own governed clock", async () => {
    const sql = await readFile(
      new URL("./012_source_authorization_expiry.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("ADD COLUMN authorization_expires_at");
    expect(sql).toContain("'authorization_expired'");
    expect(sql).toContain("'expire'");
    expect(sql).toContain(
      "transition_actor IN ('human', 'system')",
    );
    expect(sql).toContain(
      "CREATE INDEX source_authorization_expiry_idx",
    );
  });

  it("recovers source-authorization recompilation after process loss", async () => {
    const sql = await readFile(
      new URL(
        "./013_source_authorization_compilation_jobs.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(sql).toContain(
      "CREATE TABLE source_authorization_compilation_jobs",
    );
    expect(sql).toContain(
      "status IN ('pending', 'running', 'retry', 'completed')",
    );
    expect(sql).toContain("lease_expires_at");
    expect(sql).toContain(
      "FOREIGN KEY (account_id, decision_id)",
    );
    expect(sql).toContain(
      "CREATE INDEX source_authorization_compilation_jobs_due_idx",
    );
    expect(sql).toContain(
      "CREATE INDEX source_authorization_compilation_jobs_expired_lease_idx",
    );
  });

  it("records versioned reversible person merges without flattening relationship contexts", async () => {
    const sql = await readFile(
      new URL("./015_reversible_person_merges.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE person_merge_operations");
    expect(sql).toContain("merged_into_subject_id uuid");
    expect(sql).toContain("affected_assignment_ids uuid[] NOT NULL");
    expect(sql).toContain("affected_capture_ids uuid[] NOT NULL");
    expect(sql).toContain("invalidated_snapshot_ids uuid[] NOT NULL");
    expect(sql).toContain(
      "CREATE UNIQUE INDEX person_merge_operations_one_active_source_idx",
    );
    expect(sql).toContain("status IN ('active', 'merged', 'deleted')");
  });

  it("recovers bounded research retrieval after process loss", async () => {
    const sql = await readFile(
      new URL("./014_research_retrieval_jobs.sql", import.meta.url),
      "utf8",
    );
    expect(sql).toContain("CREATE TABLE research_retrieval_jobs");
    expect(sql).toContain("request_body jsonb NOT NULL");
    expect(sql).toContain(
      "status IN ('pending', 'running', 'retry', 'completed')",
    );
    expect(sql).toContain(
      "FOREIGN KEY (account_id, task_id)",
    );
    expect(sql).toContain(
      "FOREIGN KEY (account_id, idempotency_record_id)",
    );
    expect(sql).toContain(
      "CREATE INDEX research_retrieval_jobs_due_idx",
    );
    expect(sql).toContain(
      "CREATE INDEX research_retrieval_jobs_expired_lease_idx",
    );
  });

  it("removes the misplaced backend Agent public-web state", async () => {
    const sql = await readFile(
      new URL(
        "./035_decommission_backend_agent_web_research.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(sql).toContain("DROP TABLE IF EXISTS agent_research_artifacts");
    expect(sql).not.toContain("'artifact_created'");
    expect(sql).not.toContain("'PUBLIC_RESEARCH_UNAVAILABLE'");
  });
});
