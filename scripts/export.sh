#!/usr/bin/env bash
# Platform-specific FFmpeg encoding for exported shorts
# Usage: bash scripts/export.sh --input-dir DIR --platform PLATFORM --output-dir DIR
set -euo pipefail

# Make portable ffmpeg/ffprobe discoverable on native-Windows installs.
[ -d "$HOME/.shorts-tools/bin" ] && export PATH="$HOME/.shorts-tools/bin:$PATH"

INPUT_DIR=""
PLATFORM="all"
OUTPUT_DIR="./shorts"
FORCE="false"
COPY_VIDEO="false"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --input-dir) INPUT_DIR="$2"; shift 2 ;;
        --platform) PLATFORM="$2"; shift 2 ;;
        --output-dir) OUTPUT_DIR="$2"; shift 2 ;;
        --force) FORCE="true"; shift ;;
        # Fast single-encode: keep the already-encoded Remotion video (stream copy) and
        # only re-encode audio (loudnorm). Skips a full second H.264 pass with no quality
        # loss. Ignores per-platform video bitrate targets (file stays at the render's CRF).
        --copy-video) COPY_VIDEO="true"; shift ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

if [ -z "$INPUT_DIR" ]; then
    echo '{"error":"Usage: export.sh --input-dir DIR [--platform youtube|tiktok|instagram|all] [--output-dir DIR]"}'
    exit 1
fi

if [ ! -d "$INPUT_DIR" ]; then
    echo "{\"error\":\"Input directory not found: $INPUT_DIR\"}"
    exit 1
fi

mkdir -p "$OUTPUT_DIR"

# Pick the best available hardware H.264 encoder, by presence in ffmpeg's encoder
# list. Priority: NVENC (Nvidia) > VideoToolbox (Apple Silicon / macOS) > libx264
# (software fallback). Detection is portable: on Windows/Linux without the codec
# compiled in, the grep simply fails and we fall through to the next tier.
HAS_NVENC="false"
if command -v nvidia-smi &>/dev/null && command -v ffmpeg &>/dev/null; then
    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q "h264_nvenc"; then
        HAS_NVENC="true"
    fi
fi

HAS_VIDEOTOOLBOX="false"
if command -v ffmpeg &>/dev/null; then
    if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q "h264_videotoolbox"; then
        HAS_VIDEOTOOLBOX="true"
    fi
fi

if [ "$HAS_NVENC" = "true" ]; then
    ENCODER="h264_nvenc"
elif [ "$HAS_VIDEOTOOLBOX" = "true" ]; then
    ENCODER="h264_videotoolbox"
else
    ENCODER="libx264"
fi
# Copy mode reports the true video codec (no re-encode).
[ "$COPY_VIDEO" = "true" ] && ENCODER="copy"

# Fast single-encode: stream-copy the video, re-encode only audio with loudnorm.
encode_copy() {
    local input="$1" output="$2" plat="$3"
    local abr="128k" ar="44100"
    [ "$plat" = "youtube" ] && { abr="192k"; ar="48000"; }
    ffmpeg -y -i "$input" \
        -c:v copy \
        -af loudnorm=I=-14:TP=-1:LRA=11 \
        -c:a aac -b:a "$abr" -ar "$ar" \
        -movflags +faststart \
        "$output" 2>/dev/null
}

# Platform encoding functions
encode_youtube() {
    local input="$1" output="$2"
    if [ "$HAS_NVENC" = "true" ]; then
        ffmpeg -y -i "$input" \
            -c:v h264_nvenc -preset p5 -tune hq \
            -b:v 12M -maxrate 14M -bufsize 24M \
            -profile:v high -level 4.2 \
            -af loudnorm=I=-14:TP=-1:LRA=11 \
            -c:a aac -b:a 192k -ar 48000 \
            -pix_fmt yuv420p -movflags +faststart \
            "$output" 2>/dev/null
    elif [ "$HAS_VIDEOTOOLBOX" = "true" ]; then
        ffmpeg -y -i "$input" \
            -c:v h264_videotoolbox -allow_sw 1 \
            -b:v 12M -maxrate 14M -bufsize 24M \
            -profile:v high -level 4.2 \
            -af loudnorm=I=-14:TP=-1:LRA=11 \
            -c:a aac -b:a 192k -ar 48000 \
            -pix_fmt yuv420p -movflags +faststart \
            "$output" 2>/dev/null
    else
        ffmpeg -y -i "$input" \
            -c:v libx264 -preset slow \
            -b:v 12M -maxrate 14M -bufsize 24M \
            -profile:v high -level 4.2 \
            -af loudnorm=I=-14:TP=-1:LRA=11 \
            -c:a aac -b:a 192k -ar 48000 \
            -pix_fmt yuv420p -movflags +faststart \
            "$output" 2>/dev/null
    fi
}

encode_tiktok() {
    local input="$1" output="$2"
    if [ "$HAS_NVENC" = "true" ]; then
        ffmpeg -y -i "$input" \
            -c:v h264_nvenc -preset p5 -tune hq \
            -cq 18 -maxrate 10M -bufsize 20M \
            -af loudnorm=I=-14:TP=-1:LRA=11 \
            -c:a aac -b:a 128k -ar 44100 \
            -pix_fmt yuv420p -movflags +faststart \
            "$output" 2>/dev/null
    elif [ "$HAS_VIDEOTOOLBOX" = "true" ]; then
        ffmpeg -y -i "$input" \
            -c:v h264_videotoolbox -allow_sw 1 \
            -b:v 10M -maxrate 10M -bufsize 20M \
            -af loudnorm=I=-14:TP=-1:LRA=11 \
            -c:a aac -b:a 128k -ar 44100 \
            -pix_fmt yuv420p -movflags +faststart \
            "$output" 2>/dev/null
    else
        ffmpeg -y -i "$input" \
            -c:v libx264 -preset slow -crf 18 \
            -maxrate 10M -bufsize 20M \
            -af loudnorm=I=-14:TP=-1:LRA=11 \
            -c:a aac -b:a 128k -ar 44100 \
            -pix_fmt yuv420p -movflags +faststart \
            "$output" 2>/dev/null
    fi
}

encode_instagram() {
    local input="$1" output="$2"
    if [ "$HAS_NVENC" = "true" ]; then
        ffmpeg -y -i "$input" \
            -c:v h264_nvenc -preset p5 -tune hq \
            -b:v 4500k -maxrate 5000k -bufsize 10M \
            -profile:v high -level 4.2 \
            -af loudnorm=I=-14:TP=-1:LRA=11 \
            -c:a aac -b:a 128k -ar 44100 \
            -pix_fmt yuv420p -movflags +faststart \
            "$output" 2>/dev/null
    elif [ "$HAS_VIDEOTOOLBOX" = "true" ]; then
        ffmpeg -y -i "$input" \
            -c:v h264_videotoolbox -allow_sw 1 \
            -b:v 4500k -maxrate 5000k -bufsize 10M \
            -profile:v high -level 4.2 \
            -af loudnorm=I=-14:TP=-1:LRA=11 \
            -c:a aac -b:a 128k -ar 44100 \
            -pix_fmt yuv420p -movflags +faststart \
            "$output" 2>/dev/null
    else
        ffmpeg -y -i "$input" \
            -c:v libx264 -preset slow \
            -b:v 4500k -maxrate 5000k -bufsize 10M \
            -profile:v high -level 4.2 \
            -af loudnorm=I=-14:TP=-1:LRA=11 \
            -c:a aac -b:a 128k -ar 44100 \
            -pix_fmt yuv420p -movflags +faststart \
            "$output" 2>/dev/null
    fi
}

# Process each rendered short
RESULTS=()
COUNT=0

for input_file in "$INPUT_DIR"/short_*.mp4; do
    [ -f "$input_file" ] || continue
    COUNT=$((COUNT + 1))

    base=$(basename "$input_file" .mp4)
    num="${base#short_}"

    platforms=()
    if [ "$PLATFORM" = "all" ]; then
        platforms=("youtube" "tiktok" "instagram")
    else
        platforms=("$PLATFORM")
    fi

    for plat in "${platforms[@]}"; do
        case "$plat" in
            youtube)  suffix="_yt"; encode_func="encode_youtube" ;;
            tiktok)   suffix="_tt"; encode_func="encode_tiktok" ;;
            instagram) suffix="_ig"; encode_func="encode_instagram" ;;
            *) echo "Unknown platform: $plat" >&2; continue ;;
        esac

        output_file="$OUTPUT_DIR/short_${num}${suffix}.mp4"

        # Skip if output already exists (use --force to overwrite)
        if [ -f "$output_file" ] && [ "$FORCE" != "true" ]; then
            size=$(du -k "$output_file" | cut -f1)
            size_mb=$(awk -v n="$size" 'BEGIN{printf "%.1f", n/1024}')
            duration=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$output_file" 2>/dev/null)
            duration_int=$(printf "%.0f" "$duration" 2>/dev/null || echo "0")
            RESULTS+=("{\"file\":\"$output_file\",\"platform\":\"$plat\",\"duration\":\"${duration_int}s\",\"size_mb\":$size_mb,\"skipped\":true}")
            continue
        fi

        if [ "$COPY_VIDEO" = "true" ]; then
            encode_copy "$input_file" "$output_file" "$plat"
        else
            $encode_func "$input_file" "$output_file"
        fi

        # Get file info
        size=$(du -k "$output_file" | cut -f1)
        size_mb=$(awk -v n="$size" 'BEGIN{printf "%.1f", n/1024}')
        duration=$(ffprobe -v quiet -show_entries format=duration -of csv=p=0 "$output_file" 2>/dev/null)
        duration_int=$(printf "%.0f" "$duration" 2>/dev/null || echo "0")

        RESULTS+=("{\"file\":\"$output_file\",\"platform\":\"$plat\",\"duration\":\"${duration_int}s\",\"size_mb\":$size_mb}")
    done
done

# Build JSON output
# Join the JSON objects with commas (pure bash — portable to macOS BSD tools / bash 3.2).
RESULTS_JSON="[$(IFS=','; printf '%s' "${RESULTS[*]}")]"

cat <<EOF
{
  "action": "export",
  "platform": "$PLATFORM",
  "encoder": "$ENCODER",
  "nvenc": $HAS_NVENC,
  "videotoolbox": $HAS_VIDEOTOOLBOX,
  "shorts_exported": $COUNT,
  "output_dir": "$OUTPUT_DIR",
  "files": $RESULTS_JSON
}
EOF
