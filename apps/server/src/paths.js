// Filesystem layout. The server lives at apps/server/src, and reuses the existing
// pipeline (scripts/, remotion/, references/) at the repo root.
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IS_WIN = process.platform === "win32";

// Portable tools dir used by the native-Windows install (ffmpeg/ffprobe/jq/deno).
export const TOOLS_BIN = path.join(os.homedir(), ".shorts-tools", "bin");

function firstExisting(candidates, fallback) {
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return fallback;
}

/** Absolute path to the venv's Python interpreter — project .venv (uv) first, then shared skill venvs. */
export function venvPython() {
  const home = os.homedir();
  return firstExisting(
    [
      path.join(REPO_ROOT, ".venv", "bin", "python3"),
      path.join(REPO_ROOT, ".venv", "Scripts", "python.exe"),
      path.join(home, ".video-skill", "bin", "python3"),
      path.join(home, ".shorts-skill", "bin", "python3"),
      path.join(home, ".video-skill", "Scripts", "python.exe"),
      path.join(home, ".shorts-skill", "Scripts", "python.exe"),
    ],
    IS_WIN ? "python" : "python3"
  );
}

/** ffmpeg command — full path to the portable build on Windows, else PATH lookup. */
export function ffmpegCmd() {
  if (!IS_WIN) return "ffmpeg";
  return firstExisting([path.join(TOOLS_BIN, "ffmpeg.exe")], "ffmpeg");
}

/** bash command — Git Bash on Windows, else PATH lookup. */
export function bashCmd() {
  if (!IS_WIN) return "bash";
  return firstExisting(
    [
      "C:\\Program Files\\Git\\bin\\bash.exe",
      "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
      "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    ],
    "bash"
  );
}

/** Full child env: portable tools on PATH + UTF-8 Python I/O. */
export function pipelineEnv(extra = {}) {
  const sep = IS_WIN ? ";" : ":";
  const PATH = (fs.existsSync(TOOLS_BIN) ? TOOLS_BIN + sep : "") + (process.env.PATH || "");
  return { ...process.env, PATH, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8", ...extra };
}

export const REPO_ROOT = path.resolve(__dirname, "../../..");
export const SCRIPTS_DIR = path.join(REPO_ROOT, "scripts");
export const RUN_PY = path.join(SCRIPTS_DIR, "run_py.sh");
export const REMOTION_RENDER = path.join(REPO_ROOT, "remotion", "render.mjs");
export const RUBRIC_FILE = path.join(REPO_ROOT, "references", "scoring-rubric.md");

// Local, gitignored data (job workspaces + provider config with the API key).
export const DATA_DIR = path.join(REPO_ROOT, ".data");
export const JOBS_DIR = path.join(DATA_DIR, "jobs");
export const CONFIG_FILE = path.join(DATA_DIR, "config.json");

fs.mkdirSync(JOBS_DIR, { recursive: true });

export const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
