-- Push capabilities are account-owned writes and use the same retirement
-- fence as every other governed account table. Preserve migration103 history.
CREATE TRIGGER account_retirement_fence
  BEFORE INSERT OR UPDATE ON capture_activity_registrations
  FOR EACH ROW EXECUTE FUNCTION enforce_account_retirement_fence('account_id');
