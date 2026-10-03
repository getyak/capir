/** Page-local synthetic state. No product records, external services, or persistence. */
export type DemoPhase = 0 | 1 | 2 | 3;
export type PersonalAgentDemoState = {
  phase: DemoPhase;
  playing: boolean;
  run: number;
  sourceAvailable: boolean;
  identityResolved: boolean;
  identityDeferred: boolean;
  saved: boolean;
  newReply: boolean;
  updateConfirmed: boolean;
  remindersPaused: boolean;
};
export const initialPersonalAgentDemo: PersonalAgentDemoState = {
  phase: 0, playing: false, run: 0, sourceAvailable: true,
  identityResolved: true, identityDeferred: false, saved: false, newReply: false,
  updateConfirmed: false, remindersPaused: false,
};
export type PersonalAgentDemoEvent =
  | { type: "play"; reducedMotion: boolean }
  | { type: "tick"; run: number; phase: DemoPhase }
  | { type: "pause" }
  | { type: "complete-introduction" }
  | { type: "ambiguous" }
  | { type: "resolve-identity" }
  | { type: "defer-identity" }
  | { type: "save" }
  | { type: "new-reply" }
  | { type: "confirm-update" }
  | { type: "toggle-reminders" }
  | { type: "remove-source" }
  | { type: "new-demo" };
export function personalAgentDemoReducer(state: PersonalAgentDemoState, event: PersonalAgentDemoEvent): PersonalAgentDemoState {
  switch (event.type) {
    case "play":
      if (!state.sourceAvailable) return state;
      return { ...state, phase: event.reducedMotion ? 3 : 0, playing: !event.reducedMotion, run: state.run + 1 };
    case "tick":
      if (!state.playing || event.run !== state.run || event.phase !== state.phase || state.phase === 3) return state;
      return { ...state, phase: (state.phase + 1) as DemoPhase, playing: state.phase < 2 };
    case "pause": return { ...state, playing: false, run: state.run + 1 };
    case "complete-introduction": return { ...state, playing: false, phase: 3, run: state.run + 1 };
    case "ambiguous":
      if (state.saved || !state.sourceAvailable) return state;
      return { ...state, identityResolved: false, identityDeferred: false, playing: false, phase: 3, run: state.run + 1 };
    case "resolve-identity":
      if (!state.sourceAvailable) return state;
      return { ...state, identityResolved: true, identityDeferred: false };
    case "defer-identity":
      if (!state.sourceAvailable || state.identityResolved) return state;
      return { ...state, identityDeferred: true };
    case "save":
      if (!state.sourceAvailable || !state.identityResolved || state.phase !== 3) return state;
      return { ...state, saved: true };
    case "new-reply":
      if (!state.saved || !state.sourceAvailable) return state;
      return { ...state, newReply: true };
    case "confirm-update":
      if (!state.newReply || !state.sourceAvailable || !state.saved) return state;
      return { ...state, updateConfirmed: true };
    case "toggle-reminders":
      if (!state.saved || !state.sourceAvailable) return state;
      return { ...state, remindersPaused: !state.remindersPaused };
    case "remove-source": return { ...state, sourceAvailable: false, playing: false, run: state.run + 1 };
    case "new-demo": return { ...initialPersonalAgentDemo, phase: 3, run: state.run + 1 };
  }
}
