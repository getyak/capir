# Find saved Memory across Sessions with durable withdrawal

Linear: GET-455, child of GET-439. The accepted C03 design is preserved in the
operational review `capir-c03-discovery-design-peer-review.md/.json`.

## Outcome and fixed boundaries

An authorized private workspace Chat may discover the acting user's currently
readable accepted Memory through bounded literal clues across Sessions. Before
the tool is released, every actually admitted Memory statement, including
existing recall and automatic self core, must have durable exact-version and
monotonic-epoch lineage through canonical publication and every retained
readback. Withdrawal, replacement and lawful undo must not resurrect an old
derived reply. Preserve unrelated replies, still-authorized human-authored
prose, current scopes, existing Run budgets and ADR0024 natural raw-source TTL.

This adds no global People search, identity authority, writes, Wiki citation
authority, semantic index, deployment secret or provider permission. Historical
untracked dependencies remain unknown. The three approved public archive source
objects preserve intent; withheld originals and private derivations are excluded.

## Current milestone: compatible foundation before runtime publication

Main `ac4fdce93a7260532342e5f382515659c3c39877` has 117 frozen migrations.
Draft #536 foundation `7ee02f744635d9810a61d78198d7bf0b8ce9c911`
has not reached Main or the resident service. Its Hosted PostgreSQL run
42487231340 passed the original populated upgrade (12), owner target (5), and
tracked recall (7). Default backend tests passed 2141 with 1069 configured skips.
The new runtime suite still failed 11 of 15; subsequent stages were skipped.
These results do not establish the whole capability or resident acceptance.

A read-only resident schema check found a real historical
`099_saved_memory_chat_lineage` table named `agent_task_memory_dependencies`.
Its text task IDs and old version/owner fields cannot stand in for new UUID,
epoch and scope proofs. The unmerged draft114 used the same physical name and
would fail before draft115. Keep the old table, constraints, triggers and rows.
The new C03 table is `agent_task_saved_memory_dependencies`; its SQL and all
C03 consumers use that distinct name. Never infer a new proof from an old row.

This explicitly supersedes the earlier draft114/115 review snapshots. Their
previous SQL remains in Git history and operational evidence. All 117 Main
migration names, order and SQL bytes stay exact; only these unmerged drafts are
corrected and the reviewed 119-entry digest is repinned. The normal migrator's
already-applied checksum refusal is unchanged. An unknown environment that has
applied an older draft must still stop at that refusal, not rewrite history.

The active verification batch adds four required PostgreSQL contracts in a
separate, empty loopback database. It executes the complete historical099 Git
SQL, retains synthetic UUID and text task rows, runs the normal migrator through
114/115, checks the old table and rows byte for byte, rejects synthetic conversion
into new proofs, repeats migration without changed receipts, and verifies an
already-applied checksum mismatch still fails. This fixture matches the observed
old table shape; its full SQL has not been asserted identical to the resident's
stored099 checksum. Existing upgrade12 and runtime15 case bodies and timeouts
remain intact. These four contracts are source-only until their Hosted step
actually passes. The same batch maps physical Self subjects to semantic null
inside the original discovery SELECT, while retaining strict owner predicates.

## Following milestones and protected boundaries

1. Pass fresh and historical upgrades, tracked/owner tests, source checks and
   independent review at the current head. Preserve failures and configured skips.
2. Wire the three actual producers (automatic Self, governed recall and literal
   search) to one private Run/source owner. Admit only actual exposed compiler
   items with original tuples and one shared budget. A callback alone is not a
   current authorization or source capability.
3. Join current credentials, source and Memory/query membership in the same SQL
   snapshot before exposure and publication. Preserve terminal revocation errors
   through fallback paths. Register completed lineage on the actual canonical
   completion transaction and physical client, with real source receipts and
   COMMIT/ACK evidence; no new tool is released before these paths work.
4. Finish Session/history/queue/SDK/fork/monitor and retained-artifact readers,
   both publication race orders, bounded maintenance, replacement/undo negatives,
   hidden-row negatives, literal Unicode/microsecond pagination and shared quotas.
   Preserve ADR0024 raw-TTL positive controls and lawful human-authored originals.
5. Pass all applicable Hosted gates, then deploy affected existing resident
   services from clean committed source using the normal deployment entrypoint.
   Read back live revisions and changed behavior before closing GET-455.

The existing6 discovery and15 runtime regressions remain mandatory alongside the
foundation tests. Their semantic failures cannot be replaced by helper-only
passes. Do not overwrite C05 protocols or released SQL/auth/claim guards. Keep
independent source ownership, the full migration manifest order (113 before112),
private receipts and existing transport/schema contracts. No production secrets
or user source content belong in lineage metadata, tests or reports. Synthetic
CI does not prove actual provider, physical-device or production acceptance.
