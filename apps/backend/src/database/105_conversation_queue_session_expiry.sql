-- Queue rows inherit the owning Session's expiry. Their creation timestamp
-- comes from the database clock, while a Session can carry an application
-- timestamp. Comparing these two clocks can reject a valid first message.
-- Session lifetime validation, expiry checks and cascade deletion remain the
-- authority; admission never extends the inherited Session expiry.
ALTER TABLE conversation_queue_entries
  DROP CONSTRAINT conversation_queue_entries_check;
