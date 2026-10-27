# Send continuity: current client evidence and implementation options

Observed on 2026-10-26 (Asia/Shanghai). This is the GET-233 research intake,
not a claim that competitor desktop animations have been measured. The
[execution plan](../../plans/2026-10-26-get-233-send-continuity.md) owns delivery
state. [Product](../../docs/product.md) and [Design system](../../docs/design-system.md)
own the product boundaries.

## What current primary sources establish

| Surface | Verified source evidence | Useful implication | Evidence boundary |
| --- | --- | --- | --- |
| ChatGPT desktop | General settings distinguish Enter/Cmd-Enter submission and follow-up steering versus waiting for another run. [Current settings](https://learn.chatgpt.com/docs/app/settings) | Preserve input availability; distinguish sending intent from what an active run can accept. | This is current documentation, not a recorded send interaction in an authenticated competitor account. It does not establish frame timing or cache behavior. |
| ChatGPT Classic on macOS | Release notes identify the former macOS app as Classic, and document interrupting streaming through Cmd-period. [macOS release notes](https://help.openai.com/en/articles/9703738-chatgpt-macos-app-release-notes) | Keep a direct stop action and separate application generations when comparing behavior. | The historical streaming improvements do not prove the new desktop client's current layout or an absence of sidebar flicker. |
| Claude Chat on Web/desktop | Getting started describes explicit prompt submission, a nearby model control, and additional input options. [Get started](https://support.claude.com/en/articles/8114491-get-started-with-claude) | Keep the composer as the stable interaction anchor and secondary choices nearby. | No undocumented desktop FIFO, optimistic acknowledgement or exact transition duration is inferred. |
| Claude desktop availability | Official installation guidance distinguishes Chat, Code and Cowork, with different plan availability. [Install Claude Desktop](https://support.claude.com/en/articles/10065433-install-claude-desktop) | Name the product mode before borrowing an Agent interaction. | Code/Cowork semantics are not treated as proof of ordinary Chat behavior. |
| Claude Code | Current interactive-mode documentation explicitly covers queued input, interruption, taking queued input back and deliberate immediate submission. [Interactive mode](https://code.claude.com/docs/en/interactive-mode) | Queue identity and reversibility matter; immediate feedback must retain actual waiting and recovery. | This is a terminal Agent reference, not a macOS Chat visual benchmark. |

No private capri conversations or screenshots were uploaded for this research.
Public documentation establishes semantics; it cannot substantiate a claim
that either competitor never flashes during a send. Those unmeasured details
remain unknown. The selection below follows observed capri defects rather than
an invented imitation of competitor animation.

## Reproduced capri defects

The controlled fixture runs the real client fetch wrapper, directory hook,
sidebar and conversation renderer. It intercepts synthetic admission and SSE;
it does not invoke a model or create a billable task. The authenticated baseline
uses resident Web revision `285bfd8b`, Chromium 153.0.8010.12 at 1280 by 900.
Relevant baseline source files were compared with isolated `fa01bb1c`.

1. A successful send invalidates the shared directory. Its owner publishes
   `null` before the refresh completes. Existing recent-session nodes unmount,
   skeletons appear, and subsequent rows are new DOM nodes.
2. A queued message already has its identity-stable transcript pair. The
   composer dock repeats its objective and mounts a second layout region.
   The same message is visible twice and the dock changes the space available
   to the transcript. Frame measurements keep the composer at the same bottom
   anchor; they do not substantiate a claim that its input itself moves.
3. The preview fixture exposed text inside the existing closed execution
   disclosure. A received first fragment is not reported as painted answer
   text merely because its DOM node exists.

## Comparable options

| Option | Behavior | Tradeoff | Decision |
| --- | --- | --- | --- |
| A. Retain authorized send projections | Keep the same mounted sidebar rows during additive send refresh; still evict the shared cache and fence stale requests. | Smallest sidebar correction, but repeated queue content and the extra dock region remain. | Necessary, insufficient alone. |
| B. Stable transcript with inline queue management | Combine A with one user bubble and controls beside its exact message's assistant/status row. Preserve actual queued, failed, paused, retry, withdraw and steering states. | Controls move to the message they manage; requires focus and lifecycle regressions. Removes the duplicate dock and its separate layout region. | Selected smallest complete slice. |
| C. Reserved dock plus staged transitions | Keep a permanently reserved queue region or time-gate its appearance. | Wastes idle space or introduces timing policy; can conceal real short queued states without repairing directory ownership. | Rejected. No global opacity, artificial wait or scheduling change. |

## Acceptance boundary

Retain exact request/message/session identity and unsent text/attachments.
Destructive mutations, account changes, any applicable 401, logout and expiry
still retract old projections immediately. Slow genuine waiting remains visible
and actionable. Fixture state is explicitly distinct from live backend execution
and from the installed macOS client's payload. Exact-head CI, merge, resident
deployment and installed-client acceptance remain required delivery evidence.
