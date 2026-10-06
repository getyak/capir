#!/bin/sh
# capir standalone installer bootstrap.
#
# Installs a managed standalone capir from the signed capir-stable channel:
#
#   curl -fsSL https://github.com/getyak/capir/releases/download/capir-stable/install.sh -o capir-install.sh
#   sh capir-install.sh
#
# Trust model: the release manifest carries a detached RSA-SHA256 signature
# checked against the PUBLIC KEY embedded below BEFORE the manifest is parsed
# or used. The current-platform archive is sha256-verified against the signed
# manifest BEFORE extraction; archive entry names, symlink targets (including
# chains) and hardlink sources are proven confined to the extraction root
# before any file is unpacked. Only then does the bundled Node installer run
# and re-verify everything again in Node before publishing anything.
#
# This bootstrap uses only sh, curl, tar, openssl and standard POSIX tools -
# no system Python or Node. All network access is bounded (connect timeout and
# total deadline) and all bodies are size-capped.
#
# The private signing key is NEVER present here or in any client; it lives
# only in the trusted release pipeline.
#
# Options:
#   --version X.Y.Z           install exactly the signed immutable capir-vX.Y.Z
#                             release manifest (default: the capir-stable
#                             channel's verified newest stable manifest)
#   --replace-existing        back up an unrelated launcher and proceed
#                             (default: refuse unrelated/custom launchers)
#   --install-root <dir>      managed root (default ~/.local/share/capir,
#                             or CAPIR_INSTALL_DIR)
#   --bin-dir <dir>           launcher directory (default ~/.local/bin,
#                             or CAPIR_BIN_DIR)
#   --release-base-url <url>  explicit transport injection for tests/mirrors;
#                             every byte is still pinned by the signed
#                             manifest and its signature
set -eu

RELEASE_BASE_URL="https://github.com/getyak/capir/releases"
REPLACE_EXISTING=0
REQUESTED_VERSION=""
INSTALL_ROOT="${CAPIR_INSTALL_DIR:-${HOME}/.local/share/capir}"
BIN_DIR="${CAPIR_BIN_DIR:-${HOME}/.local/bin}"
CONNECT_TIMEOUT=10
MAX_TIME=600
MAX_MANIFEST_BYTES=262144

usage() {
  cat <<'EOF'
Usage: sh capir-install.sh [--version X.Y.Z] [--replace-existing]
                           [--install-root <dir>] [--bin-dir <dir>]
                           [--release-base-url <url>]
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      shift
      REQUESTED_VERSION="${1:?--version requires a value}"
      printf '%s' "$REQUESTED_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || {
        printf 'capir-install.sh: --version must be strict semver X.Y.Z\n' >&2
        exit 2
      }
      ;;
    --replace-existing) REPLACE_EXISTING=1 ;;
    --install-root) shift; INSTALL_ROOT="${1:?--install-root requires a value}" ;;
    --bin-dir) shift; BIN_DIR="${1:?--bin-dir requires a value}" ;;
    --release-base-url) shift; RELEASE_BASE_URL="${1:?--release-base-url requires a value}" ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'capir-install.sh: unknown argument %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

# ---------------------------------------------------------------------------
# Strict platform selection: no guessing, no emulation.
uname_s="$(uname -s 2>/dev/null || echo unknown)"
uname_m="$(uname -m 2>/dev/null || echo unknown)"
case "$uname_m" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64) arch="x64" ;;
  *) arch="unsupported" ;;
esac
case "$uname_s-$arch" in
  Darwin-arm64) PLATFORM="darwin-arm64" ;;
  Darwin-x64) PLATFORM="darwin-x64" ;;
  Linux-arm64) PLATFORM="linux-arm64" ;;
  Linux-x64) PLATFORM="linux-x64" ;;
  *)
    printf 'capir-install.sh: unsupported platform %s-%s.\n' "$uname_s" "$uname_m" >&2
    printf 'Supported: darwin-arm64, darwin-x64, linux-arm64, linux-x64 (glibc).\n' >&2
    printf 'Windows is source-install only and has no native updater support.\n' >&2
    exit 3
    ;;
esac

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/capir-install.XXXXXX")"
FETCH_PID=""
cleanup() {
  if [ -n "${FETCH_PID:-}" ]; then kill "$FETCH_PID" 2>/dev/null || true; fi
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT INT TERM

fetch() {
  # BSD and GNU head support -c on every supported platform. Bound bytes
  # written even when older curl receives an unknown-length response.
  # $1 = url, $2 = output file, $3 = max bytes
  url="$1"; out="$2"; max_bytes="$3"
  proto_args=""
  case "$RELEASE_BASE_URL" in
    https://*) proto_args="--proto =https --proto-redir =https" ;;
  esac
  transfer_pipe="$WORK_DIR/download.pipe"
  mkfifo "$transfer_pipe"
  # shellcheck disable=SC2086
  curl --fail --silent --show-error --location \
    --connect-timeout "$CONNECT_TIMEOUT" --max-time "$MAX_TIME" \
    --max-filesize "$max_bytes" \
    $proto_args --output - "$url" > "$transfer_pipe" 2> "$WORK_DIR/download-error" &
  FETCH_PID=$!
  head -c "$((max_bytes + 1))" < "$transfer_pipe" > "$out"
  actual="$(wc -c < "$out" | tr -d ' ')"
  if [ "$actual" -gt "$max_bytes" ]; then
    kill "$FETCH_PID" 2>/dev/null || true
    wait "$FETCH_PID" 2>/dev/null || true
    FETCH_PID=""
    printf 'capir-install.sh: body exceeds its byte cap\n' >&2
    exit 3
  fi
  download_status=0
  wait "$FETCH_PID" || download_status=$?
  FETCH_PID=""
  rm "$transfer_pipe"
  if [ "$download_status" -ne 0 ]; then
    printf 'capir-install.sh: download failed (curl status %s)\n' "$download_status" >&2
    exit 3
  fi
}

# ---------------------------------------------------------------------------
# 1. Manifest + detached signature (capped, bounded). The default is the
#    capir-stable channel release; --version selects the signed immutable
#    capir-vX.Y.Z release manifest instead.
if [ -n "$REQUESTED_VERSION" ]; then
  MANIFEST_URL="${RELEASE_BASE_URL}/download/capir-v${REQUESTED_VERSION}/manifest.json"
  SIGNATURE_URL="${RELEASE_BASE_URL}/download/capir-v${REQUESTED_VERSION}/manifest.json.sig"
else
  MANIFEST_URL="${RELEASE_BASE_URL}/download/capir-stable/manifest.json"
  SIGNATURE_URL="${RELEASE_BASE_URL}/download/capir-stable/manifest.json.sig"
fi
fetch "$MANIFEST_URL" "$WORK_DIR/manifest.json" "$MAX_MANIFEST_BYTES"
fetch "$SIGNATURE_URL" "$WORK_DIR/manifest.json.sig" "$MAX_MANIFEST_BYTES"

# 2. The committed public trust key.
cat > "$WORK_DIR/trust.pem" <<'EOF'
-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEArcp5/dQcN+DhqD/gW1vY
4ZchI41DneoR1p1+yo+kA6N9SS0ksKWtKR3YABVjSmN7hsbwhsT3t96g7YkgtJtZ
DkXTNoFqg3MDOl8Dqhg0tieWQ82YrVe97n1+LYPLIFLG1sgoafagXJ+NoY19vXiT
0G80bC2Rpzy0ugrEkmCJJjBQWCfznJHRYoMto2nxu5P3YlnQrQWYf1fzUUnUQuSH
Uuov/nbRpeLNSU8RCDoMKUt2rA4vBJWHHBX7ncmuehP9vc70cw25WjNX+Qiavmka
ZpavlTx1V1PUUsyizPkK/sTIqx5y+JLGMg4199hEks8kssShEZbv4pirMgfQfRPu
SHwvtwWUdtxHIzUTMAoGRRFRERuwbbpb4qnCE2E3EtJpv+8p2w+hnpHjeqQWfbue
jhpFKsOQhDn54MwJbB3iF7quA81Kqrio0krcwVGCiB5YaegAOlspHSqPYenb1OpN
Xe9vM09OF/85HUZfh2bGRmr5koAiJVDqfxr8qUxEO7HtAgMBAAE=
-----END PUBLIC KEY-----
EOF

# 3. Signature verification STRICTLY BEFORE parsing or using the manifest.
if ! openssl dgst -sha256 -verify "$WORK_DIR/trust.pem" \
  -signature "$WORK_DIR/manifest.json.sig" "$WORK_DIR/manifest.json" \
  > "$WORK_DIR/verify.out" 2>&1; then
  printf 'capir-install.sh: manifest signature verification FAILED; nothing was used.\n' >&2
  exit 3
fi

# ---------------------------------------------------------------------------
# 4. Strict field extraction from the deliberately simple multi-line JSON.
manifest_field() {
  sed -n "s/^[[:space:]]*\"$1\":[[:space:]]*\"\\([^\"]*\\)\"[,]*[[:space:]]*$/\\1/p" \
    "$WORK_DIR/manifest.json" | head -n 1
}
VERSION="$(manifest_field version)"
TAG="$(manifest_field tag)"
NODE_VERSION="$(manifest_field node_version)"
SOURCE_COMMIT="$(manifest_field source_commit)"

echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || {
  printf 'capir-install.sh: manifest version is not strict semver\n' >&2; exit 3; }
[ -z "$REQUESTED_VERSION" ] || [ "$VERSION" = "$REQUESTED_VERSION" ] || {
  printf 'capir-install.sh: manifest version %s does not match requested %s\n' \
    "$VERSION" "$REQUESTED_VERSION" >&2; exit 3; }
[ "$TAG" = "capir-v$VERSION" ] || {
  printf 'capir-install.sh: manifest tag does not bind its version\n' >&2; exit 3; }
echo "$NODE_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || {
  printf 'capir-install.sh: manifest node_version is malformed\n' >&2; exit 3; }
echo "$SOURCE_COMMIT" | grep -Eq '^[0-9a-f]{40}$' || {
  printf 'capir-install.sh: manifest source_commit is malformed\n' >&2; exit 3; }

# Asset block for the selected platform (ordered entries; one key per line).
asset_field() {
  awk -v want="$PLATFORM" -v key="$1" '
    BEGIN { inside = 0; depth = 0 }
    /^[[:space:]]*\{/ { if (inside) depth++ }
    /"platform":/ {
      line = $0
      sub(/.*"platform":[[:space:]]*"/, "", line)
      sub(/".*/, "", line)
      if (line == want) inside = 1
    }
    inside && $0 ~ "\"" key "\":" {
      line = $0
      sub(".*\"" key "\":[[:space:]]*", "", line)
      sub(/,$/, "", line)
      gsub(/^"|"$/, "", line)
      print line
      exit
    }
    /^[[:space:]]*\}/ { if (inside && depth == 0) exit; if (inside) depth-- }
  ' "$WORK_DIR/manifest.json"
}
FILENAME="$(asset_field filename)"
ASSET_URL="$(asset_field url)"
ASSET_SHA256="$(asset_field sha256)"
ASSET_SIZE="$(asset_field size)"

EXPECTED_FILENAME="capir-$VERSION-$PLATFORM.tar.gz"
[ "$FILENAME" = "$EXPECTED_FILENAME" ] || {
  printf 'capir-install.sh: manifest asset filename must be %s\n' "$EXPECTED_FILENAME" >&2; exit 3; }
EXPECTED_URL="${RELEASE_BASE_URL}/download/${TAG}/${EXPECTED_FILENAME}"
[ "$ASSET_URL" = "$EXPECTED_URL" ] || {
  printf 'capir-install.sh: manifest asset url must be %s\n' "$EXPECTED_URL" >&2; exit 3; }
echo "$ASSET_SHA256" | grep -Eq '^[0-9a-f]{64}$' || {
  printf 'capir-install.sh: manifest asset sha256 is malformed\n' >&2; exit 3; }
echo "$ASSET_SIZE" | grep -Eq '^[0-9]+$' || {
  printf 'capir-install.sh: manifest asset size is malformed\n' >&2; exit 3; }
if [ "$ASSET_SIZE" -le 0 ] || [ "$ASSET_SIZE" -gt 536870912 ]; then
  printf 'capir-install.sh: manifest asset size is out of bounds\n' >&2; exit 3;
fi

# ---------------------------------------------------------------------------
# 5. Archive download (capped) and sha256 verification BEFORE extraction.
fetch "$ASSET_URL" "$WORK_DIR/$FILENAME" "$ASSET_SIZE"
ACTUAL_SIZE="$(wc -c < "$WORK_DIR/$FILENAME" | tr -d ' ')"
[ "$ACTUAL_SIZE" = "$ASSET_SIZE" ] || {
  printf 'capir-install.sh: archive byte size %s does not match the signed %s\n' \
    "$ACTUAL_SIZE" "$ASSET_SIZE" >&2; exit 3; }
ACTUAL_SHA256="$(openssl dgst -sha256 -r "$WORK_DIR/$FILENAME" | cut -d' ' -f1)"
[ "$ACTUAL_SHA256" = "$ASSET_SHA256" ] || {
  printf 'capir-install.sh: archive sha256 does not match the signed manifest; refusing to extract.\n' >&2
  exit 3; }

# ---------------------------------------------------------------------------
# 6. Archive confinement preflight BEFORE extraction. Entry names and every
#    symlink target are resolved through the full link graph (chains, cycles)
#    and must stay inside the archive root; no entry may live under a symlink
#    ancestor; hardlinks may only reference regular members.
tar -tvzf "$WORK_DIR/$FILENAME" | awk '
  function fail(msg) { print "capir-install.sh: " msg > "/dev/stderr"; bad = 1; exit 1 }
  function pop(s,   p) { p = match(s, /\/[^\/]*$/); return p ? substr(s, 1, p - 1) : "" }
  function resolve(link,   target, rest, seg, stack, here, p, resolved) {
    if (VISIT[link]) fail("symlink cycle through " link)
    VISIT[link] = 1
    target = LINK[link]
    if (target == "" || substr(target, 1, 1) == "/") fail("symlink " link " has an empty or absolute target")
    stack = pop(link)
    rest = target
    while (length(rest) > 0) {
      p = index(rest, "/")
      if (p > 0) { seg = substr(rest, 1, p - 1); rest = substr(rest, p + 1) } else { seg = rest; rest = "" }
      if (seg == "" || seg == ".") continue
      if (seg == "..") {
        if (stack == "") fail("symlink " link " escapes the archive root via " target)
        stack = pop(stack)
        continue
      }
      here = (stack == "") ? seg : stack "/" seg
      if (TYPE[here] == "l") { resolved = resolve(here); stack = resolved } else { stack = here }
    }
    delete VISIT[link]
    return stack
  }
  {
    line = $0
    type = substr(line, 1, 1)
    if (type != "-" && type != "d" && type != "l" && type != "h")
      fail("archive uses a refused entry type: " line)
    if (match(line, /[0-9][0-9]:[0-9][0-9](:[0-9][0-9])?/) == 0)
      fail("cannot parse archive listing line: " line)
    name = substr(line, RSTART + RLENGTH)
    sub(/^[[:space:]]+/, "", name)
    target = ""
    if (type != "l" && index(name, " link to ") > 0) {
      # GNU tar lists hardlinks with a file type char plus ` link to `.
      type = "h"
    }
    if (type == "l") {
      p = index(name, " -> ")
      if (p == 0) fail("cannot parse symlink listing: " line)
      target = substr(name, p + 4)
      name = substr(name, 1, p - 1)
    } else if (type == "h") {
      p = index(name, " link to ")
      if (p == 0) fail("cannot parse hardlink listing: " line)
      target = substr(name, p + 9)
      name = substr(name, 1, p - 1)
    }
    sub(/\/$/, "", name)
    if (name == "" || substr(name, 1, 1) == "/") fail("archive entry uses an empty or absolute path")
    n = split(name, segs, "/")
    for (i = 1; i <= n; i++) {
      if (segs[i] == "" || segs[i] == "..") fail("archive entry escapes the root: " name)
    }
    if (name != "node" && name != "package" && name != "LICENSES" && name != "build-info.json" &&
        name !~ /^(node|package|LICENSES)\//)
      fail("archive entry outside the portable layout: " name)
    if (name in TYPE) {
      if (TYPE[name] != type) fail("duplicate archive entry with conflicting type: " name)
    } else {
      TYPE[name] = type
      COUNT[++total] = name
    }
    if (type == "l") LINK[name] = target
    if (type == "h") LINK[name] = target
  }
  END {
    if (bad) exit 1
    for (i = 1; i <= total; i++) {
      name = COUNT[i]
      # No file or directory may sit under a symlink ancestor.
      if (TYPE[name] != "l") {
        parent = pop(name)
        while (parent != "") {
          if (TYPE[parent] == "l") fail("entry " name " lives under symlink " parent)
          parent = pop(parent)
        }
      }
    }
    for (i = 1; i <= total; i++) {
      name = COUNT[i]
      if (TYPE[name] == "l") { resolved = resolve(name); delete VISIT }
      if (TYPE[name] == "h") {
        ref = LINK[name]
        if (ref == "" || substr(ref, 1, 1) == "/") fail("hardlink " name " has an invalid target")
        seen = 0
        while (TYPE[ref] == "h") {
          if (seen++ > 64) fail("hardlink cycle through " ref)
          ref = LINK[ref]
        }
        if (TYPE[ref] != "-") fail("hardlink " name " does not reference a regular member")
      }
    }
  }
' || {
  printf 'capir-install.sh: archive confinement preflight failed; nothing was extracted.\n' >&2
  exit 3
}

# ---------------------------------------------------------------------------
# 7. Extract into staging (never into the install root directly).
mkdir -p "$WORK_DIR/extract"
tar -xzf "$WORK_DIR/$FILENAME" -C "$WORK_DIR/extract" --no-same-owner --no-same-permissions
[ -x "$WORK_DIR/extract/node/bin/node" ] || {
  printf 'capir-install.sh: bundled runtime is missing\n' >&2; exit 3; }
[ -f "$WORK_DIR/extract/package/dist/update/installEntry.js" ] || {
  printf 'capir-install.sh: bundled installer is missing\n' >&2; exit 3; }

# ---------------------------------------------------------------------------
# 8. Bundled Node installer re-verifies signature, archive sha256, tree
#    confinement and smokes the CLI from a clean environment before publish.
set -- --manifest "$WORK_DIR/manifest.json" \
  --signature "$WORK_DIR/manifest.json.sig" \
  --archive "$WORK_DIR/$FILENAME" \
  --tree "$WORK_DIR/extract" \
  --install-root "$INSTALL_ROOT" \
  --bin-dir "$BIN_DIR" \
  --trust-key "$WORK_DIR/trust.pem" \
  --expected-release-base "$RELEASE_BASE_URL"
if [ "$REPLACE_EXISTING" = "1" ]; then
  set -- "$@" --replace-existing
fi
"$WORK_DIR/extract/node/bin/node" "$WORK_DIR/extract/package/dist/update/installEntry.js" "$@"
