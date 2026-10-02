# Independent browser verification

Verified using the Playwright CLI against the task-owned Next server at
`http://127.0.0.1:3217`, Chromium, 2026-10-02. This is local browser evidence,
not proof that the public domain serves this revision.

## Visible result

- [Previous desktop baseline](baseline-desktop.png).
- [New Chinese desktop](home-desktop.png), [Chinese mobile](home-mobile.png),
  [dark mobile](home-mobile-dark.png), [English dark desktop](home-desktop-en-dark.png).
- [Reviewed next-screenshot state](home-updated-desktop.png).
- Direction A prototypes remain in this directory; [B desktop](prototype-b-desktop.png)
  and [B mobile](prototype-b-mobile.png) preserve the continuity alternative.

Root inspected the actual rendered source, directed graph and response rather
than inferring quality from a build. The final layout uses A's concrete source
and result, with B's time continuity in the following section. Desktop keeps the
chat, causal chain and useful response together. Mobile collapses the long chat
to an attributed excerpt, then shows the Agent result before the chain. At
390×844 the page's scrollWidth is exactly 390; there is no horizontal overflow.
Light and dark views keep incoming white/outgoing green WeChat-style hierarchy.
All source chat is synthetic and explicitly labelled.

## Interaction and accessibility

The actual page was exercised through identity ambiguity, keeping an unbound
clue, explicit identity choice, save, next screenshot, same-item update, pause,
source withdrawal and explicit new-demo reset. Source words were opened and
then became unavailable after removal. Replay is disabled after source removal;
the reducer separately rejects replay, so removed material cannot return through
that action. The same person projection also withdraws dependent context.

After a fresh navigation with reduced motion enabled, the readable review state
and save button were immediately available. Keyboard Tab focuses the skip link;
Enter activates the focused save action. English FAQPage contains four questions,
all matching visible English summary text. The fresh-navigation console/page-error
collector recorded zero errors; earlier development-only HMR dependency-array
warnings occurred while effects were edited and do not recur after reload.

The default-motion introduction was observed settling into the human-review
state. Full hidden-tab and late-timer guards also have component/reducer test
coverage; no native device, real account or live WeChat connection was used.

Machine-readable presentation receipt: [browser-presentation.json](browser-presentation.json).

Interaction receipt: [browser-flow.json](browser-flow.json). Full final page: [desktop](home-full-desktop.png).
