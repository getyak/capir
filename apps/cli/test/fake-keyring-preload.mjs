/**
 * `node --import ./fake-keyring-preload.mjs` registers the keyring test
 * double for a built-CLI subprocess run. Only tests set FAKE_KEYRING_FILE;
 * production wiring still imports the native keyring and fails closed.
 */
import { register } from "node:module";

register(new URL("./fake-keyring-hook.mjs", import.meta.url));
