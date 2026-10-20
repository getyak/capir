# GET-204 — One macOS workspace appearance

## Outcome and ownership

One local appearance preference governs the AppKit title bar, sidebar material
and Web reading canvas. System releases explicit appearance and continues
following later OS changes. AppKit owns traffic lights, dragging, activation
and menus; Web owns branding, destinations and content headings. Keep opaque
reading surfaces and the existing layout; remove duplicate native toolbar rows.
Account settings remain browser-owned. No backend or Web source is changed.

## Implementation

- Read only the existing local theme preference through a main-frame,
  exact-origin, isolated-world bridge with a closed System/light/dark enum.
- The View menu changes the same embedded-origin preference with existing
  persistence/failure feedback. System removes the stored override rather than
  saving a currently resolved color. Retain native history, reload and settings
  commands and standard window buttons/dragging.
- Apply explicit native appearance to the material surface and window; detach
  releases the window override. Reduce Transparency uses an opaque backing,
  and restoring transparency returns to active/inactive native material.

## Host takeover and verification

PR395 merged and official signed0.2.15(166) was installed with signature,
notarization, appcast and rollback verification. Nine original AppKit/WebKit
and seven script tests passed. Actual window testing preserved private captures,
zoom/drag/minimize/keyboard evidence and default-account authorization.

Final cross-check reopened acceptance: Light could leave the native titlebar
dark, and System could retain dark WebKit media despite global Aqua. Checking
the menu and an isolated NSView was insufficient. A minimal actual SwiftUI-host
probe reproduced the retained surface override while window.appearance changed.
The fixed probe clears both overrides and resolves Aqua again.

The follow-up passes the closed appearance enum as a value input to the
representable. Bridge/menu completion only publish the confirmed preference;
the material surface owns applying it to itself and its window. This avoids
SwiftUI skipping an update whose only inputs were an unchanged browser reference
and zoom. The live WebView, history and local draft stay in place. A new runtime
regression exercises the confirmed preference changes through an NSHostingView, reads back surface/window/WebKit media state and retains a synthetic
draft. The focused8-test runtime suite and7 existing JS contracts pass.
Earlier opaque-document and loopback full-bridge fixture attempts did not
establish the full chain; failures remain in private evidence and are not
claimed as passes. Production origin/world gates remain unchanged.

Symphony remains paused. Native private captures and full test/probe receipts
stay in host evidence; they must not be uploaded with workspace content.

## SwiftUI presentation follow-up

The signed0.2.16(169) readback confirmed the value-input fix repaired Light,
but Dark → System still retained dark content. Same-process traces narrowed it
to SwiftUI's intermediate platform host: app, window and root host resolved
Aqua while that host explicitly retained DarkAqua. This is an observed
integration failure, not a script/menu persistence failure.

ConnectedQuietWorkspace now gives SwiftUI the same closed preference through
preferredColorScheme and releases it on native sign-in or load failure. A
focused candidate run and actual Debug scene showed that nil alone still left
the platform host dark. The presentation modifier therefore also supplies the
colorScheme environment, following NSApplication.effectiveAppearance through
its public KVO publisher for System. It never changes the application's own
appearance and continues observing later changes instead of pinning Aqua. The
outer preview modifier emits a dark preference only when explicitly enabled;
ordinary launches emit no outer preference, since a higher-level nil would
cancel the workspace value. AppKit material retains its existing ownership;
no private host traversal or global appearance override is introduced. The
host regression uses the actual disabled preview modifier and also exercises
later application appearance changes plus surface detach/reattach with the
same retained WebView and draft. Earlier failed candidates remain private
evidence and are not counted as passing acceptance.

## Remaining delivery gates

Run documentation and whitespace checks; commit the candidate, independently
review, submit the linked PR, satisfy current-head CI and merge normally.
Build/install the native artifact from clean merged source through the existing
signed release path. Verify the same content after installation at default and
small windows, light/dark/System with laterOS changes, active/inactive,
Reduce Transparency/increased contrast,90–150%zoom, titlebar dragging,
traffic lights, native shortcuts/history and unsent-draft continuity.
Native screenshots must record the exact app/source and resident Web revisions.
Keep GET-204 open until actual application acceptance is complete.
