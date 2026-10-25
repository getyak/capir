import {
  classifyCaptureError,
  normalizeSelection,
  normalizeTabSource,
} from "./lib/capture-contract.js";
import { contactTaskFromReviewedImage, contactTaskReviewURL, contactHandoffInWeb } from "./lib/contact-handoff.js";
import { normalizeLocalOrigin } from "./lib/handoff-contract.js";

import { contactRecoveryJournal } from "./lib/contact-recovery.js";

const journal = contactRecoveryJournal(chrome.storage.local);
const storageReady = chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
let handoffQueue = Promise.resolve();
function serialized(operation) {
  const result = handoffQueue.then(operation);
  handoffQueue = result.catch(() => {});
  return result;
}

async function recoverHandoff(requestKey) {
  await storageReady;
  const record = (await journal.list()).find(item => item.requestKey === requestKey);
  if (!record) return { state: "unknown", message: "The local recovery record has expired or was removed. Check your Web tasks before sending another copy." };
  const origin = normalizeLocalOrigin(record.origin);
  const tab = await readyWebTab(origin);
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN",
    func: contactHandoffInWeb, args: [origin, record.sessionVersion, "recover", record.requestKey] });
  if (result.result?.contact_task_id) await chrome.tabs.update(tab.id, { url: contactTaskReviewURL(origin, result.result.contact_task_id) });
  if (["received", "unavailable"].includes(result.result?.state)) await journal.complete(requestKey);
  return result.result;
}

async function readyWebTab(origin) {
  const tab = await chrome.tabs.create({ url: `${origin}/contact-agent?source=browser-extension` });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const current = await chrome.tabs.get(tab.id);
    if (current.status === "complete") break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const current = await chrome.tabs.get(tab.id);
  if (new URL(current.url).origin !== origin || new URL(current.url).pathname !== "/contact-agent") throw new Error("CONTACT_RECOVERY_SESSION_STALE");
  return tab;
}

async function handoffReviewedImage(envelope) {
  const origin = normalizeLocalOrigin(envelope.handoff_target), payload = await contactTaskFromReviewedImage(envelope);
  await storageReady;
  const tab = await readyWebTab(origin);
  await journal.claim(origin, envelope.session.version, envelope.idempotency_key);
  // Chrome executes the supplied function in the exact tab and awaits its
  // Promise. No bearer token, broad host permission or new backend bypass.
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN",
    func: contactHandoffInWeb, args: [origin, envelope.session.version, "submit", payload] });
  if (result.result?.contact_task_id) await chrome.tabs.update(tab.id, { url: contactTaskReviewURL(origin, result.result.contact_task_id) });
  if (result.result?.state === "received") await journal.complete(envelope.idempotency_key);
  // A later preflight failure cannot erase an earlier unknown POST outcome.
  // Keep the same bounded metadata record until its actual receipt is read.
  return result.result;
}

async function enableActionPanel() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

enableActionPanel().catch(() => {
  // The panel can still be opened from Chrome's side-panel menu.
});

chrome.runtime.onInstalled.addListener(() => {
  enableActionPanel().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  enableActionPanel().catch(() => {});
});

async function activeTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  if (!tab?.id || typeof tab.windowId !== "number") {
    throw new Error("No active tab is available.");
  }

  return tab;
}

async function captureVisibleSource() {
  const tab = await activeTab();
  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
    format: "png",
  });

  const current=await activeTab();
  if(current.id!==tab.id||current.url!==tab.url)throw new Error("The source tab changed during capture. Capture again from the intended page.");
  return {
    ok: true,
    kind: "visible_tab",
    source: normalizeTabSource(tab),
    data_url: dataUrl,
  };
}

async function captureSelectedText(page = false) {
  const tab = await activeTab();
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [page],
    func: (wholePage) => wholePage ? (document.querySelector("main, article") ?? document.body).innerText : globalThis.getSelection?.()?.toString() ?? "",
  });
  const selection = normalizeSelection(result);

  if (!selection.ok) {
    return selection;
  }

  return {
    ok: true,
    kind: page ? "page_text" : "selected_text",
    source: normalizeTabSource(tab),
    text: selection.text,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "handoff.reviewed-image" && sender.id === chrome.runtime.id) {
    serialized(() => handoffReviewedImage(message.envelope)).then(sendResponse).catch(() => sendResponse({ state: "unknown",
      code: "contact_handoff_unverified", message: "Receipt not verified. Check the original task before submitting another copy." }));
    return true;
  }
  if (["handoff.recovery-list", "handoff.recover"].includes(message?.type) && sender.id === chrome.runtime.id) {
    serialized(async () => {
      await storageReady;
      return message.type === "handoff.recovery-list" ? { records: await journal.list() } : recoverHandoff(message.requestKey);
    }).then(sendResponse).catch(() => sendResponse({ state: "unknown", message: "Recovery is not verified. Check the original Web account before submitting another copy." }));
    return true;
  }
  if (!["capture.visible", "capture.selection", "capture.page"].includes(message?.type)) {
    return false;
  }

  const operation =
    message.type === "capture.visible"
      ? captureVisibleSource()
      : captureSelectedText(message.type === "capture.page");

  operation
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, ...classifyCaptureError(error) }));

  return true;
});
