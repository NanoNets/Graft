#!/usr/bin/env sh
# Context Graph Engine — one-line installer.
#
# Two ways to use it:
#   1. From a checkout:  ./install.sh          (builds THIS directory — no re-clone)
#   2. Over the network: curl -fsSL https://raw.githubusercontent.com/NanoNets/context-graph-engine/main/install.sh | sh
#
# Either way it builds the project and puts the `context-graph` command on your
# PATH. Requires git, Node >= 20, and npm.
#
# Environment overrides:
#   CGE_REPO   git URL to clone from      (default: the NanoNets repo below)
#   CGE_REF    branch/tag/commit to fetch (default: main)
#   CGE_HOME   where to clone into        (default: ~/.context-graph-engine)
set -eu

REPO_URL="${CGE_REPO:-https://github.com/NanoNets/context-graph-engine.git}"
REF="${CGE_REF:-main}"
INSTALL_DIR="${CGE_HOME:-$HOME/.context-graph-engine}"

info() { printf '\033[1;36m›\033[0m %s\n' "$1"; }
err()  { printf '\033[1;31m✗ %s\033[0m\n' "$1" >&2; }

need() {
  command -v "$1" >/dev/null 2>&1 || { err "'$1' is required but not installed. $2"; exit 1; }
}

need node "Install Node.js >= 20 from https://nodejs.org and re-run."
need npm  "Install npm (bundled with Node.js) and re-run."

# Enforce Node >= 20.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Node.js >= 20 is required (found $(node -v)). Upgrade and re-run."
  exit 1
fi

# If this script lives inside a checkout of the project, build that in place
# rather than cloning (works offline and for private repos). Detected by a
# sibling package.json naming this package. When piped via `curl | sh` there is
# no script file on disk, so this check falls through to the clone path.
SCRIPT_DIR=""
case "${0:-}" in
  */*) SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" 2>/dev/null && pwd) || SCRIPT_DIR="" ;;
esac

if [ -n "$SCRIPT_DIR" ] && grep -q '"context-graph-engine"' "$SCRIPT_DIR/package.json" 2>/dev/null; then
  INSTALL_DIR="$SCRIPT_DIR"
  info "Installing from local checkout at $INSTALL_DIR"
else
  need git "Install git and re-run."
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Updating existing install at $INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$REF"
    git -C "$INSTALL_DIR" checkout -q "$REF"
    git -C "$INSTALL_DIR" reset --hard -q "origin/$REF" 2>/dev/null || true
  else
    info "Cloning $REPO_URL → $INSTALL_DIR"
    git clone --depth 1 --branch "$REF" "$REPO_URL" "$INSTALL_DIR"
  fi
fi

info "Installing dependencies"
( cd "$INSTALL_DIR" && npm install --silent )

info "Building"
( cd "$INSTALL_DIR" && npm run build --silent )

info "Linking the 'context-graph' command"
( cd "$INSTALL_DIR" && npm link >/dev/null 2>&1 )

echo
info "Installed. Try it in any repo:"
cat <<'NEXT'

  Build the graph, then commit it:
          cd your-repo
          context-graph init          # writes .context/*.md from your code
          git add .context && git commit -m "add context graph"

  Keep it honest in CI:
          context-graph check         # exits non-zero if the graph is stale

  Runs locally out of the box:
    • Extraction/summaries default to a local Ollama model. Install Ollama and
      pull one:  https://ollama.com   then   ollama pull llama3.2
    • Prefer cloud quality? Set a key and it's used automatically:
          export OPENROUTER_API_KEY=sk-or-...
NEXT
