/**
 * Host platform identification for the standalone updater.
 *
 * Only the four supported platforms are ever accepted. Windows has no native
 * updater support (source installs are documented as unsupported for the
 * native updater); anything else fails closed.
 */
import { CapirCliError, EXIT } from "../errors.js";
import { SUPPORTED_PLATFORMS, type ReleasePlatform } from "./manifest.js";

export function hostPlatform(
  platform: NodeJS.Platform | string = process.platform,
  arch: string = process.arch,
): ReleasePlatform {
  const key = `${platform}-${arch}`;
  if ((SUPPORTED_PLATFORMS as readonly string[]).includes(key)) return key as ReleasePlatform;
  throw new CapirCliError(
    "CAPIR_UPDATE_PLATFORM_UNSUPPORTED",
    EXIT.INFRASTRUCTURE,
    `Platform "${key}" is not supported by the standalone updater. Supported: ${SUPPORTED_PLATFORMS.join(", ")}. Windows is source-install only and has no native updater.`,
  );
}
