// Filesystem layout. The server lives at apps/server/src, and reuses the existing
// pipeline (scripts/, remotion/, references/) at the repo root.
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
