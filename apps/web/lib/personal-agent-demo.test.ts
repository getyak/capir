import { describe, expect, it } from "vitest";
import { initialPersonalAgentDemo as initial, personalAgentDemoReducer as reduce } from "./personal-agent-demo";
const ready = reduce(initial, { type: "complete-introduction" });
describe("personal Agent synthetic continuity", () => {
  it("requires reviewed identity before saving, without preselecting a same-name person", () => {
    const ambiguous = reduce(ready, { type: "ambiguous" });
    expect(reduce(ambiguous, { type: "save" }).saved).toBe(false);
    expect(reduce(reduce(ambiguous, { type: "resolve-identity" }), { type: "save" }).saved).toBe(true);
  });
  it("deferred identity preserves an unbound clue without enabling a person-linked save", () => {
    const ambiguous = reduce(ready, { type: "ambiguous" });
    const deferred = reduce(ambiguous, { type: "defer-identity" });
    expect(deferred.identityDeferred).toBe(true);
    expect(reduce(deferred, { type: "save" }).saved).toBe(false);
  });
  it("a new screenshot proposes a change to the same item before confirmation", () => {
    expect(reduce(ready, { type: "new-reply" }).newReply).toBe(false);
    const saved = reduce(ready, { type: "save" });
    const next = reduce(saved, { type: "new-reply" });
    expect(next.saved).toBe(true);
    expect(next.updateConfirmed).toBe(false);
    expect(reduce(next, { type: "confirm-update" }).updateConfirmed).toBe(true);
  });
  it("late callbacks cannot run after pause, replay or source withdrawal", () => {
    const playing = reduce(initial, { type: "play", reducedMotion: false });
    for (const state of [reduce(playing, { type: "pause" }), reduce(playing, { type: "play", reducedMotion: false }), reduce(playing, { type: "remove-source" })]) {
      expect(reduce(state, { type: "tick", run: playing.run, phase: playing.phase })).toEqual(state);
    }
  });
  it("withdrawal blocks all dependent writes and replay cannot restore the source", () => {
    const removed = reduce(reduce(ready, { type: "save" }), { type: "remove-source" });
    for (const event of [{ type: "play", reducedMotion: true }, { type: "save" }, { type: "new-reply" }, { type: "confirm-update" }, { type: "toggle-reminders" }] as const) {
      expect(reduce(removed, event)).toEqual(removed);
    }
    expect(reduce(removed, { type: "new-demo" }).sourceAvailable).toBe(true);
  });
  it("pausing keeps context and continues to mean only reminders paused", () => {
    const saved = reduce(ready, { type: "save" });
    const paused = reduce(saved, { type: "toggle-reminders" });
    expect(paused.saved).toBe(true);
    expect(paused.remindersPaused).toBe(true);
    expect(paused.sourceAvailable).toBe(true);
    expect(reduce(paused, { type: "play", reducedMotion: true }).remindersPaused).toBe(true);
  });
  it("introduction settles once and reduced motion has the same inspectable result", () => {
    let state = reduce(initial, { type: "play", reducedMotion: false });
    for (let i = 0; i < 3; i++) state = reduce(state, { type: "tick", run: state.run, phase: state.phase });
    expect(state.phase).toBe(3);
    expect(state.playing).toBe(false);
    expect(reduce(initial, { type: "play", reducedMotion: true }).phase).toBe(3);
  });
});
