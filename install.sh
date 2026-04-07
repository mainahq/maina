#!/bin/bash
# Maina — verification-first developer OS
# Install: curl -fsSL https://api.mainahq.com/install | bash
#
# This script:
# 1. Detects your OS and package manager
# 2. Installs maina CLI
# 3. Detects your installed AI coding tools
# 4. Configures MCP for each tool
# 5. Bootstraps maina in the current repo (optional)

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
  local yn
  if [ "$default" = "y" ]; then
    printf "${BLUE}?${NC} %s ${DIM}[Y/n]${NC} " "$message"
  else
    printf "${BLUE}?${NC} %s ${DIM}[y/N]${NC} " "$message"
  fi
  read -r yn
  yn="${yn:-$default}"
  case "$yn" in
    [Yy]*) return 0 ;;
    *) return 1 ;;
  esac
}

prompt_select() {
  local message="$1"
  shift
  local options=("$@")
  echo -e "${BLUE}?${NC} ${message}"
  local i=1
  for opt in "${options[@]}"; do
    echo -e "  ${BOLD}${i})${NC} ${opt}"
    ((i++))
  done
  printf "${DIM}Enter numbers (comma-separated, or 'all'):${NC} "
  read -r selection
  echo "$selection"
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

# ─── IDE/Tool Detection ──────────────────────────────────────────────────

DETECTED_TOOLS=""
DETECTED_COUNT=0

add_tool() {
  if [ -n "$DETECTED_TOOLS" ]; then
    DETECTED_TOOLS="$DETECTED_TOOLS|$1"
  else
    DETECTED_TOOLS="$1"
  fi
  DETECTED_COUNT=$((DETECTED_COUNT + 1))
}

has_tool() {
  echo "$DETECTED_TOOLS" | tr '|' '\n' | grep -q "^$1$"
}

detect_tools() {
  local os="$1"

  # Claude Code
  if command -v claude &>/dev/null; then
    add_tool "claude-code"
  fi

  # Cursor
  if command -v cursor &>/dev/null || [ -d "$HOME/.cursor" ]; then
    add_tool "cursor"
  elif [ "$os" = "macos" ] && [ -d "/Applications/Cursor.app" ]; then
    add_tool "cursor"
  fi

  # VS Code (Copilot)
  if command -v code &>/dev/null; then
    add_tool "vscode"
  elif [ "$os" = "macos" ] && [ -d "/Applications/Visual Studio Code.app" ]; then
    add_tool "vscode"
  fi

  # Windsurf
  if command -v windsurf &>/dev/null || [ -d "$HOME/.codeium" ]; then
    add_tool "windsurf"
  elif [ "$os" = "macos" ] && [ -d "/Applications/Windsurf.app" ]; then
    add_tool "windsurf"
  fi

  # Zed
  if command -v zed &>/dev/null || [ -d "$HOME/.config/zed" ]; then
    add_tool "zed"
  elif [ "$os" = "macos" ] && [ -d "/Applications/Zed.app" ]; then
    add_tool "zed"
  fi

  # Cline (VS Code extension)
  local vscode_ext_dir="$HOME/.vscode/extensions"
  if ls "$vscode_ext_dir"/saoudrizwan.claude-dev-* &>/dev/null 2>&1; then
    add_tool "cline"
  fi

  # Roo Code (VS Code extension)
  if ls "$vscode_ext_dir"/rooveterinaryinc.roo-cline-* &>/dev/null 2>&1; then
    add_tool "roo"
  fi

  # Continue.dev
  if ls "$vscode_ext_dir"/continue.continue-* &>/dev/null 2>&1 || [ -d "$HOME/.continue" ]; then
    add_tool "continue"
  fi

  # Amazon Q
  if command -v q &>/dev/null || [ -d "$HOME/.aws/amazonq" ]; then
    add_tool "amazon-q"
  fi

  # Gemini CLI
  if command -v gemini &>/dev/null; then
    add_tool "gemini"
  fi

  # Aider
  if command -v aider &>/dev/null; then
    add_tool "aider"
  fi

  # Codex CLI
  if command -v codex &>/dev/null; then
    add_tool "codex"
  fi
}

# ─── MCP Configuration ───────────────────────────────────────────────────

get_mcp_command() {
  local pkg_mgr="$1"
  case "$pkg_mgr" in
    bun) echo "bunx" ;;
    pnpm) echo "pnpx" ;;
    *) echo "npx" ;;
  esac
}

configure_mcp_claude() {
  local cmd="$1"
  local settings_dir="$HOME/.claude"
  local settings_file="$settings_dir/settings.json"

  mkdir -p "$settings_dir"

  if [ -f "$settings_file" ]; then
    # Merge into existing — check if maina already configured
    if grep -q '"maina"' "$settings_file" 2>/dev/null; then
      dim "  Already configured in ~/.claude/settings.json"
      return
    fi
    # Use a simple approach: if mcpServers exists, we need to merge
    # For safety, back up and rewrite
    cp "$settings_file" "$settings_file.bak"
  fi

  cat > "$settings_file" <<JSONEOF
{
  "mcpServers": {
    "maina": {
      "command": "$cmd",
      "args": ["@mainahq/cli", "--mcp"]
    }
  }
}
JSONEOF
  success "  Configured ~/.claude/settings.json"
}

configure_mcp_cursor() {
  local cmd="$1"
  local config_dir="$HOME/.cursor"
  local config_file="$config_dir/mcp.json"

  mkdir -p "$config_dir"

  if [ -f "$config_file" ] && grep -q '"maina"' "$config_file" 2>/dev/null; then
    dim "  Already configured in ~/.cursor/mcp.json"
    return
  fi

  cat > "$config_file" <<JSONEOF
{
  "mcpServers": {
    "maina": {
      "command": "$cmd",
      "args": ["@mainahq/cli", "--mcp"]
    }
  }
}
JSONEOF
  success "  Configured ~/.cursor/mcp.json"
}

configure_mcp_windsurf() {
  local cmd="$1"
  local config_dir="$HOME/.codeium/windsurf"
  local config_file="$config_dir/mcp_config.json"

  mkdir -p "$config_dir"

  if [ -f "$config_file" ] && grep -q '"maina"' "$config_file" 2>/dev/null; then
    dim "  Already configured"
    return
  fi

  cat > "$config_file" <<JSONEOF
{
  "mcpServers": {
    "maina": {
      "command": "$cmd",
      "args": ["@mainahq/cli", "--mcp"]
    }
  }
}
JSONEOF
  success "  Configured ~/.codeium/windsurf/mcp_config.json"
}

configure_mcp_zed() {
  local cmd="$1"
  local config_dir="$HOME/.config/zed"
  local config_file="$config_dir/settings.json"

  mkdir -p "$config_dir"

  if [ -f "$config_file" ] && grep -q '"maina"' "$config_file" 2>/dev/null; then
    dim "  Already configured in zed settings"
    return
  fi

  if [ ! -f "$config_file" ]; then
    cat > "$config_file" <<JSONEOF
{
  "context_servers": {
    "maina": {
      "command": {
        "path": "$cmd",
        "args": ["@mainahq/cli", "--mcp"]
      },
      "source": "custom"
    }
  }
}
JSONEOF
  else
    warn "  Zed settings exist — add maina manually to context_servers in ~/.config/zed/settings.json"
    dim "  Add: \"maina\": { \"command\": { \"path\": \"$cmd\", \"args\": [\"@mainahq/cli\", \"--mcp\"] }, \"source\": \"custom\" }"
    return
  fi
  success "  Configured ~/.config/zed/settings.json"
}

configure_mcp_continue() {
  local cmd="$1"
  local config_dir="$HOME/.continue/mcpServers"

  mkdir -p "$config_dir"

  if [ -f "$config_dir/maina.json" ]; then
    dim "  Already configured in ~/.continue/mcpServers/"
    return
  fi

  cat > "$config_dir/maina.json" <<JSONEOF
{
  "maina": {
    "command": "$cmd",
    "args": ["@mainahq/cli", "--mcp"]
  }
}
JSONEOF
  success "  Configured ~/.continue/mcpServers/maina.json"
}

configure_mcp_vscode() {
  local cmd="$1"
  # Copilot reads from .vscode/mcp.json at project level
  # Global: suggest user adds to settings
  info "  Copilot uses project-level .vscode/mcp.json — run 'maina init' in your repo"
}

configure_mcp_cline() {
  local cmd="$1"
  local os="$1"
  # Cline stores MCP config in VS Code extension globalStorage
  info "  Open Cline sidebar > MCP Servers > Add server:"
  dim "  Command: $cmd @mainahq/cli --mcp"
}

configure_tool() {
  local tool="$1"
  local cmd="$2"

  case "$tool" in
    claude-code) configure_mcp_claude "$cmd" ;;
    cursor) configure_mcp_cursor "$cmd" ;;
    windsurf) configure_mcp_windsurf "$cmd" ;;
    zed) configure_mcp_zed "$cmd" ;;
    continue) configure_mcp_continue "$cmd" ;;
    vscode) configure_mcp_vscode "$cmd" ;;
    cline) configure_mcp_cline "$cmd" ;;
    roo) info "  Roo Code uses project-level .roo/mcp.json — run 'maina init' in your repo" ;;
    amazon-q) info "  Amazon Q uses project-level .amazonq/mcp.json — run 'maina init' in your repo" ;;
    gemini) info "  Gemini CLI uses project-level .mcp.json — run 'maina init' in your repo" ;;
    aider) info "  Aider doesn't support MCP — run 'maina init' for CONVENTIONS.md" ;;
    codex) info "  Codex CLI uses AGENTS.md — run 'maina init' in your repo" ;;
  esac
}

# ─── Installation ─────────────────────────────────────────────────────────

install_maina() {
  local pkg_mgr="$1"

  case "$pkg_mgr" in
    bun)
      info "Installing with bun..."
      bun install -g @mainahq/cli
      ;;
    pnpm)
      info "Installing with pnpm..."
      pnpm install -g @mainahq/cli
      ;;
    yarn)
      info "Installing with yarn..."
      yarn global add @mainahq/cli
      ;;
    npm)
      info "Installing with npm..."
      npm install -g @mainahq/cli
      ;;
    none)
      error "No package manager found. Install one of: bun, npm, pnpm, yarn"
      echo ""
      info "Recommended: curl -fsSL https://bun.sh/install | bash"
      exit 1
      ;;
  esac
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

  # Verify installation
  if ! command -v maina &>/dev/null; then
    # Try with package runner
    local runner
    runner=$(get_mcp_command "$pkg_mgr")
    if $runner @mainahq/cli --version &>/dev/null 2>&1; then
      success "Installed (available via $runner @mainahq/cli)"
    else
      error "Installation failed. Try manually: $pkg_mgr install -g @mainahq/cli"
      exit 1
    fi
  else
    success "maina $(maina --version 2>/dev/null || echo '') installed"
  fi

  # Step 3: Detect AI coding tools
  step "3. Detecting AI coding tools"

  detect_tools "$os"

  if [ "$DETECTED_COUNT" -eq 0 ]; then
    warn "No AI coding tools detected"
    info "Supported: Claude Code, Cursor, Windsurf, VS Code (Copilot), Zed, Continue.dev, Cline, Roo Code, Amazon Q, Gemini CLI, Codex CLI, Aider"
  else
    for tool in $(echo "$DETECTED_TOOLS" | tr '|' ' '); do
      local label
      case "$tool" in
        claude-code) label="Claude Code" ;;
        cursor) label="Cursor" ;;
        vscode) label="VS Code (GitHub Copilot)" ;;
        windsurf) label="Windsurf" ;;
        zed) label="Zed" ;;
        cline) label="Cline" ;;
        roo) label="Roo Code" ;;
        continue) label="Continue.dev" ;;
        amazon-q) label="Amazon Q" ;;
        gemini) label="Gemini CLI" ;;
        aider) label="Aider" ;;
        codex) label="Codex CLI" ;;
        *) label="$tool" ;;
      esac
      success "$label"
    done
  fi

  # Step 4: Configure MCP
  step "4. Configuring MCP servers"

  local mcp_cmd
  mcp_cmd=$(get_mcp_command "$pkg_mgr")

  if [ "$DETECTED_COUNT" -gt 0 ]; then
    if prompt_yn "Configure maina MCP for all detected tools?" "y"; then
      for tool in $(echo "$DETECTED_TOOLS" | tr '|' ' '); do
        info "Setting up ${tool}..."
        configure_tool "$tool" "$mcp_cmd"
      done
    fi
  else
    dim "Skipping MCP configuration (no tools detected)"
  fi

  # Step 5: Initialize in current repo
  step "5. Project setup"

  if [ -d ".git" ]; then
    local repo_name
    repo_name=$(basename "$(pwd)")
    info "Git repo detected: $repo_name"

    if prompt_yn "Initialize maina in this repo?" "y"; then
      if command -v maina &>/dev/null; then
        maina init
      else
        $mcp_cmd @mainahq/cli init
      fi
      success "maina initialized"

      # Optional wiki
      if prompt_yn "Compile codebase knowledge wiki?" "y"; then
        if command -v maina &>/dev/null; then
          maina wiki init
        else
          $mcp_cmd @mainahq/cli wiki init
        fi
        success "Wiki compiled"
      fi
    fi
  else
    dim "Not in a git repo — skipping project setup"
    info "Run 'maina init' inside your project to get started"
  fi

  # Step 6: Verify
  step "6. Verification"

  if [ -d ".maina" ]; then
    if command -v maina &>/dev/null; then
      maina doctor
    else
      $mcp_cmd @mainahq/cli doctor
    fi
  else
    success "Installation complete"
  fi

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
