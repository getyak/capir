-- User-owned language choices. Presentation only: never person data.
-- display_language: interface chrome language; 'system' follows the platform.
-- prompt_output_language: language the agent writes in; 'system' preserves
-- automatic current-request language selection. Neither value ever translates stored evidence,
-- source excerpts, or quoted conversations.
ALTER TABLE users ADD COLUMN display_language text NOT NULL DEFAULT 'system'
  CHECK(display_language IN ('system','en','zh-CN','zh-TW','ja','ko'));
ALTER TABLE agent_user_preferences ADD COLUMN prompt_output_language text NOT NULL DEFAULT 'system'
  CHECK(prompt_output_language IN ('system','en','zh-CN','zh-TW','ja','ko'));
-- The presentation-preference save writes its own audit row; extend the kind
-- allowlist exactly like prior settings kinds (details keep identifiers and
-- lifecycle revisions only, never the language value).
ALTER TABLE account_access_events DROP CONSTRAINT account_access_events_kind_check;
ALTER TABLE account_access_events ADD CONSTRAINT account_access_events_kind_check
  CHECK (kind IN (
    'profile', 'workspace', 'member', 'transfer', 'revoke_session', 'onboarding',
    'link_provider', 'unlink_provider', 'set_password', 'change_password',
    'reconciliation', 'preferences'
  ));
