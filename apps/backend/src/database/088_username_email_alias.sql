-- Existing handles remain valid. A username may also be its own canonical
-- primary email, allowing the development fixture to use one login identifier.
-- This cannot reserve an arbitrary email-shaped username for another address.
ALTER TABLE users DROP CONSTRAINT users_username_format_check;
ALTER TABLE users ADD CONSTRAINT users_username_format_check CHECK (
  username IS NULL
  OR username ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{2,39}$'
  OR (
    email IS NOT NULL
    AND username = lower(btrim(email))
    AND length(username) <= 320
    AND username ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
);
