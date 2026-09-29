#!/usr/bin/env bash
# Build a portable native workspace. No workspace origin or credentials are bundled.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${MACOS_OUTPUT_DIR:?Set MACOS_OUTPUT_DIR to a task-owned artifact directory}"
MODE="${MACOS_RELEASE_MODE:-preview}"
case "$MODE" in preview|signed) ;; *) echo 'Expected preview or signed mode' >&2; exit 1;; esac
if [[ "$MODE" == signed ]]; then
  : "${MACOS_SIGNING_IDENTITY:?Developer ID Application identity required}"
  : "${MACOS_NOTARY_PROFILE:?Notary keychain profile required}"
  : "${MACOS_NOTARY_KEYCHAIN:?Notary keychain path required}"
  : "${MACOS_SPARKLE_PUBLIC_KEY:?Sparkle public key required for signed releases}"
  node -e 'if(Buffer.from(process.env.MACOS_SPARKLE_PUBLIC_KEY,"base64").length!==32)throw Error("Invalid Sparkle public key")'
  [[ "$MACOS_SIGNING_IDENTITY" == 'Developer ID Application:'* ]] || { echo 'Developer ID Application identity required' >&2; exit 1; }
fi
if [[ "$MODE" == preview ]]; then export MACOS_SPARKLE_PUBLIC_KEY=""; fi
VERSION="${MACOS_VERSION:?Set the product tag version, for example MACOS_VERSION=0.1.92}"
BUILD="${MACOS_BUILD_NUMBER:?Set a monotonic native build number}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ && "$BUILD" =~ ^[1-9][0-9]*$ ]] || { echo 'Invalid version/build' >&2; exit 1; }
product_tags="$(git -C "$ROOT" tag --points-at HEAD --list 'v[0-9]*.[0-9]*.[0-9]*')"
if [[ -n "$product_tags" && "$product_tags" != "v$VERSION" ]]; then
  echo "Package version $VERSION disagrees with the source tag: $product_tags" >&2
  exit 1
fi
mkdir -p "$MACOS_OUTPUT_DIR"
OUTPUT="$(cd "$MACOS_OUTPUT_DIR" && pwd)"
# A run gets its own build/staging directory; existing files are never overwritten.
STAGING="$(mktemp -d "$OUTPUT/package.XXXXXX")"
"$ROOT/scripts/macos/generate.sh"
xcodebuild -quiet -project "$ROOT/apps/macos/TalentSignalMac.xcodeproj" \
  -scheme TalentSignalMac -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath "$STAGING/DerivedData" ARCHS='arm64 x86_64' ONLY_ACTIVE_ARCH=NO \
  MACOS_SPARKLE_PUBLIC_KEY="${MACOS_SPARKLE_PUBLIC_KEY:-}" CODE_SIGNING_ALLOWED=NO MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$BUILD" build
mkdir "$STAGING/dmg"
APP="$STAGING/dmg/Talent Signal.app"
ditto "$STAGING/DerivedData/Build/Products/Release/TalentSignalMac.app" "$APP"
EXECUTABLE="$APP/Contents/MacOS/TalentSignalMac"
lipo "$EXECUTABLE" -verify_arch arm64 x86_64
[[ -f "$APP/Contents/Resources/AppIcon.icns" ]] || { echo 'AppIcon missing' >&2; exit 1; }
# Build only the shared, portable connection UI; no developer origin may leak.
if /usr/libexec/PlistBuddy -c 'Print :TalentSignalWebOrigin' "$APP/Contents/Info.plist" >/dev/null 2>&1; then
  echo 'Distribution must not embed a workspace address' >&2; exit 1
fi
if [[ "$MODE" == signed ]]; then
  "$ROOT/scripts/macos/sign-app.sh" "$APP" "$MACOS_SIGNING_IDENTITY"
  ditto -c -k --keepParent "$APP" "$STAGING/notarize.zip"
  xcrun notarytool submit "$STAGING/notarize.zip" --keychain-profile "$MACOS_NOTARY_PROFILE" --keychain "$MACOS_NOTARY_KEYCHAIN" --wait
  xcrun stapler staple "$APP"
  xcrun stapler validate "$APP"
  spctl --assess --type execute --verbose "$APP"
else
  "$ROOT/scripts/macos/sign-app.sh" "$APP" -
fi
codesign --verify --deep --strict "$APP"
BASE="Talent-Signal-${VERSION}-${BUILD}-macOS-universal-${MODE}"
for suffix in dmg zip; do
  [[ ! -e "$OUTPUT/$BASE.$suffix" ]] || { echo 'Refusing to overwrite an existing package' >&2; exit 1; }
done
ln -s /Applications "$STAGING/dmg/Applications"
cp "$ROOT/docs/operations/macos-install.txt" "$STAGING/dmg/Install.txt"
if [[ "$MODE" == preview ]]; then
  printf '\nPREVIEW: ad-hoc signed, not notarized by Apple.\n' >> "$STAGING/dmg/Install.txt"
fi
hdiutil create -quiet -volname 'Talent Signal' -srcfolder "$STAGING/dmg" -ov -format UDZO "$OUTPUT/$BASE.dmg"
if [[ "$MODE" == signed ]]; then
  codesign --timestamp --sign "$MACOS_SIGNING_IDENTITY" "$OUTPUT/$BASE.dmg"
  xcrun notarytool submit "$OUTPUT/$BASE.dmg" --keychain-profile "$MACOS_NOTARY_PROFILE" --keychain "$MACOS_NOTARY_KEYCHAIN" --wait
  xcrun stapler staple "$OUTPUT/$BASE.dmg"
  xcrun stapler validate "$OUTPUT/$BASE.dmg"
fi
ditto -c -k --keepParent "$APP" "$OUTPUT/$BASE.zip"
(cd "$OUTPUT" && shasum -a 256 "$BASE.dmg" "$BASE.zip" > "$BASE-SHA256SUMS.txt")
printf 'Packaged %s (%s). App: %s\n' "$BASE" "$MODE" "$APP"
