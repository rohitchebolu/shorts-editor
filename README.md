# claude-shorts

![claude-shorts header](claude-shorts-header.jpeg)

Interactive longform-to-shortform video creator powered by [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Extracts viral-ready vertical clips from long videos using Claude as the intelligent orchestrator with Remotion-rendered premium animated captions.

## How It Works

Claude Code accepts a **YouTube (or any yt-dlp-supported) URL _or_ a local video file**, then guides you through the pipeline:

0. **Fetch** *(URLs only)* - Downloads the source video with yt-dlp (best ≤1080p) to a local file
1. **Preflight** - Validates input video, checks disk space, detects GPU
2. **Transcribe** - GPU-accelerated transcription with word-level timestamps (faster-whisper)
3. **Detect Content** - Auto-classifies: talking-head, screen recording, or podcast
4. **Analyze** - Claude reads the full transcript and scores 8-12 candidate segments
5. **Present** - Shows candidates in a formatted table with scores, hooks, and rationale
6. **Approve** - You pick segments, adjust timecodes, choose caption style and platform
7. **Snap Boundaries** - Aligns cut points to word boundaries, sentence endings, and audio silences
8. **Prepare** - Extracts clips (FFmpeg stream copy) and computes reframe coordinates
9. **Render** - Remotion renders 1080x1920 vertical video with animated captions
10. **Export** - Platform-optimized encoding (YouTube Shorts, TikTok, Instagram Reels)

## Web App (Gemini / Groq — no Claude Code required)

A minimal monorepo (`apps/web` = React UI, `apps/server` = Node orchestrator) turns the pipeline
into a **local web app**, so you can run it **without Claude Code**. The one LLM step (segment
scoring) uses **Gemini or Groq** — chosen from the UI — in place of Claude.

```bash
npm install     # installs the app workspaces (setup-mac.sh also does this)
npm run dev      # starts the API (:8787) and the UI (:5173) together
```

Open **http://localhost:5173**:

1. **Settings** → pick **Gemini** or **Groq**, enter the **model name** + your **API key**, then Save / Test.
2. Paste a **YouTube URL**, choose the Whisper model + backend (use **mlx** on Apple Silicon), click **Start**.
3. Watch the live **stage stepper** — fetch → transcribe → detect → score → snap → reframe → render → export.
4. When scoring completes, **tick the clips** to keep, pick a caption style, click **Render**.
5. **Preview and download** the finished vertical shorts right in the browser.

Your API key is stored locally on the server (`.data/config.json`, gitignored) and is never sent back to the browser.

**Runs on Windows, macOS, and Linux** — the server resolves the venv Python, `ffmpeg`, and `bash`
per-OS. Install the pipeline once (`setup.ps1` on Windows, `setup-mac.sh` on macOS, `setup.sh` on
Linux), then `npm install && npm run dev` anywhere. (Only the pipeline tools are OS-specific; the
React + Node app itself is platform-neutral.)

Architecture: the Node server shells out to the same Python/Remotion pipeline; only the scoring
call is swapped from Claude to your chosen provider via the Vercel AI SDK (`@ai-sdk/google`,
`@ai-sdk/groq`). See [SETUP-MAC.md](SETUP-MAC.md) for the M4 setup.

## Demo

> Demo video/GIF coming soon — showing the full pipeline from input to rendered short with Bold-style captions.

## Features

- **Claude-powered segment scoring** - 5-dimension rubric (hook strength, coherence, emotion, value density, payoff) with weighted scoring. No heuristic keyword matching - Claude understands narrative arcs.
- **3 caption styles** - Bold (ALL CAPS, yellow highlights), Bounce (bouncy spring, rotating colors), Clean (minimal fade-in)
- **Cursor tracking** - For screen recordings, detects mouse cursor via frame differencing and smoothly pans the crop to follow it
- **Audio-aware boundary snapping** - Never cuts mid-word or mid-sentence. Extends to natural sentence endings and silence points.
- **Remotion rendering** - React-based single-pass rendering with spring animations, word-level karaoke highlighting, hook text overlays, and progress bars
- **GPU acceleration** - CUDA for transcription, NVENC for export encoding (falls back to CPU gracefully)

## Prerequisites

- **FFmpeg** (system package)
- **Python 3.10+**
- **Node.js 18+**
- **yt-dlp** (for URL input) + a **JS runtime (deno)** for reliable YouTube extraction
- **Claude Code** (CLI)
- **NVIDIA GPU** optional (CUDA transcription + NVENC encoding; CPU works fine without it)

## Installation

```bash
# Clone the repository
git clone https://github.com/AgriciDaniel/claude-shorts.git
cd claude-shorts

# Install Python + Node.js dependencies
bash setup.sh

# Install as a Claude Code skill
bash install.sh
```

### macOS (Apple Silicon / M-series)

Runs natively — one command. See **[SETUP-MAC.md](SETUP-MAC.md)** for the full guide:

```bash
git clone <YOUR_REPO_URL> claude-shorts && cd claude-shorts
bash setup-mac.sh
```

Add `--backend mlx` for fast `large-v3` transcription on the GPU/Neural Engine (recommended for
non-English audio like **Telugu**). Rendering uses the GPU, so shorts render in well under a minute.

### Windows (native)

This fork runs on **native Windows** — no WSL required. One command sets everything up:

```powershell
powershell -ExecutionPolicy Bypass -File setup.ps1
```

`setup.ps1` creates the Python venv (CPU-only — faster-whisper uses CTranslate2, so **no
PyTorch**), installs the deps, fetches portable **ffmpeg / ffprobe / jq / deno** into
`%USERPROFILE%\.shorts-tools\bin` (added to your user PATH), downloads the MediaPipe
face-detection model, and runs `npm install` for Remotion.

How it works under the hood: the `scripts/run_py.sh` launcher resolves the venv interpreter on
both the Unix (`bin/`) and Windows (`Scripts/`) layouts, and the bash scripts prepend the
portable-tools dir to `PATH` — so the pipeline steps are identical across OSes. (**deno** is a
JS runtime that yt-dlp now needs for reliable YouTube extraction.)

WSL 2 also works if you prefer a Linux environment (`bash setup.sh && bash install.sh`).

### What `setup.sh` does

- Creates a Python virtual environment at `~/.shorts-skill/` (or reuses `~/.video-skill/` if it exists)
- Installs `faster-whisper`, `mediapipe`, `numpy`, `opencv-python`, `yt-dlp` (PyTorch only if an NVIDIA GPU is present — faster-whisper uses CTranslate2, so CPU needs no PyTorch)
- Runs `npm install` in the `remotion/` directory
- Checks for system dependencies (FFmpeg, jq)

> On **native Windows**, use `setup.ps1` instead (see [Windows](#windows-native) below) — it also fetches portable ffmpeg/jq/deno and the MediaPipe face model.

## Usage

In Claude Code, invoke the skill:

```
/shorts
```

Then provide your video file when prompted. Claude will:

1. Transcribe the video
2. Present scored segment candidates
3. Ask which segments to render, caption style, and target platform
4. Render and export the final shorts

### Example Interaction

```
You: /shorts ~/Videos/my-talk.mp4
Claude: [Transcribes, detects content type, scores segments]

| # | Time          | Dur  | Score | Hook                           |
|---|---------------|------|-------|--------------------------------|
| 1 | 04:22 - 05:01 | 39s  | 87    | "Nobody talks about this..."  |
| 2 | 12:45 - 13:28 | 43s  | 82    | "Here's the exact framework." |
| 3 | 08:11 - 08:52 | 41s  | 79    | "I tested this for 6 months." |

Claude: Which segments? Caption style? Platform?
You: 1 and 3, bounce style, youtube

Claude: [Snaps boundaries, extracts clips, renders, exports]
Output: shorts/short_01_yt.mp4, shorts/short_03_yt.mp4
```

### From a YouTube URL

```
You: /shorts https://www.youtube.com/watch?v=VIDEO_ID
Claude: [Downloads with yt-dlp (Step 0), then runs the identical pipeline]
```

Claude downloads the video locally first, then transcribes it with faster-whisper for
word-level timestamps — so YouTube captions are **not** required and the caption animation
stays precise.

> **⚠️ Terms of Service:** Downloading third-party videos may be restricted by YouTube's
> Terms of Service and by the source's copyright. You are responsible for having the rights
> to download, edit, and re-publish anything you process. Use only with content you own or
> are licensed to use.

## Project Structure

```
claude-shorts/
├── SKILL.md                           # Interactive pipeline, Steps 0–10 (Claude Code skill)
├── CLAUDE.md                          # Project-level instructions
├── install.sh                         # Install to ~/.claude/skills/
├── setup.sh                           # Python + Node dependency installer (Linux/macOS)
├── setup.ps1                          # Native-Windows dependency installer
│
├── scripts/
│   ├── ytdlp_fetch.py                 # Step 0: YouTube/URL → local MP4 (yt-dlp)
│   ├── run_py.sh                      # Cross-platform venv Python launcher (bin/ ↔ Scripts/)
│   ├── transcribe.py                  # faster-whisper transcription (word-level timestamps)
│   ├── detect_content.py              # MediaPipe content type classifier
│   ├── face_detect.py                 # Shared MediaPipe Tasks face-detector wrapper
│   ├── compute_reframe.py             # Face tracking + cursor tracking + crop
│   ├── snap_boundaries.py             # Audio-aware boundary snapping
│   ├── preflight.sh                   # Input validation + disk space check
│   ├── detect_gpu.sh                  # NVIDIA NVENC detection
│   └── export.sh                      # Platform-specific FFmpeg encoding
│
├── remotion/
│   ├── package.json                   # Remotion v4 + React 19 + Zod
│   ├── render.mjs                     # Bundle-once-render-many orchestrator
│   ├── remotion.config.ts
│   └── src/
│       ├── Root.tsx                   # Composition registry
│       ├── ShortVideo.tsx             # Main composition
│       ├── types.ts                   # Zod schemas for props
│       ├── components/
│       │   ├── VideoFrame.tsx         # Reframed video with animated crop pan
│       │   ├── Captions.tsx           # Style dispatcher
│       │   ├── BoldCaptions.tsx        # Bold ALL CAPS, pop-in spring
│       │   ├── BounceCaptions.tsx     # Bouncy scale, bright colors
│       │   ├── CleanCaptions.tsx      # Minimal fade-in
│       │   ├── HookOverlay.tsx        # First 3.5s hook text
│       │   └── ProgressBar.tsx        # Bottom progress indicator
│       ├── hooks/
│       │   └── useCaptionPages.ts     # @remotion/captions TikTok-style pages
│       └── styles/
│           ├── fonts.ts               # @font-face declarations
│           └── theme.ts               # Color palettes per style
│
└── references/
    ├── scoring-rubric.md              # 5-dimension scoring criteria
    ├── caption-styles.md              # Visual specs + spring configs
    ├── platform-specs.md              # YouTube/TikTok/Instagram encoding
    └── remotion-patterns.md           # Remotion best practices
```

## Caption Styles

| Style | Font | Animation | Best For |
|-------|------|-----------|----------|
| **Bold** | Montserrat Bold | Pop-in spring, yellow active word | Business, education |
| **Bounce** | Bangers | Bouncy scale 70-120-100%, rotating colors | Entertainment, energy |
| **Clean** | Inter Bold | Fade-in opacity, white + shadow | Professional, interviews |

## Platform Export Specs

| Platform | Codec | Bitrate | Audio |
|----------|-------|---------|-------|
| **YouTube Shorts** | H.264 High 4.2 | 12 Mbps | AAC 192k |
| **TikTok** | H.264 | CRF 18, -preset slow | AAC 128k |
| **Instagram Reels** | H.264 High 4.2 | 4.5 Mbps (max 5000k) | AAC 128k |

## Content Type Strategies

| Content Type | Reframe Strategy | Zoom |
|--------------|-----------------|------|
| **Talking-head** | Face-tracked center crop (MediaPipe) | 9:16 exact |
| **Screen recording** | Cursor-tracked pan with moderate zoom | 55% of source width |
| **Podcast** | Dominant speaker tracking | 9:16 exact |

## Dependencies

### Python (installed via `setup.sh`)
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) - GPU-accelerated Whisper
- [mediapipe](https://mediapipe.dev/) - Face detection for content classification + reframing
- [numpy](https://numpy.org/) - Array operations for cursor tracking smoothing
- [opencv-python](https://opencv.org/) - Frame differencing for cursor detection

### Node.js (installed via `setup.sh`)
- [Remotion v4](https://remotion.dev/) - React-based video rendering
- [@remotion/captions](https://remotion.dev/docs/captions) - TikTok-style word-level captions
- [React 19](https://react.dev/) - Component framework
- [Zod](https://zod.dev/) - Runtime type validation for props

### Fonts

Caption fonts are bundled from Google Fonts under the [SIL Open Font License](remotion/public/fonts/OFL.txt):
- Montserrat Bold (Bold style)
- Bangers Regular (Bounce style)
- Inter Bold (Clean style)
- Noto Sans Telugu (Telugu / Telugu-English fallback in all styles — renders mixed-script captions)

### System
- [FFmpeg](https://ffmpeg.org/) - Audio extraction, segment cutting, export encoding
- [jq](https://jqlang.github.io/jq/) - JSON processing in shell scripts

## How Segment Scoring Works

Claude scores each candidate on 5 weighted dimensions:

| Dimension | Weight | What Claude Looks For |
|-----------|--------|----------------------|
| Hook Strength | 0.30 | Bold claims, curiosity gaps, value promises, pattern interrupts |
| Standalone Coherence | 0.25 | Makes complete sense without any context from the rest of the video |
| Emotional Intensity | 0.20 | Strong opinions, surprise reveals, humor, passion |
| Value Density | 0.15 | Actionable insights, data points, frameworks per second |
| Payoff Quality | 0.10 | Satisfying conclusion - punchline, reveal, call-to-action |

Final score = weighted sum, scale 0-100. Minimum threshold: 60.

## Support

- **Issues**: [GitHub Issues](https://github.com/AgriciDaniel/claude-shorts/issues)
- **Discussions**: [GitHub Discussions](https://github.com/AgriciDaniel/claude-shorts/discussions)

## License

[MIT](LICENSE)

---

## Author

Built by [Agrici Daniel](https://agricidaniel.com/about) - AI Workflow Architect.

- [Blog](https://agricidaniel.com/blog) - Deep dives on AI marketing automation
- [AI Marketing Hub](https://www.skool.com/ai-marketing-hub) - Free community, 2,800+ members
- [YouTube](https://www.youtube.com/@AgriciDaniel) - Tutorials and demos
- [All open-source tools](https://github.com/AgriciDaniel)
