/**
 * The running package version: one read path shared by `--version`, the
 * updater and the automatic update check.
 */
import { readFileSync } from "node:fs";

export function readVersion(): string {
  try {
    return (
      JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
        version: string;
      }
    ).version;
  } catch {
    return "0.0.0";
  }
}
