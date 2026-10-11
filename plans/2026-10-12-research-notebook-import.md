# Research notebook import

## Outcome

Save explicitly authorized person research under a password-authenticated personal
workspace, and provide a readable Person page with structured platform links,
research judgments, source limits and complete historical dossiers.

## Boundary and decisions

Reuse subjects, attributed Memory source statements and their independent retained
note evidence. No new table, identity handle, verified public profile, human gold,
confirmed fact, task or external-effect permission is created. Imported AI prose
remains visibly unreviewed research. The source of these notes is the supplied
research packet, not a claim that every linked page was read in full. Explicit
operator provisioning uses the existing normalized-email reservation and password
encoder, proves existing credentials instead of replacing them, and leaves mailbox
verification unset. There is no shared/default credential or startup seed.

Private packets, credentials and runtime evidence remain outside Git. Replays are
account-bound and atomic; edited/deleted/revoked notes cause conflicts rather than
being overwritten or restored. The existing Memory deletion and account cleanup
paths own lifetime. No parallel authoritative contact store or new MCP is needed.

## Milestones

1. Define and test bounded private notebook ingestion and owner provisioning.
2. Render structured research alongside ordinary Person Memory.
3. Import, replay and read back the authorized packet; prove password login,
   account isolation, structured links and unknown identities on the live surface.
4. Deploy the affected resident Web from clean committed source and verify revision.

## Completion evidence

Focused parser/render and PostgreSQL transaction tests, type checks, clean-source
Web build and real browser login/directory/detail/source inspection. Counts and
receipts are private; passing deterministic tests does not mean AI judgments or
account attribution were human reviewed. Native acceptance and further crawling
are not part of this import.

## Current state

Implementation and synthetic transaction/renderer checks passed. Authorized
private input was imported and exact replay added nothing. Live sign-in exposed
the existing 20-person directory cutoff; the shared bounded projection is now
200 with a visible cap. Live readback and clean-source deployment remain active.
