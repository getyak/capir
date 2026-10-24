import type { SystemHealthResponse } from "@talent-signal/contracts";

export type SystemHealthPhase =
  | "loading"
  | "ready"
  | "error"
  | "session_expired";

export type SystemHealthState = {
  observation: SystemHealthResponse | null;
  phase: SystemHealthPhase;
};

export type SystemHealthEvent =
  | { type: "request_started" }
  | { type: "observation_received"; observation: SystemHealthResponse }
  | { type: "invalid_response" }
  | { type: "request_failed" }
  | { type: "session_expired" };

export function reduceSystemHealth(
  state: SystemHealthState,
  event: SystemHealthEvent,
): SystemHealthState {
  if (event.type === "request_started") {
    return {
      observation: state.observation,
      phase: state.observation ? "ready" : "loading",
    };
  }
  if (event.type === "observation_received") {
    return { observation: event.observation, phase: "ready" };
  }
  if (event.type === "session_expired") {
    return { observation: null, phase: "session_expired" };
  }
  return { observation: null, phase: "error" };
}
