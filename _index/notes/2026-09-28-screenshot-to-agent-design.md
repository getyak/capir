# Screenshot directly to Agent: Mac menu-bar proposal

- Status: user-requested Figma design; proposed behavior, not implemented.
- Date: 2026-09-28.
- Supersedes: the text composer and current-task panel from the earlier menu-bar exploration.
- User direction: screenshot first, minimal steps, automatic upload and Agent processing; remove the current-task section; keep the menu elegant and useful.
- Scope: research and editable Figma design using synthetic content. No real screenshot was submitted for model processing, no new screen permission was granted, and no product code changed.
- Delivered: [Figma design section](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f?node-id=220-1991), [compact menu](https://www.figma.com/design/7Z8yHplvwjVhpq8IuKv87f?node-id=220-1997), and [verification record](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-28-menu-bar-capture/README.md).

## Decision

Use an integrated native region-capture entry backed by Apple's capture APIs. Borrow the low-friction capture/action rhythm of CleanShot and the lightweight presentation of Shottr; do not require either application or route relationship screenshots through their image hosting.

After initial explanation, enablement, sign-in and required system permission, the normal loop is:

1. Press a configurable global shortcut, or choose Screenshot to Agent from the menu.
2. Drag a region and release. Upload and Agent admission start automatically.

There is no save dialog, file picker, mandatory preview, relationship selector, prompt form, or second Send in that loop. Pressing P during selection enters an optional crop/redact/preview path; the visible Preview control exposes the same route. Space switches to window selection, preserving a familiar capture convention. The proposed launch shortcut is Control-Option-S, subject to conflict detection and user remapping.

This is the preferred fit for this product, not a benchmark claim that one capture implementation is universally fastest.

## Research and alternatives

| Source | Verified behavior or scope | Decision |
| --- | --- | --- |
| [CleanShot official URL API](https://cleanshot.com/docs-api) | Area/window capture supports an after-capture action, including copy, annotate and upload. | Borrow immediate capture-to-action. Its cloud upload is not our authenticated Agent intake and a third-party dependency adds setup. |
| [Shottr official site](https://shottr.cc/) and [URL commands](https://shottr.cc/kb/urlschemes) | Lightweight native screenshot utility, region/fullscreen commands, OCR and upload capabilities. | Borrow speed and compact feedback. External-tool import may be a later convenience, not the default workflow. |
| [MacShot repository](https://github.com/sw33tLie/macshot) | Native Swift/AppKit capture and annotation, region selection, window snap, scrolling capture and upload destinations; repository declares GPLv3. | Useful interaction reference. Do not copy implementation into this repository as part of design; broader tools and annotation need not become our menu. |
| [Snap repository](https://github.com/J-1000/snap) | Native capture with region selection, multiple monitors, shortcut preferences and ScreenCaptureKit; project labels itself WIP. | Study selection geometry and keyboard behavior; not evidence that a dependency is release-ready. |
| [Apple SCScreenshotManager](https://developer.apple.com/documentation/screencapturekit/scscreenshotmanager) | Captures individual images with a filter/configuration. | Use the platform capability beneath our owned interaction and authenticated upload. Verify API availability for each supported macOS version. |

The existing [SystemWindowCaptureService](../../apps/macos/Sources/Services/SystemWindowCaptureService.swift) already uses ScreenCaptureKit's system single-window picker and local Vision OCR. It is not a region-selection UI, and its comment explicitly keeps the raw image local. Automatic raw-image upload is a new, explicitly disclosed capture intent; do not silently repurpose the old local-only contract.

## Menu composition

- Approved monochrome Held Interval mark in the system menu bar.
- A compact 320-point panel, with one dominant Screenshot to Agent row and visible shortcut.
- Continue last conversation and Open workspace as secondary entries.
- Settings and Quit in a quiet footer.
- No text composer, task list, pending-task count, miniature calendar, or generic dashboard.
- Defer the next-meeting row until usage establishes that it earns this space.

Two visual directions use the same commands: a compact native menu and a larger hero-style capture panel. Recommend the compact version because additional hero space adds no new capability. Use existing local styles, semantic variables and approved brand/window components. Use native material in implementation with an opaque reduced-transparency fallback; the Figma rendering is a visual approximation.

## Capture and lifecycle

- Hide our menu and transient overlays before capturing. The crosshair and bounded selection reveal exactly what will be uploaded. Capturing the frozen screen locally to implement selection does not authorize uploading the surrounding pixels.
- Retain Retina text legibility, account for point-to-pixel scale and multi-display coordinates, and validate the resulting image rather than merely the selector outline. Do not blindly reuse a 2560-pixel downscale cap for long text screenshots.
- Escape before submission cancels with no upload. Optional preview keeps bytes local until explicit Send.
- Bind capture intent to the authenticated workspace/account at initiation. Revalidate before upload; an account or destination change must not redirect a queued image.
- A new capture starts its own recoverable Session by default. Do not append private input to whichever previous conversation happens to be selected. An explicitly Session-scoped capture may continue that exact Session.
- One operation ID owns staging, upload, admission and recovery. Content hashes may assist integrity checks but must not silently merge separately intended captures.
- Distinguish uploading, admitted processing, viewable result, failure and unknown outcome. No invented percentage, no optimistic claim of saved facts.
- A small anchored transient says Analyzing screenshot, then Ready to view. It never steals focus or opens the workspace automatically. Closing this transient only hides presentation.
- Result entry opens the exact protected Session with the submitted screenshot and answer. No name or conversation text appears in ambient status.
- If the network fails before upload, retain an encrypted device-only recovery item for a proposed maximum of 24 hours, with retry and delete. This is a proposed local expiry, not the existing workspace source-retention policy. Reauthentication may be required before replay.
- Unknown upload outcomes reconcile the same operation before retry. Retry never creates another Agent task merely because the first response was lost.
- Captured text is untrusted data. It cannot instruct the Agent to widen access, confirm identity or execute external actions. Analysis and draft generation can proceed automatically; consequential writes keep their existing separate human decision.

## First use and preferences

First use explains that selected pixels go to the current workspace and its configured model processor, how to inspect the processing/retention details, and that selection release is the submission gesture. The specific configured destination/processor must be available from that explanation; do not substitute a generic cloud assurance. Changing that processing scope requires renewed disclosure. OS screen-capture permission is a separate user-owned decision; the Figma Enable capture button illustrates entry, not a bypass of system permission.

Settings → This device includes:

- Show Talent Signal in menu bar: on by default, persisted locally, immediate.
- Screenshot shortcut: editable, conflicts detected.
- After selection: Send directly to Agent; optional Always preview alternative.
- Top activity hint: off by default; optional custom Mac capsule, not claimed as a system Dynamic Island API.
- Start at login: off and independent.
- Screenshot processing and retention details.

Hiding the menu does not cancel work, log out, remove the Dock entry, or erase a screenshot. Settings remains accessible through the main window and Command-comma. The optional top capsule shares generic lifecycle state and opens the same Session; it must not create another task interface or duplicate companion/notification alerts.

## Figma verification boundary

The target is the existing `Talent Signal · macOS 工作区视觉方案`, file `7Z8yHplvwjVhpq8IuKv87f`, Desktop & Web page `0:1`. The proposal is grouped in one feature section and linked from the existing page directory. Keep original user designs and their navigation intact.

Required examples: compact menu, region selection, non-disruptive processing feedback, Session result, native preferences, dark appearance, first-use disclosure, permission/offline/unknown/preview recovery, and equal-function density comparison. Reactions only illustrate navigation; screenshots, upload, model processing, settings persistence and OS permission are not executable in Figma.

Before implementation, verify the real workflow with macOS 14 and current macOS where available, mixed-DPI displays, permission denied/revoked, wrong account, IME-free shortcut capture, cancelled selection, optional preview, network loss, unknown server receipt, Session readback and deletion. The design is not a privacy or reliability certification.
