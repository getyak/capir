# Mobile test matrix

Select all rows relevant to the changed path. Record `pass`, `fail`, or `not_run` with evidence.

## Devices and environment

- Primary shared iPhone for relevant native paths.
- Compact iPhone only for affected small-screen, keyboard, or Dynamic Type risk;
  record the reason and use the repository native session/storage guard.
- Landscape where supported.
- Current supported iOS plus the oldest deployment target.
- Light, dark, increased contrast, and reduce transparency.
- Reduce Motion enabled.
- 200% localization expansion; Simplified Chinese and English minimum.
- Slow network, offline launch, network loss during extraction/write.
- Low Power Mode and app background/foreground during work.

## Content extremes

- Long and mixed-script Person/context names.
- No avatar, no role, unknown company, and missing context.
- One fact; many facts; long evidence; multiline recommendation.
- Ambiguous relative date, absent timezone, and crossed midnight.
- Same-name people and wrong-context suggestion.
- Cropped, low-contrast, quoted, forwarded, group-chat, and third-party messages.
- No-action input, contradiction, retraction, expired deadline, superseded state.
- New acquaintance without work, an undated promise, updated waiting state, and
  paused reminders. Verify a second visit retrieves current context rather than
  creating duplicate work or reviving a superseded plan.
- Evidence becoming unavailable while its observation timestamp remains present;
  freshness must not hide lost authority in either primary or continuation rows.

## Accessibility

- Dynamic Type default, XXXL, AX3, and AX5.
- VoiceOver linear order through import, evidence, edit, confirm, action preview, result.
- Every control has a meaningful name/value; no duplicated speech.
- State differences remain understandable without color.
- Default targets approximately 44×44 pt with adequate separation.
- For custom controls, inspect the actual accessible button bounds and tap the
  target. Padding or a SwiftUI frame alone does not prove the hit region;
  verify any content-shape correction on the rendered control.
- Contrast manually inspected; automated findings reviewed, not blindly accepted.
- Full Keyboard Access/Switch Control where applicable.
- Evidence highlights have a textual alternative.

## Permissions and external actions

- Photo access first ask, limited selection, denied, and later revoked.
- Contacts/calendar/notifications denied and changed while app is open.
- Duplicate contact, meeting, and reminder.
- Destination write succeeds, fails, times out, or succeeds after client timeout.
- Retry, cancellation, app termination, and relaunch reconciliation.
- Undo/correction where supported; audit entry always visible.

## Structured conversation results

- Decode a real producer-shaped response before judging native parity. HTTP
  responses and persisted Session projections can use different field names;
  a locally constructed model cannot prove either wire path.
- Open the result with its actual surface, source Session and exact target
  scope. Include a follow-up referring to an earlier image and a canonical
  steering message; the answer turn is not necessarily the source message.
- Perform the primary decision and read the actual destination, then return
  to the same conversation. Adding a contact must leave undecided details
  available; saving one detail must not silently skip its siblings.
- Lose the response both before dispatch and after server success. Relaunch,
  reconcile and recover the same protected operation; never substitute a new
  operation merely because its result is unknown.
- Read the source while editing, return, and verify the draft survives.
  Separately revoke the source or account authority and verify pending private
  recovery material is removed without erasing the safe operation identity.
- Exercise native APIs against the oldest deployment target during compilation;
  a source parse or a newer Simulator alone does not prove compatibility.

## Evidence capture

For each failure retain:

- build/version and device;
- start state and exact steps;
- screenshot/video/accessibility output;
- expected versus observed;
- severity and affected user;
- retest result after correction.
