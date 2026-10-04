# Talent Signal browser capture

A Chrome Manifest V3 extension for intentional page text, selected text,
visible-tab pixels, a user-chosen screen/window, and screenshot files. Reviewed
sources enter the signed-in account's durable contact task pipeline. AI may
create or reuse an internal Person and preserve proposed source observations;
it cannot confirm facts, merge people, contact anyone, or execute external work.

This extension is distinct from the repository's Codex plugin. Image profile
drafts require human confirmation in the shared review view before saving.

## Use

1. Open `chrome://extensions`, enable Developer mode and choose Load unpacked.
2. Select `apps/browser-extension/load-unpacked` (or build the distributable with
   `node apps/chrome-extension/scripts/build.mjs`).
3. Open the extension from a source tab. Select text, read page text, capture the
   visible area, choose a screen/window, or upload a screenshot.
4. Review the exact text/pixels; edit, crop or redact before continuing. Connect
   to your Talent Signal Web origin (default `http://localhost:3000`) and sign in
   in its Web tab. HTTPS origins request access only to the chosen workspace.
5. Submit the reviewed source. Open its exact task in `/workspace/captures` to
   inspect processing, identity questions, source, analysis and the Person.

The toolbar/shortcut grants temporary `activeTab` access. Whole-page text reads
rendered `main`/`article` text, falling back to visible body text; it does not
crawl links or read input values. The text limit is 50,000 characters. Screen
capture uses Chrome's explicit picker and stops every video track immediately
after extracting one frame. Only the reviewed crop is uploaded.

## Authenticated handoff

The extension runs a narrow, same-origin fetch inside a tab at the chosen Web
origin using `chrome.scripting`. The browser attaches its HttpOnly session; the
extension never reads credentials. Reviewed text uses these narrow capture endpoints:

```text
GET  /api/browser-extension/session
POST /api/browser-extension/captures
GET  /api/browser-extension/captures/:request_id
```

Images preserve the shared Agent's existing session-bound `/api/contact-agent`
transport and recovery journal. It keeps only the origin, opaque session binding
and operation key across extension restarts, never raw pixels or text. The image
receipt opens the same workspace capture view; profile confirmation remains in
that view. Text uses the same SDK runner and stores unconfirmed document evidence;
it cannot establish confirmed profile fields or identity handles.

Web validates the actual account, user/session version, target origin, source
kind, bounded payload, retention and explicit submit decision before calling the
backend's existing contact task API. A stable browser request key reconciles
retries in PostgreSQL. A receipt includes the durable `task_id`; a `capture_id`
and Person may appear later. Received means durable admission, not AI completion.
Unknown network results remain unknown until reconciliation or a same-key retry.

No fixture login or synthetic text substitution is used on this real path.
Synthetic fixture mode remains network-free and explicitly labeled.

## Optional evaluation fixtures

The eight-case candidate-momentum evaluation corpus is not shipped in this
package. It has one authoritative private home: the private
`getyak/capir-evals` repository (GET-134). Disposable private evaluation runs
may inject the canonical `evals/candidate-momentum-v1.json` as
`load-unpacked/fixtures/candidate-momentum-v1.json`; until a suite loads
successfully, the "Synthetic fixtures" mode option stays disabled and the
panel runs in live mode. Corpus absence is a normal live-mode state, never a
fixture-package error, and `?mode=fixture` degrades clearly to live. The panel
never fetches remote corpus data, and `scripts/validate-package.mjs` does not
require the corpus file. See
[`load-unpacked/fixtures/README.md`](load-unpacked/fixtures/README.md).

## Lifecycle and recovery

Reviewed pixels use the existing account/task-scoped image store. Text, source
metadata and model checkpoints use the existing durable task. The normal
retention is at most 30 days. Unsupported ephemeral/full-source options are
blocked rather than silently changed. Source deletion in Web fences running
work, deletes governed evidence/derivatives and purges retained images. People
with no remaining source are removed through the existing deletion contract.

Missing identity and multiple people stay reviewable; no-person sources finish
without inventing a Person. Failed and interrupted work resumes on the same task.
The Web inbox refreshes across devices and links to the actual person and source.

The image recovery journal keeps at most 20 metadata records for 30 days and
cleans expired records when read. Capacity eviction removes only completed
records; pending or unknown submissions remain protected. A missing or expired
record does not prove that submission never happened. Check the workspace's
existing task before submitting the source again; never infer failure from a
lost local receipt.

## Permissions

| Permission | Purpose |
| --- | --- |
| `activeTab` | User-initiated source access |
| `scripting` | Read the selected source; send capture requests inside Web |
| `sidePanel` | Review the exact source |
| `desktopCapture` | Explicit screen/window picker for one frame |
| `storage` | Existing metadata-only image receipt recovery journal |
| Loopback hosts | Local Web handoff |
| Optional HTTPS host | Only the user-selected Web origin is requested |

There is no ambient content script, cookies/history access, remote script,
external messaging endpoint, background capture, or automatic public research.

## Verification

```sh
node --test apps/browser-extension/tests/*.test.mjs
node apps/browser-extension/scripts/validate-package.mjs
node apps/chrome-extension/scripts/build.mjs
```

Backend, Web and model checks are recorded in
[`plans/web-capture-pipeline.md`](../../plans/web-capture-pipeline.md).

## Platform sources

- https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
- https://developer.chrome.com/docs/extensions/reference/api/scripting
- https://developer.chrome.com/docs/extensions/reference/api/desktopCapture
- https://developer.chrome.com/docs/extensions/reference/api/permissions
