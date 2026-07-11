#!/usr/bin/env python3
"""Step 0: Fetch a YouTube (or any yt-dlp-supported) video to a local file.

Downloads the best <=1080p video + best audio, muxes to a single MP4 the rest of
the shorts pipeline consumes exactly like a local INPUT_FILE. Also writes source
metadata (id, title, duration, uploader) so later steps / captions can reference it.

Transcription is still done by faster-whisper on the downloaded audio (word-level
timestamps), so we intentionally do NOT rely on YouTube's own captions here.

Usage:
    python3 ytdlp_fetch.py <URL> --output /tmp/claude-shorts/input.mp4
    python3 ytdlp_fetch.py <URL> --output ... --max-height 720

On success, prints the absolute path of the downloaded file on the LAST stdout line
(so an orchestrator can capture it), plus a JSON summary. Exits non-zero with a clear
message on private / age-restricted / geo-blocked / unavailable videos.
"""
import argparse
import json
import os
import shutil
import sys


def find_ffmpeg_location():
    """Return a directory containing ffmpeg for yt-dlp muxing, or None to use PATH."""
    # Already on PATH?
    if shutil.which("ffmpeg"):
        return None
    # Portable install used by the native-Windows setup.
    candidate = os.path.join(os.path.expanduser("~"), ".shorts-tools", "bin")
    if os.path.isfile(os.path.join(candidate, "ffmpeg.exe")) or os.path.isfile(
        os.path.join(candidate, "ffmpeg")
    ):
        return candidate
    return None


def main():
    parser = argparse.ArgumentParser(description="Fetch a video URL to a local MP4")
    parser.add_argument("url", help="Video URL (YouTube, etc.)")
    parser.add_argument("--output", required=True, help="Output MP4 path")
    parser.add_argument(
        "--max-height", type=int, default=1080, help="Max video height (default 1080)"
    )
    parser.add_argument(
        "--meta-output",
        default=None,
        help="Where to write source metadata JSON (default: <output_dir>/source_meta.json)",
    )
    args = parser.parse_args()

    try:
        from yt_dlp import YoutubeDL
        from yt_dlp.utils import DownloadError
    except ImportError:
        print(
            json.dumps(
                {
                    "error": "yt-dlp is not installed. Run: pip install yt-dlp "
                    "(or `bash setup.sh`)."
                }
            ),
            file=sys.stderr,
        )
        sys.exit(2)

    out_path = os.path.abspath(args.output)
    out_dir = os.path.dirname(out_path)
    os.makedirs(out_dir, exist_ok=True)

    meta_path = args.meta_output or os.path.join(out_dir, "source_meta.json")

    # bv*[height<=H]+ba -> best video within height cap plus best audio, fall back to
    # a pre-muxed best[] if separate streams are unavailable.
    fmt = f"bv*[height<={args.max_height}]+ba/b[height<={args.max_height}]/b"

    ydl_opts = {
        "format": fmt,
        "merge_output_format": "mp4",
        "outtmpl": out_path,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "retries": 3,
        "fragment_retries": 3,
        # Re-mux to mp4 if the merged container isn't already mp4.
        "postprocessors": [
            {"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"},
        ],
    }
    ffloc = find_ffmpeg_location()
    if ffloc:
        ydl_opts["ffmpeg_location"] = ffloc

    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(args.url, download=True)
    except DownloadError as e:
        msg = str(e)
        hint = ""
        low = msg.lower()
        if "private" in low:
            hint = " (video is private)"
        elif "age" in low and "restrict" in low:
            hint = " (age-restricted — may need cookies)"
        elif "not available" in low or "geo" in low or "blocked" in low:
            hint = " (unavailable or geo-blocked in this region)"
        print(
            json.dumps({"error": f"Download failed{hint}: {msg}"}),
            file=sys.stderr,
        )
        sys.exit(1)
    except Exception as e:  # noqa: BLE001 - surface any unexpected failure clearly
        print(json.dumps({"error": f"Unexpected error: {e}"}), file=sys.stderr)
        sys.exit(1)

    # yt-dlp may have adjusted the extension during remux; find the real file.
    final_path = out_path
    if not os.path.isfile(final_path):
        stem, _ = os.path.splitext(out_path)
        for ext in (".mp4", ".mkv", ".webm"):
            if os.path.isfile(stem + ext):
                final_path = stem + ext
                break

    if not os.path.isfile(final_path):
        print(
            json.dumps({"error": f"Download reported success but no file at {out_path}"}),
            file=sys.stderr,
        )
        sys.exit(1)

    meta = {
        "id": info.get("id"),
        "title": info.get("title"),
        "duration": info.get("duration"),
        "uploader": info.get("uploader"),
        "channel": info.get("channel"),
        "webpage_url": info.get("webpage_url", args.url),
        "width": info.get("width"),
        "height": info.get("height"),
        "local_path": final_path,
    }
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    summary = {
        "ok": True,
        "local_path": final_path,
        "meta_path": meta_path,
        "title": meta["title"],
        "duration": meta["duration"],
    }
    print(json.dumps(summary, indent=2))
    # Last line = the local path, easy for the orchestrator to capture.
    print(final_path)


if __name__ == "__main__":
    main()
