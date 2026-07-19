#!/usr/bin/env python3
"""Transcribe video with faster-whisper, output dual-format JSON.

Produces both WhisperX-style segments (for Claude to read) and
Remotion-native captions (for rendering with @remotion/captions).

Usage:
    python3 transcribe.py INPUT_VIDEO --output transcript.json
    python3 transcribe.py INPUT_VIDEO --output transcript.json --model large-v3
    python3 transcribe.py INPUT_VIDEO --output transcript.json --model small  # low VRAM

Output JSON:
{
    "language": "en",
    "duration": 3600.0,
    "word_count": 12000,
    "segments": [
        {
            "start": 0.0, "end": 4.5,
            "text": "Hello and welcome to the show",
            "words": [
                {"word": "Hello", "start": 0.0, "end": 0.3},
                {"word": "and", "start": 0.35, "end": 0.5},
                ...
            ]
        },
        ...
    ],
    "captions": [
        {"text": "Hello", "startMs": 0, "endMs": 300},
        {"text": " and", "startMs": 350, "endMs": 500},
        ...
    ]
}
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import unicodedata

# Optional Telugu -> Latin romanization for Tenglish captions. Pure-Python (no torch);
# if the package is missing we silently leave text in Telugu script.
try:
    from indic_transliteration import sanscript as _sanscript
    from indic_transliteration.sanscript import transliterate as _translit
    _HAS_XLIT = True
except Exception:
    _HAS_XLIT = False


def romanize_te(text):
    """Telugu script -> casual romanized Telugu (Tenglish). Non-Telugu characters
    (spaces, English words, punctuation) pass through unchanged, so per-word caption
    timings are preserved when callers romanize each token."""
    if not _HAS_XLIT or not text:
        return text
    s = _translit(text, _sanscript.TELUGU, _sanscript.ITRANS)
    s = re.sub(r"M([pbm])", r"m\1", s)  # anusvara: 'm' before labials, else 'n'
    s = s.replace("M", "n").replace("~N", "n").replace("~n", "n")
    s = re.sub(r"\.([nmh])", r"\1", s)
    s = s.replace("H", "h")
    s = "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)).lower()
    return s


def extract_audio(video_path, audio_path):
    """Extract audio from video as 16kHz mono WAV."""
    cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        audio_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(json.dumps({"error": f"Audio extraction failed: {result.stderr[-300:]}"}))
        sys.exit(1)


def transcribe(audio_path, model_size="large-v3", device="auto", compute_type="auto", language=None):
    """Run faster-whisper transcription with word-level timestamps."""
    from faster_whisper import WhisperModel

    # Auto-detect device
    if device == "auto":
        try:
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            device = "cpu"

    # Auto-detect compute type
    if compute_type == "auto":
        compute_type = "float16" if device == "cuda" else "int8"

    model = WhisperModel(model_size, device=device, compute_type=compute_type)

    segments_iter, info = model.transcribe(
        audio_path,
        language=language,
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters=dict(
            min_silence_duration_ms=500,
            speech_pad_ms=200,
        ),
    )

    segments = []
    captions = []

    for segment in segments_iter:
        seg_data = {
            "start": round(segment.start, 3),
            "end": round(segment.end, 3),
            "text": segment.text.strip(),
            "words": [],
        }

        if segment.words:
            for word in segment.words:
                seg_data["words"].append({
                    "word": word.word.strip(),
                    "start": round(word.start, 3),
                    "end": round(word.end, 3),
                })

                # Remotion caption format: {text, startMs, endMs}
                # faster-whisper preserves leading spaces in word.word
                captions.append({
                    "text": word.word,
                    "startMs": int(word.start * 1000),
                    "endMs": int(word.end * 1000),
                })

        segments.append(seg_data)

    return segments, captions, info, device, compute_type


# Short model name -> mlx-community HF repo. A value containing "/" is used as-is,
# so you can pass a specific repo (e.g. --model mlx-community/whisper-large-v3-mlx).
MLX_MODEL_MAP = {
    "tiny": "mlx-community/whisper-tiny",
    "base": "mlx-community/whisper-base",
    "small": "mlx-community/whisper-small",
    "medium": "mlx-community/whisper-medium",
    "large-v3": "mlx-community/whisper-large-v3-mlx",
    "large-v3-turbo": "mlx-community/whisper-large-v3-turbo",
}


def transcribe_mlx(audio_path, model="large-v3", language=None):
    """Transcribe on Apple Silicon via MLX (GPU / Neural Engine) — fast large-v3.

    Returns the same (segments, captions, info, device, compute_type) shape as
    transcribe() so main() stays backend-agnostic.
    """
    import mlx_whisper
    from types import SimpleNamespace

    repo = model if "/" in model else MLX_MODEL_MAP.get(model, f"mlx-community/whisper-{model}")

    result = mlx_whisper.transcribe(
        audio_path,
        path_or_hf_repo=repo,
        word_timestamps=True,
        language=language,
    )

    segments = []
    captions = []
    for seg in result.get("segments", []):
        seg_data = {
            "start": round(float(seg.get("start", 0.0)), 3),
            "end": round(float(seg.get("end", 0.0)), 3),
            "text": (seg.get("text") or "").strip(),
            "words": [],
        }
        for w in (seg.get("words") or []):
            word_text = w.get("word", "")
            w_start = float(w.get("start", seg_data["start"]))
            w_end = float(w.get("end", w_start))
            seg_data["words"].append({
                "word": word_text.strip(),
                "start": round(w_start, 3),
                "end": round(w_end, 3),
            })
            captions.append({
                "text": word_text,
                "startMs": int(w_start * 1000),
                "endMs": int(w_end * 1000),
            })
        segments.append(seg_data)

    info = SimpleNamespace(
        language=result.get("language", "unknown"),
        language_probability=1.0,
    )
    return segments, captions, info, "mlx", "float16"


def transcribe_hf(audio_path, model="large-v3", language="english"):
    """Transcribe via a HuggingFace transformers Whisper checkpoint that outputs romanized
    text directly (e.g. a Telugu->Tenglish fine-tune, so English loanwords stay correct).

    Requires the 'romanized' extra (torch + transformers): uv sync --extra romanized.
    Returns the same (segments, captions, info, device, compute_type) shape as the others.
    """
    import torch
    from types import SimpleNamespace
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor, pipeline

    repo = model if "/" in model else "jayasuryajsk/whisper-large-v3-Telugu-Romanized"

    if torch.cuda.is_available():
        device, dtype, cname = "cuda", torch.float16, "float16"
    elif getattr(torch.backends, "mps", None) is not None and torch.backends.mps.is_available():
        device, dtype, cname = "mps", torch.float16, "float16"
    else:
        device, dtype, cname = "cpu", torch.float32, "float32"

    asr = AutoModelForSpeechSeq2Seq.from_pretrained(repo, torch_dtype=dtype)
    asr.to(device)
    proc = AutoProcessor.from_pretrained(repo)
    pipe = pipeline(
        "automatic-speech-recognition",
        model=asr,
        tokenizer=proc.tokenizer,
        feature_extractor=proc.feature_extractor,
        chunk_length_s=30,
        batch_size=16,
        return_timestamps="word",
        torch_dtype=dtype,
        device=device,
    )
    out = pipe(audio_path, generate_kwargs={"language": language})

    words = []
    captions = []
    for ch in out.get("chunks", []):
        ts = ch.get("timestamp") or (None, None)
        start, end = ts[0], ts[1]
        if start is None:
            continue
        if end is None:
            end = start
        raw = ch.get("text", "")
        words.append({"word": raw.strip(), "start": round(float(start), 3), "end": round(float(end), 3)})
        captions.append({"text": raw, "startMs": int(float(start) * 1000), "endMs": int(float(end) * 1000)})

    # Group words into segments on pauses (>0.8s) or length, so the AI scorer sees
    # timestamped segments (snap/captions use the flat word list either way).
    segments = []
    cur = None
    for w in words:
        if cur is None or (w["start"] - cur["end"]) > 0.8 or len(cur["words"]) >= 14:
            cur = {"start": w["start"], "end": w["end"], "text": "", "words": []}
            segments.append(cur)
        cur["words"].append(w)
        cur["end"] = w["end"]
        cur["text"] = (cur["text"] + " " + w["word"]).strip()

    info = SimpleNamespace(language="te", language_probability=1.0)
    return segments, captions, info, device, cname


def main():
    parser = argparse.ArgumentParser(description="Transcribe video with faster-whisper")
    parser.add_argument("input", help="Input video or audio file")
    parser.add_argument("--output", required=True, help="Output JSON file path")
    parser.add_argument("--model", default="large-v3",
                        help="Whisper model size (default: large-v3)")
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"],
                        help="Compute device (default: auto)")
    parser.add_argument("--compute-type", default="auto",
                        choices=["auto", "float16", "int8", "float32"],
                        help="Compute type (default: auto)")
    parser.add_argument("--backend", default="faster-whisper",
                        choices=["faster-whisper", "mlx", "hf"],
                        help="Transcription backend. 'mlx' = Apple Silicon GPU (needs mlx-whisper). "
                             "'hf' = a HuggingFace fine-tune that outputs romanized Tenglish directly, "
                             "keeping English loanwords correct (needs the 'romanized' extra: "
                             "torch+transformers). Default: faster-whisper.")
    parser.add_argument("--language", default=None,
                        help="Force a language code (e.g. 'te' for Telugu). Default: auto-detect.")
    parser.add_argument("--romanize", action="store_true",
                        help="Romanize the transcript to Latin (Tenglish). Auto-enabled for Telugu.")

    args = parser.parse_args()

    if not os.path.isfile(args.input):
        print(json.dumps({"error": f"Input file not found: {args.input}"}))
        sys.exit(1)

    start_time = time.time()

    # Extract audio if input is video
    audio_path = args.input
    tmp_audio = None

    # Check if input has video stream (i.e., it's a video file, not audio)
    probe = subprocess.run(
        ["ffprobe", "-v", "quiet", "-select_streams", "v:0",
         "-show_entries", "stream=codec_type", "-of", "csv=p=0", args.input],
        capture_output=True, text=True
    )
    if "video" in probe.stdout:
        tmp_file = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        tmp_audio = tmp_file.name
        tmp_file.close()
        audio_path = tmp_audio
        extract_audio(args.input, audio_path)

    try:
        if args.backend == "mlx":
            segments, captions, info, actual_device, actual_compute = transcribe_mlx(
                audio_path, args.model, args.language
            )
        elif args.backend == "hf":
            segments, captions, info, actual_device, actual_compute = transcribe_hf(
                audio_path, args.model
            )
        else:
            segments, captions, info, actual_device, actual_compute = transcribe(
                audio_path, args.model, args.device, args.compute_type, args.language
            )
    finally:
        if tmp_audio and os.path.exists(tmp_audio):
            os.unlink(tmp_audio)

    # Romanize to Tenglish when the language is Telugu (or --romanize) — but NOT for the 'hf'
    # backend, whose model already outputs romanized text (keeps English loanwords correct).
    lang_code = args.language or getattr(info, "language", None)
    if args.backend != "hf" and (args.romanize or lang_code == "te"):
        for c in captions:
            c["text"] = romanize_te(c["text"])
        for seg in segments:
            seg["text"] = romanize_te(seg["text"])
            for w in seg.get("words", []):
                w["word"] = romanize_te(w["word"])

    elapsed = time.time() - start_time

    # Get video duration
    duration_cmd = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "csv=p=0", args.input],
        capture_output=True, text=True
    )
    duration = float(duration_cmd.stdout.strip()) if duration_cmd.stdout.strip() else 0

    # Count total words
    word_count = sum(len(seg.get("words", [])) for seg in segments)

    output = {
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "duration": round(duration, 1),
        "word_count": word_count,
        "model": args.model,
        "device": actual_device,
        "compute_type": actual_compute,
        "transcription_time_sec": round(elapsed, 1),
        "segments": segments,
        "captions": captions,
    }

    # Ensure output directory exists
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)

    with open(args.output, "w") as f:
        json.dump(output, f, indent=2)

    # Print summary (not the full transcript)
    summary = {
        "action": "transcribe",
        "input": args.input,
        "output": args.output,
        "language": info.language,
        "duration": round(duration, 1),
        "word_count": word_count,
        "segment_count": len(segments),
        "caption_count": len(captions),
        "model": args.model,
        "transcription_time_sec": round(elapsed, 1),
        "realtime_factor": round(duration / elapsed, 1) if elapsed > 0 else 0,
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
