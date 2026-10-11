# Authorized research notebooks

The operator-only `apps/backend/src/operations/importResearchNotebook.ts` reads one
bounded JSON envelope from stdin using the service's authorized `DATABASE_URL`.
The envelope has `email`, `displayName`, `password`, and `notebook`; never put a
password in argv, logs, source, fixture files or deployment settings. The notebook
has schema `research-notebook.v1`, a stable namespace, and people with stable
`key`, `name` and ordered notes. Each note contains a unique `key`, text shorter
than 970 UTF-16 characters, a section (`identity`, `analysis`, `learning`, `limits`,
`platform`, `sources`, `dossier`), and bounded metadata.

Provisioning creates a normal personal owner with a salted password hash, no
mailbox-verification claim and no cross-account privilege. If the email already
exists, the supplied password must prove the single active credential; it is
never reset, attached to a federated account, or used to merge identities.

Each person becomes a distinct subject keyed by the import namespace rather than
its display name. Notes are attributed AI research source statements with their
original metadata and excerpt. The user authorized saving research notes, not
promoting their conclusions to confirmed facts or social identity. Platform
metadata retains `platform`, `url`, `handle`, `role`, `ownership`, `evidenceUrl`,
`captureStatus` and `use`. Source notes may contain the original `sources` array;
dossier notes should use zero-padded keys to preserve concatenation order. The
Person Web page groups those notes into a readable research archive and preserves
ordinary confirmed Memory separately. Links are displayed without automatic
fetching; unresolved identities retain no platform records.

Import and owner provisioning commit in one transaction. Repeating the exact
packet returns the same identifiers and adds no notes. Changed labels, edited or
removed notes, revoked evidence and credential conflicts abort without restoring
or replacing user work. Keep the private import receipt and packet digest for
readback. Ordinary Memory recall, edit, deletion and account cleanup continue to
own these entries; imported data grants no external-effect or Agent authority.

The current directory and search projection return up to 200 people (the Web
labels the cap). This makes a modest research library fully reachable instead of
silently clipping at 20. Larger libraries require explicit server-side search;
full pagination is a separate delivery. The import accepts up to 2000 explicit
people, but does not imply the directory lists all of them in a single response.
