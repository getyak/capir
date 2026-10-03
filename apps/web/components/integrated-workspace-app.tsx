"use client";

import { workspaceSessionFetch } from "@/components/workspace-session-request";

import type { WorkspaceReviewResponse } from "@talent-signal/contracts";
import {
  ArrowClockwise,
  ArrowRight,
  Check,
  CheckCircle,
  CircleNotch,
  Clock,
  Database,
  LinkSimple,
  PencilSimple,
  Prohibit,
  ShieldCheck,
  Trash,
  Warning,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import type { MouseEvent } from "react";
import { useMemo, useRef, useState } from "react";

import {
  areRequiredAssertionsConfirmed,
  capabilityNoticeAnnouncement,
  deriveIntegrationAuthorityPresentation,
  deriveIntegrationAuthorityState,
  integrationStateAnnouncement,
  presentedAssertionValue,
} from "@/lib/integrationState";
import {
  createSyntheticBrowserHandoff,
  FROZEN_SYNTHETIC_SOURCE,
  reuseSyntheticBrowserHandoff,
} from "@/lib/browserHandoff";

import { ThemeToggle } from "./theme-toggle";

type Props = {
  initialWorkspace: WorkspaceReviewResponse | null;
  initialError: string | null;
  user: {
    email?: string | null;
    name?: string | null;
  };
};

type MutationState = {
  cancelable: boolean;
  label: string;
  target: string;
} | null;

type ErrorState = {
  code: string;
  message: string;
} | null;

type DeletionState = {
  deletion: {
    access_revoked_at: string;
    deletion_id: string;
    derivatives_deleted: number;
    status: "deleted";
  };
  lineage: {
    completed_at: string | null;
    lineage: Array<{
      disposition: string;
      entity_id: string;
      entity_type: string;
    }>;
  };
} | null;

function reviewLabel(status: string) {
  switch (status) {
    case "confirmed":
      return "Confirmed by recruiter";
    case "dismissed":
      return "Dismissed";
    case "unresolved":
      return "Needs clarification";
    default:
      return "Proposed from evidence";
  }
}

function fieldLabel(field: string) {
  return field.replaceAll("_", " ");
}

function errorHeading(error: Exclude<ErrorState, null>) {
  if (error.code === "CAPABILITY_NOT_AUTHORIZED") {
    return "Local effect permission was revoked.";
  }
  if (
    error.code === "APPROVAL_NOT_CURRENT" ||
    error.code === "APPROVAL_STALE"
  ) {
    return "The approval is no longer current.";
  }
  if (error.code === "request_cancelled") {
    return "The refresh was cancelled.";
  }
  return "Canonical state could not be updated.";
}

export function IntegratedWorkspaceApp({
  initialWorkspace,
  initialError,
  user,
}: Props) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [error, setError] = useState<ErrorState>(
    initialError
      ? {
          code: "workspace_not_found",
          message: initialError,
        }
      : null,
  );
  const [mutation, setMutation] = useState<MutationState>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [announcement, setAnnouncement] = useState(
    initialWorkspace
      ? "Backend-owned synthetic evidence is ready for review."
      : "No submitted synthetic evidence is available.",
  );
  const [deletion, setDeletion] = useState<DeletionState>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState(false);
  const [capabilityRevoked, setCapabilityRevoked] = useState(false);
  const abortController = useRef<AbortController | null>(null);
  const syntheticHandoff = useRef<ReturnType<
    typeof createSyntheticBrowserHandoff
  > | null>(null);

  const assertions = workspace?.analysis.assertions ?? [];
  const allFactsReviewed =
    assertions.length > 0 &&
    assertions.every((assertion) =>
      ["confirmed", "dismissed"].includes(assertion.review_status),
    );
  const confirmedCount = assertions.filter(
    (assertion) => assertion.review_status === "confirmed",
  ).length;
  const action = workspace?.analysis.action ?? null;
  const allRequiredFactsConfirmed =
    action !== null &&
    areRequiredAssertionsConfirmed(
      action.required_assertion_ids,
      assertions,
    );
  const approval = workspace?.latest_approval ?? null;
  const authorityState = deriveIntegrationAuthorityState({
    action,
    allRequiredFactsConfirmed,
    approval,
    effect: workspace?.latest_effect ?? null,
  });
  const authorityPresentation = deriveIntegrationAuthorityPresentation({
    approvalStatus: approval?.status ?? null,
    authorityState,
    capabilityRevoked,
  });
  const verified = authorityState === "verified";
  const approvalComplete =
    approval?.status === "active" || approval?.status === "consumed";

  const evidenceById = useMemo(
    () =>
      new Map(
        (workspace?.capture.messages ?? []).map((message) => [
          message.id,
          message,
        ]),
      ),
    [workspace],
  );

  async function requestWorkspace(
    path: string,
    options?: RequestInit,
    label = "Refreshing canonical state",
    target = "workspace",
    cancelable = false,
  ) {
    const controller = new AbortController();
    abortController.current = controller;
    setMutation({ cancelable, label, target });
    setError(null);
    setAnnouncement(`${label}.`);
    try {
      const response = await workspaceSessionFetch(path, {
        cache: "no-store",
        ...options,
        signal: controller.signal,
        headers: {
          ...(options?.body ? { "content-type": "application/json" } : {}),
          ...options?.headers,
        },
      });
      const payload = (await response.json()) as
        | WorkspaceReviewResponse
        | {
            code?: string;
            message?: string;
            workspace?: WorkspaceReviewResponse;
          };
      if (!response.ok) {
        const failure = payload as { code?: string; message?: string };
        const failureError = new Error(
          failure.message ??
            `The localhost backend returned ${failure.code ?? response.status}.`,
        );
        Object.assign(failureError, {
          code: failure.code ?? `http_${response.status}`,
        });
        throw failureError;
      }
      const next =
        "workspace" in payload && payload.workspace
          ? payload.workspace
          : (payload as WorkspaceReviewResponse);
      setWorkspace(next);
      setAnnouncement("Canonical backend state updated.");
      return next;
    } catch (caught) {
      const caughtError =
        caught instanceof Error
          ? caught
          : new Error("The localhost state could not be refreshed.");
      const cancelled = caughtError.name === "AbortError";
      const code =
        cancelled
          ? "request_cancelled"
          : "code" in caughtError && typeof caughtError.code === "string"
            ? caughtError.code
            : "backend_unavailable";
      if (code === "CAPABILITY_NOT_AUTHORIZED") {
        setCapabilityRevoked(true);
      }
      setError({
        code,
        message: cancelled
          ? "No state was changed by this cancelled refresh. The last canonical view remains on screen."
          : caughtError.message,
      });
      setAnnouncement(
        cancelled
          ? "Refresh cancelled. Prior state preserved."
          : "The update failed. Prior state preserved.",
      );
      return null;
    } finally {
      if (abortController.current === controller) {
        abortController.current = null;
      }
      setMutation(null);
    }
  }

  async function submitSyntheticEvidence() {
    setMutation({
      cancelable: false,
      label: "Submitting the reviewed synthetic source",
      target: "capture",
    });
    setError(null);
    setAnnouncement("Submitting the reviewed synthetic source.");
    try {
      const request = reuseSyntheticBrowserHandoff(
        syntheticHandoff.current,
        {
          approvedAt: new Date().toISOString(),
          origin: window.location.origin,
          requestId: `web-local-${crypto.randomUUID()}`,
        },
      );
      syntheticHandoff.current = request;
      const response = await workspaceSessionFetch("/api/browser-extension/captures", {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
      });
      const payload = (await response.json()) as {
        code?: string;
        message?: string;
      };
      if (!response.ok) {
        const failure = new Error(
          payload.message ?? "The reviewed synthetic source was not accepted.",
        );
        Object.assign(failure, {
          code: payload.code ?? `http_${response.status}`,
        });
        throw failure;
      }
      const nextResponse = await workspaceSessionFetch("/api/local-integration/workspace", {
        cache: "no-store",
      });
      const nextPayload = (await nextResponse.json()) as
        | WorkspaceReviewResponse
        | { code?: string; message?: string };
      if (!nextResponse.ok || !("capture" in nextPayload)) {
        const failure = nextPayload as { code?: string; message?: string };
        throw new Error(
          failure.message ??
            "The receipt was accepted, but the canonical review could not be read.",
        );
      }
      setWorkspace(nextPayload);
      setAnnouncement(
        "Backend receipt recorded. Proposed facts are ready for review; no effect is authorized.",
      );
    } catch (caught) {
      const caughtError =
        caught instanceof Error
          ? caught
          : new Error("The synthetic source could not be submitted.");
      setError({
        code:
          "code" in caughtError && typeof caughtError.code === "string"
            ? caughtError.code
            : "capture_failed",
        message: caughtError.message,
      });
      setAnnouncement(
        "Evidence submission failed. No review or effect authority was created.",
      );
    } finally {
      setMutation(null);
    }
  }

  function openExactEvidence(
    event: MouseEvent<HTMLAnchorElement>,
    evidenceId: string,
  ) {
    const targetId = `source-evidence-${evidenceId}`;
    const target = document.getElementById(targetId);
    if (!target) {
      return;
    }

    event.preventDefault();
    window.history.replaceState(null, "", `#${targetId}`);
    target.scrollIntoView({ block: "center" });
    target.focus({ preventScroll: true });
    setAnnouncement(
      "Exact source opened. Speaker, time, and scope remain visible.",
    );
  }

  function cancelMutation() {
    abortController.current?.abort();
  }

  async function decide(
    assertionId: string,
    version: number,
    decision: "confirm" | "dismiss",
    correctedValue?: string,
  ) {
    const next = await requestWorkspace(
      `/api/local-integration/assertions/${assertionId}/decisions`,
      {
        method: "POST",
        body: JSON.stringify({
          decision,
          expected_assertion_version: version,
          ...(correctedValue ? { corrected_value: correctedValue } : {}),
        }),
      },
      decision === "dismiss"
        ? "Recording the dismissal"
        : correctedValue
          ? "Saving the edit and confirmation"
          : "Recording the fact confirmation",
      assertionId,
    );
    if (next) {
      setEditing(null);
    }
  }

  async function revokeCapability() {
    setMutation({
      cancelable: false,
      label: "Revoking local effect permission",
      target: "capability",
    });
    setError(null);
    setAnnouncement("Revoking local effect permission.");
    try {
      const response = await workspaceSessionFetch(
        "/api/local-integration/authorizations/revocation",
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        code?: string;
        message?: string;
        status?: string;
      };
      if (!response.ok) {
        const failure = new Error(
          payload.message ?? "The local permission could not be revoked.",
        );
        Object.assign(failure, { code: payload.code ?? "revocation_failed" });
        throw failure;
      }
      setCapabilityRevoked(true);
      setAnnouncement(
        "Local effect permission revoked. Review state remains unchanged.",
      );
    } catch (caught) {
      const caughtError =
        caught instanceof Error
          ? caught
          : new Error("The local permission could not be revoked.");
      setError({
        code:
          "code" in caughtError && typeof caughtError.code === "string"
            ? caughtError.code
            : "revocation_failed",
        message: caughtError.message,
      });
      setAnnouncement("Permission revocation failed. Prior state preserved.");
    } finally {
      setMutation(null);
    }
  }

  async function reviseForRecovery(
    variant: "stale_approval" | "timeout_after_effect",
  ) {
    if (!action) {
      return;
    }
    await requestWorkspace(
      `/api/local-integration/actions/${action.id}/revision`,
      {
        method: "POST",
        body: JSON.stringify({ variant }),
      },
      variant === "stale_approval"
        ? "Revising the preview and invalidating its old approval"
        : "Binding the preview to an unknown-result recovery drill",
      action.id,
    );
  }

  async function deleteEvidence() {
    if (!workspace) {
      return;
    }
    setMutation({
      cancelable: false,
      label: "Deleting source and registered derivatives",
      target: "deletion",
    });
    setError(null);
    setAnnouncement("Deleting source and registered derivatives.");
    try {
      const response = await workspaceSessionFetch(
        `/api/local-integration/captures/${workspace.capture.id}/deletion`,
        { method: "POST" },
      );
      const payload = (await response.json()) as
        | Exclude<DeletionState, null>
        | { code?: string; message?: string };
      if (!response.ok || !("deletion" in payload)) {
        const failure = payload as { code?: string; message?: string };
        const failureError = new Error(
          failure.message ?? "The source could not be deleted.",
        );
        Object.assign(failureError, {
          code: failure.code ?? "deletion_failed",
        });
        throw failureError;
      }
      setDeletion(payload);
      setWorkspace(null);
      setDeleteConfirmation(false);
      setAnnouncement(
        "Source access revoked and registered derivatives deleted.",
      );
    } catch (caught) {
      const caughtError =
        caught instanceof Error
          ? caught
          : new Error("The source could not be deleted.");
      setError({
        code:
          "code" in caughtError && typeof caughtError.code === "string"
            ? caughtError.code
            : "deletion_failed",
        message: caughtError.message,
      });
      setAnnouncement("Deletion failed. Prior state remains available.");
    } finally {
      setMutation(null);
    }
  }

  return (
    <>
      <a className="skip-link" href="#integration-review">
        Skip to evidence review
      </a>
      <main
        id="main-content"
        className="integration-shell"
        tabIndex={-1}
      >
        <header className="integration-topbar">
          <Link
            className="integration-brand"
            href="/"
            aria-label="capri home"
          >
            <span aria-hidden="true">TS</span>
            <strong>capri</strong>
          </Link>
          <div className="integration-mode" role="status">
            <ShieldCheck size={18} weight="duotone" aria-hidden="true" />
            Local simulation · synthetic fixture only
          </div>
          <div className="integration-user">
            <Link href="/workspace/boundaries">
              Boundary cases
              <ArrowRight size={15} aria-hidden="true" />
            </Link>
            <div>
              <span>{user.name ?? "Simulated recruiter"}</span>
              <small>{user.email ?? "local account"}</small>
            </div>
            <ThemeToggle />
          </div>
        </header>

        <div className="integration-layout">
          <aside className="integration-rail" aria-label="Journey status">
            <p className="eyebrow">TS-CORE-01 · LOCALHOST</p>
            <h1>One source. One governed decision.</h1>
            <p>
              Inspect the source, decide each proposed fact, then authorize one
              exact local effect separately.
            </p>

            <ol className="integration-steps">
              <li data-complete={Boolean(workspace || deletion)}>
                <span aria-hidden="true">1</span>
                <div>
                  <strong>Capture received</strong>
                  <small>Explicit submit → backend receipt</small>
                </div>
              </li>
              <li data-complete={allFactsReviewed || Boolean(deletion)}>
                <span aria-hidden="true">2</span>
                <div>
                  <strong>Facts reviewed</strong>
                  <small>{confirmedCount} confirmed · zero effect authority</small>
                </div>
              </li>
              <li data-complete={approvalComplete || verified}>
                <span aria-hidden="true">3</span>
                <div>
                  <strong>Effect approved</strong>
                  <small>Exact target, digest, and version bound</small>
                </div>
              </li>
              <li data-complete={verified}>
                <span aria-hidden="true">4</span>
                <div>
                  <strong>Readback verified</strong>
                  <small>Observed destination matches approval</small>
                </div>
              </li>
            </ol>

            <div className="integration-provenance">
              <Database size={19} weight="duotone" aria-hidden="true" />
              <div>
                <strong>Backend is canonical</strong>
                <small>
                  {workspace
                    ? `${workspace.account_slug} · cursor ${workspace.audit_cursor}`
                    : deletion
                      ? `deletion ${deletion.deletion.deletion_id.slice(0, 8)}`
                      : "Waiting for an account-scoped capture"}
                </small>
              </div>
            </div>
          </aside>

          <section
            aria-labelledby="integration-review-title"
            className="integration-work"
            id="integration-review"
            tabIndex={-1}
          >
            <p className="sr-only" role="status" aria-live="polite">
              {announcement}
            </p>

            <div className="integration-work__header">
              <div>
                <p className="eyebrow">EVIDENCE REVIEW</p>
                <h2 id="integration-review-title">
                  {workspace?.subject.display_label ??
                    (deletion ? "Source deleted" : "Awaiting evidence")}
                </h2>
                <p>
                  {workspace?.assignment.display_label ??
                    (deletion
                      ? "Access is revoked; only deletion lineage remains."
                      : "Submit the frozen synthetic source before any review state exists.")}
                </p>
              </div>
              <button
                className="quiet-button"
                type="button"
                onClick={() =>
                  requestWorkspace(
                    "/api/local-integration/workspace",
                    undefined,
                    "Reading the latest backend state",
                    "workspace",
                    true,
                  )
                }
                disabled={Boolean(mutation) || Boolean(deletion)}
              >
                {mutation?.target === "workspace" ? (
                  <CircleNotch className="spin" size={18} aria-hidden="true" />
                ) : (
                  <ArrowClockwise size={18} aria-hidden="true" />
                )}
                Refresh
              </button>
            </div>

            {mutation ? (
              <div
                className="integration-progress"
                role="status"
                aria-live="polite"
              >
                <CircleNotch className="spin" size={19} aria-hidden="true" />
                <p>
                  <strong>{mutation.label}</strong>
                  <span>Prior canonical state stays visible until this completes.</span>
                </p>
                {mutation.cancelable ? (
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={cancelMutation}
                  >
                    Cancel refresh
                  </button>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <div className="integration-alert" role="alert">
                <Warning size={21} weight="duotone" aria-hidden="true" />
                <div>
                  <strong>{errorHeading(error)}</strong>
                  <p>{error.message}</p>
                  <small>
                    {verified
                      ? "No newer state is claimed. The last verified readback remains visible as prior readable state."
                      : "No verified result is claimed. The last readable review state remains unchanged."}
                  </small>
                </div>
                {!deletion ? (
                  <button
                    className="quiet-button"
                    type="button"
                    onClick={() =>
                      requestWorkspace(
                        "/api/local-integration/workspace",
                        undefined,
                        "Retrying canonical state readback",
                        "workspace",
                        true,
                      )
                    }
                    disabled={Boolean(mutation)}
                  >
                    Retry readback
                  </button>
                ) : null}
              </div>
            ) : null}

            {deletion ? (
              <section
                className="integration-deleted"
                aria-labelledby="deleted-title"
              >
                <Prohibit size={30} weight="duotone" aria-hidden="true" />
                <div>
                  <p className="eyebrow">DELETION COMPLETE</p>
                  <h3 id="deleted-title">
                    Source access revoked before derivative removal.
                  </h3>
                  <p>
                    The candidate source and registered working derivatives are
                    no longer available to this workspace. The audit-safe
                    lineage contains identifiers and dispositions, not the
                    deleted conversation.
                  </p>
                </div>
                <dl>
                  <div>
                    <dt>Access revoked</dt>
                    <dd>{deletion.deletion.access_revoked_at}</dd>
                  </div>
                  <div>
                    <dt>Derivatives deleted</dt>
                    <dd>{deletion.deletion.derivatives_deleted}</dd>
                  </div>
                  <div>
                    <dt>Lineage entries</dt>
                    <dd>{deletion.lineage.lineage.length}</dd>
                  </div>
                </dl>
                <Link href="/workspace/boundaries">
                  Review non-destructive boundary cases
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </section>
            ) : !workspace ? (
              <div className="integration-empty">
                <LinkSimple size={30} weight="duotone" aria-hidden="true" />
                <h3>No submitted evidence</h3>
                <p>
                  Nothing is inferred, confirmed, or authorized until a
                  reviewed synthetic payload is explicitly submitted.
                </p>
                <blockquote>“{FROZEN_SYNTHETIC_SOURCE}”</blockquote>
                <button type="button" onClick={submitSyntheticEvidence}>
                  <ShieldCheck size={17} aria-hidden="true" />
                  Submit frozen synthetic evidence
                </button>
                <small>
                  Localhost only · creates a backend receipt and review proposal,
                  never an external effect.
                </small>
                <Link href="/workspace/boundaries">
                  Inspect no_action and ambiguity cases
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
              </div>
            ) : (
              <>
                <section
                  className="integration-source"
                  aria-labelledby="source-title"
                >
                  <div className="integration-section-heading">
                    <div>
                      <p className="eyebrow">OBSERVED SOURCE</p>
                      <h3 id="source-title">Exact captured evidence</h3>
                    </div>
                    <span>receipt {workspace.capture.id.slice(0, 8)}</span>
                  </div>
                  {workspace.capture.messages.map((message) => (
                    <figure
                      id={`source-evidence-${message.id}`}
                      key={message.id}
                      tabIndex={-1}
                    >
                      <blockquote>“{message.text}”</blockquote>
                      <figcaption>
                        {message.source_message_id} · {message.speaker} ·{" "}
                        {workspace.capture.source.source_timezone}
                      </figcaption>
                    </figure>
                  ))}
                  <dl className="integration-source-meta">
                    <div>
                      <dt>Suite</dt>
                      <dd>candidate-momentum-v1 · 2026-08-05.1</dd>
                    </div>
                    <div>
                      <dt>Classification</dt>
                      <dd>{workspace.data_classification}</dd>
                    </div>
                    <div>
                      <dt>Capture</dt>
                      <dd>{workspace.capture.source.kind} · explicit submit</dd>
                    </div>
                  </dl>
                </section>

                <section aria-labelledby="facts-title">
                  <div className="integration-section-heading">
                    <div>
                      <p className="eyebrow">PROPOSED → CONFIRMED</p>
                      <h3 id="facts-title">What changed</h3>
                    </div>
                    <span>
                      {confirmedCount} of {assertions.length} confirmed
                    </span>
                  </div>

                  <div className="integration-facts">
                    {assertions.map((assertion) => {
                      const evidence = evidenceById.get(assertion.evidence_id);
                      const isEditing = editing === assertion.id;
                      const editedValue =
                        editedValues[assertion.id] ?? assertion.value ?? "";
                      const displayedValue = presentedAssertionValue(
                        assertion.id,
                        assertion.value,
                        workspace.confirmed_state.assertions,
                      );
                      const busy = mutation?.target === assertion.id;
                      const headingId = `assertion-${assertion.id}`;
                      return (
                        <article
                          aria-labelledby={headingId}
                          className="integration-fact"
                          data-state={assertion.review_status}
                          key={assertion.id}
                        >
                          <div className="integration-fact__heading">
                            <div>
                              <span>{reviewLabel(assertion.review_status)}</span>
                              <h4 id={headingId}>
                                {fieldLabel(assertion.field)}
                              </h4>
                            </div>
                            {assertion.review_status === "confirmed" ? (
                              <CheckCircle
                                size={22}
                                weight="fill"
                                aria-label="Confirmed"
                              />
                            ) : null}
                          </div>

                          {isEditing ? (
                            <label className="integration-edit">
                              Corrected value
                              <input
                                autoFocus
                                value={editedValue}
                                onChange={(event) =>
                                  setEditedValues((current) => ({
                                    ...current,
                                    [assertion.id]: event.target.value,
                                  }))
                                }
                              />
                            </label>
                          ) : (
                            <p className="integration-fact__value">
                              {displayedValue}
                            </p>
                          )}

                          <a
                            className="integration-evidence"
                            href={`#source-evidence-${assertion.evidence_id}`}
                            onClick={(event) =>
                              openExactEvidence(
                                event,
                                assertion.evidence_id,
                              )
                            }
                          >
                            <LinkSimple size={16} aria-hidden="true" />
                            <span>
                              Exact evidence: “{assertion.evidence_quote}” ·{" "}
                              {evidence?.source_message_id ?? "source"}
                            </span>
                          </a>

                          {assertion.review_status === "pending" ? (
                            <div
                              className="integration-fact__actions"
                              aria-label={`Review ${fieldLabel(assertion.field)}`}
                            >
                              {isEditing ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      decide(
                                        assertion.id,
                                        assertion.version,
                                        "confirm",
                                        editedValue,
                                      )
                                    }
                                    disabled={
                                      busy || editedValue.trim().length === 0
                                    }
                                  >
                                    {busy ? (
                                      <CircleNotch
                                        className="spin"
                                        size={17}
                                        aria-hidden="true"
                                      />
                                    ) : (
                                      <Check size={17} aria-hidden="true" />
                                    )}
                                    Save and confirm
                                  </button>
                                  <button
                                    className="quiet-button"
                                    type="button"
                                    onClick={() => setEditing(null)}
                                    disabled={busy}
                                  >
                                    Cancel edit
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      decide(
                                        assertion.id,
                                        assertion.version,
                                        "confirm",
                                      )
                                    }
                                    disabled={busy}
                                  >
                                    {busy ? (
                                      <CircleNotch
                                        className="spin"
                                        size={17}
                                        aria-hidden="true"
                                      />
                                    ) : (
                                      <Check size={17} aria-hidden="true" />
                                    )}
                                    Confirm
                                  </button>
                                  <button
                                    className="quiet-button"
                                    type="button"
                                    onClick={() => setEditing(assertion.id)}
                                    disabled={busy}
                                  >
                                    <PencilSimple
                                      size={17}
                                      aria-hidden="true"
                                    />
                                    Edit
                                  </button>
                                  <button
                                    className="quiet-button"
                                    type="button"
                                    onClick={() =>
                                      decide(
                                        assertion.id,
                                        assertion.version,
                                        "dismiss",
                                      )
                                    }
                                    disabled={busy}
                                  >
                                    <X size={17} aria-hidden="true" />
                                    Dismiss
                                  </button>
                                </>
                              )}
                            </div>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                </section>

                {action ? (
                  <section
                    className="integration-action"
                    aria-labelledby="action-title"
                  >
                    <div className="integration-section-heading">
                      <div>
                        <p className="eyebrow">SEPARATE AUTHORITY</p>
                        <h3 id="action-title">One smallest next step</h3>
                      </div>
                      <span>local deterministic effect</span>
                    </div>

                    <div className="integration-action__body">
                      <div>
                        <h4>{action.target}</h4>
                        <p>{action.reason}</p>
                        <dl>
                          <div>
                            <dt>Owner</dt>
                            <dd>Recruiter</dd>
                          </div>
                          <div>
                            <dt>Due</dt>
                            <dd>{action.due}</dd>
                          </div>
                          <div>
                            <dt>Exact effect</dt>
                            <dd>{action.exact_preview.change.title}</dd>
                          </div>
                          <div>
                            <dt>Destination</dt>
                            <dd>{action.exact_preview.target.label}</dd>
                          </div>
                          {action.exact_preview.simulation_behavior ===
                          "timeout_after_write" ? (
                            <div>
                              <dt>Recovery drill</dt>
                              <dd>
                                Result becomes unknown until destination
                                reconciliation
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                        {action.evidence_ids[0] ? (
                          <a
                            className="integration-action__evidence"
                            href={`#source-evidence-${action.evidence_ids[0]}`}
                            onClick={(event) =>
                              openExactEvidence(
                                event,
                                action.evidence_ids[0],
                              )
                            }
                          >
                            <LinkSimple size={16} aria-hidden="true" />
                            Open the exact source for this action
                          </a>
                        ) : null}
                      </div>

                      <div
                        className="integration-authority"
                        data-state={authorityPresentation.presentationState}
                      >
                        {authorityState === "review_required" ? (
                          <div className="authority-note">
                            <Clock
                              size={20}
                              weight="duotone"
                              aria-hidden="true"
                            />
                            <p>
                              {allFactsReviewed
                                ? "This proposal cannot receive authority because a required fact was dismissed. The evidence record remains reviewable and no action runs."
                                : "Review every required fact first. Confirmation creates zero effects and grants no authority to this proposal."}
                            </p>
                          </div>
                        ) : null}

                        {authorityPresentation.showApprovalCta ? (
                          <>
                            {authorityState !== "ready_for_approval" ? (
                              <div
                                className="authority-note"
                                data-state={authorityState}
                              >
                                <Warning
                                  size={21}
                                  weight="duotone"
                                  aria-hidden="true"
                                />
                                <p>
                                  {integrationStateAnnouncement(
                                    authorityState,
                                  )}
                                </p>
                              </div>
                            ) : null}
                            <p>
                              Approval binds proposal version {action.version},
                              its exact target, and the preview above.
                            </p>
                            <button
                              type="button"
                              onClick={() =>
                                requestWorkspace(
                                  `/api/local-integration/actions/${action.id}/approval`,
                                  { method: "POST" },
                                  "Recording the exact action approval",
                                  action.id,
                                )
                              }
                              disabled={mutation?.target === action.id}
                            >
                              {mutation?.target === action.id ? (
                                <CircleNotch
                                  className="spin"
                                  size={18}
                                  aria-hidden="true"
                                />
                              ) : (
                                <ShieldCheck size={18} aria-hidden="true" />
                              )}
                              {authorityState === "stale"
                                ? "Approve revised exact effect"
                                : authorityState === "failed"
                                  ? "Approve one safe retry"
                                  : "Approve exact local effect"}
                            </button>
                          </>
                        ) : null}

                        {authorityPresentation.showActiveApproval ? (
                          <>
                            <div
                              className="authority-note"
                              data-state="approved"
                            >
                              <ShieldCheck
                                size={21}
                                weight="duotone"
                                aria-hidden="true"
                              />
                              <p>
                                Approved · version {approval?.action_version}.
                                No destination result has been claimed.
                              </p>
                            </div>
                            <div className="integration-authority__actions">
                              {authorityPresentation.showExecutionCta ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    requestWorkspace(
                                      `/api/local-integration/actions/${action.id}/execution`,
                                      { method: "POST" },
                                      "Executing and reading back the local effect",
                                      action.id,
                                    )
                                  }
                                  disabled={mutation?.target === action.id}
                                >
                                  <Database size={18} aria-hidden="true" />
                                  Execute and verify readback
                                </button>
                              ) : null}
                              {authorityPresentation.showRevokeApproval &&
                              approval ? (
                                <button
                                  className="quiet-button"
                                  type="button"
                                  onClick={() =>
                                    requestWorkspace(
                                      `/api/local-integration/approvals/${approval.id}/revocation`,
                                      { method: "POST" },
                                      "Revoking the exact action approval",
                                      approval.id,
                                    )
                                  }
                                  disabled={
                                    mutation?.target === approval.id
                                  }
                                >
                                  <X size={17} aria-hidden="true" />
                                  Revoke approval
                                </button>
                              ) : null}
                            </div>
                          </>
                        ) : null}

                        {authorityPresentation.capabilityNotice ? (
                          <div className="authority-note" data-state="revoked">
                            <Prohibit
                              size={21}
                              weight="duotone"
                              aria-hidden="true"
                            />
                            <p>
                              {capabilityNoticeAnnouncement(
                                authorityPresentation.capabilityNotice,
                              )}
                            </p>
                          </div>
                        ) : null}

                        {authorityState === "revoked" &&
                        !capabilityRevoked ? (
                          <div className="authority-note" data-state="revoked">
                            <Prohibit
                              size={21}
                              weight="duotone"
                              aria-hidden="true"
                            />
                            <p>{integrationStateAnnouncement("revoked")}</p>
                          </div>
                        ) : null}

                        {authorityState ===
                        "reconciliation_required" ? (
                          <>
                            <div className="authority-note" data-state="unknown">
                              <Warning
                                size={21}
                                weight="duotone"
                                aria-hidden="true"
                              />
                              <p>
                                {integrationStateAnnouncement(
                                  "reconciliation_required",
                                )}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                requestWorkspace(
                                  `/api/local-integration/effects/${workspace.latest_effect?.attempt_id}/reconciliation`,
                                  { method: "POST" },
                                  "Reconciling destination readback",
                                  workspace.latest_effect?.attempt_id ??
                                    "effect",
                                )
                              }
                              disabled={Boolean(mutation)}
                            >
                              <ArrowClockwise
                                size={18}
                                aria-hidden="true"
                              />
                              Reconcile before retry
                            </button>
                          </>
                        ) : null}

                        {authorityState === "verified" ? (
                          <div className="verified-result" role="status">
                            <CheckCircle
                              size={28}
                              weight="fill"
                              aria-hidden="true"
                            />
                            <div>
                              <strong>
                                Verified after destination readback
                              </strong>
                              <p>
                                {
                                  workspace.latest_effect?.observation
                                    ?.destination_key
                                }
                                {" · version "}
                                {
                                  workspace.latest_effect?.observation
                                    ?.destination_version
                                }
                              </p>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </section>
                ) : (
                  <section
                    className="integration-empty"
                    aria-labelledby="no-action-title"
                  >
                    <CheckCircle
                      size={28}
                      weight="duotone"
                      aria-hidden="true"
                    />
                    <h3 id="no-action-title">No action is supported</h3>
                    <p>{integrationStateAnnouncement("no_action")}</p>
                  </section>
                )}

                <details className="integration-data-controls">
                  <summary>Local authority and deletion controls</summary>
                  <div>
                    <p>
                      These controls affect only the authenticated synthetic
                      localhost record. They never contact a candidate or an
                      external system.
                    </p>
                    {action &&
                    allRequiredFactsConfirmed &&
                    !approvalComplete &&
                    authorityPresentation
                      .showCapabilityDependentRevisionControls &&
                    action.exact_preview.simulation_behavior !==
                      "timeout_after_write" ? (
                      <button
                        className="quiet-button"
                        type="button"
                        onClick={() =>
                          reviseForRecovery("timeout_after_effect")
                        }
                        disabled={Boolean(mutation)}
                      >
                        <Warning size={17} aria-hidden="true" />
                        Use unknown-result recovery preview
                      </button>
                    ) : null}
                    {action &&
                    approval?.status === "active" &&
                    authorityPresentation
                      .showCapabilityDependentRevisionControls ? (
                      <button
                        className="quiet-button"
                        type="button"
                        onClick={() => reviseForRecovery("stale_approval")}
                        disabled={Boolean(mutation)}
                      >
                        <ArrowClockwise size={17} aria-hidden="true" />
                        Revise preview and invalidate approval
                      </button>
                    ) : null}
                    {!verified && !capabilityRevoked ? (
                      <button
                        className="quiet-button"
                        type="button"
                        onClick={revokeCapability}
                        disabled={Boolean(mutation)}
                      >
                        <Prohibit size={17} aria-hidden="true" />
                        Revoke local execution permission
                      </button>
                    ) : null}
                    {!deleteConfirmation ? (
                      <button
                        className="quiet-button"
                        type="button"
                        onClick={() => setDeleteConfirmation(true)}
                        disabled={Boolean(mutation)}
                      >
                        <Trash size={17} aria-hidden="true" />
                        Review source deletion
                      </button>
                    ) : (
                      <div
                        className="integration-delete-confirmation"
                        role="group"
                        aria-labelledby="deletion-confirmation-title"
                      >
                        <div>
                          <strong id="deletion-confirmation-title">
                            Delete source and registered derivatives?
                          </strong>
                          <p>
                            Access is revoked first. This local evidence review
                            cannot be restored without rebuilding the
                            disposable environment.
                          </p>
                        </div>
                        <button
                          className="quiet-button"
                          type="button"
                          onClick={() => setDeleteConfirmation(false)}
                          disabled={Boolean(mutation)}
                        >
                          Keep evidence
                        </button>
                        <button
                          className="danger-button"
                          type="button"
                          onClick={deleteEvidence}
                          disabled={Boolean(mutation)}
                        >
                          <Trash size={17} aria-hidden="true" />
                          Delete source
                        </button>
                      </div>
                    )}
                  </div>
                </details>
              </>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
