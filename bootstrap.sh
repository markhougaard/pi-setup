#!/usr/bin/env bash
# Idempotent bootstrap for pi-coding-agent + Ollama setup.
# Re-runnable; only takes action when something is missing.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"

log() { printf "\033[1;34m==>\033[0m %s\n" "$*"; }
ok()  { printf "\033[1;32m  ✓\033[0m %s\n" "$*"; }
skip(){ printf "\033[1;33m  •\033[0m %s\n" "$*"; }

# --- 1. Homebrew ---
log "Checking Homebrew"
if command -v brew >/dev/null 2>&1; then
  ok "brew present"
else
  echo "Homebrew is required. Install from https://brew.sh and re-run." >&2
  exit 1
fi

# --- 2. Ollama ---
log "Checking Ollama"
if brew list ollama >/dev/null 2>&1; then
  ok "ollama installed"
else
  brew install ollama
  ok "installed ollama"
fi

if brew services list | awk '$1=="ollama" {print $2}' | grep -q started; then
  ok "ollama service running"
else
  brew services start ollama
  ok "started ollama service"
fi

# Wait for the API to come up
log "Waiting for Ollama API"
for i in {1..30}; do
  if curl -sS -o /dev/null -w "%{http_code}" "$OLLAMA_HOST/api/version" 2>/dev/null | grep -q 200; then
    ok "API responding"
    break
  fi
  sleep 1
done

# --- 3. Node / pi-coding-agent ---
log "Checking pi-coding-agent"
if command -v pi >/dev/null 2>&1; then
  ok "pi present ($(pi --version 2>&1 | head -1))"
else
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm not found. Install Node (e.g. 'brew install node') and re-run." >&2
    exit 1
  fi
  npm install -g @earendil-works/pi-coding-agent
  ok "installed pi-coding-agent"
fi

# --- 4. Base models (pull only if not present) ---
log "Ensuring base models pulled"
need_pull() {
  ! ollama list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$1"
}

for model in "gemma4:e4b" "qwen2.5-coder:14b-instruct-q4_K_M"; do
  if need_pull "$model"; then
    ollama pull "$model"
    ok "pulled $model"
  else
    skip "$model already pulled"
  fi
done

# --- 5. Custom models from Modelfiles ---
log "Building custom models from Modelfiles"
for name in gemma4-fast gemma4-think qwen-coder; do
  ollama create "$name" -f "$REPO_DIR/modelfiles/$name" >/dev/null
  ok "built $name"
done

# --- 6. Pi extensions and keybindings ---
log "Installing Pi extensions"
mkdir -p "$HOME/.pi/agent/extensions"
for ext in ollama.ts think-toggle.ts auto-plan.ts; do
  cp "$REPO_DIR/pi/extensions/$ext" "$HOME/.pi/agent/extensions/$ext"
  ok "$ext"
done

if [ -f "$REPO_DIR/pi/keybindings.json" ]; then
  cp "$REPO_DIR/pi/keybindings.json" "$HOME/.pi/agent/keybindings.json"
  ok "keybindings.json"
fi

# --- 7. LaunchAgent for re-pinning gemma4-fast at login ---
log "Installing LaunchAgent (re-pin at login)"
PRIME_PLIST="$HOME/Library/LaunchAgents/com.markhougaard.ollama-prime.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cp "$REPO_DIR/launchagents/com.markhougaard.ollama-prime.plist" "$PRIME_PLIST"

if launchctl print "gui/$(id -u)/com.markhougaard.ollama-prime" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)" "$PRIME_PLIST" 2>/dev/null || true
fi
launchctl bootstrap "gui/$(id -u)" "$PRIME_PLIST"
ok "LaunchAgent installed and loaded"

# --- 8. Pin gemma4-fast right now (don't wait for next login) ---
log "Pinning gemma4-fast in memory"
curl -sS -X POST "$OLLAMA_HOST/api/generate" \
  -H "Content-Type: application/json" \
  -d '{"model":"gemma4-fast","keep_alive":-1,"prompt":""}' >/dev/null
ok "pinned"

# --- 9. Optional: ollama service env vars (FLASH_ATTENTION, KV cache) ---
log "Note: OLLAMA_FLASH_ATTENTION=1 and OLLAMA_KV_CACHE_TYPE=q8_0 are set"
log "      automatically by Homebrew's ollama plist on install. Verify with:"
log "      ps -axE | grep 'ollama serve' | tr ' ' '\\n' | grep OLLAMA_"

echo
log "Done. Launch pi and use shift+tab to cycle: Fast → Plan → Code"
