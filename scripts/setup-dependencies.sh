#!/usr/bin/env bash
set -euo pipefail
RENDER_MODE="$1"
INSTALL_ROOT="${MANIMATE_LOCAL_ROOT:-$HOME/.manimate}"
BIN_DIR="$INSTALL_ROOT/tools/bin"
DRY_RUN=0
MANIM_VERSION="0.21.0"
export PATH="$BIN_DIR:$HOME/.local/bin:$PATH"
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

prepend_macos_tex_path() {
  if [ "$(uname -s)" = "Darwin" ] && [ -d /Library/TeX/texbin ]; then
    PATH="/Library/TeX/texbin:$PATH"
    export PATH
  fi
}

install_macos_packages() {
  [ "$#" -gt 0 ] || return 0

  if [ "$DRY_RUN" -eq 1 ]; then
    run_or_log brew install "$@"
    return
  fi

  have_cmd brew || die "Homebrew is required to install Manimate dependencies on macOS. Install Homebrew or re-run with --skip-dependencies."
  run_or_log brew install "$@"
}

install_macos_casks() {
  [ "$#" -gt 0 ] || return 0

  if [ "$DRY_RUN" -eq 1 ]; then
    run_or_log brew install --cask "$@"
    return
  fi

  have_cmd brew || die "Homebrew is required to install Manimate dependencies on macOS. Install Homebrew or re-run with --skip-dependencies."
  run_or_log brew install --cask "$@"
}

install_linux_packages() {
  [ "$#" -gt 0 ] || return 0

  if [ "$DRY_RUN" -eq 1 ]; then
    run_with_sudo_or_log apt-get update
    run_with_sudo_or_log apt-get install -y "$@"
    return
  fi

  have_cmd apt-get || die "Automatic dependency installation currently supports apt-based Linux distributions. Install claude, manim, and ffmpeg manually or re-run with --skip-dependencies."
  run_with_sudo_or_log apt-get update
  run_with_sudo_or_log apt-get install -y "$@"
}

install_system_dependencies() {
  local packages=()
  local casks=()

  case "$(uname -s)" in
    Darwin)
      if ! have_cmd ffmpeg; then
        packages+=(ffmpeg)
      fi
      if [ "$RENDER_MODE" = local ] && ! manim_is_usable; then
        packages+=(python@3.12 pipx cairo pango pkg-config)
      fi
      if [ "$RENDER_MODE" = local ] && ! have_cmd latex; then
        casks+=(mactex-no-gui)
      fi
      if [ "$RENDER_MODE" = local ] && ! have_cmd dvisvgm; then
        packages+=(dvisvgm)
      fi
      if [ "${#packages[@]}" -gt 0 ]; then
        log "Installing macOS packages: ${packages[*]}"
        install_macos_packages "${packages[@]}"
      fi
      if [ "${#casks[@]}" -gt 0 ]; then
        log "Installing macOS casks: ${casks[*]}"
        install_macos_casks "${casks[@]}"
      fi
      prepend_macos_tex_path
      ;;
    Linux)
      if ! have_cmd ffmpeg; then
        packages+=(ffmpeg)
      fi
      if [ "$RENDER_MODE" = local ] && ! manim_is_usable; then
        packages+=(python3 python3-pip python3-venv python3-dev pipx build-essential libcairo2-dev libpango1.0-dev pkg-config)
      fi
      if [ "$RENDER_MODE" = local ] && { ! have_cmd latex || ! have_cmd dvisvgm; }; then
        packages+=(texlive-latex-base texlive-latex-extra texlive-fonts-recommended texlive-science texlive-fonts-extra dvipng dvisvgm cm-super)
      fi
      if [ "${#packages[@]}" -gt 0 ]; then
        log "Installing Linux packages: ${packages[*]}"
        install_linux_packages "${packages[@]}"
      fi
      ;;
    *)
      die "Unsupported platform: $(uname -s). Install claude, manim, ffmpeg, latex, and dvisvgm manually, then re-run with --skip-dependencies."
      ;;
  esac
}

manim_is_usable() {
  have_cmd manim && manim --version 2>/dev/null | grep -Fxq "Manim Community v${MANIM_VERSION}"
}

install_manim() {
  if manim_is_usable; then
    log "Using existing Manim at $(command -v manim)"
    return
  fi

  if have_cmd manim; then
    warn "Existing Manim at $(command -v manim) does not match ${MANIM_VERSION}; installing a managed copy"
  fi

  log "Installing Manim with pipx"

  if [ "$DRY_RUN" -eq 1 ]; then
    log "Would run: PIPX_HOME=${INSTALL_ROOT}/tools/pipx PIPX_BIN_DIR=${BIN_DIR} pipx install --force "manim==${MANIM_VERSION}""
    return
  fi

  have_cmd pipx || die "pipx is required to install Manim"
  mkdir -p "$BIN_DIR" "${INSTALL_ROOT}/tools/pipx"
  PIPX_HOME="${INSTALL_ROOT}/tools/pipx" PIPX_BIN_DIR="${BIN_DIR}" pipx install --force "manim==${MANIM_VERSION}"
  manim_is_usable || die "Manim installation completed but 'manim --version' does not report ${MANIM_VERSION}. Check pipx output above."
}


prepend_macos_tex_path
install_system_dependencies
prepend_macos_tex_path
if [ "$RENDER_MODE" = local ]; then install_manim; fi
