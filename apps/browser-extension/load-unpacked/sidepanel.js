import { webRequest, connectWebOrigin } from "./lib/web-transport.js";
import { extensionVersion, installedExtensionVersion } from "./lib/version-status.js";
import {
  makeCaptureDraft,
  normalizeUploadedImageSource,
} from "./lib/capture-contract.js";
import {
  cropPixels,
  estimateDataUrlBytes,
  isRedactionVisible,
  normalizeCrop,
  normalizeRedaction,
  redactionPixels,
} from "./lib/image-review.js";
import {
  buildExactWebReviewUrl,
  buildHandoffEnvelope,
  classifyReceiptResponse,
  classifyTransportError,
  createRequestIdentity,
  DEFAULT_LOCAL_ORIGIN,
  MAX_HANDOFF_BYTES,
  normalizeLocalOrigin,
  retentionCompatibility,
  sessionCopy,
} from "./lib/handoff-contract.js";
import { contactTaskReviewURL } from "./lib/contact-handoff.js";
import {
  fixtureCheck,
  fixtureSubmit,
} from "./lib/fixture-transport.js";
import {
  dispositionPresentation,
  isSyntheticTransport,
  LONG_MIXED_SCRIPT_SAMPLE,
  progressPresentation,
  sessionPresentation,
  submissionPresentation,
} from "./lib/review-presentation.js";

const byId = (id) => document.getElementById(id);

const elements = {
  modeSelect: byId("mode-select"),
  assistiveStatus: byId("assistive-status"),
  captureView: byId("capture-view"),
  reviewView: byId("review-view"),
  captureEyebrow: byId("capture-eyebrow"),
  captureTitle: byId("capture-title"),
  captureLede: byId("capture-lede"),
  liveControls: byId("live-capture-controls"),
  fixtureControls: byId("fixture-controls"),
  fixtureCase: byId("fixture-case"),
  fixtureScenario: byId("fixture-scenario"),
  captureVisible: byId("capture-visible"),
  captureSelection: byId("capture-selection"),
  uploadImage: byId("upload-image"),
  loadFixture: byId("load-fixture"),
  captureAlert: byId("capture-alert"),
  captureAlertTitle: byId("capture-alert-title"),
  captureAlertCopy: byId("capture-alert-copy"),
  backButton: byId("back-button"),
  removeButton: byId("remove-button"),
  reviewHeading: byId("review-heading"),
  stepEvidence: byId("step-evidence"),
  stepSession: byId("step-session"),
  stepSubmit: byId("step-submit"),
  captureKindChip: byId("capture-kind-chip"),
  sourceTitle: byId("source-page-title"),
  sourceUrl: byId("source-url"),
  sourceTimeLabel: byId("source-time-label"),
  sourceTime: byId("source-time"),
  screenshotReview: byId("screenshot-review"),
  textReview: byId("text-review"),
  fixtureReview: byId("fixture-review"),
  localCleared: byId("local-cleared"),
  canvas: byId("review-canvas"),
  imageSummary: byId("image-summary"),
  cropLeft: byId("crop-left"),
  cropTop: byId("crop-top"),
  cropRight: byId("crop-right"),
  cropBottom: byId("crop-bottom"),
  addRedaction: byId("add-redaction"),
  undoRedaction: byId("undo-redaction"),
  resetImageEdits: byId("reset-image-edits"),
  redactionList: byId("redaction-list"),
  reviewedText: byId("reviewed-text"),
  textSummary: byId("text-summary"),
  fixtureTitle: byId("fixture-title"),
  fixtureId: byId("fixture-id"),
  fixtureContext: byId("fixture-context"),
  fixtureMessages: byId("fixture-messages"),
  fixtureDisposition: byId("fixture-disposition"),
  fixtureDetailSummary: byId("fixture-detail-summary"),
  fixtureAssertions: byId("fixture-assertions"),
  fixtureActionBlock: byId("fixture-action-block"),
  fixtureAction: byId("fixture-action"),
  fixtureBoundaries: byId("fixture-boundaries"),
  originField: byId("origin-field"),
  localOrigin: byId("local-origin"),
  openSignIn: byId("open-sign-in"),
  checkSession: byId("check-session"),
  sessionState: byId("session-state"),
  sessionCopy: byId("session-copy"),
  retentionMode: byId("retention-mode"),
  retentionCopy: byId("retention-copy"),
  handoffTarget: byId("handoff-target"),
  handoffEffect: byId("handoff-effect"),
  dispatchShell: document.querySelector(".dispatch-shell"),
  submitHeading: byId("submit-title"),
  submitNote: byId("submit-note"),
  approvalCheck: byId("approval-check"),
  submissionStatus: byId("submission-status"),
  submissionStateLabel: byId("submission-state-label"),
  submissionTitle: byId("submission-title"),
  submissionCopy: byId("submission-copy"),
  receiptId: byId("receipt-id"),
  submitButton: byId("submit-button"),
  checkReceipt: byId("check-receipt"),
  openWebReview: byId("open-web-review"),
};

const query = new URLSearchParams(location.search);

const state = {
  mode: query.get("mode") === "fixture" ? "fixture" : "live",
  fixtureSuite: null,
  draft: null,
  image: null,
  drawRedaction: null,
  requestIdentity: null,
  submitAttempt: 0,
  fixtureRecovered: false,
  session: {
    state: "not_checked",
    message:
      "The extension never reads or shows a password, cookie, or bearer token.",
  },
  submission: {
    state: "idle",
    code: null,
    message: null,
    receipt_id: null,
    duplicate: false,
  },
};

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (typeof text === "string") {
    element.textContent = text;
  }
  if (className) {
    element.className = className;
  }
  return element;
}

function humanTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value || "Unavailable";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

function bytesLabel(bytes) {
  if (bytes < 1_000) {
    return `${bytes} B`;
  }
  if (bytes < 1_000_000) {
    return `${(bytes / 1_000).toFixed(1)} KB`;
  }
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function announce(message) {
  elements.assistiveStatus.textContent = "";
  requestAnimationFrame(() => {
    elements.assistiveStatus.textContent = message;
  });
}

function showCaptureAlert(title, copy, tone = "error") {
  elements.captureAlertTitle.textContent = title;
  elements.captureAlertCopy.textContent = copy;
  elements.captureAlert.dataset.tone = tone;
  elements.captureAlert.setAttribute(
    "role",
    tone === "error" ? "alert" : "status",
  );
  elements.captureAlert.hidden = false;
}

function clearCaptureAlert() {
  elements.captureAlert.hidden = true;
  delete elements.captureAlert.dataset.tone;
  elements.captureAlert.setAttribute("role", "status");
  elements.captureAlertTitle.textContent = "";
  elements.captureAlertCopy.textContent = "";
}

function setCaptureBusy(busy, label = "Capturing…") {
  elements.captureVisible.disabled = busy;
  elements.captureSelection.disabled = busy;
  elements.uploadImage.disabled = busy;
  elements.loadFixture.disabled = busy;
  elements.captureView.setAttribute("aria-busy", String(busy));

  if (busy) {
    showCaptureAlert(
      label,
      "Nothing will be submitted during this step.",
      "progress",
    );
  }
}

function resetDecision() {
  state.reviewGeneration = (state.reviewGeneration ?? 0) + 1;
  state.contactHandoffEnvelope = null;
  state.requestIdentity = null;
  state.submitAttempt = 0;
  state.submission = {
    state: "idle",
    code: null,
    message: null,
    receipt_id: null,
    duplicate: false,
  };
  elements.approvalCheck.checked = false;
  renderSubmission();
  void renderHandoffRecovery();
}

function draftChanged() {
  if (!state.draft) {
    return;
  }

  state.draft.revision += 1;
  resetDecision();
}

function renderMode() {
  const fixtureMode = state.mode === "fixture";
  elements.modeSelect.value = state.mode;
  elements.liveControls.hidden = fixtureMode;
  elements.fixtureControls.hidden = !fixtureMode;
  elements.captureEyebrow.textContent = fixtureMode
    ? "Deterministic evaluation"
    : "Intentional capture";
  elements.captureTitle.textContent = fixtureMode
    ? "Exercise the same eight safety cases."
    : "Bring only what matters into review.";
  elements.captureLede.textContent = fixtureMode
    ? "Open a bundled synthetic case and inspect its evidence, proposed meaning, action boundary, and truthful receipt state."
    : "Choose the visible page or text you selected. capri will show the exact payload before anything leaves this panel.";
}

async function loadFixtureSuite() {
  const response = await fetch("./fixtures/candidate-momentum-v1.json");
  if (!response.ok) {
    throw new Error("The bundled fixture suite could not be loaded.");
  }
  state.fixtureSuite = await response.json();
  elements.fixtureCase.replaceChildren();

  for (const fixtureCase of state.fixtureSuite.cases) {
    const option = document.createElement("option");
    option.value = fixtureCase.id;
    option.textContent = `${fixtureCase.id} · ${fixtureCase.title}`;
    elements.fixtureCase.append(option);
  }

  const requestedCase = query.get("case");
  if (
    requestedCase &&
    state.fixtureSuite.cases.some((item) => item.id === requestedCase)
  ) {
    elements.fixtureCase.value = requestedCase;
  }

  const requestedScenario = query.get("scenario");
  if (
    requestedScenario &&
    [...elements.fixtureScenario.options].some(
      (option) => option.value === requestedScenario,
    )
  ) {
    elements.fixtureScenario.value = requestedScenario;
  }
}

async function requestCapture(type) {
  clearCaptureAlert();
  setCaptureBusy(true);

  try {
    const response = await chrome.runtime.sendMessage({ type });
    if (!response?.ok) {
      showCaptureAlert(
        response?.code === "permission_denied"
          ? "Page access not granted"
          : "Capture not created",
        response?.message ??
          "Nothing was captured or submitted. Return to the source tab and try again.",
      );
      return;
    }

    const draft = makeCaptureDraft({
      kind: response.kind,
      source: response.source,
      dataUrl: response.data_url ?? null,
      text: response.text ?? null,
    });
    await openReview(draft);
  } catch (error) {
    showCaptureAlert(
      "Capture not created",
      error instanceof Error
        ? error.message
        : "Nothing was captured or submitted.",
    );
  } finally {
    setCaptureBusy(false);
  }
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result), { once: true });
    reader.addEventListener(
      "error",
      () => reject(new Error("The chosen screenshot could not be read.")),
      { once: true },
    );
    reader.readAsDataURL(file);
  });
}

async function openUploadedImage(file) {
  clearCaptureAlert();
  if (!file) {
    return;
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    showCaptureAlert(
      "Screenshot not opened",
      "Choose a JPEG, PNG, or WebP image.",
    );
    return;
  }
  if (file.size <= 0 || file.size > MAX_HANDOFF_BYTES) {
    showCaptureAlert(
      "Screenshot not opened",
      `Choose an image smaller than ${bytesLabel(MAX_HANDOFF_BYTES)}.`,
    );
    return;
  }

  setCaptureBusy(true, "Opening screenshot…");
  try {
    const dataUrl = await readImageFile(file);
    const draft = makeCaptureDraft({
      kind: "visible_tab",
      source: normalizeUploadedImageSource(file),
      dataUrl,
    });
    await openReview(draft);
  } catch (error) {
    showCaptureAlert(
      "Screenshot not opened",
      error instanceof Error ? error.message : "The image could not be read.",
    );
  } finally {
    setCaptureBusy(false);
  }
}

async function loadSelectedFixture() {
  if (!state.fixtureSuite) {
    return;
  }

  const fixtureCase = state.fixtureSuite.cases.find(
    (item) => item.id === elements.fixtureCase.value,
  );
  if (!fixtureCase) {
    showCaptureAlert("Fixture unavailable", "Choose another bundled case.");
    return;
  }

  const source = {
    title: fixtureCase.title,
    url: `fixture://${state.fixtureSuite.suite_id}/${fixtureCase.id}`,
    captured_at: fixtureCase.context.captured_at,
  };
  const draft = makeCaptureDraft({
    kind: "fixture",
    source,
    fixtureCase,
    transport: "fixture",
    createdAt: fixtureCase.context.captured_at,
  });
  await openReview(draft);
}

async function loadLongMixedScriptSample() {
  const sample = LONG_MIXED_SCRIPT_SAMPLE;
  const draft = makeCaptureDraft({
    kind: "selected_text",
    source: sample.source,
    text: sample.text,
    transport: "fixture",
    syntheticLabel: sample.synthetic_label,
    createdAt: sample.source.captured_at,
  });
  await openReview(draft);
}

async function loadImage(dataUrl) {
  const image = new Image();
  const loaded = new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", reject, { once: true });
  });
  image.src = dataUrl;
  await loaded;
  return image;
}

async function openReview(draft) {
  clearCaptureAlert();
  state.contactHandoffEnvelope = null;
  state.draft = draft;
  state.image = null;
  state.fixtureRecovered = false;
  resetDecision();

  if (draft.kind === "visible_tab") {
    state.image = await loadImage(draft.original_data_url);
  }

  elements.captureView.hidden = true;
  elements.reviewView.hidden = false;
  elements.modeSelect.disabled = true;
  renderReview();
  elements.backButton.focus();
  announce(
    "Capture review opened. Inspect source and exact evidence, check the local session, then approve and submit explicitly.",
  );
}

function clearDraft() {
  if (state.draft) {
    state.draft.original_data_url = null;
    state.draft.original_text = null;
    state.draft.reviewed_text = null;
    state.draft.fixture_case = null;
  }
  state.draft = null;
  state.contactHandoffEnvelope = null;
  state.image = null;
  state.drawRedaction = null;
  state.requestIdentity = null;
  state.fixtureRecovered = false;
  state.session = {
    state: "not_checked",
    message:
      "The extension never reads or shows a password, cookie, or bearer token.",
  };
  resetDecision();
  elements.reviewView.hidden = true;
  elements.captureView.hidden = false;
  elements.modeSelect.disabled = false;
  elements.uploadImage.value = "";
  clearCaptureAlert();
  renderMode();
  elements.captureTitle.focus();
  announce("Capture removed. No reviewed payload remains in this panel.");
}

function renderReview() {
  const draft = state.draft;
  if (!draft) {
    return;
  }

  elements.sourceTitle.textContent = draft.source.title;
  elements.sourceUrl.textContent = draft.source.url;
  elements.sourceTimeLabel.textContent =
    draft.source.time_basis === "imported_at" ? "Imported" : "Captured";
  elements.sourceTime.textContent = humanTime(draft.source.captured_at);
  elements.captureKindChip.textContent = {
    visible_tab: "Visible pixels",
    selected_text: "Selected text",
    page_text: "Page text",
    fixture: "Synthetic fixture",
  }[draft.kind];
  if (draft.synthetic_label) {
    elements.captureKindChip.textContent = draft.synthetic_label;
  }

  const cleared = Boolean(draft.local_cleared);
  elements.localCleared.hidden = !cleared;
  elements.screenshotReview.hidden = cleared || draft.kind !== "visible_tab";
  elements.textReview.hidden = cleared || !["selected_text", "page_text"].includes(draft.kind);
  elements.fixtureReview.hidden = draft.kind !== "fixture";

  if (draft.kind === "visible_tab" && !cleared) {
    syncCropInputs();
    renderCanvas();
    renderRedactionList();
  } else if (["selected_text", "page_text"].includes(draft.kind) && !cleared) {
    elements.reviewedText.value = draft.reviewed_text ?? "";
    renderTextSummary();
  } else if (draft.kind === "fixture") {
    renderFixture();
  }

  renderSession();
  renderRetention();
  renderSubmission();
  renderProgress();
}

function renderProgress() {
  const steps = progressPresentation({
    sessionState: state.session.state,
    approved: elements.approvalCheck.checked,
    submissionState: state.submission.state,
  });
  const stepElements = [
    elements.stepEvidence,
    elements.stepSession,
    elements.stepSubmit,
  ];

  steps.forEach((step, index) => {
    const copy = stepElements[index];
    copy.textContent = step.label;
    copy.closest("li").dataset.state = step.state;
  });

  if (
    state.draft?.kind === "visible_tab" &&
    !retentionCompatibility("visible_tab", elements.retentionMode.value).supported
  ) {
    elements.stepSubmit.textContent = "Web image handoff unavailable";
    elements.stepSubmit.closest("li").dataset.state = "upcoming";
  }
}

function syncCropInputs() {
  const crop = state.draft?.crop ?? {};
  elements.cropLeft.value = String(crop.left ?? 0);
  elements.cropTop.value = String(crop.top ?? 0);
  elements.cropRight.value = String(crop.right ?? 0);
  elements.cropBottom.value = String(crop.bottom ?? 0);
}

function currentCropFromInputs() {
  return normalizeCrop({
    left: elements.cropLeft.value,
    top: elements.cropTop.value,
    right: elements.cropRight.value,
    bottom: elements.cropBottom.value,
  });
}

function renderCanvas() {
  if (!state.image || !state.draft) {
    return;
  }

  const canvas = elements.canvas;
  const context = canvas.getContext("2d", { alpha: false });
  const source = cropPixels(
    state.image.naturalWidth,
    state.image.naturalHeight,
    state.draft.crop,
  );
  const outputScale = Math.min(1, 1_600 / source.width);
  canvas.width = Math.max(1, Math.round(source.width * outputScale));
  canvas.height = Math.max(1, Math.round(source.height * outputScale));
  context.drawImage(
    state.image,
    source.sx,
    source.sy,
    source.width,
    source.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const redactions = [
    ...state.draft.redactions,
    ...(state.drawRedaction ? [state.drawRedaction] : []),
  ];

  for (const item of redactions) {
    if (!isRedactionVisible(item, state.draft.crop)) {
      continue;
    }
    const rectangle = redactionPixels(
      item,
      state.draft.crop,
      canvas.width,
      canvas.height,
    );
    const x = Math.max(0, rectangle.x);
    const y = Math.max(0, rectangle.y);
    const width = Math.min(canvas.width - x, rectangle.width);
    const height = Math.min(canvas.height - y, rectangle.height);
    context.fillStyle = "#181816";
    context.fillRect(x, y, width, height);

    if (width > 68 && height > 24) {
      context.fillStyle = "#fffaf5";
      context.font = `${Math.max(11, Math.round(canvas.width / 90))}px sans-serif`;
      context.textBaseline = "middle";
      context.fillText("Redacted", x + 8, y + height / 2);
    }
  }

  const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
  elements.imageSummary.textContent =
    `${canvas.width}×${canvas.height}, ${bytesLabel(estimateDataUrlBytes(dataUrl))}, ` +
    `${state.draft.redactions.length} redaction${state.draft.redactions.length === 1 ? "" : "s"}`;
}

function renderRedactionList() {
  elements.redactionList.replaceChildren();
  const redactions = state.draft?.redactions ?? [];
  elements.undoRedaction.disabled = redactions.length === 0;

  redactions.forEach((item, index) => {
    const listItem = document.createElement("li");
    const copy = node(
      "span",
      `Box ${index + 1} · ${Math.round(item.width)}×${Math.round(item.height)}%`,
    );
    const remove = node("button", "Remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove redaction ${index + 1}`);
    remove.addEventListener("click", () => {
      state.draft.redactions.splice(index, 1);
      draftChanged();
      renderCanvas();
      renderRedactionList();
    });
    listItem.append(copy, remove);
    elements.redactionList.append(listItem);
  });
}

function renderTextSummary() {
  const text = state.draft?.reviewed_text ?? "";
  const edited = text !== state.draft?.original_text;
  elements.textSummary.textContent =
    `${text.length.toLocaleString()} characters${edited ? " · edited" : ""}`;
  resizeTextEditor();
}

function resizeTextEditor() {
  elements.reviewedText.style.height = "auto";
  const rootSize = Number.parseFloat(
    getComputedStyle(document.documentElement).fontSize,
  );
  const maximum = rootSize * 42;
  elements.reviewedText.style.height =
    `${Math.min(elements.reviewedText.scrollHeight + 2, maximum)}px`;
  elements.reviewedText.dataset.overflow =
    elements.reviewedText.scrollHeight > maximum ? "scroll" : "expanded";
}

function renderFixture() {
  const fixtureCase = state.draft?.fixture_case;
  if (!fixtureCase || !state.fixtureSuite) {
    return;
  }

  elements.fixtureTitle.textContent = fixtureCase.title;
  elements.fixtureId.textContent = fixtureCase.id;
  elements.fixtureContext.replaceChildren();

  const contextLines = [
    fixtureCase.context.candidate
      ? `Candidate: ${fixtureCase.context.candidate}`
      : "Candidate: unresolved",
    fixtureCase.context.assignment
      ? `Assignment: ${fixtureCase.context.assignment}`
      : "Assignment: unresolved",
    `Source timezone: ${fixtureCase.context.source_timezone ?? "ambiguous"}`,
  ];
  if (fixtureCase.context.candidate_options) {
    contextLines.push(
      `Possible matches: ${fixtureCase.context.candidate_options.join(" · ")}`,
    );
  }
  if (fixtureCase.context.prior_state) {
    contextLines.push(
      `Prior state: ${Object.values(fixtureCase.context.prior_state).join(", ")}`,
    );
  }
  if (fixtureCase.context.requested_output) {
    contextLines.push(`Requested output: ${fixtureCase.context.requested_output}`);
  }

  contextLines.forEach((line) => elements.fixtureContext.append(node("p", line)));

  elements.fixtureMessages.replaceChildren();
  for (const message of fixtureCase.messages) {
    const item = document.createElement("li");
    item.id = `fixture-message-${message.id}`;
    item.tabIndex = -1;
    item.append(
      node("span", `${message.id} · ${message.speaker}`),
      node("p", message.text),
    );
    elements.fixtureMessages.append(item);
  }

  const disposition = dispositionPresentation(fixtureCase.expected.disposition);
  elements.fixtureDisposition.textContent = disposition.label;
  elements.fixtureDisposition.dataset.state = disposition.state;

  elements.fixtureAssertions.replaceChildren();
  if (fixtureCase.expected.assertions.length === 0) {
    elements.fixtureAssertions.append(
      node("p", "No assertion is supported for persistence.", "edit-note"),
    );
  } else {
    for (const assertion of fixtureCase.expected.assertions) {
      const item = node("article", null, "assertion");
      const messageId = `fixture-message-${assertion.evidence_message_id}`;
      item.dataset.state = assertion.status;
      item.setAttribute("aria-describedby", messageId);
      item.append(
        node("strong", `${assertion.field} · ${assertion.status}`),
      );
      const priorValue =
        fixtureCase.context.prior_state?.[assertion.field] ?? null;
      if (priorValue) {
        const change = node("p", null, "state-change");
        change.append(
          node("del", priorValue),
          node("span", "→ proposed change"),
          node("strong", assertion.value),
        );
        item.append(change);
      } else {
        item.append(node("p", assertion.value));
      }
      item.append(
        node(
          "small",
          `Exact evidence ${assertion.evidence_message_id}: “${assertion.evidence_quote}”`,
        ),
      );
      const links = node("div", null, "evidence-links");
      const openEvidence = node(
        "button",
        `View message ${assertion.evidence_message_id}`,
        "evidence-link",
      );
      openEvidence.type = "button";
      openEvidence.addEventListener("click", () =>
        focusFixtureMessage(assertion.evidence_message_id),
      );
      links.append(openEvidence);
      item.append(links);
      elements.fixtureAssertions.append(item);
    }
  }

  const action = fixtureCase.expected.action;
  elements.fixtureActionBlock.hidden = !action;
  elements.fixtureAction.replaceChildren();
  if (action) {
    elements.fixtureAction.append(
      document.createTextNode(
        `${action.type.replaceAll("_", " ")} · ${action.target}. ${action.reason} Due ${action.due}; owned by ${action.owner}.`,
      ),
    );
    const actionLinks = node("span", null, "evidence-links");
    for (const messageId of action.evidence_message_ids ?? []) {
      const openEvidence = node(
        "button",
        `View action evidence ${messageId}`,
        "evidence-link",
      );
      openEvidence.type = "button";
      openEvidence.addEventListener("click", () =>
        focusFixtureMessage(messageId),
      );
      actionLinks.append(openEvidence);
    }
    elements.fixtureAction.append(actionLinks);
  }

  elements.fixtureBoundaries.replaceChildren();
  fixtureCase.expected.must_not.forEach((boundary) => {
    elements.fixtureBoundaries.append(node("li", `Must not ${boundary}.`));
  });
  elements.fixtureDetailSummary.textContent =
    `${fixtureCase.expected.assertions.length} proposed change${fixtureCase.expected.assertions.length === 1 ? "" : "s"} · ${fixtureCase.expected.must_not.length} limits`;
}

function focusFixtureMessage(messageId) {
  for (const message of elements.fixtureMessages.children) {
    message.classList.remove("is-evidence-target");
  }
  const target = byId(`fixture-message-${messageId}`);
  if (!target) {
    return;
  }
  target.classList.add("is-evidence-target");
  target.scrollIntoView({ block: "center", behavior: "auto" });
  target.focus({ preventScroll: true });
  announce(`Exact evidence ${messageId} focused.`);
}

function renderSession() {
  const synthetic = isSyntheticTransport(state.draft);
  const presentation = sessionPresentation(state.session, synthetic);
  elements.originField.hidden = synthetic;
  elements.openSignIn.hidden = synthetic;
  elements.checkSession.hidden = false;
  elements.checkSession.textContent = synthetic
    ? state.session.state === "ready"
      ? "Refresh synthetic session"
      : "Check synthetic session"
    : "Check session";
  elements.checkSession.disabled = presentation.busy;
  elements.sessionState.className = `state-chip ${presentation.chip_class}`;
  elements.sessionState.textContent = presentation.chip_label;
  elements.sessionCopy.textContent = state.session.message;
  elements.sessionCopy.closest("section").setAttribute(
    "aria-busy",
    String(presentation.busy),
  );
  updateSubmitAvailability();
  renderProgress();
}

function renderRetention() {
  const captureKind = state.draft?.kind ?? "selected_text";
  if (captureKind === "visible_tab" && !retentionCompatibility(captureKind, elements.retentionMode.value).supported) elements.retentionMode.value = "evidence_crop";
  for (const option of elements.retentionMode.options) {
    option.disabled = !retentionCompatibility(
      captureKind,
      option.value,
    ).supported;
  }
  const compatibility = retentionCompatibility(
    captureKind,
    elements.retentionMode.value,
  );
  elements.retentionCopy.textContent = compatibility.message;
  const imageHandoffBlocked =
    captureKind === "visible_tab" && !compatibility.supported;
  elements.dispatchShell.dataset.imageHandoff = imageHandoffBlocked
    ? "unavailable"
    : "available";
  elements.approvalCheck.closest("label").hidden = imageHandoffBlocked;
  elements.submitHeading.textContent = imageHandoffBlocked
    ? "Choose the supported reviewed-source retention mode."
    : "Submit this reviewed capture?";
  elements.handoffEffect.textContent = imageHandoffBlocked
    ? "No transfer · reviewed pixels remain local"
    : "Save this source, process it with AI, and file a reversible internal person record when identity is clear";
  elements.submitNote.textContent = imageHandoffBlocked
    ? "This retention mode is unavailable. Select reviewed-source retention before submitting pixels to Web for AI processing."
    : "Submission is a capture handoff only. It does not confirm facts, contact anyone, create a meeting, or update an ATS.";
  elements.handoffTarget.textContent =
    isSyntheticTransport(state.draft)
      ? "Synthetic fixture transport · no network"
      : elements.localOrigin.value;
}

function renderSubmission() {
  const submission = state.submission;
  const presentation = submissionPresentation(submission);
  elements.submissionStatus.hidden = !presentation.visible;
  elements.submissionStatus.setAttribute(
    "aria-busy",
    String(presentation.busy),
  );
  elements.checkReceipt.hidden = !presentation.check_receipt;
  elements.checkReceipt.textContent = state.draft?.kind === "visible_tab" ? "Recover same task" : "Check receipt";
  const imageHandoffBlocked =
    state.draft?.kind === "visible_tab" &&
    !retentionCompatibility("visible_tab", elements.retentionMode.value).supported;
  elements.openWebReview.hidden = !(
    submission.state === "received" &&
    (submission.task_id || submission.capture_id) &&
    !isSyntheticTransport(state.draft)
  );

  if (presentation.visible) {
    elements.submissionStatus.dataset.state = submission.state;
    elements.submissionStateLabel.textContent = submission.state;
    elements.submissionTitle.textContent = presentation.title;
    elements.submissionCopy.textContent = submission.message ?? "";
    elements.receiptId.hidden = !submission.receipt_id;
    elements.receiptId.textContent = submission.receipt_id
      ? `Receipt ${submission.receipt_id}`
      : "";
  }

  elements.submitButton.textContent = imageHandoffBlocked
    ? "Choose supported retention"
    : presentation.action_label;
  updateSubmitAvailability();
  renderProgress();
}

function assetIsReady() {
  if (!state.draft || state.draft.local_cleared) {
    return false;
  }
  if (state.draft.kind === "visible_tab") {
    return Boolean(state.image && elements.canvas.width && elements.canvas.height);
  }
  if (["selected_text", "page_text"].includes(state.draft.kind)) {
    return Boolean(state.draft.reviewed_text?.trim());
  }
  return state.draft.kind === "fixture";
}

function updateSubmitAvailability() {
  const presentation = submissionPresentation(state.submission);
  const retentionSupported = retentionCompatibility(
    state.draft?.kind,
    elements.retentionMode.value,
  ).supported;
  elements.submitButton.disabled =
    !assetIsReady() ||
    !retentionSupported ||
    !elements.approvalCheck.checked ||
    state.session.state !== "ready" ||
    presentation.blocks_submit;
  renderProgress();
}

function reviewAsset() {
  if (state.draft.kind === "visible_tab") {
    const dataUrl = elements.canvas.toDataURL("image/jpeg", 0.92);
    return {
      type: "reviewed_image",
      mime_type: "image/jpeg",
      width: elements.canvas.width,
      height: elements.canvas.height,
      data_url: dataUrl,
      edits: {
        crop_percent: state.draft.crop,
        redactions_percent: state.draft.redactions,
      },
    };
  }

  if (["selected_text", "page_text"].includes(state.draft.kind)) {
    return {
      type: "reviewed_text",
      text: state.draft.reviewed_text.trim(),
      edited_from_selection:
        state.draft.reviewed_text !== state.draft.original_text,
    };
  }

  return {
    type: "synthetic_fixture",
    suite_id: state.fixtureSuite.suite_id,
    suite_version: state.fixtureSuite.version,
    case_id: state.draft.fixture_case.id,
    input: {
      context: state.draft.fixture_case.context,
      messages: state.draft.fixture_case.messages,
    },
    expected_contract: state.draft.fixture_case.expected,
  };
}

async function responseBody(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function postRealHandoff(origin, envelope) {
  if (envelope.source.capture_kind === "visible_tab") {
    state.contactHandoffEnvelope = envelope;
    return chrome.runtime.sendMessage({ type: "handoff.reviewed-image", envelope });
  }
  const response = await webRequest(origin, "/api/browser-extension/captures", {
    method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":envelope.idempotency_key,"X-Talent-Signal-Session-Version":envelope.session.version},body:JSON.stringify(envelope),
  });
  return classifyReceiptResponse(response.status,response.body);
}
async function getRealReceipt(origin, requestId) {
  const response=await webRequest(origin,`/api/browser-extension/captures/${encodeURIComponent(requestId)}`);
  return classifyReceiptResponse(response.status,response.body);
}

function clearPrivatePayloadAfterReceipt() {
  if (!state.draft || state.draft.kind === "fixture") {
    return;
  }

  state.draft.original_data_url = null;
  state.contactHandoffEnvelope = null;
  state.draft.original_text = null;
  state.draft.reviewed_text = null;
  state.draft.local_cleared = true;
  state.image = null;
  elements.canvas.width = 1;
  elements.canvas.height = 1;
  renderReview();
}

async function submitHandoff() {
  if (elements.submitButton.disabled || !state.draft) {
    return;
  }

  let origin = DEFAULT_LOCAL_ORIGIN;
  try {
    if (!isSyntheticTransport(state.draft)) {
      origin = normalizeLocalOrigin(elements.localOrigin.value);
    }
  } catch (error) {
    state.submission = {
      state: "failed",
      code: "invalid_origin",
      message: error.message,
      receipt_id: null,
      duplicate: false,
    };
    renderSubmission();
    return;
  }

  state.requestIdentity ??= createRequestIdentity(state.draft.id);
  const envelope = buildHandoffEnvelope({
    draft: state.draft,
    reviewedAsset: reviewAsset(),
    retentionMode: elements.retentionMode.value,
    requestIdentity: state.requestIdentity,
    handoffTarget:
      isSyntheticTransport(state.draft)
        ? "fixture://local-transport"
        : origin,
    sessionVersion: state.session.session_version ?? null,
  });
  const encodedBytes = new TextEncoder().encode(JSON.stringify(envelope)).byteLength;

  if (encodedBytes > MAX_HANDOFF_BYTES) {
    state.submission = {
      state: "failed",
      code: "payload_too_large",
      message: `The reviewed packet is ${bytesLabel(encodedBytes)}. Crop it below ${bytesLabel(MAX_HANDOFF_BYTES)} before submitting.`,
      receipt_id: null,
      duplicate: false,
    };
    renderSubmission();
    return;
  }

  state.submitAttempt += 1;
  const reviewGeneration = state.reviewGeneration;
  state.submission = {
    state: "pending",
    code: null,
    message:
      "The reviewed packet is being handed to the local service. No downstream fact or action is approved.",
    receipt_id: null,
    duplicate: false,
  };
  renderSubmission();

  try {
    const scenario =
      state.fixtureRecovered &&
      elements.fixtureScenario.value === "stale_session"
        ? "received"
        : elements.fixtureScenario.value;
    const result =
      isSyntheticTransport(state.draft)
        ? await fixtureSubmit({
            envelope,
            scenario,
            attempt: state.submitAttempt,
          })
        : await postRealHandoff(origin, envelope);
    if (reviewGeneration !== state.reviewGeneration) return;
    state.submission = result;
    if (result.code === "session_stale") {
      state.session = {
        state: "not_ready",
        message:
          "The local service rejected the previous session version. Open or check sign-in before retrying.",
      };
      renderSession();
    }
    if (result.state === "received") {
      clearPrivatePayloadAfterReceipt();
    }
  } catch (error) {
    if (reviewGeneration !== state.reviewGeneration) return;
    state.submission = classifyTransportError(error);
  }

  renderSubmission();
}

async function checkReceipt() {
  if (!state.requestIdentity || !state.draft) {
    return;
  }

  const reviewGeneration = state.reviewGeneration;
  state.submission = {
    state: "pending",
    code: null,
    message: "Checking the local service for receipt evidence.",
    receipt_id: state.submission.receipt_id,
    duplicate: false,
  };
  renderSubmission();

  try {
    const origin =
      isSyntheticTransport(state.draft)
        ? DEFAULT_LOCAL_ORIGIN
        : normalizeLocalOrigin(elements.localOrigin.value);
    const result =
      isSyntheticTransport(state.draft)
        ? await fixtureCheck({
            requestId: state.requestIdentity.request_id,
            scenario: elements.fixtureScenario.value,
          })
        : state.draft.kind === "visible_tab" && state.contactHandoffEnvelope
          ? await postRealHandoff(origin, state.contactHandoffEnvelope)
          : await getRealReceipt(origin, state.requestIdentity.request_id);
    if (reviewGeneration !== state.reviewGeneration) return;
    state.submission = result;
    if (result.state === "received") {
      clearPrivatePayloadAfterReceipt();
    }
  } catch (error) {
    if (reviewGeneration !== state.reviewGeneration) return;
    state.submission = classifyTransportError(error);
  }

  renderSubmission();
}

async function checkSession() {
  if (!state.draft) {
    return;
  }

  const synthetic = isSyntheticTransport(state.draft);
  state.session = {
    state: "checking",
    message: synthetic
      ? "Checking the synthetic session without making a network request."
      : "Checking only the browser-managed localhost session.",
  };
  renderSession();

  if (synthetic) {
    await new Promise((resolve) => setTimeout(resolve, 140));
    if (
      elements.fixtureScenario.value === "stale_session" &&
      state.submission.code === "session_stale"
    ) {
      state.fixtureRecovered = true;
    }
    state.session = {
      state: "ready",
      message:
        state.fixtureRecovered
          ? "Synthetic session refreshed. Retry reuses the same idempotency key."
          : "Synthetic local session is ready. No network request or external effect will occur.",
    };
    renderSession();
    announce(state.session.message);
    return;
  }

  try {
    const origin = normalizeLocalOrigin(elements.localOrigin.value);
    await connectWebOrigin(origin);
    const response=await webRequest(origin,"/api/browser-extension/session");
    state.session = sessionCopy(response.status,response.body);
  } catch (error) {
    state.session = {
      state: "not_ready",
      message:
        "No local session was observed. Nothing was submitted; open the local sign-in flow and check again.",
    };
  }

  renderSession();
  announce(state.session.message);
}

async function openSignIn() {
  try {
    const origin = normalizeLocalOrigin(elements.localOrigin.value);
    await connectWebOrigin(origin);
    const target = new URL("/login", origin);
    target.searchParams.set("source", "browser-extension");
    target.searchParams.set("callbackUrl", "/workspace/captures");
    await chrome.tabs.create({ url: target.toString() });
  } catch (error) {
    state.session = {
      state: "not_ready",
      message: error.message,
    };
    renderSession();
  }
}

async function openExactWebReview() {
  if (!(state.submission.task_id || state.submission.capture_id) || isSyntheticTransport(state.draft)) {
    return;
  }
  try {
    const target = (state.submission.contact_task_id ? contactTaskReviewURL : buildExactWebReviewUrl)(
      elements.localOrigin.value,
      state.submission.task_id || state.submission.capture_id,
    );
    await chrome.tabs.create({ url: target });
  } catch (error) {
    state.submission = {
      ...state.submission,
      message:
        error instanceof Error
          ? error.message
          : "The exact Web review could not be opened.",
    };
    renderSubmission();
  }
}

function canvasPoint(event) {
  const bounds = elements.canvas.getBoundingClientRect();
  const crop = normalizeCrop(state.draft.crop);
  const visibleWidth = 100 - crop.left - crop.right;
  const visibleHeight = 100 - crop.top - crop.bottom;
  return {
    x: crop.left + ((event.clientX - bounds.left) / bounds.width) * visibleWidth,
    y: crop.top + ((event.clientY - bounds.top) / bounds.height) * visibleHeight,
  };
}

let dragStart = null;

elements.canvas.addEventListener("pointerdown", (event) => {
  if (!state.draft || state.draft.local_cleared) {
    return;
  }
  dragStart = canvasPoint(event);
  elements.canvas.setPointerCapture(event.pointerId);
});

elements.canvas.addEventListener("pointermove", (event) => {
  if (!dragStart || !state.draft) {
    return;
  }
  const current = canvasPoint(event);
  state.drawRedaction = normalizeRedaction({
    x: Math.min(dragStart.x, current.x),
    y: Math.min(dragStart.y, current.y),
    width: Math.abs(current.x - dragStart.x),
    height: Math.abs(current.y - dragStart.y),
  });
  renderCanvas();
});

elements.canvas.addEventListener("pointerup", (event) => {
  if (!dragStart || !state.drawRedaction || !state.draft) {
    dragStart = null;
    return;
  }
  elements.canvas.releasePointerCapture(event.pointerId);
  state.draft.redactions.push(state.drawRedaction);
  state.drawRedaction = null;
  dragStart = null;
  draftChanged();
  renderCanvas();
  renderRedactionList();
});

for (const input of [
  elements.cropLeft,
  elements.cropTop,
  elements.cropRight,
  elements.cropBottom,
]) {
  input.addEventListener("change", () => {
    state.draft.crop = currentCropFromInputs();
    syncCropInputs();
    draftChanged();
    renderCanvas();
  });
}

elements.addRedaction.addEventListener("click", () => {
  state.draft.redactions.push(
    normalizeRedaction({ x: 35, y: 40, width: 30, height: 12 }),
  );
  draftChanged();
  renderCanvas();
  renderRedactionList();
});

elements.undoRedaction.addEventListener("click", () => {
  state.draft.redactions.pop();
  draftChanged();
  renderCanvas();
  renderRedactionList();
});

elements.resetImageEdits.addEventListener("click", () => {
  state.draft.crop = { left: 0, top: 0, right: 0, bottom: 0 };
  state.draft.redactions = [];
  syncCropInputs();
  draftChanged();
  renderCanvas();
  renderRedactionList();
});

elements.reviewedText.addEventListener("input", () => {
  state.draft.reviewed_text = elements.reviewedText.value;
  draftChanged();
  renderTextSummary();
});

elements.modeSelect.addEventListener("change", () => {
  state.mode = elements.modeSelect.value;
  clearDraft();
  renderMode();
});
elements.captureVisible.addEventListener("click", () =>
  requestCapture("capture.visible"),
);
elements.captureSelection.addEventListener("click", () =>
  requestCapture("capture.selection"),
);
elements.uploadImage.addEventListener("change", () =>
  openUploadedImage(elements.uploadImage.files?.[0] ?? null),
);
elements.loadFixture.addEventListener("click", loadSelectedFixture);
elements.backButton.addEventListener("click", clearDraft);
elements.removeButton.addEventListener("click", clearDraft);
elements.retentionMode.addEventListener("change", () => {
  renderRetention();
  draftChanged();
});
elements.localOrigin.addEventListener("change", () => {
  state.session = {
    state: "not_checked",
    message:
      "The local target changed. Check its browser-managed session before approving this handoff.",
  };
  renderRetention();
  draftChanged();
  renderSession();
});
elements.approvalCheck.addEventListener("change", () => {
  updateSubmitAvailability();
  announce(
    elements.approvalCheck.checked
      ? "Reviewed payload approved for this exact capture handoff. Submission has not occurred."
      : "Capture handoff approval removed.",
  );
});
elements.submitButton.addEventListener("click", submitHandoff);
elements.checkReceipt.addEventListener("click", checkReceipt);
elements.checkSession.addEventListener("click", () => checkSession());
elements.openSignIn.addEventListener("click", openSignIn);
elements.openWebReview.addEventListener("click", openExactWebReview);

async function renderHandoffRecovery() {
  if (state.mode !== "live" || !globalThis.chrome?.runtime?.sendMessage) return;
  const section = byId("handoff-recovery"), items = byId("handoff-recovery-items");
  try {
    const response = await chrome.runtime.sendMessage({ type: "handoff.recovery-list" });
    const records = response?.records ?? [];
    section.hidden = records.length === 0;
    items.replaceChildren();
    for (const record of records) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${record.completed ? "Open previous handoff" : "Check pending handoff"} · ${record.origin}`;
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const result = await chrome.runtime.sendMessage({ type: "handoff.recover", requestKey: record.requestKey });
          byId("handoff-recovery-status").textContent = result?.message ?? "Receipt not verified. Check again before resubmitting.";
          if (["received", "unavailable"].includes(result?.state)) button.remove();
        } finally { button.disabled = false; }
      });
      items.append(button);
    }
  } catch { showCaptureAlert("Recovery unavailable", "Check your Web tasks before submitting another copy."); }
}

async function initialize() {
  const runtime = globalThis.chrome?.runtime;
  const installedVersion = installedExtensionVersion(runtime);
  byId("extension-version-short").textContent = installedVersion
    ? ` · v${installedVersion}`
    : " · version unavailable";
  byId("extension-version").textContent = installedVersion
    ? `Installed extension ${installedVersion} · update status not checked`
    : "Extension version unavailable";
  runtime?.onUpdateAvailable?.addListener?.((offer) => {
    const next = extensionVersion(offer?.version);
    byId("extension-version-short").textContent = installedVersion
      ? ` · v${installedVersion} · update available`
      : " · update available";
    byId("extension-version").textContent = next
      ? `Update ${next} is available. Finish this review before updating in Chrome extensions.`
      : "An extension update is available. Finish this review before updating in Chrome extensions.";
  });
  elements.localOrigin.value = DEFAULT_LOCAL_ORIGIN;
  renderMode();
  await renderHandoffRecovery();
  try {
    await loadFixtureSuite();
    if (state.mode === "fixture") {
      if (query.get("audit") === "long-mixed-text") {
        await loadLongMixedScriptSample();
      } else {
        await loadSelectedFixture();
      }
    }
  } catch (error) {
    showCaptureAlert("Fixture package unavailable", error.message);
  }
}

initialize();

byId("capture-page").addEventListener("click",()=>requestCapture("capture.page"));
byId("capture-screen").addEventListener("click",()=>{
  chrome.desktopCapture.chooseDesktopMedia(["screen","window","tab"],async streamId=>{
    if(!streamId)return;
    let stream;
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{mandatory:{chromeMediaSource:"desktop",chromeMediaSourceId:streamId}}});
      const video=document.createElement("video");video.srcObject=stream;await video.play();
      await new Promise(resolve=>video.requestVideoFrameCallback(resolve));
      const canvas=document.createElement("canvas");canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      canvas.getContext("2d").drawImage(video,0,0);
      const dataUrl=canvas.toDataURL("image/png");
      stream.getTracks().forEach(track=>track.stop());stream=null;
      await openReview(makeCaptureDraft({kind:"visible_tab",source:{title:"Screen capture",url:"screen://user-selected",captured_at:new Date().toISOString()},dataUrl}));
    }catch(error){showCaptureAlert("Screen capture unavailable",error.message);}
    finally{stream?.getTracks().forEach(track=>track.stop());}
  });
});
