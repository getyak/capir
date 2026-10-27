# Dependency upgrade compatibility — 2026-10-27

Replacement PR #459 supersedes the closed #445. Its dependency head
`ebe59f00ada96907fef39407c67c8d0a98df30e8` was normally merged with main
`8c751149bafd317a60ea2d4fd47386ba42d0340c`; successor application source was
preserved. The replacement resolves Claude Agent SDK 0.3.310, undici 8.12.3,
and Next.js 16.4.3. The security contracts use those actual resolved versions;
no audit exclusions or release-age exceptions were added.

The replacement lock contains 991 package records and 991 snapshots, compared
with 988 in the earlier #445 graph. Its additional Babel parser, types and
string-parser records come from the React Hooks ESLint dependency branch.
Keeping the replacement's complete graph is required; the earlier count is
not a target to force through dependency removal.

The earlier Web CI passed its assertions but failed on an unhandled AbortError
during Motion cancellation. Happy DOM 21.0.3 and 21.0.4 share the Animation
implementation that eagerly creates `finished` and rejects it on cancellation
without the Web Animations `PromiseIsHandled` step. A synchronous `cancel()`
try/catch cannot handle that promise rejection.

Only the affected DOM test installs compatibility for animations created in
its own document. It consumes only that realm's actual DOMException AbortError
for the current `finished` promise and never replaces that promise. Explicit
consumers still observe the original rejection. Non-Abort failures, ordinary
Errors named AbortError and unrelated rejected promises still fail. Restoring
the animation factory leaves previously owned animations protected during
late teardown. Production components and global rejection reporting are
unchanged.

Local checks cover manifest/importer and dependency-reference consistency,
strict module/VM lifecycle probes and the helper's strict TypeScript types.
The probes use an existing cached Happy DOM Animation class whose official
implementation matches 21.0.4. They do not constitute the complete Motion
14.6 / Happy DOM 21.0.4 React matrix. Frozen dependency installation, the full
production audit, Web tests and applicable type/lint/build checks remain
required on the final exact-head CI. Missing installed dependencies must be
reported as unavailable, not passing.

Fresh CI, ordinary merge and production or installed-client acceptance are
separate evidence. Provider deployment quota failures are not successful
deployments.
