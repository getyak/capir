-- Raster tool evidence is separate from user-authored image sources. Images
-- inherit the exact receipt's owner, conversation visibility and retention.
CREATE TABLE mcp_tool_result_images (
  account_id uuid NOT NULL,
  call_id uuid NOT NULL,
  image_index integer NOT NULL CHECK (image_index BETWEEN 0 AND 3),
  media_type text NOT NULL CHECK (media_type IN ('image/png','image/jpeg','image/webp')),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 750000),
  PRIMARY KEY (account_id, call_id, image_index),
  FOREIGN KEY (account_id, call_id) REFERENCES mcp_tool_calls(account_id, id) ON DELETE CASCADE
);
INSERT INTO lab_test_workspace_table_manifest(table_name, scope)
VALUES ('mcp_tool_result_images', 'account');
CREATE TRIGGER lab_test_workspace_write_guard
  BEFORE INSERT OR UPDATE ON mcp_tool_result_images
  FOR EACH ROW EXECUTE FUNCTION lab_test_workspace_write_guard();
CREATE TRIGGER account_retirement_fence
  BEFORE INSERT OR UPDATE ON mcp_tool_result_images
  FOR EACH ROW EXECUTE FUNCTION enforce_account_retirement_fence('account_id');
