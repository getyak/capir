/**
 * `node <tree>/package/dist/update/smokeEntry.js` — load the native keyring
 * binding from the portable tree and report success. Runs under the bundled
 * runtime with a clean environment; any load failure exits non-zero so the
 * transaction aborts before publishing the version directory.
 */
const keyring = await import("@napi-rs/keyring");
if (typeof (keyring as { default?: unknown }).default !== "object" && typeof keyring !== "object")
  throw new Error("keyring binding loaded but exposed no entry surface");
process.stdout.write("keyring-ok\n");
