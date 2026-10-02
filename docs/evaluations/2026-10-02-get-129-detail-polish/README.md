# GET-129 conversation detail polish evaluation

Date: 2026-10-02. [Plan](../../../plans/2026-10-02-get-129-detail-polish.md).
This follow-up refines utility chrome and person-preview rhythm after
[the deep alignment evaluation](../2026-10-02-get-129-deep-alignment/README.md).
Its acceptance scope is production-mode Web with an isolated synthetic backend.

## Grounded changes

Figwright read the current Desktop section `31:68` without navigating the
currently selected Mobile page or writing to the design. Full reads cover
composer `404:2355`, utility popover `31:585`, person preview `537:3423`
and drawer close `31:699`. The source screenshots and measured trees remain
in the local evidence archive below. The connector reports the design title
but no current file key; historical links are not used as current identity proof.

| Detail | Implemented behavior |
| --- | --- |
| Inline composer | 62px baseline, 16px radius, 10px horizontal inset, 8px gaps; multiline growth retained |
| Floating utilities | 18px radius, existing quiet border, one 0/8/24 shadow at 10% ink |
| Suggestions | Warm selected token, primary 14/22 and secondary 12/20 |
| Person preview | 8px group rhythm, 2px identity/provenance gap, 32px minimum property row |
| History | 6px group gap, 42px minimum content rows, 2px title/provenance gap |
| Drawer heading / close | 14/24; desktop close 40px at y82 with content y92; mobile target 44px |
| Sticky drawer | Same geometry at initial open; opaque extended chrome and inset focus ring prevent scroll bleed/clipping |
| Short mobile details | Fixed above the persistent navigation at <=640px width and <=320px height; bounded scroll, reachable summary toggle and 44px actions |
| Image viewer | 40px desktop and 44px mobile close; authenticated byte loading and dismissal retained |

Only four CSS modules change. Sending, IME handling, account fences, draft
recovery, immediate private-content removal, source semantics and permission
boundaries remain owned by their existing implementations. Dynamic identities
and brand assets are not replaced by design sample people or unsupported actions.

## Direct evidence

[Desktop receipt](desktop-receipt.json) records actual layout, menu search focus,
ArrowDown/Escape behavior, an unsent multiline draft, an IME composition Enter
event, and drawer removal/focus recovery. This event check supplements the
existing host tests; it is not native operating-system IME acceptance.

[Responsive receipt](responsive-receipt.json) , [theme receipt](theme-receipt.json)
and [motion receipt](motion-receipt.json)
record the final short-window, mobile, original-image, reduced-motion and saved
appearance observations. Review checks target rectangles and occlusion, not
HTTP 200 or an element's presence alone. No deletion action is executed.

The backend uses a disposable named database, the ordinary password entry and
real capture, queue, Session, Memory review and commit APIs. Its built-in
username and email are both `test@gmail.com`. A queue fixture must use an
unresolved-intent Session; relationship Sessions use the scoped conversation
path. The rendered opinion is explicitly saved as `user_opinion`, with its
speaker, observed time and source retained. The image fixture is an existing
public icon asset. An injected deterministic adapter makes no remote model calls.
No customer data, cookies, grant secrets, review credentials or undo tokens
are included in published evidence.

The local screenshot/source archive is:
`/Users/cubxxw/.codex/visualizations/2026/10/02/get-129-detail-polish`.
[Artifact manifest](artifact-manifest.json) binds reviewed files to hashes.
Images remain outside the text-only PR review input.

## Checks, review and limits

The three focused host suites pass 45 tests. Production build and typecheck
pass; lint has zero errors and six existing warnings. Documentation validation passes. Latest-head CI is recorded during delivery.

[Independent review](review.md) records the confirmed findings and their final
closure. The assessment concerns this bounded Web slice; it is not a universal
quality certification, model-quality score or native authentication proof.

The resident password entry, configured reusable `capir auth` environment and
signed native login acceptance remain outside this proof. Follow
[account access](../../operations/account-access.md) rather than inventing a
bypass. GET-129 remains In Progress until the original acceptance is complete;
this follow-up uses a related PR without a closing keyword.

