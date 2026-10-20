// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider, useT } from "./locale-provider";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("only reruns translation-dependent effects when the locale changes", async () => {
  const observed: string[] = [];
  function Reader({ count }: { count: number }) {
    const t = useT();
    useEffect(() => { observed.push(t("language.save")); }, [t]);
    return <span>{count} {t("language.save")}</span>;
  }
  await act(() => root.render(<LocaleProvider locale="en"><Reader count={0} /></LocaleProvider>));
  await act(() => root.render(<LocaleProvider locale="en"><Reader count={1} /></LocaleProvider>));
  expect(observed).toEqual(["Save"]);
  await act(() => root.render(<LocaleProvider locale="ja"><Reader count={1} /></LocaleProvider>));
  expect(observed).toEqual(["Save", "保存"]);
  expect(host.textContent).toBe("1 保存");
});
