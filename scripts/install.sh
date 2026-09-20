#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${MANIMATE_INSTALL_BASE_URL:-https://manimate.ai}"
INSTALL_ROOT="${MANIMATE_INSTALL_ROOT:-$HOME/.manimate}"
BIN_DIR="${MANIMATE_BIN_DIR:-$HOME/.local/bin}"
RELEASE_ENV_URL="${MANIMATE_RELEASE_ENV_URL:-$BASE_URL/releases/latest.env}"
NO_MODIFY_PATH=0
SKIP_DEPENDENCY_CHECKS=0
SKIP_DEPENDENCY_INSTALL="${MANIMATE_SKIP_DEPENDENCY_INSTALL:-0}"
DRY_RUN=0
NO_OPEN=0

TMP_DIR=""

usage() {
  cat <<EOF
Manimate installer

Usage:
  curl -fsSL ${BASE_URL}/install.sh | bash

Options:
  --install-root <path>  Install under this directory (default: ~/.manimate)
  --bin-dir <path>       Write the manimate shim here (default: ~/.local/bin)
  --base-url <url>       Override the release host (default: ${BASE_URL})
  --no-modify-path       Do not update shell startup files
  --skip-dependencies    Skip interactive setup (run manimate later)
  --skip-dependency-checks
                         Alias for --skip-dependencies
  --no-open              Finish setup without opening the workspace
  --dry-run              Print actions without applying changes
  --help                 Show this help
EOF
}

log() {
  printf '[manimate-install] %s\n' "$*"
}

warn() {
  printf '[manimate-install] warning: %s\n' "$*" >&2
}

die() {
  printf '[manimate-install] error: %s\n' "$*" >&2
  exit 1
}

cleanup() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}

trap cleanup EXIT

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --install-root)
        [ $# -ge 2 ] || die "--install-root requires a value"
        INSTALL_ROOT="$2"
        shift 2
        ;;
      --bin-dir)
        [ $# -ge 2 ] || die "--bin-dir requires a value"
        BIN_DIR="$2"
        shift 2
        ;;
      --base-url)
        [ $# -ge 2 ] || die "--base-url requires a value"
        BASE_URL="${2%/}"
        RELEASE_ENV_URL="${BASE_URL}/releases/latest.env"
        shift 2
        ;;
      --no-modify-path)
        NO_MODIFY_PATH=1
        shift
        ;;
      --skip-dependencies|--skip-dependency-checks)
        SKIP_DEPENDENCY_INSTALL=1
        SKIP_DEPENDENCY_CHECKS=1
        shift
        ;;
      --no-open)
        NO_OPEN=1
        shift
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
  done
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

require_cmd() {
  have_cmd "$1" || die "Missing required command: $1"
}

run_or_log() {
  if [ "$DRY_RUN" -eq 1 ]; then
    log "Would run: $*"
    return 0
  fi

  "$@"
}

run_with_sudo_or_log() {
  if [ "$DRY_RUN" -eq 1 ]; then
    log "Would run: $*"
    return 0
  fi

  if [ "$(id -u)" -eq 0 ]; then
    "$@"
    return
  fi

  have_cmd sudo || die "sudo is required to install system dependencies. Re-run with --skip-dependencies to install them yourself."
  sudo "$@"
}

sha256_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
    return
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
    return
  fi
  die "Need shasum or sha256sum to verify downloads"
}

verify_sha256() {
  local file_path="$1"
  local expected="$2"
  local actual
  actual="$(sha256_file "$file_path")"
  [ "$actual" = "$expected" ] || die "Checksum mismatch for ${file_path}"
}

download_file() {
  local url="$1"
  local output="$2"
  if [ "$DRY_RUN" -eq 1 ]; then
    log "Would download ${url} -> ${output}"
    return
  fi
  curl -fsSL "$url" -o "$output"
}

load_release_metadata() {
  if [ -n "${MANIMATE_PACKAGE_URL:-}" ] && [ -n "${MANIMATE_PACKAGE_SHA256:-}" ] && [ -n "${MANIMATE_NODE_VERSION:-}" ]; then
    return
  fi

  local manifest_path="${TMP_DIR}/latest.env"
  if [ "$DRY_RUN" -eq 1 ]; then
    log "Would download ${RELEASE_ENV_URL} -> ${manifest_path}"
    curl -fsSL "$RELEASE_ENV_URL" -o "$manifest_path"
  else
    download_file "$RELEASE_ENV_URL" "$manifest_path"
  fi

  # shellcheck disable=SC1090
  . "$manifest_path"
}

ensure_local_node() {
  local platform_id checksum_var node_sha archive_name archive_path node_url

  case "$(uname -s):$(uname -m)" in
    Darwin:arm64|Darwin:aarch64)
      platform_id="darwin-arm64"
      checksum_var="MANIMATE_NODE_DARWIN_ARM64_SHA256"
      ;;
    Darwin:x86_64)
      platform_id="darwin-x64"
      checksum_var="MANIMATE_NODE_DARWIN_X64_SHA256"
      ;;
    Linux:arm64|Linux:aarch64)
      platform_id="linux-arm64"
      checksum_var="MANIMATE_NODE_LINUX_ARM64_SHA256"
      ;;
    Linux:x86_64)
      platform_id="linux-x64"
      checksum_var="MANIMATE_NODE_LINUX_X64_SHA256"
      ;;
    Darwin:*)
      die "Unsupported macOS architecture: $(uname -m)"
      ;;
    Linux:*)
      die "Unsupported Linux architecture: $(uname -m)"
      ;;
    *)
      die "Unsupported platform: $(uname -s). Use macOS or Linux."
      ;;
  esac

  node_sha="${!checksum_var:-}"
  [ -n "$node_sha" ] || die "Missing checksum for ${platform_id}"

  NODE_DIR="${INSTALL_ROOT}/tools/node-v${MANIMATE_NODE_VERSION}-${platform_id}"
  NODE_BIN="${NODE_DIR}/bin/node"
  NPM_BIN="${NODE_DIR}/bin/npm"

  if [ -x "$NODE_BIN" ] && [ -x "$NPM_BIN" ]; then
    log "Reusing local Node ${MANIMATE_NODE_VERSION} at ${NODE_DIR}"
    return
  fi

  archive_name="node-v${MANIMATE_NODE_VERSION}-${platform_id}.tar.gz"
  archive_path="${TMP_DIR}/${archive_name}"
  node_url="https://nodejs.org/dist/v${MANIMATE_NODE_VERSION}/${archive_name}"

  log "Downloading Node ${MANIMATE_NODE_VERSION} for ${platform_id}"
  download_file "$node_url" "$archive_path"

  if [ "$DRY_RUN" -eq 1 ]; then
    return
  fi

  verify_sha256 "$archive_path" "$node_sha"
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  tar -xzf "$archive_path" --strip-components=1 -C "$NODE_DIR"
}

resolve_node_runtime() {
  local major="0"

  if have_cmd node && have_cmd npm; then
    major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
  fi

  if [ "$major" -ge 22 ]; then
    NODE_BIN="$(command -v node)"
    NPM_BIN="$(command -v npm)"
    WRAPPER_NODE_BIN=""
    log "Using system Node $("$NODE_BIN" -p "process.version")"
    return
  fi

  ensure_local_node
  WRAPPER_NODE_BIN="$NODE_BIN"
}

managed_npm_bin_dir() {
  printf '%s\n' "${INSTALL_ROOT}/tools/npm-global/bin"
}

prepend_managed_path() {
  PATH="${BIN_DIR}:$(managed_npm_bin_dir):$PATH"
  export PATH
}

install_package() {
  PACKAGE_VERSION="${MANIMATE_RELEASE_VERSION:-${MANIMATE_VERSION:-unknown}}"
  PACKAGE_URL="${MANIMATE_PACKAGE_URL:-}"
  PACKAGE_SHA256="${MANIMATE_PACKAGE_SHA256:-}"

  [ -n "$PACKAGE_URL" ] || die "Missing package URL"
  [ -n "$PACKAGE_SHA256" ] || die "Missing package checksum"

  case "$PACKAGE_URL" in
    http://*|https://*)
      ;;
    /*)
      PACKAGE_URL="${BASE_URL}${PACKAGE_URL}"
      ;;
    *)
      PACKAGE_URL="${BASE_URL}/${PACKAGE_URL}"
      ;;
  esac

  PACKAGE_ARCHIVE="${TMP_DIR}/manimate.tgz"
  PACKAGE_INSTALL_DIR="${INSTALL_ROOT}/install"
  PACKAGE_ENTRY="${PACKAGE_INSTALL_DIR}/node_modules/manimate/scripts/manimate-tool.mjs"

  log "Downloading Manimate ${PACKAGE_VERSION}"
  download_file "$PACKAGE_URL" "$PACKAGE_ARCHIVE"

  if [ "$DRY_RUN" -eq 1 ]; then
    log "Would install package under ${PACKAGE_INSTALL_DIR}"
    return
  fi

  verify_sha256 "$PACKAGE_ARCHIVE" "$PACKAGE_SHA256"
  rm -rf "$PACKAGE_INSTALL_DIR"
  mkdir -p "$PACKAGE_INSTALL_DIR"
  NPM_CONFIG_UPDATE_NOTIFIER=false "$NPM_BIN" install --prefix "$PACKAGE_INSTALL_DIR" --no-fund --no-audit "$PACKAGE_ARCHIVE" >/dev/null
  [ -f "$PACKAGE_ENTRY" ] || die "Installed package is missing ${PACKAGE_ENTRY}"
}

write_wrapper() {
  WRAPPER_PATH="${BIN_DIR}/manimate"

  if [ "$DRY_RUN" -eq 1 ]; then
    log "Would write wrapper to ${WRAPPER_PATH}"
    return
  fi

  mkdir -p "$BIN_DIR"

  cat >"$WRAPPER_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail

INSTALL_ROOT="$(printf '%s' "$INSTALL_ROOT")"
NODE_BIN="$(printf '%s' "$WRAPPER_NODE_BIN")"
BIN_DIR="$(printf '%s' "$BIN_DIR")"
MANAGED_NPM_BIN="\$INSTALL_ROOT/tools/npm-global/bin"
ENTRYPOINT="\$INSTALL_ROOT/install/node_modules/manimate/scripts/manimate-tool.mjs"

export PATH="\$BIN_DIR:\$MANAGED_NPM_BIN:\$PATH"

if [ -d /Library/TeX/texbin ]; then
  export PATH="/Library/TeX/texbin:\$PATH"
fi

if [ -n "\$NODE_BIN" ] && [ -x "\$NODE_BIN" ]; then
  exec "\$NODE_BIN" "\$ENTRYPOINT" "\$@"
fi

if command -v node >/dev/null 2>&1; then
  exec "\$(command -v node)" "\$ENTRYPOINT" "\$@"
fi

echo "Node.js 22+ is required to run Manimate. Re-run the installer." >&2
exit 1
EOF

  chmod +x "$WRAPPER_PATH"
}

ensure_path() {
  if [ "$NO_MODIFY_PATH" -ne 0 ]; then
    return 0
  fi

  case ":$PATH:" in
    *":${BIN_DIR}:"*)
      return
      ;;
  esac

  local shell_name rc_file path_line
  shell_name="$(basename "${SHELL:-sh}")"

  case "$shell_name" in
    zsh)
      rc_file="$HOME/.zshrc"
      ;;
    bash)
      rc_file="$HOME/.bashrc"
      ;;
    *)
      rc_file="$HOME/.profile"
      ;;
  esac

  path_line="export PATH=\"${BIN_DIR}:\$PATH\""

  if [ "$DRY_RUN" -eq 1 ]; then
    log "Would append PATH update to ${rc_file}"
    return
  fi

  mkdir -p "$(dirname "$rc_file")"
  touch "$rc_file"
  if ! grep -Fq "$path_line" "$rc_file"; then
    printf '\n%s\n' "$path_line" >>"$rc_file"
    PATH_UPDATED=1
  fi
}

print_summary() {
  log "Installed Manimate ${PACKAGE_VERSION} to ${INSTALL_ROOT}"
  log "CLI shim: ${WRAPPER_PATH}"

  if [ "${PATH_UPDATED:-0}" -eq 1 ]; then
    log "Updated PATH in your shell startup file. Open a new terminal before running 'manimate'."
    return
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    log "Dry run complete."
    return
  fi

  log "Run: manimate"
}

main() {
  parse_args "$@"

  require_cmd curl
  require_cmd tar

  TMP_DIR="$(mktemp -d)"
  PATH_UPDATED=0

  load_release_metadata
  resolve_node_runtime
  install_package
  write_wrapper
  ensure_path
  print_summary
  if [ "$DRY_RUN" -eq 0 ] && [ "$SKIP_DEPENDENCY_INSTALL" -eq 0 ]; then
    if [ -r /dev/tty ] && ( : </dev/tty ) 2>/dev/null; then
      local setup_args=(--setup --no-upgrade-check)
      if [ "$NO_OPEN" -eq 1 ]; then setup_args+=(--no-open); fi
      "$WRAPPER_PATH" "${setup_args[@]}" </dev/tty
    else
      log "Run manimate in a terminal to choose Local or Cloud and finish setup."
    fi
  fi
}

main "$@"
