#!/usr/bin/env bash
# One-command setup for Apple Silicon Macs (M1/M2/M3/M4).
#
# The base skill is Unix-native, so macOS needs far less special-casing than Windows:
# standard bin/ venv, python3, Homebrew for ffmpeg/jq/deno/node. This script also installs
# the optional MLX Whisper backend, which runs on the Mac's GPU/Neural Engine and makes
# large-v3 transcription (needed for Telugu and other non-English audio) fast.
#
# Usage:  bash setup-mac.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "=== claude-shorts setup (Apple Silicon) ==="

# --- 0. Sanity: Apple Silicon + Homebrew ---
if [ "$(uname -s)" != "Darwin" ]; then
    echo "This script is for macOS. On Linux use setup.sh; on Windows use setup.ps1." >&2
    exit 1
fi
ARCH="$(uname -m)"
if [ "$ARCH" != "arm64" ]; then
    echo "WARNING: expected arm64 (Apple Silicon), found $ARCH. MLX will be skipped." >&2
fi
if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew not found. Install it first: https://brew.sh" >&2
    exit 1
fi

# --- 1. System tools via Homebrew ---
echo "[brew] installing ffmpeg, jq, deno, node (skips if already present)..."
for pkg in ffmpeg jq deno node; do
    if brew list --formula "$pkg" >/dev/null 2>&1; then
        echo "  $pkg already installed"
    else
        brew install "$pkg"
    fi
done
# deno = JS runtime yt-dlp needs for reliable YouTube extraction.

# --- 2. Python venv + deps (CPU/Metal; no PyTorch needed) ---
VENV="$HOME/.shorts-skill"
if [ ! -x "$VENV/bin/python3" ]; then
    echo "[python] creating venv at $VENV ..."
    python3 -m venv "$VENV"
fi
echo "[python] installing dependencies ..."
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet -r "$SCRIPT_DIR/requirements.txt"

# Optional: MLX Whisper — Apple GPU/Neural Engine transcription (fast large-v3).
if [ "$ARCH" = "arm64" ]; then
    echo "[python] installing mlx-whisper (Apple Silicon fast transcription) ..."
    "$VENV/bin/pip" install --quiet mlx-whisper || \
        echo "  (mlx-whisper install failed — the default faster-whisper backend still works)"
fi

"$VENV/bin/python3" -c "import faster_whisper, mediapipe, cv2, numpy, yt_dlp; print('[python] core imports OK')"

# --- 3. MediaPipe face model (also auto-downloads on first use) ---
MODELS="$HOME/.shorts-tools/models"
mkdir -p "$MODELS"
MODEL="$MODELS/blaze_face_short_range.tflite"
if [ ! -f "$MODEL" ]; then
    echo "[model] downloading blaze_face_short_range.tflite ..."
    curl -L -sS -o "$MODEL" \
        "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
fi

# --- 4. Node: web app (monorepo) + Remotion ---
echo "[node] installing web-app (React UI + server) dependencies ..."
( cd "$SCRIPT_DIR" && npm install --silent )
echo "[node] installing Remotion dependencies ..."
( cd "$SCRIPT_DIR/remotion" && npm install --silent )

echo ""
echo "=== Setup complete ==="
echo "Venv:   $VENV"
echo ""
echo "Start the web app (no Claude needed):   npm run dev"
echo "  then open http://localhost:5173, add your Gemini/Groq key in Settings, paste a URL."
echo ""
echo "Fast transcription on this Mac:  choose backend 'mlx' (e.g. model large-v3) in the UI."
echo "CLI alternative:  bash scripts/run_py.sh <script.py> ...   or  /shorts <url> in Claude Code."
