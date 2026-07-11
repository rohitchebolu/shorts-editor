# Native-Windows setup for claude-shorts (no WSL required).
#
# Mirrors setup.sh for Windows: creates the Python venv, installs deps (CPU-only —
# faster-whisper uses CTranslate2, so no PyTorch), fetches portable ffmpeg/ffprobe/jq/deno
# into %USERPROFILE%\.shorts-tools\bin (added to your user PATH), downloads the MediaPipe
# face-detection model, and runs `npm install` for Remotion.
#
# Usage:  powershell -ExecutionPolicy Bypass -File setup.ps1
$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "=== claude-shorts native-Windows setup ===`n"

# --- 1. Python venv ---
$venv = Join-Path $HOME ".shorts-skill"
$py = $null
foreach ($ver in @("3.13", "3.12", "3.11")) {
    if (& py "-$ver" -c "print(1)" 2>$null) { $pyLauncher = "-$ver"; break }
}
if (-not $pyLauncher) { throw "No suitable Python (3.11-3.13) found via the 'py' launcher." }

if (-not (Test-Path (Join-Path $venv "Scripts\python.exe"))) {
    Write-Host "[Python] creating venv at $venv ($pyLauncher) ..."
    & py $pyLauncher -m venv $venv
}
$py = Join-Path $venv "Scripts\python.exe"
Write-Host "[Python] installing dependencies (CPU-only) ..."
& $py -m pip install --upgrade pip | Out-Null
& $py -m pip install -r (Join-Path $ScriptDir "requirements.txt")
& $py -c "import faster_whisper, mediapipe, cv2, numpy, yt_dlp; print('[Python] imports OK')"

# --- 2. Portable tools (ffmpeg, ffprobe, jq, deno) ---
$tools = Join-Path $HOME ".shorts-tools\bin"
New-Item -ItemType Directory -Force -Path $tools | Out-Null

function Ensure-Tool($name, $exe, $scriptblock) {
    if (Test-Path (Join-Path $tools $exe)) { Write-Host "[tools] $name present"; return }
    Write-Host "[tools] installing $name ..."; & $scriptblock
}

Ensure-Tool "ffmpeg" "ffmpeg.exe" {
    $zip = Join-Path $HOME ".shorts-tools\ffmpeg.zip"
    Invoke-WebRequest "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $zip -UseBasicParsing
    $ext = Join-Path $HOME ".shorts-tools\ffmpeg_ext"
    if (Test-Path $ext) { Remove-Item -Recurse -Force $ext }
    Expand-Archive $zip -DestinationPath $ext -Force
    $src = (Get-ChildItem $ext -Recurse -Filter ffmpeg.exe | Select-Object -First 1).DirectoryName
    Copy-Item (Join-Path $src "ffmpeg.exe") $tools -Force
    Copy-Item (Join-Path $src "ffprobe.exe") $tools -Force
    Remove-Item $zip -Force; Remove-Item -Recurse -Force $ext
}
Ensure-Tool "jq" "jq.exe" {
    Invoke-WebRequest "https://github.com/jqlang/jq/releases/latest/download/jq-windows-amd64.exe" -OutFile (Join-Path $tools "jq.exe") -UseBasicParsing
}
Ensure-Tool "deno" "deno.exe" {
    # deno is the JS runtime yt-dlp now needs for reliable YouTube extraction
    $zip = Join-Path $HOME ".shorts-tools\deno.zip"
    Invoke-WebRequest "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip" -OutFile $zip -UseBasicParsing
    Expand-Archive $zip -DestinationPath $tools -Force
    Remove-Item $zip -Force
}

# Add tools dir to user PATH (idempotent)
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$tools*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$tools", "User")
    Write-Host "[tools] added $tools to user PATH (restart shells to pick it up)"
}

# --- 3. MediaPipe face-detection model ---
$models = Join-Path $HOME ".shorts-tools\models"
New-Item -ItemType Directory -Force -Path $models | Out-Null
$model = Join-Path $models "blaze_face_short_range.tflite"
if (-not (Test-Path $model)) {
    Write-Host "[model] downloading blaze_face_short_range.tflite ..."
    Invoke-WebRequest "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite" -OutFile $model -UseBasicParsing
}

# --- 4. Remotion ---
Write-Host "[Node] installing Remotion dependencies ..."
Push-Location (Join-Path $ScriptDir "remotion")
& npm install --silent
Pop-Location

Write-Host "`n=== Setup complete ==="
Write-Host "Python venv: $venv"
Write-Host "Tools:       $tools"
Write-Host "Use /shorts in Claude Code, or run the pipeline scripts via scripts/run_py.sh"
