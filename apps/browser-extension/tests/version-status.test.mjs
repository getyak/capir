import assert from "node:assert/strict";
import test from "node:test";

import { extensionVersion, installedExtensionVersion } from "../load-unpacked/lib/version-status.js";

test("reports only the installed extension manifest version", () => {
  assert.equal(installedExtensionVersion({ getManifest: () => ({ version: "0.2.0" }) }), "0.2.0");
  assert.equal(installedExtensionVersion(undefined), null);
  assert.equal(installedExtensionVersion({ getManifest: () => ({ version: "preview" }) }), null);
  assert.equal(installedExtensionVersion({ getManifest: () => { throw new Error("unavailable"); } }), null);
  assert.equal(extensionVersion("0.2.1"), "0.2.1");
  assert.equal(extensionVersion("unverified"), null);
});
