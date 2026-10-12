After modifying backend code, rebuild and redeploy the local TestFlight backend with `./scripts/deploy/testflight-local.sh` before handoff so the installed iOS app receives the change.

Migration identity is the full migration filename; the
`src/database/migration-manifest.json` array is the execution-order authority.
Numeric prefixes may have gaps, and a new migration must use a fresh prefix.
