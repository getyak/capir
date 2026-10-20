import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Execute the shipped scripts, not a rewritten preference resolver.
// This is script contract coverage; AppKit/WebKit and visual proof are separate.
const source = readFileSync(new URL("../../apps/macos/Sources/Services/WorkspaceAppearanceBridge.swift", import.meta.url), "utf8");
const script = (name) => {
  const match = source.match(new RegExp(`static let ${name} = """\\n([\\s\\S]*?)\\n    """`));
  assert.ok(match, `${name} must remain executable production source`);
  return match[1];
};
function fixture(stored = null) {
  let dark = false, storageFailure = false, observer;
  const values = new Map(stored === null ? [] : [["talent-signal-theme", stored]]);
  const messages = [], events = new Map();
  const media = { get matches() { return dark; }, addEventListener: (_, callback) => { media.change = callback; } };
  const root = { dataset: { theme: "light" } };
  const context = vm.createContext({
    document: { documentElement: root },
    location: { origin: "https://workspace.example" },
    localStorage: {
      getItem: (key) => { if (storageFailure) throw Error("blocked"); return values.get(key) ?? null; },
      setItem: (key, value) => { if (storageFailure) throw Error("blocked"); values.set(key, value); },
      removeItem: (key) => { if (storageFailure) throw Error("blocked"); values.delete(key); },
    },
    matchMedia: () => media,
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} },
    Event: class { constructor(type) { this.type = type; } },
    window: {
      webkit: { messageHandlers: { workspaceAppearance: { postMessage: (value) => messages.push(value) } } },
      addEventListener: (name, callback) => {
        const callbacks = events.get(name) ?? [];
        callbacks.push(callback); events.set(name, callbacks);
      },
      dispatchEvent: (event) => { for (const callback of events.get(event.type) ?? []) callback(event); },
    },
  });
  vm.runInContext(script("scriptSource"), context);
  return {
    context, messages, root, values,
    mutate: () => observer(),
    storageFailure: (value = true) => { storageFailure = value; },
    systemDark: (value) => { dark = value; media.change(); },
    event: (type) => context.window.dispatchEvent({ type }),
    select: (preference, expectedOrigin = "https://workspace.example") => {
      context.preference = preference; context.expectedOrigin = expectedOrigin;
      return vm.runInContext(`(() => { ${script("selectionScript")} })()`, context);
    },
  };
}

test("saved light/dark synchronizes; System is an independent preference", () => {
  for (const value of ["light", "dark", null, "invalid"]) {
    const f = fixture(value);
    assert.deepEqual(f.messages, [value === "light" || value === "dark" ? value : "system"]);
    f.mutate();
    assert.equal(f.messages.length, 1, "repainting does not feed back into native appearance");
    f.event("pageshow");
    assert.equal(f.messages.length, 2, "reconcile after native navigation commits");
  }
});

test("dark to System releases override and continues following later OS changes", () => {
  const f = fixture("dark");
  f.root.dataset.theme = "dark";
  assert.equal(f.select("system"), true);
  assert.equal(f.values.has("talent-signal-theme"), false);
  assert.equal(f.messages.at(-1), "system");
  assert.equal(f.root.dataset.theme, "light");
  f.systemDark(true);
  assert.equal(f.root.dataset.theme, "dark");
  f.systemDark(false);
  assert.equal(f.root.dataset.theme, "light");
  assert.equal(f.messages.at(-1), "system", "resolved colors must never pin AppKit");
});

test("explicit choices ignore OS changes and page toggles reach the native observer", () => {
  const f = fixture();
  assert.equal(f.select("light"), true);
  f.systemDark(true);
  assert.equal(f.root.dataset.theme, "light");
  assert.equal(f.messages.at(-1), "light");
  f.values.set("talent-signal-theme", "dark");
  f.root.dataset.theme = "dark";
  f.mutate();
  assert.equal(f.messages.at(-1), "dark");
});

test("System reset works even when it resolves to the same painted color", () => {
  const f = fixture("dark");
  f.root.dataset.theme = "dark";
  f.systemDark(true);
  assert.equal(f.select("system"), true);
  assert.equal(f.root.dataset.theme, "dark");
  assert.equal(f.messages.at(-1), "system");
  let notifications = 0;
  f.context.window.addEventListener("talent-signal:theme-change", () => notifications++);
  f.systemDark(false);
  assert.equal(f.root.dataset.theme, "light");
  assert.equal(notifications, 1, "Web subscribers must update with the system palette");
});

test("failed persistence and foreign navigation cannot report a saved choice or repaint", () => {
  const f = fixture("light");
  assert.equal(f.select("dark", "https://foreign.example"), false);
  f.storageFailure();
  assert.equal(f.select("dark"), false);
  assert.equal(f.root.dataset.theme, "light");
  assert.equal(f.values.get("talent-signal-theme"), "light");
  assert.deepEqual(f.messages, ["light"]);
});

test("unavailable storage starts with inherited System and has no private data messages", () => {
  const f = fixture();
  f.storageFailure();
  f.event("pageshow");
  assert.deepEqual(f.messages, ["system", "system"]);
  assert.ok(f.messages.every((value) => ["light", "dark", "system"].includes(value)));
});

test("a failed selection can be retried and only the successful choice is published", () => {
  const f = fixture("light");
  f.storageFailure();
  assert.equal(f.select("dark"), false);
  assert.deepEqual(f.messages, ["light"]);
  f.storageFailure(false);
  assert.equal(f.select("dark"), true);
  assert.equal(f.values.get("talent-signal-theme"), "dark");
  assert.equal(f.root.dataset.theme, "dark");
  assert.deepEqual(f.messages, ["light", "dark"]);
});
