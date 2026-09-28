/** A bounded Chrome manifest version, never inferred from source metadata. */
export function extensionVersion(value) {
  return typeof value === "string" && /^\d+(?:\.\d+){0,3}$/.test(value)
    ? value
    : null;
}

/** Version of this installed extension, never the latest published package. */
export function installedExtensionVersion(runtime) {
  try {
    return extensionVersion(runtime?.getManifest?.()?.version);
  } catch {
    return null;
  }
}
