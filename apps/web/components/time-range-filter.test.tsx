// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TimeRangeFilter } from "./time-range-filter";

let host: HTMLElement, root: Root;
const apply = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); apply.mockReset();
  host = document.createElement("section"); host.setAttribute("data-time-filters", "");
  document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(from = "2026-10-23", to = "2026-10-21") {
  function Controlled() {
    const [start, setStart] = useState(from), [end, setEnd] = useState(to);
    return <TimeRangeFilter from={start} to={end} onFromChange={setStart} onToChange={setEnd} onApply={apply} />;
  }
  await act(async () => root.render(<Controlled />));
}
const form = () => host.querySelector("form")!;
const submit = () => form().querySelector<HTMLButtonElement>("button")!;
const error = () => form().querySelector<HTMLElement>('[role="alert"]');
async function invalid(moved?: HTMLElement) {
  const trigger = submit(); trigger.focus();
  await act(async () => {
    form().dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: trigger }));
    moved?.focus();
  });
}

it("reveals local validation with its own filter scroll and repeats only on explicit submit", async () => {
  await render();
  // Geometry is a host protocol fixture, not real browser visibility evidence.
  Object.defineProperties(host, { clientHeight: { value: 140 }, clientTop: { value: 1 } });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this === host ? new DOMRect(0, 100, 300, 142) : new DOMRect(10, 600 - host.scrollTop, 280, 24);
  });
  await invalid();
  expect(error()?.textContent).toBe("请选择连续的 1–93 天。");
  expect(document.activeElement).toBe(error()); expect(host.scrollTop).toBe(389);
  expect(document.documentElement.scrollTop).toBe(0); expect(apply).not.toHaveBeenCalled();
  const fields = [...form().querySelectorAll("input")];
  expect(fields.map(field => field.value)).toEqual(["2026-10-23", "2026-10-21"]);
  expect(fields.every(field => field.getAttribute("aria-describedby") === error()?.id && field.getAttribute("aria-invalid") === "true")).toBe(true);
  await invalid(); expect(document.activeElement).toBe(error()); expect(host.scrollTop).toBe(389);
});

it("respects focus moved before the validation commit", async () => {
  await render(); const other = document.createElement("button"); document.body.append(other);
  try { await invalid(other); expect(error()).not.toBeNull(); expect(document.activeElement).toBe(other); expect(host.scrollTop).toBe(0); }
  finally { other.remove(); }
});

it("clears stale feedback when a date is edited without applying the range", async () => {
  await render(); await invalid();
  const from = form().querySelector<HTMLInputElement>("input")!; from.focus();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(from, "2026-10-20");
    from.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(error()).toBeNull(); expect(document.activeElement).toBe(from);
  expect(form().querySelectorAll("input")[1]!.value).toBe("2026-10-21"); expect(apply).not.toHaveBeenCalled();
});

it.each([
  ["2026-01-01", "2026-01-01", "2026-01-02"],
  ["2026-01-01", "2026-04-03", "2026-04-04"],
])("applies the inclusive valid range %s to %s", async (from, to, end) => {
  await render(from, to); await invalid();
  expect(error()).toBeNull(); expect(apply).toHaveBeenCalledExactlyOnceWith({ view: "timeline", range: "custom", from, to: end, day: from });
});

it.each([["2026-01-01", "2026-04-04"], ["2026-01-01", ""]])("does not apply an excessive or incomplete range %s to %s", async (from, to) => {
  await render(from, to); await invalid(); expect(error()).not.toBeNull(); expect(apply).not.toHaveBeenCalled();
});
