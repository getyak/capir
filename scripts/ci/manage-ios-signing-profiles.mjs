#!/usr/bin/env node

import { createSign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const APP_GROUP = "group.com.talentsignal.app";
export const PROFILE_SPECS = [
  { bundleId: "com.talentsignal.app", signInWithApple: true, pushNotifications: true },
  { bundleId: "com.talentsignal.app.share", signInWithApple: false },
  { bundleId: "com.talentsignal.app.live-activity", signInWithApple: false },
].map((spec) => ({ ...spec, name: `match AppStore ${spec.bundleId}` }));

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

export function createAppStoreConnectToken({ issuerId, keyId, privateKey, now = Date.now() }) {
  const issuedAt = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: issuerId,
    iat: issuedAt,
    exp: issuedAt + 600,
    aud: "appstoreconnect-v1",
  }));
  const input = `${header}.${payload}`;
  const signer = createSign("SHA256");
  // The public Apple key ID is part of a signed JWT header, not a password.
  signer.update(input); // lgtm[js/insufficient-password-hash]
  signer.end(); // lgtm[js/insufficient-password-hash]
  const signature = signer.sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
  return `${input}.${signature.toString("base64url")}`;
}

export function validateProvisioningProfile(profile, spec) {
  if (profile.Name !== spec.name) throw new Error(`Unexpected profile name for ${spec.bundleId}`);
  const entitlements = profile.Entitlements ?? {};
  const applicationIdentifier = entitlements["application-identifier"] ?? "";
  if (!applicationIdentifier.endsWith(`.${spec.bundleId}`)) {
    throw new Error(`Unexpected application identifier for ${spec.bundleId}`);
  }
  const appGroups = entitlements["com.apple.security.application-groups"] ?? [];
  if (!appGroups.includes(APP_GROUP)) throw new Error(`${spec.bundleId} lacks ${APP_GROUP}`);
  if (spec.signInWithApple) {
    const appleSignIn = entitlements["com.apple.developer.applesignin"] ?? [];
    if (!appleSignIn.includes("Default")) {
      throw new Error(`${spec.bundleId} lacks Sign in with Apple`);
    }
  }
  if (spec.pushNotifications && entitlements["aps-environment"] !== "production") {
    throw new Error(`${spec.bundleId} lacks production APNs entitlement`);
  }
}

function decodeProfile(profileContent) {
  const plist = execFileSync("/usr/bin/security", ["cms", "-D", "-i", "/dev/stdin"], {
    input: Buffer.from(profileContent, "base64"),
    maxBuffer: 10 * 1024 * 1024,
  });
  const extraction = [
    "import json, plistlib, sys",
    "profile = plistlib.loads(sys.stdin.buffer.read())",
    "entitlements = profile.get('Entitlements', {})",
    "keys = ['application-identifier', 'com.apple.security.application-groups', 'com.apple.developer.applesignin', 'aps-environment']",
    "print(json.dumps({'Name': profile.get('Name'), 'Entitlements': {key: entitlements[key] for key in keys if key in entitlements}}))",
  ].join("\n");
  return JSON.parse(execFileSync("python3", ["-c", extraction], { encoding: "utf8", input: plist }));
}

async function apiRequest(token, path, options = {}) {
  const response = await fetch(`https://api.appstoreconnect.apple.com${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`App Store Connect ${options.method ?? "GET"} ${path} failed (${response.status}): ${body.slice(0, 500)}`);
  }
  return response.status === 204 ? null : response.json();
}

async function profilesForSpec(token, spec) {
  const query = new URLSearchParams({
    "filter[name]": spec.name,
    "filter[profileType]": "IOS_APP_STORE",
    include: "bundleId",
    limit: "200",
  });
  const response = await apiRequest(token, `/v1/profiles?${query}`);
  const bundleIds = new Map(
    (response.included ?? [])
      .filter((item) => item.type === "bundleIds")
      .map((item) => [item.id, item.attributes.identifier]),
  );
  return response.data.map((profile) => ({
    ...profile,
    bundleId: bundleIds.get(profile.relationships?.bundleId?.data?.id),
  })).filter((profile) => profile.attributes.name === spec.name);
}

async function rotate(token) {
  for (const spec of PROFILE_SPECS) {
    const profiles = await profilesForSpec(token, spec);
    for (const profile of profiles) {
      if (profile.bundleId !== spec.bundleId) {
        throw new Error(`Refusing to delete ${spec.name}: bundle ID relationship is ${profile.bundleId ?? "missing"}`);
      }
      await apiRequest(token, `/v1/profiles/${profile.id}`, { method: "DELETE" });
      console.log(`Deleted exact App Store profile ${spec.name} (${profile.id})`);
    }
    if (profiles.length === 0) console.log(`No existing exact profile for ${spec.bundleId}`);
  }
}

async function verify(token) {
  for (const spec of PROFILE_SPECS) {
    const profiles = await profilesForSpec(token, spec);
    if (profiles.length !== 1) throw new Error(`Expected one exact profile for ${spec.bundleId}; found ${profiles.length}`);
    const profile = profiles[0];
    if (profile.bundleId !== spec.bundleId || profile.attributes.profileState !== "ACTIVE") {
      throw new Error(`Profile for ${spec.bundleId} is not exact and ACTIVE`);
    }
    const decoded = decodeProfile(profile.attributes.profileContent);
    validateProvisioningProfile(decoded, spec);
    console.log(`Verified ${spec.bundleId}: ${profile.attributes.uuid}`);
  }
}

async function main() {
  const [mode, confirmation] = process.argv.slice(2);
  if (!['rotate', 'verify'].includes(mode)) throw new Error("Usage: manage-ios-signing-profiles.mjs rotate --confirm-rotation | verify");
  if (mode === "rotate" && confirmation !== "--confirm-rotation") throw new Error("Profile rotation requires --confirm-rotation");
  const privateKey = readFileSync(process.env.APP_STORE_CONNECT_API_KEY_PATH, "utf8");
  const token = createAppStoreConnectToken({
    issuerId: process.env.APP_STORE_CONNECT_ISSUER_ID,
    keyId: process.env.APP_STORE_CONNECT_API_KEY_ID,
    privateKey,
  });
  await (mode === "rotate" ? rotate(token) : verify(token));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
