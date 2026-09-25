#!/bin/bash
# Maina — verification-first developer OS
# Install: curl -fsSL https://api.mainahq.com/install | bash
#
# This script is a thin wrapper:
# 1. Detects your OS and package manager
# 2. Installs the maina CLI globally
# 3. Hands over to `maina setup`, which configures your AI coding tools
#
# It never writes a config file itself. `maina setup` merges maina into
# the files each tool actually reads (Claude Code: .mcp.json /
# ~/.claude.json), keeps every other key, backs the original up once, and
# `maina mcp remove` restores it.

set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ─── Helpers ──────────────────────────────────────────────────────────────

info() { echo -e "${BLUE}>${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; }
step() { echo -e "\n${BOLD}${CYAN}$1${NC}"; }
dim() { echo -e "${DIM}$1${NC}"; }

prompt_yn() {
  local message="$1"
  local default="${2:-y}"
  # When piped (curl | bash), stdin is not a terminal — use defaults
  if [ ! -t 0 ]; then
    case "$default" in
      [Yy]*) return 0 ;;
      *) return 1 ;;
    esac
  fi
  local yn
  if [ "$default" = "y" ]; then
    printf "${BLUE}?${NC} %s ${DIM}[Y/n]${NC} " "$message"
  else
    printf "${BLUE}?${NC} %s ${DIM}[y/N]${NC} " "$message"
  fi
  read -r yn </dev/tty
  yn="${yn:-$default}"
  case "$yn" in
    [Yy]*) return 0 ;;
    *) return 1 ;;
  esac
}

# ─── OS Detection ─────────────────────────────────────────────────────────

detect_os() {
  case "$(uname -s)" in
    Darwin*) echo "macos" ;;
    Linux*)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        echo "wsl"
      else
        echo "linux"
      fi
      ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *) echo "unknown" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "x64" ;;
    arm64|aarch64) echo "arm64" ;;
    *) echo "$(uname -m)" ;;
  esac
}

# ─── Package Manager Detection ────────────────────────────────────────────

detect_pkg_manager() {
  if command -v bun &>/dev/null; then
    echo "bun"
  elif command -v pnpm &>/dev/null; then
    echo "pnpm"
  elif command -v yarn &>/dev/null; then
    echo "yarn"
  elif command -v npm &>/dev/null; then
    echo "npm"
  else
    echo "none"
  fi
}

# ─── Installation ─────────────────────────────────────────────────────────

install_maina() {
  local pkg_mgr="$1"

  case "$pkg_mgr" in
    bun)
      info "Installing with bun..."
      if ! bun install -g @mainahq/cli; then
        error "bun install -g @mainahq/cli failed."
        info "  Try: npm install -g @mainahq/cli"
        exit 11
      fi
      ;;
    pnpm)
      info "Installing with pnpm..."
      if ! pnpm install -g @mainahq/cli; then
        error "pnpm install -g @mainahq/cli failed."
        info "  Try: npm install -g @mainahq/cli"
        exit 11
      fi
      ;;
    yarn)
      info "Installing with yarn..."
      if ! yarn global add @mainahq/cli; then
        error "yarn global add @mainahq/cli failed."
        info "  Try: npm install -g @mainahq/cli"
        exit 11
      fi
      ;;
    npm)
      info "Installing with npm..."
      if ! npm install -g @mainahq/cli; then
        error "npm install -g @mainahq/cli failed."
        info "  Check npm permissions: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally"
        exit 11
      fi
      ;;
    none)
      error "No package manager found. Install one of: bun, npm, pnpm, yarn"
      echo ""
      info "Recommended: curl -fsSL https://bun.sh/install | bash"
      exit 10
      ;;
  esac
}

# Emits the shell-profile hint for the user to add the package-manager's
# global bin directory to PATH. Shell profile and bin directory both depend
# on what the user has — a pure-npm user does not have ~/.bun/bin.
path_hint() {
  local pkg_mgr="$1"
  local shell_name="${SHELL##*/}"
  local profile
  case "$shell_name" in
    zsh)  profile="\$HOME/.zshrc" ;;
    bash) profile="\$HOME/.bashrc" ;;
    fish) profile="\$HOME/.config/fish/config.fish" ;;
    *)    profile="your shell profile" ;;
  esac
  warn "maina was installed globally but is not on PATH in this shell."
  info "  Add the $pkg_mgr global bin directory to PATH in $profile, then open a new shell."
  case "$pkg_mgr" in
    bun)
      if [ "$shell_name" = "fish" ]; then
        dim "    fish_add_path \$HOME/.bun/bin"
      else
        dim "    export PATH=\"\$HOME/.bun/bin:\$PATH\""
      fi
      ;;
    pnpm)
      dim "    # Run \`pnpm bin -g\` to see the directory, then add it to PATH"
      dim "    export PATH=\"\$(pnpm bin -g):\$PATH\""
      ;;
    yarn)
      dim "    export PATH=\"\$(yarn global bin):\$PATH\""
      ;;
    npm)
      dim "    # Run \`npm bin -g\` to see the directory, then add it to PATH"
      dim "    export PATH=\"\$(npm prefix -g)/bin:\$PATH\""
      ;;
    *)
      dim "    # Add your package manager's global bin directory to PATH"
      ;;
  esac
}

# ─── Setup ────────────────────────────────────────────────────────────────

# All configuration is done by the CLI, never by this script: inside a git
# repo `maina setup` onboards the project and registers maina with the AI
# tools it finds; elsewhere `maina mcp add` registers it globally.
run_setup() {
  if git rev-parse --is-inside-work-tree &>/dev/null; then
    info "Git repo detected: $(basename "$(pwd)")"
    if [ -t 0 ]; then
      maina setup
    else
      maina setup --yes
    fi
  else
    dim "Not in a git repo — registering maina with your AI tools globally"
    maina mcp add
    info "Run 'maina setup' inside your project to onboard it"
  fi
}

# ─── Main ─────────────────────────────────────────────────────────────────

main() {
  echo ""
  echo -e "${BOLD}${CYAN}  maina${NC}${BOLD} — verification-first developer OS${NC}"
  echo -e "${DIM}  https://mainahq.com${NC}"
  echo ""

  # Step 1: Detect environment
  step "1. Detecting environment"

  local os
  os=$(detect_os)
  local arch
  arch=$(detect_arch)
  local pkg_mgr
  pkg_mgr=$(detect_pkg_manager)

  success "OS: $os ($arch)"
  success "Package manager: $pkg_mgr"

  # Step 2: Install maina
  step "2. Installing maina CLI"

  if command -v maina &>/dev/null; then
    local current_version
    current_version=$(maina --version 2>/dev/null || echo "unknown")
    success "maina already installed (v$current_version)"
    if prompt_yn "Update to latest?" "y"; then
      install_maina "$pkg_mgr"
    fi
  else
    install_maina "$pkg_mgr"
  fi

  # Verify installation. We do not silently fall back to bunx — if `maina` is
  # not on PATH in a fresh shell, AI agents that spawn subshells cannot find it.
  # The user must resolve the PATH hint or re-run with an alternative package
  # manager.
  if ! command -v maina &>/dev/null; then
    path_hint "$pkg_mgr"
    error "Aborting: global install completed but 'maina' is not on PATH."
    exit 12
  fi
  success "maina $(maina --version 2>/dev/null || echo '') installed"

  # Step 3: Hand over to maina
  step "3. Setting up maina"
  run_setup

  # Done
  echo ""
  echo -e "${BOLD}${GREEN}  Done!${NC}"
  echo ""
  echo -e "  ${BOLD}Next steps:${NC}"
  echo -e "  ${DIM}1.${NC} Open your AI coding tool"
  echo -e "  ${DIM}2.${NC} The maina MCP tools are available automatically"
  echo -e "  ${DIM}3.${NC} Ask: ${CYAN}\"verify my changes\"${NC} or ${CYAN}\"query the wiki about auth\"${NC}"
  echo ""
  echo -e "  ${DIM}Docs:${NC} https://mainahq.com"
  echo -e "  ${DIM}GitHub:${NC} https://github.com/mainahq/maina"
  echo ""
}

main "$@"
