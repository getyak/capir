const DENIAL_PATTERNS = [
  /activeTab/i,
  /cannot access/i,
  /cannot be scripted/i,
  /cannot capture/i,
  /permission/i,
  /not granted/i,
  /restricted/i,
];

export const MAX_SELECTION_CHARACTERS = 50_000;

export function normalizeTabSource(tab, capturedAt = new Date().toISOString()) {
  return {
    title: typeof tab?.title === "string" && tab.title.trim()
      ? tab.title.trim().slice(0, 500)
      : "Untitled page",
    url: typeof tab?.url === "string" && tab.url.trim()
      ? tab.url.trim().slice(0, 4_096)
      : "Unavailable",
    captured_at: capturedAt,
  };
}

export function normalizeUploadedImageSource(
  file,
  importedAt = new Date().toISOString(),
) {
  return {
    title:
      typeof file?.name === "string" && file.name.trim()
        ? file.name.trim().slice(0, 500)
        : "Chosen screenshot",
    url: "local-file://reviewed-screenshot",
    captured_at: importedAt,
    time_basis: "imported_at",
  };
}

export function normalizeSelection(value) {
  const text = typeof value === "string" ? value.trim() : "";

  if (!text) {
    return {
      ok: false,
      code: "empty_selection",
      message: "No selected text was found. Select text on the page and try again.",
    };
  }

  if (text.length > MAX_SELECTION_CHARACTERS) {
    return {
      ok: false,
      code: "selection_too_large",
      message: `The selection exceeds ${MAX_SELECTION_CHARACTERS.toLocaleString()} characters. Select a smaller excerpt.`,
    };
  }

  return { ok: true, text };
}

export function classifyCaptureError(error) {
  const detail = error instanceof Error ? error.message : String(error ?? "");
  const denied = DENIAL_PATTERNS.some((pattern) => pattern.test(detail));

  if (denied) {
    return {
      code: "permission_denied",
      message:
        "Chrome did not grant access to this page. Return to the source tab, click the capri toolbar icon, and try again.",
      detail,
    };
  }

  return {
    code: "capture_failed",
    message:
      "The visible source could not be captured. Nothing was submitted; try again from the source tab.",
    detail,
  };
}

export function makeCaptureDraft({
  kind,
  source,
  dataUrl = null,
  text = null,
  fixtureCase = null,
  transport = kind === "fixture" ? "fixture" : "localhost",
  syntheticLabel = null,
  createdAt = new Date().toISOString(),
}) {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `capture-${Date.now()}`,
    kind,
    source,
    created_at: createdAt,
    original_data_url: dataUrl,
    original_text: text,
    reviewed_text: text,
    fixture_case: fixtureCase,
    transport,
    synthetic_label: syntheticLabel,
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    redactions: [],
    revision: 0,
  };
}
