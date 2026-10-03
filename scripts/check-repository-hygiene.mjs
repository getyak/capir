#!/usr/bin/env node
/**
 * Deterministic repository hygiene check (GET-134).
 *
 * Evaluated against `git ls-files` (the tracked index), not ignore globs, so a
 * `git add -f` cannot smuggle an extracted evaluation payload or a generated
 * artifact back into history. Rules:
 *
 * 1. Eval payload/harness files stay out of the product repository. The
 *    extracted trees live in the private getyak/capir-evals repository; the
 *    product keeps only the evals/README.md index.
 * 2. Generated bundles, media, and database files are rejected outside the
 *    admitted brand/design, architecture-image, product-asset, and test
 *    fixture paths. Canonical architecture images, migration SQL, tests and
 *    fixtures, and release source are never rejected.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FORBIDDEN_EVAL_PREFIXES = [
  "evals/",
  "docs/evaluations/",
  "apps/eval-runner/",
  "scripts/evals/",
];
export const FORBIDDEN_EVAL_EXACT = new Set([
  "apps/browser-extension/tests/fixture-contract.test.mjs",
  "apps/browser-extension/scripts/capture-round-2-evidence.mjs",
  "apps/browser-extension/scripts/compose-round-2-panel.mjs",
  "apps/browser-extension/scripts/verify-round-2.mjs",
]);
export const ALLOWED_EVAL_FILES = new Set(["evals/README.md"]);

/** Generated archives, native bundles, recordings, database dumps and raw logs. */
export const GENERATED_BUNDLE_EXTENSIONS = new Set([
  "zip", "tar", "gz", "tgz", "bz2", "xz", "zst", "7z", "rar",
  "ipa", "xcarchive", "xcresult", "dmg", "pkg",
  "mov", "mp4", "m4v", "avi", "webm", "mkv",
  "sqlite", "sqlite3", "db", "dump", "log", "pyc", "xcuserstate", "mobileprovision",
]);

/** Images and design media admitted only in brand/design, architecture, and product asset roots. */
export const MEDIA_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "icns", "bmp", "tiff", "avif", "heic",
]);
export const ADMITTED_MEDIA_ROOTS = [
  "brand/", "assets/", "docs/readme/",
  "apps/web/public/", "apps/macos-hybrid/public/",
  "apps/ios/Resources/", "apps/macos/Resources/",
  "apps/macos-hybrid/src-tauri/icons/", "apps/browser-extension/load-unpacked/icons/",
];
const ARCHITECTURE_MEDIA = new Set([
  "agent-control-plane", "agent-module-blueprint", "agent-runtime-flow",
  "product-architecture", "system-architecture",
].flatMap(name => ["png", "svg"].map(ext => `docs/talent-signal-${name}.${ext}`)));

/** Generated output trees that must never become tracked product state. */
export const GENERATED_DIRECTORY_SEGMENTS = new Set([
  "node_modules", "dist", "coverage", "__pycache__", ".next", ".pnpm-store", ".playwright-cli",
]);
export const GENERATED_ROOT_PREFIXES = ["output/", "build/", "runs/", "tmp/", "dist/", "coverage/", "test-results/"];

function extension(path) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

function isFixturePath(path) {
  return path.split("/").some((segment) => segment === "fixtures" || segment === "fixture");
}

/** Pure rule evaluation over an explicit tracked-file list. */
export function checkHygiene(trackedFiles) {
  const errors = [];
  for (const path of [...trackedFiles].sort()) {
    if (FORBIDDEN_EVAL_EXACT.has(path)) {
      errors.push(`${path}: extracted evaluation harness file must live in the private getyak/capir-evals repository`);
      continue;
    }
    if (FORBIDDEN_EVAL_PREFIXES.some((prefix) => path.startsWith(prefix)) && !ALLOWED_EVAL_FILES.has(path)) {
      errors.push(`${path}: extracted evaluation payload/harness path is forbidden in the product repository`);
      continue;
    }

    const segments = path.split("/");
    if (segments.slice(0, -1).some((segment) => GENERATED_DIRECTORY_SEGMENTS.has(segment))) {
      errors.push(`${path}: generated output/build directory must not be tracked`);
      continue;
    }
    if (GENERATED_ROOT_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      errors.push(`${path}: generated output root must not be tracked`);
      continue;
    }

    const ext = extension(path);
    const fixture = isFixturePath(path);
    if (GENERATED_BUNDLE_EXTENSIONS.has(ext) && !fixture) {
      errors.push(`${path}: generated bundle/media/database artifact must not be tracked (extension .${ext})`);
      continue;
    }
    if (MEDIA_EXTENSIONS.has(ext) && !fixture
      && !ARCHITECTURE_MEDIA.has(path)
      && !ADMITTED_MEDIA_ROOTS.some((root) => path.startsWith(root))) {
      errors.push(`${path}: media file outside admitted brand/design, architecture, or product asset paths`);
    }
  }
  return errors;
}

export function trackedFiles(root = process.cwd()) {
  const result = spawnSync("git", ["ls-files", "-z"], { cwd: resolve(root), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`cannot list tracked files with git: ${result.error?.message ?? result.stderr}`);
  }
  return result.stdout.split("\0").filter(Boolean);
}

function main() {
  const errors = checkHygiene(trackedFiles());
  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR ${error}`);
    console.error(`Repository hygiene check failed with ${errors.length} error(s).`);
    process.exit(1);
  }
  console.log("Repository hygiene check passed: no extracted evaluation payloads and no generated bundle/media/database artifacts are tracked.");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
