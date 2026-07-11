# Setup — Mac Mini M4 (Apple Silicon)

The pipeline is Unix-native, so it runs cleanly on macOS. The M-series chip also makes the two
slow stages fast: **rendering** (GPU) and **transcription** (MLX on the GPU/Neural Engine — which
finally makes `large-v3` practical, and it's what non-English audio like **Telugu** needs).

## 1. Prerequisites

- macOS on Apple Silicon (M1/M2/M3/**M4**)
- [Homebrew](https://brew.sh) — `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`
- [Claude Code](https://docs.claude.com/en/docs/claude-code) (the LLM scoring runs inside Claude Code — **no Anthropic API key needed**)

## 2. Install (one command)

```bash
git clone <YOUR_REPO_URL> claude-shorts
cd claude-shorts
bash setup-mac.sh
```

`setup-mac.sh` installs everything:
- **Homebrew:** `ffmpeg`, `jq`, `deno` (JS runtime yt-dlp needs for YouTube), `node`
- **Python venv** at `~/.shorts-skill` with `faster-whisper`, `mediapipe`, `opencv`, `numpy`, `yt-dlp`
  (CPU/Metal — **no PyTorch**), plus **`mlx-whisper`** for fast Apple-Silicon transcription
- MediaPipe **face model** → `~/.shorts-tools/models/`
- **Remotion** node deps (`npm install`)

Then install the skill (optional — you can also run from the project folder):

```bash
bash install.sh   # copies the skill to ~/.claude/skills/shorts
```

## 3. Run it

In Claude Code:

```
/shorts https://www.youtube.com/watch?v=VIDEO_ID
```

Claude downloads the video, transcribes, scores segments for retention, shows a ranked table for
your approval, then renders + exports the vertical short(s).

## 4. Fast transcription (use the M4's GPU)

Add **`--backend mlx`** to run Whisper on the Neural Engine instead of the CPU. This is the
recommended default on the M4 — especially for `large-v3`:

```bash
bash scripts/run_py.sh scripts/transcribe.py INPUT.mp4 \
    --output out.json --model large-v3 --backend mlx
```

| Backend | Where it runs | Speed on M4 | Use for |
|---|---|---|---|
| `faster-whisper` (default) | CPU (ARM) | good | English, quick passes |
| `mlx` | GPU / Neural Engine | **much faster** | `large-v3`, non-English (Telugu), batch work |

> First MLX run downloads the model from Hugging Face (`mlx-community/whisper-large-v3-mlx`).
> If a model repo name errors, pass an exact repo, e.g. `--model mlx-community/whisper-large-v3-mlx`.

## 5. Telugu / Telugu-English (Tinglish) content

- **Captions already render** Telugu + English mixed (Noto Sans Telugu is bundled as a per-glyph
  fallback in every style — no setup needed).
- **Transcription needs the big model:** small/base produce gibberish for Telugu. Use
  `--model large-v3 --backend mlx` — fast on the M4, and the only setting that gives usable Telugu.
- Background music hurts accuracy; cleaner speech transcribes far better.

## 6. Performance notes (M4 vs a CPU-only box)

- **Rendering:** Remotion uses the GPU — expect well under a minute per short (vs several minutes CPU-only).
- **Transcription:** `--backend mlx` with `large-v3` runs many× faster than CPU `faster-whisper`.
- No NVIDIA/NVENC on Mac; export uses CPU H.264 (fast enough at short lengths).

## 7. Troubleshooting

- **`mediapipe` install fails:** ensure you're on arm64 Python (`python3 -c "import platform;print(platform.machine())"` → `arm64`). If a wheel is missing, try `pip install mediapipe-silicon`.
- **`mlx-whisper` missing / errors:** it's optional — the default `faster-whisper` backend still works. Reinstall with `~/.shorts-skill/bin/pip install -U mlx-whisper`.
- **yt-dlp "Video unavailable":** make sure `deno` is installed (`brew install deno`) — yt-dlp needs a JS runtime for YouTube.
- **First render downloads a Chrome Headless Shell (~100 MB):** one-time, cached afterward.

## Cross-platform note

- **Linux:** `bash setup.sh` · **Windows (native):** `setup.ps1` (see README). The `scripts/run_py.sh`
  launcher resolves the venv on every OS, so the pipeline steps are identical.
