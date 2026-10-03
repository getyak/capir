# Primary references for compact Agent prompts

- Accessed: 2026-09-06
- Original language: English
- Rights: public sources; original summaries only, no copied prompts
- Related implementation: [product prompts](../../apps/agent/src/prompts.ts)
- Related evidence: [prompt evaluation](https://github.com/getyak/capir-evals/blob/main/evidence/2026-09-06-prompt-simplification/README.md)

## Anthropic: context engineering

- Owner: Anthropic Applied AI
- Source: [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

The article recommends direct, high-signal instructions at a useful level of
abstraction. Excessive hardcoded branches are brittle; vague instructions can
omit information the model actually needs. It also treats tool definitions,
retrieved context, and observations as part of the same limited attention
budget. Concision is a means to effective behavior, not a word-count target.

Application: write task purpose and decision principles once; retain compact
instructions for identity, epistemic status, and output contracts where actual
trials demonstrate a need. Evaluate rendered input and behavior, not only the
base prompt's length.

## Pi: capability-aware composition

- Owner: earendil-works/pi (the reviewed badlogic/pi-mono URL redirected here)
- Source: [system-prompt.ts](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/system-prompt.ts)

The reviewed implementation builds its tool list from supplied snippets,
deduplicates guidelines, and includes skill descriptions only when a capable
read tool is available. Project context, optional additions, and the base
instructions are composed separately.

Application: keep task prompts independent, share stable wording, include only
the current tool manifest, and avoid provider adapters appending the same task
rules again. Talent Signal does not inherit Pi's shell or filesystem authority.

## Hugging Face smolagents: tool descriptions and observations

- Owner: Hugging Face
- Sources: [Building good agents](https://huggingface.co/docs/smolagents/en/tutorials/building_good_agents),
  [ToolCallingAgent template](https://github.com/huggingface/smolagents/blob/main/src/smolagents/prompts/toolcalling_agent.yaml)

The tutorial assigns tool-use details to tool descriptions and task-specific
details to the task. The tool-calling template uses observations from earlier
actions to inform subsequent calls and a defined final-answer mechanism. Its
template contains substantial examples; it is not evidence that all effective
prompts are tiny.

Application: place exact contact-query reuse, profile provenance, and operational
proposal syntax in their owning tool descriptions. Keep tool receipts and the
host's terminal schema authoritative. Preserve useful partial work when an
optional research step fails.

## Limits

These are design references, not performance results for Talent Signal's GLM
model or recruiting workflow. The repository's own synthetic comparison and
domain tests determine what this change can claim. A shorter prompt does not
justify weaker authorization, unsupported facts, or a claim of general model
improvement.
