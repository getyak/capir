#!/usr/bin/env bash
# Finder metadata must describe the deliverable volume, not the staging folder.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${MACOS_OUTPUT_DIR:?Set MACOS_OUTPUT_DIR to a task-owned artifact directory}"
[[ $# == 2 && -d "$1" ]] || { echo 'Expected source folder and new output DMG' >&2; exit 1; }
SOURCE="$(cd "$1" && pwd)"
FINAL="$2"
[[ ! -e "$FINAL" ]] || { echo 'Refusing to overwrite an existing installer' >&2; exit 1; }
SCRATCH="$(mktemp -d "$MACOS_OUTPUT_DIR/installer-image.XXXXXX")"
MOUNT="$(mktemp -d "$MACOS_OUTPUT_DIR/installer-mount.XXXXXX")"
attached=false
cleanup() {
  local status=$?
  if [[ "$attached" == true ]]; then
    if hdiutil detach -quiet "$MOUNT"; then attached=false
    else echo "Could not detach task installer mount: $MOUNT" >&2; status=1; fi
  fi
  if [[ "$attached" == false ]]; then rmdir "$MOUNT" 2>/dev/null || true; fi
  # Failed build images remain in the registered artifact for diagnosis.
  if [[ "$status" == 0 ]]; then rm -f "$SCRATCH/scratch.dmg"; rmdir "$SCRATCH"; fi
  exit "$status"
}
trap cleanup EXIT
hdiutil create -quiet -volname 'Talent Signal' -srcfolder "$SOURCE" -fs HFS+ -format UDRW "$SCRATCH/scratch.dmg"
hdiutil attach -quiet -nobrowse -mountpoint "$MOUNT" "$SCRATCH/scratch.dmg"
attached=true
swift run --jobs 4 --package-path "$ROOT/scripts/macos/installer" \
  --scratch-path "$MACOS_OUTPUT_DIR/installer-build" InstallerLayout "$MOUNT"
hdiutil detach -quiet "$MOUNT"
attached=false
hdiutil convert "$SCRATCH/scratch.dmg" -quiet -format UDZO -o "$FINAL"
