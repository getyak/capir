/**
 * Test double for `@napi-rs/keyring`, loaded ONLY through
 * `test/fake-keyring-hook.mjs` when FAKE_KEYRING_FILE is set. Entries persist
 * as `service\nusername` keys in that JSON file so tests can assert exact
 * create-if-absent and pruning behavior without touching the real OS keyring.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const file = process.env.FAKE_KEYRING_FILE;
if (!file) throw new Error("fake-keyring-module requires FAKE_KEYRING_FILE");

function load() {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function save(entries) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(entries, null, 2), { mode: 0o600 });
}

const keyOf = (service, username) => `${service}\n${username}`;

export class Entry {
  constructor(service, username) {
    this.key = keyOf(service, username);
  }

  getPassword() {
    const entries = load();
    return Object.hasOwn(entries, this.key) ? entries[this.key] : null;
  }

  setPassword(password) {
    const entries = load();
    entries[this.key] = password;
    save(entries);
  }

  deleteCredential() {
    const entries = load();
    if (!Object.hasOwn(entries, this.key)) return false;
    delete entries[this.key];
    save(entries);
    return true;
  }
}

export default { Entry };
