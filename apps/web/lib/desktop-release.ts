/**
 * Presentation-only projection of the native desktop bridge.
 *
 * The signed host owns trust, the offered update, and installation. This module
 * only reads the optional `window.talentSignalDesktop` fields and never invents
 * an installed version or update state when the host is absent or malformed.
 */
export type UpdatePhase =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "failed"
  | "information";

export type DesktopChromeState = {
  protocolVersion: 1;
  surface?: "workspace" | "settings";
  availableVersion: string | null;
  phase?: UpdatePhase;
  progress?: number | null;
  offerID?: string | null;
  /** Installed app version reported by the signed host; absent means unknown. */
  appVersion?: string | null;
  /** Structured update state; top-level `phase`/`availableVersion` remain valid. */
  update?: {
    phase?: UpdatePhase;
    availableVersion?: string | null;
    progress?: number | null;
  } | null;
};

declare global {
  interface Window {
    talentSignalDesktop?: DesktopChromeState;
  }
}

export type DesktopReleaseIdentity = {
  /** A supported native host bridge is present on this page. */
  available: boolean;
  appVersion: string | null;
  update: {
    phase: UpdatePhase;
    availableVersion: string | null;
    progress: number | null;
  } | null;
};

const displayValuePattern = /^[\w.+() -]{1,40}$/;
const updatePhases: readonly UpdatePhase[] = [
  "disabled",
  "idle",
  "checking",
  "available",
  "downloading",
  "installing",
  "failed",
  "information",
];

export function desktopDisplayValue(value: unknown): string | null {
  return typeof value === "string" && displayValuePattern.test(value)
    ? value
    : null;
}

function updatePhase(value: unknown): UpdatePhase | null {
  return typeof value === "string" && updatePhases.includes(value as UpdatePhase)
    ? (value as UpdatePhase)
    : null;
}

function updateProgress(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, Math.round(value)))
    : null;
}

export function readDesktopRelease(state: unknown): DesktopReleaseIdentity {
  if (
    !state ||
    typeof state !== "object" ||
    (state as { protocolVersion?: unknown }).protocolVersion !== 1
  ) {
    return { available: false, appVersion: null, update: null };
  }
  const source = state as Record<string, unknown>;
  const appVersion = desktopDisplayValue(source.appVersion);
  const nested =
    source.update && typeof source.update === "object"
      ? (source.update as Record<string, unknown>)
      : null;
  const availableVersion =
    desktopDisplayValue(nested?.availableVersion) ??
    desktopDisplayValue(source.availableVersion);
  const phase =
    updatePhase(nested?.phase) ??
    updatePhase(source.phase) ??
    (availableVersion ? "available" : null);
  return {
    available: true,
    appVersion,
    update: phase
      ? {
          phase,
          availableVersion,
          progress: updateProgress(nested?.progress ?? source.progress),
        }
      : null,
  };
}
