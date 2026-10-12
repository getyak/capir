# No domain package here

`packages/domain` is not a workspace package and holds no code. This README
exists only to point at the current owners of domain shape and authority:

- Cross-surface request/response and domain contracts:
  [`packages/contracts`](../contracts).
- Canonical domain state and authority (evidence, memory, pursuits, effects):
  the backend in [`apps/backend`](../../apps/backend).
- Native Apple-side domain model:
  [`apps/ios/Sources/Domain`](../../apps/ios/Sources/Domain).

Do not add domain types or a new package here. Extend the owning surface after
the client and API agree on one stable shape.
