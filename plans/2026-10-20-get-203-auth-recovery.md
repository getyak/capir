# GET-203 — Authentication recovery and deployment readiness

## Outcome and boundary

Restore ordinary Web/Mac sign-in and distinguish invalid requests, restricted
test identities, temporary network/service failures and uncertain completion.
Keep exact-origin, PKCE, one-use grants, selected-store identity readback,
normal browser confirmation and rollback gates. Do not inject credentials.

## Confirmed findings and implementation

The Web authorization catch previously treated any error with a code as an
expired request. Real backend errors include temporary503 and transport reset,
restricted403IDENTITY_REFUSED, and permanent403PROOF_MISMATCH or409ORIGIN_NOT_ALLOWED.
Classify these explicitly, retain400/404/410invalid requests and401ordinary
reauthentication, and provide an actionable identity restriction message.

The installer previously collapsed every provider/transport/ownership failure
into one generic readiness error. Add bounded sanitized observations and a
private candidate readiness receipt while preserving the45-probe, clean build,
listener ownership and rollback gates. Limit response bytes and save no bodies,
query strings, raw exceptions, environment values or credentials.

## Host verification

-12 authorization classification/reauthentication/localization tests pass; changed-fileESLint
  passes. Independent review closed the permanent-mismatch P2 and found noP0/P1.
-6 standard-library readiness tests pass, covering network/HTTP/payload/provider/
  ownership refusals, byte bounds, privacy, transient recovery and45-probe failure.
- Current clean Web activations and normal launchd restart recovery pass.
- Normal default test@ browser confirmation approved a real installed Mac0.2.8(125)
  session; exact backend identity and the actual protected workspace were verified.
  The isolated Lab identity was refused by design; no auth gate was widened.
- A task-owned loopback fixture, with no credential/approval and a6-second expiry,
  exercised the actual Debug native app and transport: initial sign-in, waiting,
  expiry, visible working restart with a different request, then explicit cancel.
  The server observed exactly2prepares/2cancels. This is controlled native recovery,
  separate from actual resident authentication. No unsupported SwiftUI.id fix.
- An attempted XCTest UI harness never reached product code (unsigned runner was
  refused; a valid ad-hoc runner then failed to launch the target). It is not a
  passing test. Its diagnostic source/results remain private host evidence; the
  normal host UI fixture supplied the actual interaction evidence instead.

## Evidence limits and remaining delivery

The two historical readiness failures were not reproduced and their old generic
logs do not prove a cause. An earlier installed-app retry disappearance was not
reproduced in the controlled current-source expiry loop. Preserve these limits;
do not invent a historical root cause or claim an unobserved fix.

Preferred Pi diagnosis was stopped after44minutes without code; no automatic
model retry/provider fallback. The parent implemented the bounded fixes.
The first PR head passed2694Web tests but failed the i18n extraction ratchet.
The six new error strings now use the existing cached server locale and ship
four non-source locale catalogs; the residual manifest shrinks23to20. The
19auth/coverage tests and independent localization review pass.

Complete current-head CI,
merge normally, deploy the clean merged Web and read the new readiness receipt.
Recheck actual Web/default-owner Mac login, healthy restart and protected content,
record exact service/native revisions, then assess issue acceptance honestly.
