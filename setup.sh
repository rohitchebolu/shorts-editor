#!/usr/bin/env bash
# Setup dependencies for claude-shorts
# Usage: bash setup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== claude-shorts dependency setup ==="
echo ""

# --- Python dependencies via uv (fast; creates ./.venv from pyproject.toml + uv.lock) ---

if ! command -v uv >/dev/null 2>&1; then
    echo "[uv] Installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.local/bin:$PATH"
fi

echo "[Python] uv sync..."
cd "$SCRIPT_DIR"
uv sync
uv run python -c "import faster_whisper, mediapipe, cv2, numpy, yt_dlp; print('[Python] imports OK')"
echo ""

# --- Node.js: web app + Remotion ---

echo "[Node] Installing web-app (React UI + server) dependencies..."
( cd "$SCRIPT_DIR" && npm install --silent )

echo "[Node] Setting up Remotion project..."

if [ ! -f "$SCRIPT_DIR/remotion/package.json" ]; then
    echo "[Node] ERROR: remotion/package.json not found"
    echo "       Run this script from the claude-shorts project root"
    exit 1
fi

cd "$SCRIPT_DIR/remotion"

if [ -d "node_modules" ]; then
    echo "[Node] node_modules exists — running npm install to check for updates..."
else
    echo "[Node] Installing Remotion dependencies..."
fi

npm install --silent 2>&1 | tail -1 || npm install

echo "[Node] Remotion ready"
echo ""

# --- System Dependencies ---

MISSING=()

if ! command -v ffmpeg &>/dev/null; then
    MISSING+=("ffmpeg")
fi

if ! command -v jq &>/dev/null; then
    MISSING+=("jq")
fi

if [ ${#MISSING[@]} -gt 0 ]; then
    echo "[System] Missing packages: ${MISSING[*]}"
    echo "[System] Install with: sudo apt install ${MISSING[*]}"
else
    echo "[System] All system dependencies present (ffmpeg, jq)"
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Python venv: ./.venv  (managed by uv — 'uv sync' to update)"
echo "Remotion:    $SCRIPT_DIR/remotion/"
echo ""
echo "Start the web app:  npm run dev   (UI on :5173)"
echo "Or invoke /shorts in Claude Code."
