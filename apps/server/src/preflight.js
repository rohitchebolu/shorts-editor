// Startup preflight: verify the external tools the pipeline needs are present and
// current, so a fresh machine fails with a clear message instead of a cryptic error
// mid-job (e.g. yt-dlp HTTP 403 from a missing JS runtime, or an old yt-dlp build).
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { venvPython, ffmpegCmd, ffprobeCmd, pipelineEnv } from "./paths.js";

const MIN_YTDLP = "2026.8.19"; // floor that handles YouTube's HD PO-token flow

function run(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      env: pipelineEnv(),
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 15000,
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

// Compare dotted numeric versions (yt-dlp uses YYYY.M.D). true if a >= b.
function gte(a, b) {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0;
  }
  return true;
}

// One Python call: yt-dlp version + module availability (find_spec avoids importing
// the heavy faster-whisper/mlx packages, so startup stays fast).
const PY_PROBE = [
  "import importlib.util as u, json",
  "v=None",
  "try:",
  "    import yt_dlp; v=yt_dlp.version.__version__",
  "except Exception: pass",
  "print(json.dumps({'ytdlp':v,'fw':u.find_spec('faster_whisper') is not None,'mlx':u.find_spec('mlx_whisper') is not None}))",
].join("\n");

export function preflight() {
  const py = venvPython();
  let info = {};
  try {
    info = JSON.parse(run(py, ["-c", PY_PROBE]) || "{}");
  } catch {
    info = {};
  }
  const ytdlp = info.ytdlp || null;

  const report = {
    ffmpeg: !!run(ffmpegCmd(), ["-version"]),
    ffprobe: !!run(ffprobeCmd(), ["-version"]),
    deno: !!run("deno", ["--version"]),
    python: !!info.fw,
    ytdlp,
    ytdlpOk: !!ytdlp && gte(ytdlp, MIN_YTDLP),
    mlx: process.platform === "darwin" ? !!info.mlx : null, // Apple-GPU Whisper backend?
  };

  const problems = [];
  if (!report.ffmpeg) problems.push("ffmpeg not found (install: brew install ffmpeg)");
  if (!report.ffprobe) problems.push("ffprobe not found (comes with ffmpeg)");
  if (!report.deno)
    problems.push("deno not found — YouTube downloads will 403 (install: brew install deno)");
  if (!report.python) problems.push("Python venv/faster-whisper missing (run: uv sync)");
  if (report.ytdlp && !report.ytdlpOk)
    problems.push(`yt-dlp ${report.ytdlp} is old — update to >=${MIN_YTDLP} (uv pip install -U yt-dlp)`);
  if (!report.ytdlp) problems.push("yt-dlp not installed (run: uv sync)");

  report.problems = problems;
  return report;
}

export function logPreflight() {
  const r = preflight();
  if (r.problems.length) {
    console.warn("[preflight] issues detected:");
    for (const p of r.problems) console.warn("  ! " + p);
  } else {
    const extra = process.platform === "darwin" ? `, mlx=${r.mlx ? "yes" : "no (CPU fallback)"}` : "";
    console.log(`[preflight] ok — ffmpeg, deno, yt-dlp ${r.ytdlp}${extra}`);
  }
  return r;
}

// `npm run doctor` / `node preflight.js` — print the report standalone.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  logPreflight();
}
