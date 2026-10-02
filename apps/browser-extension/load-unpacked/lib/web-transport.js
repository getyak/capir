import { normalizeLocalOrigin } from "./handoff-contract.js";

// Runs only in a tab at the user's selected capri origin. The browser
// attaches HttpOnly cookies; credentials never enter extension state.
export async function webRequest(originValue, path, options = {}) {
  const origin = normalizeLocalOrigin(originValue);
  if (!/^\/api\/browser-extension\/(session|captures(?:\/[a-zA-Z0-9-]{8,80})?)$/.test(path)) throw new Error("Unsupported capture endpoint.");
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  const tab = tabs.find(item => item.id && item.url && new URL(item.url).origin === origin);
  if (!tab) throw new Error("Open capri and sign in, then connect again.");
  const [{result}] = await chrome.scripting.executeScript({
    target: {tabId: tab.id},
    args: [origin, path, options],
    func: async (expectedOrigin, endpoint, input) => {
      if (location.origin !== expectedOrigin) return {status:409,body:{code:"session_stale"}};
      try {
        const response = await fetch(endpoint, {
          method: input.method ?? "GET", credentials:"same-origin", cache:"no-store", redirect:"error",
          headers: input.headers ?? {}, ...(input.body?{body:input.body}:{}),
          signal: AbortSignal.timeout(45000),
        });
        return {status:response.status,body:await response.json()};
      } catch { return {status:503,body:{code:"receipt_unknown",message:"Receipt not confirmed. Check this capture before retrying."}}; }
    },
  });
  if (!result) throw new Error("The Web tab became unavailable. Check the receipt before retrying.");
  return result;
}

export async function connectWebOrigin(value) {
  const origin=normalizeLocalOrigin(value);
  if(origin.startsWith("https:")){
    const allowed=await chrome.permissions.request({origins:[`${origin}/*`]});
    if(!allowed)throw new Error("Workspace access was not granted. Nothing was sent.");
  }
  return origin;
}
