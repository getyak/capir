-- GET-128: immutable supplementary messages can join one running task.
-- Known-capable/dynamic claims open intake; unsupported selection detaches
-- pending members intact. Ordinary non-steering claims start closed.
-- Admission and final closure share the Session advisory lock. The primary
-- PostToolBatch/Stop checkpoint claims an ordered batch as 'dispatching'; a
-- later primary checkpoint acknowledges consumption as 'delivered'. Only that
-- acknowledgment permits canonical folding and scrubbing. Unacknowledged rows
-- survive Stop as separate queued work; failure retains the whole group for
-- one explicit retry. Every message keeps its original ID, time and creator.
--
-- Hook additionalContext is text-only: an image supplement remains whole for
-- the next task with an explicit unsupported reason. The same applies beyond
-- the twenty-message fold limit. Neither case is silently dropped or partially
-- folded. Awaiting/dispatching members prevent normal final intake closure;
-- unsupported members do not. Final closure wins atomically against admission.
ALTER TABLE conversation_queue_entries
  ADD COLUMN steer_group_entry_id uuid,
  ADD COLUMN steer_state text NOT NULL DEFAULT 'awaiting'
    CHECK (steer_state IN ('awaiting','dispatching','delivered','unsupported')),
  ADD COLUMN steer_delivered_at timestamptz,
  ADD COLUMN steer_closed_at timestamptz;

-- Delivery state is only meaningful on a member row, and the delivery record
-- stands or falls with its state. Only the leader run owns intake closure.
ALTER TABLE conversation_queue_entries
  ADD CONSTRAINT conversation_queue_steering_member_only_check
  CHECK (steer_group_entry_id IS NOT NULL OR (steer_state = 'awaiting' AND steer_delivered_at IS NULL)),
  ADD CONSTRAINT conversation_queue_steering_delivery_check
  CHECK ((steer_state = 'delivered') = (steer_delivered_at IS NOT NULL)),
  ADD CONSTRAINT conversation_queue_steering_intake_check
  CHECK (steer_closed_at IS NULL OR steer_group_entry_id IS NULL);

-- A member never holds a run lease: it is processed inside its leader's run.
ALTER TABLE conversation_queue_entries
  ADD CONSTRAINT conversation_queue_steering_lease_check
  CHECK (steer_group_entry_id IS NULL OR lease_owner IS NULL);

-- Member rows live and die with their leader row; the Session-level sweep and
-- the account purge already delete every row of the group together.
ALTER TABLE conversation_queue_entries
  ADD CONSTRAINT conversation_queue_steering_group_fkey
  FOREIGN KEY (account_id, steer_group_entry_id)
  REFERENCES conversation_queue_entries(account_id, id) ON DELETE CASCADE;

-- The runner reads awaiting members in accepted order and the admission path
-- looks up the live leader under the advisory lock; both are per Session.
CREATE INDEX conversation_queue_steering_idx
  ON conversation_queue_entries(account_id, steer_group_entry_id, sequence)
  WHERE steer_group_entry_id IS NOT NULL;
