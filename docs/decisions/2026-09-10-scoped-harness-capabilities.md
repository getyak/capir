# Scoped general capabilities in the shared Harness

Status: file/computation implemented and independently reviewed in the GET-9
follow-up; [Web download](https://github.com/getyak/capir-evals/blob/main/evidence/get9-harness/completeness-run-files-web-ui.json)
and [native Simulator saving](https://github.com/getyak/capir-evals/blob/main/evidence/get9-harness/completeness-run-files-ios-ui.json)
are verified. Browser implementation and synthetic product verification are
recorded in the [browser review](https://github.com/getyak/capir-evals/blob/main/evidence/get9-harness/completeness-browser-review.md).
Production deployment and installed Chrome acceptance remain open.

## Context

The shared SDK loop already supplies product tools, Skills and source-aware
continuation. The original GET-9 request also asks for useful general file,
code and browser capabilities. Host shell access would expose the credentialed
SDK process and is not an appropriate product capability grant.

## Decision

Give the SDK callable capability groups backed by host-issued Run resources.
The host owns resource IDs, hashes, source references, scope, allowed operations
and expiration. Reads, computation return and derived-file persistence recheck
source authority. Derived artifacts inherit every input source and the shortest
expiration; model output cannot choose a host path or grant its own authority.

The first slice admits a host-created relationship Memory JSON file only when
its cited excerpts and speaker attributions are reviewed. It supports derived
TXT, CSV and JSON output with
JavaScript inside a fresh QuickJS WebAssembly runtime. A fixed trusted launcher
runs in a separate Node child process with no inherited credentials or Node
options. Model code enters QuickJS only, never Node eval/vm or Shell. No host
filesystem, network, process or module-loading bridge is registered.

QuickJS memory, stack and instruction interruption limits complement parent
hard timeout/kill, bounded input/output and bounded concurrency. Synchronous
execution and model-return JSON serialization happen inside the VM; returned promises and pending
jobs are rejected. The parent enforces a five-second child-process deadline and
waits for process closure before releasing capacity. This is not a hard bound on
the full API call, which also creates and removes its private directory. This is WebAssembly
capability isolation plus process lifecycle isolation, not an independent OS
permission boundary or full Node/Python/Shell support.

Artifacts are staged until the provider completes and persisted in the chat
transaction behind the final source fence. Their authority includes source
generation, image hashes, session scope and consumed history, prior Run, identity
expiry and Lab state. Revocation purges content and cached reply metadata.
Authenticated clients revalidate scope before download; Web also binds the
download to the current login and cancels it when its view disappears.
Arbitrary uploaded files are not admitted by this slice.

Browser execution uses a fresh container and private Chromium profile with no
user cookies, host mounts or direct network. A host broker mediates anonymous
public GETs for sources discovered by the current task, preserving consent,
source identity and browser provenance. Only same-origin resources and bounded
top-level redirects are admitted. This is a rendered public-page read; arbitrary
navigation, login, forms and cross-origin assets are outside its grant.
Container absence must be verified before capacity is reused; failed cleanup
closes further admission. Configuration and operational limits belong to the
[worker README](../../apps/agent-host/browser/README.md).

## Acceptance and reconsideration

Require actual scoped chat requests to reach the file/computation/browser
backends, followed by product artifact/source readback. Exercise infinite code,
memory/stack exhaustion, unresolved promises, oversized/circular outputs, host
access attempts, cross-Run residue, cancellation and source revocation. Do not
count schemas, interfaces or mock execution as product delivery.

Reconsider a dedicated OS-isolated service if native libraries, additional
languages, outbound network or arbitrary package installation are required.
Reconsider browser admission if complete request-level public-network mediation
cannot be demonstrated. Keep production browser capability unadmitted until its
verification, independent review and deployment checks pass. File/computation evidence and remaining acceptance limits are in
the [evaluation review](https://github.com/getyak/capir-evals/blob/main/evidence/get9-harness/completeness-run-files-review.md).

References: [QuickJS/WASM isolation and exposed APIs](https://github.com/justjake/quickjs-emscripten#exposing-apis),
[runtime limits](https://github.com/justjake/quickjs-emscripten/blob/main/doc/quickjs-emscripten/classes/QuickJSRuntime.md).
The implementation pins `quickjs-emscripten` 0.32.0.
