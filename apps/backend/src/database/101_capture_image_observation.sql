-- Only the bounded same-run, pending text projection survives successful
-- queue-result scrubbing. It belongs to the original image, inherits its
-- expiry/cascades, and is never copied into client-editable Session JSON.
ALTER TABLE conversation_message_images
  ADD COLUMN capture_observation jsonb
  CHECK (capture_observation IS NULL OR (
    jsonb_typeof(capture_observation) = 'object'
    AND capture_observation ?& ARRAY['run_id','observation']
    AND octet_length(capture_observation::text) <= 24576
  ));
