# System health diagnostics

The product health surface answers one narrow question: can the current signed-in
Web request traverse the required product path now? It observes Talent Signal Web,
the Backend API, PostgreSQL, and required database migrations. It does not infer
the health of optional or independently operated systems.

## Probe model

`GET /health/live` remains a cheap public process-liveness probe. It must not
depend on PostgreSQL or another downstream system. `GET /health/ready` remains a
rate-limited public readiness probe for deployment tooling and returns `503` when
the backend cannot safely serve its required data path.

`GET /v1/system/health` is the authenticated component observation. It returns a
versioned, sanitized result for the Backend API, PostgreSQL, and required
migrations. The Web proxy adds its own successful request observation and exposes
the result at `GET /api/system-health` with `private, no-store` caching semantics.
The response carries bounded status codes, observation time, duration, and an
optional sanitized backend Git revision when the deployment supplies one. A
successful health request does not prove that revision is the newest release or
compatible with every client. It never returns connection strings, hosts, raw
exceptions, account content, or candidate evidence.

The server-to-backend request settles after four seconds and the browser request
after six seconds, so a stalled dependency cannot leave the health surface
permanently pending. The Web workspace requests the observation once after hydration. Healthy results
stay out of the way. Degraded, unavailable, malformed, or older-than-two-minute
results create a quiet workspace notice linking to
`/workspace/settings/diagnostics`. The diagnostics page supports an explicit
retry and keeps `unknown` distinct from `healthy`. A session-expired result clears
any older observation and offers a login recovery that returns to the diagnostics
page. Timestamps more than 30 seconds in the future are stale rather than trusted.

## Status semantics

- `healthy`: the component produced its expected bounded observation.
- `degraded`: the component answered, but a required condition such as a
  migration is missing.
- `unavailable`: the component could not complete its required observation.
- `unknown`: an upstream failure prevented this component from being observed.

The aggregate is recomputed from component results in the browser. A response
cannot claim `healthy` while any required component is degraded, unavailable, or
unknown.

## Deliberate exclusions

Opik export, external model providers, browser execution, person research, and
Tailscale exposure have separate owners and verification paths. Their absence
from this response means "not observed here", not healthy. Availability of those
systems must be proved through their dedicated operational checks and, where
applicable, a real product request plus destination readback.

## Design references

- Kubernetes separates liveness, readiness, and startup probes so dependency
  failure does not cause unsafe process restarts:
  <https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-probes>
- GitLab separates cheap health probes from detailed component diagnostics and
  restricts detailed information:
  <https://docs.gitlab.com/administration/monitoring/health_check/>
- Spring Boot Actuator gates health component details rather than exposing them
  by default:
  <https://docs.spring.io/spring-boot/reference/actuator/endpoints.html#actuator.endpoints.health>
- Next.js Route Handlers provide the authenticated Web proxy boundary; the route
  explicitly uses no-store semantics:
  <https://nextjs.org/docs/app/getting-started/route-handlers>
