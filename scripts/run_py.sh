#!/usr/bin/env bash
# Cross-platform launcher: runs a Python script (+args) with the project's venv Python.
#
# The base skill was written for Linux/macOS, where the venv lives in "$VENV/bin".
# On native Windows the venv lives in "$VENV/Scripts". This launcher resolves either
# layout so the SKILL.md steps stay identical across platforms.
#
# Usage: bash scripts/run_py.sh <script.py> [args...]
set -euo pipefail

# Make portable ffmpeg/ffprobe/jq discoverable (native Windows install path).
# Python scripts shell out to ffmpeg, so exporting PATH here covers their subprocesses too.
if [ -d "$HOME/.shorts-tools/bin" ]; then
    export PATH="$HOME/.shorts-tools/bin:$PATH"
fi

# Force UTF-8 I/O so non-Latin transcripts (e.g. Telugu) never crash on Windows'
# cp1252 default console/stdout encoding.
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8

# Locate the venv: project-local uv venv (.venv) first, then the shared skill venvs.
VENV="${SHORTS_VENV:-}"
if [ -z "${VENV}" ]; then
    ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
    if [ -d "$ROOT/.venv" ]; then
        VENV="$ROOT/.venv"
    elif [ -d "$HOME/.video-skill" ]; then
        VENV="$HOME/.video-skill"
    else
        VENV="$HOME/.shorts-skill"
    fi
fi

# Resolve the venv python: Linux/macOS -> bin/, Windows -> Scripts/.
if [ -x "$VENV/bin/python3" ]; then
    PY="$VENV/bin/python3"
elif [ -x "$VENV/bin/python" ]; then
    PY="$VENV/bin/python"
elif [ -f "$VENV/Scripts/python.exe" ]; then
    PY="$VENV/Scripts/python.exe"
else
    # Last resort: whatever python3 is on PATH.
    PY="$(command -v python3 || command -v python)"
fi

exec "$PY" "$@"
