# Web private conversations

Web private conversations use a separate, text-only room. They keep the current
transcript only in page memory and send bounded recent text to the configured
model through a stateless transport. They create no saved conversation, queue,
Memory, content evaluation trace or browser draft; they cannot read directory
records or execute tools. Exit, navigation, refresh, or a detected login change
clears the room and cancels pending work, while ordinary drafts retain their
account-bound lifecycle. This is a capri retention boundary, not a
promise about the model processor's retention or training policy.

## Transport and limits

The Web room lives at `/workspace/private`; normal workspace chrome, history,
directory and Lab clients are not mounted there. Its BFF checks origin, live
authentication, rendered workspace and login binding before reading the body.

The backend endpoint `/v1/private-conversation` accepts alternating user/assistant
text only: at most 24 messages, 24,000 characters in total and a 4,000-character
new question. The direct provider stream has a 60-second deadline, 32,000-character
answer limit, bounded upstream frames, explicit completion and no automatic retry.
It bypasses Agent SDK session files, task queues and content observation hooks.
An unsupported explicitly configured proxy fails closed instead of using a
different transport. Per-process limits allow two concurrent requests and twelve
starts per minute for each authenticated account.

Only a complete answer contributes to later context. A failed latest turn can be
retried explicitly; older incomplete turns cannot rewrite subsequent context.
Ordinary conversation persistence and external-action authority remain separate.

## Verification

Provider and route boundaries are covered by `privateConversation.test.ts`;
the real application authentication-only SQL boundary is in `app.test.ts`.
Web tests cover stale sessions before body reads, cross-workspace rejection,
interrupted streams, IME input, late responses, ephemeral lifecycle and ordinary
draft preservation. Real-provider acceptance uses synthetic text and compares
all public-table content hashes before and after the private request.
