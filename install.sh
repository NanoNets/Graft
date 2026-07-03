#!/usr/bin/env sh
# Context Graph Engine — one-line installer.
#
#   curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/context-graph-engine/main/install.sh | sh
#
# Clones the repo, builds it, and puts the `context-graph` and
# `context-graph-mcp` commands on your PATH. Requires git, Node >= 20, and npm.
#
# Environment overrides:
#   CGE_REPO   git URL to install from   (default: the YOUR_ORG repo below)
#   CGE_REF    branch/tag/commit to check out (default: main)
#   CGE_HOME   where to install           (default: ~/.context-graph-engine)
set -eu

# ---- EDIT THIS to point at your published repository -------------------------
REPO_URL="${CGE_REPO:-https://github.com/YOUR_ORG/context-graph-engine.git}"
# ------------------------------------------------------------------------------
REF="${CGE_REF:-main}"
INSTALL_DIR="${CGE_HOME:-$HOME/.context-graph-engine}"

info() { printf '\033[1;36m›\033[0m %s\n' "$1"; }
err()  { printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2; }

need() {
  command -v "$1" >/dev/null 2>&1 || { err "'$1' is required but not installed. $2"; exit 1; }
}

need git  "Install git and re-run."
need node "Install Node.js >= 20 from https://nodejs.org and re-run."
need npm  "Install npm (bundled with Node.js) and re-run."

# Enforce Node >= 20.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Node.js >= 20 is required (found $(node -v)). Upgrade and re-run."
  exit 1
fi

if [ -d "$INSTALL_DIR/.git" ]; then
  info "Updating existing install at $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$REF"
  git -C "$INSTALL_DIR" checkout -q "$REF"
  git -C "$INSTALL_DIR" reset --hard -q "origin/$REF" 2>/dev/null || true
else
  info "Cloning $REPO_URL → $INSTALL_DIR"
  git clone --depth 1 --branch "$REF" "$REPO_URL" "$INSTALL_DIR"
fi

info "Installing dependencies"
( cd "$INSTALL_DIR" && npm install --silent )

info "Building"
( cd "$INSTALL_DIR" && npm run build --silent )

info "Linking the 'context-graph' and 'context-graph-mcp' commands"
( cd "$INSTALL_DIR" && npm link >/dev/null 2>&1 )

echo
info "Installed. Try:  context-graph --help"
cat <<'NEXT'

  Runs locally out of the box:
    • Embeddings run in-process (no key, no server — model downloads on first use).
    • Extraction defaults to a local Ollama model. Install Ollama and pull one:
          https://ollama.com   then   ollama pull llama3.2

  Prefer higher-quality cloud extraction? Set keys and it's used automatically:
          export ANTHROPIC_API_KEY=sk-ant-...     # extraction
          export OPENAI_API_KEY=sk-...            # embeddings (optional)

  Quick start:
          echo "Our billing worker retries failed charges 3x then marks past_due." \
            | context-graph ingest-text --title "Billing"
          context-graph query "how are failed charges handled?"
NEXT
