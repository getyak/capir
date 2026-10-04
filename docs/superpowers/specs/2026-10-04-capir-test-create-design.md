# capir test account creation

Status: user-approved design; implementation started on 2026-10-04.

## Outcome

One CLI command creates a usable, isolated, expiring test identity and initializes
versioned synthetic product data. The caller can choose a username and password,
or receive generated credentials, then sign in normally or open an authenticated
test workspace. Help gives humans and agents a short, executable starting point.

This completes a missing dependency of deployed MCP acceptance. It does not
replace a vendor's actual OAuth consent or claim that a redirect is a grant.

## User-approved direction and latest refinements

- Use `capir test create`, with companion status and stop commands.
- Accept an explicit username and password. When omitted, generate a unique
  username and cryptographically random password and return the credentials.
- Expiration is an optional argument, with a bounded default.
- Add useful subcommand help and a few concise repository AGENTS instructions.
- Reuse Lab isolation, synthetic scenarios and verified cleanup; integrate the
  actual CLI/backend/Web chain rather than wrapping a manual login prerequisite.

## Command surface

```sh
capir help
capir help test
capir help test create
capir test create --help

# Named environment is explicit; identity and password are generated.
capir test create --env staging

# Explicit username, password and optional lifetime.
capir test create --env staging --username qa-mcp \
  --password '<chosen-password>' --expires-in 4h --open web

# Password can also be read from stdin. It is not prompt/model input.
capir test create --env staging --username qa-mcp --password-stdin

# Structured discovery/output for an agent.
capir help test create --json
capir test create --env staging --preset empty --json
capir test status <run-id> --env staging --json
capir test stop <run-id> --env staging --json
```

The default preset is `daily`. `daily` reuses the authored scenario containing
12 fictional contacts, 30 observations and 4 tasks. `empty` has no product seed.
Creating either preset dispatches no model call, email or vendor OAuth request.

`--expires-in` accepts `1h`, `4h`, `24h` and the equivalent `1d`; the default is
`4h`. These values intentionally reuse supported Lab lifetimes. Help publishes
the supported set and actual expiration timestamp. No non-expiring accounts.

`--username` uses the existing username validator and uniqueness rules. Omitted
names are unique per run. A collision returns a stable conflict without changing
the existing user's credentials or data. Generated email addresses use the
reserved `lab.invalid` namespace. Email-shaped supplied usernames are accepted
only in that namespace and follow the existing username/email invariant; other
email domains are rejected, since this command proves no email ownership.
Under the same database identity lock, a supplied handle is compared with both
existing login usernames and primary emails, using the actual login normalizer.
It cannot create a second identifier match that breaks an existing user's login.

Only one of `--password` and `--password-stdin` is accepted. Supplied passwords
follow the existing password limits. With neither option, the CLI generates at
least 128 bits of entropy using the OS cryptographic RNG. This temporary password
can be used on the ordinary password login surface of the selected test origin.

Global help and nested help work offline and allocate nothing. Plain help uses
readable commands, examples, defaults and next actions; `--json` exposes stable
command names, argument schemas, examples and error codes. Existing JSON callers
have an explicit compatibility path. `--help` never consumes password stdin or
loads a provisioning credential. Unknown commands cannot become model prompts.

## Identity and provisioning authority

Creation does not require a prior human Web login. It requires an independently
provisioned, origin-bound internal-test operator credential. The selected
environment resolves its configured credential through the OS keyring or an
explicit ephemeral environment variable; public config stores references, never
credential values. Authorized installation provisions this prerequisite so the
normal command works without asking the user to paste a secret.

The service enables provisioning only when the internal Lab and dedicated test
provisioning capability are configured. Normal deployments keep it disabled.
The provisioning credential can create and manage its own synthetic test runs;
it cannot read real workspaces, reset existing passwords, grant admin privileges,
send invitations or promote test identities into ordinary accounts. Requests
are rate-limited, quota-bound, scoped to exact registered origins and auditable
by provisioning principal, request ID and run ID.

Accounts remain `lab_human` test identities with persistent test provenance.
Password sign-in must consult the same active Lab workspace boundary as API
access, not merely a valid password hash. Every resulting session is restricted
to that account and expires no later than the run. Expired, stopped, revoked or
cleaning workspaces reject new sign-ins and existing session access immediately,
including before the next cleanup sweep. Production simulated auth stays off.

Test identities never authorize account invitations, provider linking to another
user, access to a real person's data, or permanent account conversion.

### Operator ownership and session lineage

Current Lab creation requires an active non-Lab parent human session; its owners
reference users. The new flow cannot manufacture a human AuthContext or skip
those checks. Introduce a control-scope provisioning principal with an opaque ID,
allowed origin pair, active/revoked state and credential generation. Operator
credentials are high-entropy service credentials, not password credentials.

Append schema supporting exactly two workspace ownership forms: the existing
human account/user owner pair, or one provisioning-principal ID. These forms are
mutually exclusive. Existing human owner foreign keys and authority checks stay
effective; operator-owned runs leave human owner fields null. The operator
registry and its audit metadata are classified explicitly as control scope.

Extend Lab entries with the same exclusive lineage: an existing human parent
session or an operator-principal ID and generation. An operator entry is active
only when the target account/user/session all match that workspace, the entry
and workspace are active and unexpired, and the principal remains enabled at the
recorded generation for those exact origins. A principal revocation invalidates
its entries even if cleanup is pending. Human parent-session admission keeps its
existing semantics. One shared authority predicate governs every Lab API/session
read; no broad `lab_human` exemption is introduced.

The new operator API owns only its own run creation, status, stop and handoff.
It does not reuse a human capir OAuth grant to pretend a prior human approval.
New operator handoffs use the trusted Web consumer key, a one-use secret/private
POST, exact account/run/origin binding and the same lineage/expiry recheck.
Existing Stage A human authorization and strict replay remain separate.

### Real password admission

After existing scrypt verification, a Lab password login must lock its canonical
workspace and matching provisioned target user inside the login transaction.
Only an active, unexpired run with a matching enabled principal is admitted.
That transaction creates both the session and its matching Lab entry, with
session/entry expiration clamped to the run deadline. It must not mint a bare
session that fails the Lab authority predicate on its first read.

Stop/expiry transitions take the same workspace lock. If stop wins, login
creates no session; if login wins, stop revokes that session/entry. The ordinary
human password path remains unchanged. CLI password-based entry, direct Web
login, private handoff and authenticated readback all use this canonical rule;
the browser must not invent missing entry/session relationships.

## Atomic creation and recovery

The backend owns atomic creation of the isolated account, user, salted scrypt
password hash, Lab lifecycle record, scenario data and scoped session/grant.
Reuse the existing password credential implementation, Lab write guards and
account/cleanup manifest. The CLI never connects directly to PostgreSQL.

Success requires canonical identity, preset version/digest, expected seed counts
and active expiration readback. A partially seeded account is not `ready`.
Database failures roll back the allocation or leave an explicit recoverable
state without granting access. Server-generated descriptions never override the
actual state readback.

`--request-id <uuid>` resumes the exact recorded create operation. The CLI
records private operation intent before sending. Default usernames/passwords
remain stable for that operation; generated passwords needed for retry recovery
are retained only in a run-specific OS-keyring item until run stop/expiry,
never in the plaintext journal. Semantic conflict checks include username,
credential identity, preset, origin and lifetime. The backend stores only a
password hash, not a reversible password or a fast unsalted password digest.
For replay, lock the original operation and verify the submitted password with
the stored scrypt credential; an opaque identity match or equality between
fresh randomly salted hashes is insufficient. A different password on the same
request ID is a semantic conflict and never rotates the previous credential.
An ambiguous response is recovered by exact request ID, never by creating
another account automatically. A conflicting existing keyring entry is not
overwritten. Cancellation must settle or report pending allocation honestly.
Expiry cleanup removes the local run keyring item on the next CLI operation;
server expiry already denies its use while that client is offline. A lost local
password item is reported without rotating a ready run or returning a fabricated
credential. Repeating exact creation can recover the original password only
while the caller still owns that private item.

Status does not extend TTL, rotate credentials or reveal a password. Stop revokes
the account's access first, then reuses verified Lab cleanup for product rows,
password credentials, sessions, media and MCP broker effects. `deleting`, failed
cleanup and verified `deleted` remain distinct. Runtime scope/revision checks
protect concurrent writes and prevent restoring an expired account.

## Output and password disclosure

Human success output is compact: run ID, username, generated password, preset
counts, expiry, exact Web origin and the status/stop commands. JSON has the same
facts under a versioned envelope and a narrowly defined generated-credential
field. Supplied passwords do not need to be echoed back.

The user's request explicitly authorizes returning the generated temporary
password on successful creation. Only that dedicated success projection may
emit it. Existing bearer/provisioning/token redaction remains intact. Passwords
are excluded from stderr, errors, HTTP/access logs, receipts, operation journals,
telemetry, tracked test fixtures, browser URLs and conversation history.
Automated evidence captures sanitized receipts, not raw credential stdout.

`--password-stdin` is an alternative to an argv password, not a requirement for
interactive use. Neither help nor a parsing error may echo supplied secret text.
Request bodies travel only to the verified environment origin without redirect
following. The backend never needs to return the plaintext password because the
CLI already owns the generated value.

`--open web` uses a single-use, private handoff into a fresh isolated browser
context. It does not export browser cookies or put passwords/grants in a URL.
Creation and browser readiness are separate: a failed browser launch retains
the ready run and recoverable entry command. Returned public entry URLs contain
no credentials.
Both direct password sign-in and CLI handoff show an authoritative test-space
banner and expiration. That label derives from canonical Lab state rather than
requiring a pre-existing real-user browser session or treating a cookie's mere
presence as proof. Returned login identity/readback must match the target account.

## Product integration and compatibility

Latest product baseline is `98f566d1aba45c762c5949f54dd1bfff5c2c0fba`.
The installed CLI source is independently maintained at
`/Users/cubxxw/.codex/worktrees/capir-cli/talent-signal`, currently `4cc57bf3`.
It contains Stage A CLI/backend/Web source not present in the current merged
product source. Current staging `/v1/capir/capabilities` is HTTP 404.

Integrate the relevant reviewed CLI infrastructure against the latest product
baseline. Do not deploy the stale CLI branch wholesale or overwrite the deployed
MCP source, current Desktop login, canonical account rules or unrelated Web work.
Keep historical migration checksums intact and add new schema append-only.
Old `auth` and strict-replay `sandbox` commands retain their semantics. The new
test-account flow is a distinct ordinary Lab product-testing capability; it
must not silently convert strict replay into paid live-model execution. Actual
MCP/Agent tests use the already configured host budgets and exact-effect
approval in synthetic scope; account creation itself invokes no model.

Deploy reviewed backend and Web together from clean immutable, Colima-visible
release checkouts. Align recovery image/revision/pointers and CLI binary before
calling the interface usable. Preserve rollback releases and resident volumes.

## Documentation

Global help owns the quickest human/AI entry. Operational details have one
authoritative page; update a wiki-generated page through its `_index` source.
Add only a few lines to repository `AGENTS.md`, in English:

> For AI product acceptance, inspect `capir help test create`, then use
> `capir test create --env <test-env> --preset daily --open web`.
> Reuse the returned run/request ID; credentials belong only to that expiring
> test account. Retain sanitized evidence, then verify `capir test stop` cleanup.

These commands must be implemented and deployed before the guidance claims they
are available. No repeated generic login instruction replaces provisioning.

## Acceptance

1. Actual installed `capir help`, nested help and JSON help disclose usable
   examples without configuration, network access or credential reads.
2. From no existing Web login, the real built CLI creates a generated user and
   password, confirms daily data and opens the exact deployed test workspace.
3. A fresh browser signs in with the returned password. Another run uses a
   chosen username/password; its password and identity match authoritative
   readback. Collision and cross-run access fail without mutating either user.
4. Request replay, response loss, cancellation, browser-launch failure and
   keyring conflict preserve one allocation and honest recovery state.
5. Expiration blocks password login and already issued sessions before cleanup.
   Stop confirms zero account data/credentials and real broker cleanup, or
   reports the actual pending/failure boundary. Unknown schema fails closed.
6. Existing ordinary login, strict replay and MCP exact-approval invariants pass
   meaningful focused tests. Independent security review closes confirmed
   P0/P1 before delivery; latest applicable CI, deployment probes and Notion
   address/acceptance readback accompany actual published state.

Human review of this written spec precedes implementation planning under the
selected brainstorming workflow. Pi/MiMo is the existing user-preferred coding
method; Codex owns integration, independent acceptance and final delivery.
