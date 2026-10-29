# GET-303: patch the resolved MCP Node-server adapter

## Outcome and evidence

Remove GHSA-rmxm-3fg6-px4f from the resolved production dependency graph without
changing unrelated packages or weakening audit/release-age policy. Main Security
run `40785510418` failed on the moderate advisory at base `cff8222c`; the resolved
path is `apps/agent -> claude-agent-sdk -> @modelcontextprotocol/sdk@1.32.0 ->
@hono/node-server@2.1.1`.

The [official advisory](https://github.com/advisories/GHSA-rmxm-3fg6-px4f)
affects `>=1.19.10 <2.1.3`; the
[2.1.3 release](https://github.com/honojs/node-server/releases/tag/v2.1.3)
contains the static-path decoding repair and was published September 29.
No release-age exception is needed. Dependency presence alone does not establish
that this application's static-file path is reachable.

## Small compatible change

The installed MCP 1.32.0 package manifest declares the adapter range
`^1.19.9 || ^2.0.5`, which admits 2.1.3. The override is scoped to that exact
parent/child edge: `@modelcontextprotocol/sdk@1.32.0>@hono/node-server`.
Registry metadata confirms 2.1.1 and 2.1.3 both require Node `>=20` and peer Hono
`^4`; 2.1.3 adds no runtime dependency. The exact 2.1.3 integrity comes from the
parent's retained 0600 registry receipt in
`video-review/runtime/hono-node-server-security-registry-metadata.json`.

Only the workspace override and the adapter's lockfile override, package
resolution/integrity, peer snapshot and MCP reference change. Hono stays
4.13.11; the MCP/Claude SDKs, application code, audit thresholds and release-age
policy stay unchanged. The surgical lockfile edit requires package-manager
normalization/consistency validation before acceptance.

## Status and proof still required

The narrow source edit and static diff check are complete. No installation,
test, build, model call, commit, push, CI dispatch or deployment was performed
by this worker. The active host pause is preserved.

The parent owns the remaining sequence: independent review; serialized
lockfile-only/frozen-lock consistency and production audit; applicable latest
CI; then clean committed-source rebuild/deployment of every affected existing
resident service and live revision verification. A changed lockfile does not
prove an installed runtime patch. Keep local validation, cloud gates, merge and
resident deployment evidence separate until the outcome is accepted.
