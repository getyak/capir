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

The user authorized manual host delivery on2026-10-20. Symphony remains paused;
old worker Git/sandbox/service-gateway limitations are historical, not current
host blockers. A verified stash preserves the original candidate before main
refresh. The candidate is now based on main409c555a, including206 reading tokens.

-7 shipped-script tests pass, including System reset, later media changes,
  persistence failure/retry and foreign-origin refusal.
- Real build-for-testing passed. It caught an invalid WKUserScript.contentWorld
  getter in a new test; the host replaced that with an actual WebKit page-world
  versus isolated-world handler availability check using the installed SDK API.
-9 actual AppKit/WebKit XCTest cases pass on macOS26.4. They cover closed values,
  frame/origin rejection, preserved scripts, isolated native handler ownership,
  window detach/reattach/System, reduced-transparency fallback and standard
  titlebar buttons/drag-region policy. This is runtime evidence, not syntax only.
- Independent original review found no confirmedP0/P1/P2. The test repair and
  refreshed-main integration still require independent recheck before the PR.
- Private actual installed-native before frames at1123×865 and900×680 are
  preserved in host evidence. They contain only the authorized default test
  workspace, are private, and must never be uploaded to GitHub.

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
