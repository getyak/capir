# User-provided public identity clues

## Purpose

Let a user research a person they name themselves. The user writes an explicit
research name (Chinese or English) in the conversation message, optionally with
that person's canonical public homepage. The workspace conversation Run can
then run one bounded public search and same-run source reads, and answer with
cited, tentative public background. This is research about a user-named public
subject; it never identifies a person in a photo and never confirms an identity.

## What the user provides

- An explicit positive research clause, for example `研究 张三 的背景`,
  `research Simon Willison`, or `研究 Simon Willison https://simonwillison.net/ 的背景`.
- The name must be a complete bounded name: two to four Han characters, or a
  full Latin name with at least two capitalized words. First-name-only English,
  pronouns, generic targets and time words are rejected. A homepage is
  optional and must be that name's own canonical public homepage.
- The whole target is consumed together with only its legitimate terminal
  suffix (`的背景`, `的作品`, `的文章`). A hostile or instruction tail anywhere
  else rejects the whole target instead of being sliced away.

## What runs

- Only the positive authored clause registers a bounded host subject. Unrelated
  private contacts, notes and other clauses never become research subjects.
  A plain image, a photo of two people, or an image with no explicit identity
  asks for the name instead of searching; an image can never confirm who a
  person in a photo is.
- URL-only input is incomplete identity. The user must supply or clarify a
  name; the system never invents a name from a domain or face and never claims
  an unrun URL-only lookup worked. A provided but invalid URL rejects that
  whole target honestly; it never degrades into name-only research.
- The homepage is a search query anchor only. Admission is strict: canonical
  public HTTPS roots plus exact platform profile forms are accepted;
  credentials, non-default ports, queries, fragments, deep paths, IP alternate
  representations, local/internal/pseudo suffixes, encoded contacts,
  instructions, backslashes, control characters and dot segments are rejected
  before parsing. The homepage is never direct fetch permission.
- With several names, each name binds its own homepage; mixed, repeated or
  ambiguous assignment rejects the whole target. The combined name and
  homepage must already fit the existing 100-character person-research query
  bound; an over-limit target is rejected whole rather than dropping the
  homepage or widening the bound.

## Authority and source isolation

- One research authority is one COMPLETE clue: the bounded name together with
  its own canonical homepage (or its own source-grounded anchors), bound to
  its own exact user-authored source (message identity plus unchanged text) or
  its own image authority. Two same-named people with different homepages are
  different authorities: they never share a subject id, source guard, cached
  source receipt or fetch.
- If one authored input gives one name conflicting clues (for example two
  clauses with different homepages, or name-only beside name-plus-homepage),
  that name fails closed and needs clarification. It is never a silent
  first-or-last choice and never a name-only downgrade; independent unrelated
  names in the same input still research normally.
- The exact same complete clue written in several current messages is one
  deduplicated authority: it stays researchable while any exact unchanged
  source supports it, and removing or editing one message revokes only that
  message's support. A different homepage is a different authority and can
  never revive an old source receipt.
- Every discovered source stays bound to the authority that first discovered
  it in this run; a later fetch can never switch to another authority. A
  tentative first-contact proposal runs under its own name-only (or anchored)
  clue and never borrows a name-plus-homepage authority.
- An explicit `do not search` clause or steering message removes all search
  authorization, before or during the Run. Cancellation stops further reads.

## How sources are read

The existing read-only research transport is used unchanged: the local contact
research client to the Agent Host contact research service, which calls the
fixed Exa search and contents endpoints. No page is fetched directly from the
workspace, and the homepage URL itself is never fetched because it was
provided. The outbound query is derived only from the registered name and its
own admitted homepage or context anchors; conversation text, screenshots and
private notes never cross the boundary. Model tool arguments accept only a
host subject id.

## What the answer may claim

- Discovered and fetched sources carry real same-run receipts (url, title,
  content hash, retrieval time, stage). Citations are drawn from those
  receipts; a model-printed URL without a fetch receipt is not a source
  receipt and never confirms an identity or a fact.
- The subject stays tentative: a same-name search result is never proof that
  the result is the person in any photo. Same-name ambiguity is reported
  as such.
- No contact or Memory record is written automatically. Consequential writes
  keep their existing human-confirmation path, and no external action is
  authorized by research.
- Each subject stays researchable only while its exact user-authored source
  (message id plus unchanged message text) or its image source remains
  current and the host ownership check passes. Revocation takes effect before
  any further provider read; a message whose text was edited no longer
  supports its original clue even if the edited text repeats it.

## Acceptance status

Deterministic registry, controller and acceptance tests cover the behaviors
above with a fake research client and a test-only provider adapter. Isolated
live Web acceptance on a clean resident deployment (real UI/API flow, cited
answer rendering, and a zero-write cleanup pass) remains parent-owned follow-up
work and is not claimed here.
