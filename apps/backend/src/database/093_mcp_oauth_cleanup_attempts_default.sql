-- 092 dropped the attempts default while keeping NOT NULL; restore the
-- default so every writer and legacy fixture inserts a valid row.
ALTER TABLE mcp_oauth_cleanup
  ALTER COLUMN attempts SET DEFAULT 0;
