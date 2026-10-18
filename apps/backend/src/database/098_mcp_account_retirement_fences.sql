-- MCP tables added after account identity ownership must share its retirement
-- lock. This lets an empty duplicate retire safely without admitting late MCP
-- writes into the source account. Existing records and credentials are intact.
DO $$ DECLARE item text; BEGIN
  FOREACH item IN ARRAY ARRAY[
    'mcp_interaction_requests',
    'mcp_tool_calls',
    'mcp_oauth_connect_requests',
    'mcp_continuation_outbox',
    'mcp_oauth_cleanup',
    'mcp_oauth_cleanup_effects'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER account_retirement_fence BEFORE INSERT OR UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION enforce_account_retirement_fence(''account_id'')',
      item
    );
  END LOOP;
END $$;
