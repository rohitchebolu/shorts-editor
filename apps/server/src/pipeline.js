// Job orchestrator: drives the same Python + Remotion pipeline the Claude skill
// used, but with an explicit two-phase flow so the UI can insert a human pick step.
//
//   Phase 1 (auto):  fetch -> transcribe -> detect -> score  => candidates
//   [ user picks clips + style in the UI ]
//   Phase 2 (auto):  snap -> extract -> reframe -> render -> export  => shorts
//
// Every stage emits SSE events (stage start/done/error + log lines) so the React
// UI can visualize progress live.
import { spawn } from "child_process";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { REPO_ROOT, SCRIPTS_DIR, RUN_PY, REMOTION_RENDER, RUBRIC_FILE, JOBS_DIR } from "./paths.js";
import { getSecret } from "./config.js";
import { scoreSegments } from "./llm.js";

export const PHASE1_STAGES = ["fetch", "transcribe", "detect", "score"];
export const PHASE2_STAGES = ["snap", "extract", "reframe", "render", "export"];

const jobs = new Map();
export const getJob = (id) => jobs.get(id);

let seq = 0;
const newId = () => `job_${Date.now().toString(36)}_${++seq}`;

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf-8"));
const readJsonSafe = (p) => {
  try {
    return readJson(p);
  } catch {
    return null;
  }
};
const writeJson = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2));

function emit(job, ev) {
  const e = { t: Date.now(), ...ev };
  job.events.push(e);
  job.emitter.emit("event", e);
}

/** Client-safe snapshot of a job. */
export function snapshot(j) {
  return {
    id: j.id,
    status: j.status,
    phase: j.phase,
    stage: j.stage,
    url: j.url,
    options: j.options,
    transcript: j.transcript || null,
    contentType: j.contentType || null,
    candidates: j.candidates,
    outputs: j.outputs,
    error: j.error,
  };
}

function spawnLines(cmd, args, { cwd = REPO_ROOT, env = {} }, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env } });
    let err = "";
    let lastLine = "";
    child.stdout.on("data", (d) => {
      d.toString()
        .split(/\r?\n/)
        .forEach((l) => {
          if (l.trim()) {
            lastLine = l;
            onLine && onLine(l);
          }
        });
    });
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(lastLine) : reject(new Error(err.trim() || `exited with code ${code}`))
    );
  });
}

// Run a bundled Python script through the cross-platform launcher.
function py(job, script, args, env) {
  return spawnLines("bash", [RUN_PY, path.join(SCRIPTS_DIR, script), ...args], { env }, (line) =>
    emit(job, { type: "log", stage: job.stage, line })
  );
}

async function stage(job, name, fn) {
  job.stage = name;
  emit(job, { type: "stage", stage: name, status: "running" });
  try {
    await fn();
    emit(job, { type: "stage", stage: name, status: "done" });
  } catch (e) {
    emit(job, { type: "stage", stage: name, status: "error", error: String(e.message || e) });
    throw e;
  }
}

function recommendStyle(contentType) {
  return { "talking-head": "bold", screen: "clean", podcast: "bounce" }[contentType] || "bold";
}

function fail(job, e) {
  job.status = "error";
  job.error = String(e.message || e);
  emit(job, { type: "status", status: "error", error: job.error });
}

// ---- Phase 1: fetch -> transcribe -> detect -> score -------------------------

export function startJob({ url, model = "small", backend = "faster-whisper", maxHeight = 1080 }) {
  const id = newId();
  const tmp = path.join(JOBS_DIR, id);
  fs.mkdirSync(path.join(tmp, "clips"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "render"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "out"), { recursive: true });

  const job = {
    id,
    url,
    options: { model, backend, maxHeight },
    status: "running",
    phase: 1,
    stage: null,
    tmp,
    transcript: null,
    contentType: null,
    candidates: [],
    outputs: [],
    error: null,
    events: [],
    emitter: new EventEmitter(),
  };
  job.emitter.setMaxListeners(0);
  jobs.set(id, job);
  runPhase1(job).catch((e) => fail(job, e));
  return job;
}

async function runPhase1(job) {
  const env = { SHORTS_TMP: job.tmp };
  const input = path.join(job.tmp, "input.mp4");

  await stage(job, "fetch", async () => {
    if (/^https?:\/\//i.test(job.url)) {
      await py(job, "ytdlp_fetch.py", [
        job.url,
        "--output",
        input,
        "--max-height",
        String(job.options.maxHeight),
      ], env);
    } else {
      fs.copyFileSync(job.url, input); // local file path
    }
  });

  await stage(job, "transcribe", async () => {
    const args = [input, "--output", path.join(job.tmp, "transcript.json"), "--model", job.options.model];
    if (job.options.backend === "mlx") args.push("--backend", "mlx");
    await py(job, "transcribe.py", args, env);
    const t = readJson(path.join(job.tmp, "transcript.json"));
    job.transcript = { language: t.language, word_count: t.word_count, duration: t.duration };
    emit(job, { type: "data", key: "transcript", value: job.transcript });
    // Cleaned captions for rendering (Claude used to clean filler; we copy as-is for now).
    fs.copyFileSync(path.join(job.tmp, "transcript.json"), path.join(job.tmp, "transcript_cleaned.json"));
  });

  await stage(job, "detect", async () => {
    await py(job, "detect_content.py", [input, "--output", path.join(job.tmp, "content_type.json")], env);
    job.contentType = readJsonSafe(path.join(job.tmp, "content_type.json"));
    emit(job, { type: "data", key: "contentType", value: job.contentType });
  });

  await stage(job, "score", async () => {
    const cfg = getSecret();
    if (!cfg.provider || !cfg.apiKey) throw new Error("No LLM provider configured — set one in Settings.");
    const transcript = readJson(path.join(job.tmp, "transcript.json"));
    const rubric = fs.readFileSync(RUBRIC_FILE, "utf-8");
    const cands = await scoreSegments({ transcript, rubric, config: cfg });
    job.candidates = cands.map((c, i) => ({ id: i + 1, ...c }));
    emit(job, { type: "data", key: "candidates", value: job.candidates });
  });

  job.status = "awaiting_selection";
  job.stage = null;
  emit(job, {
    type: "status",
    status: "awaiting_selection",
    candidates: job.candidates,
    contentType: job.contentType,
    recommendedStyle: recommendStyle(job.contentType?.content_type),
  });
}

// ---- Phase 2: snap -> extract -> reframe -> render -> export ------------------

export function selectAndRender(job, { segmentIds, style, platform = "youtube" }) {
  if (job.status !== "awaiting_selection") throw new Error(`Job is ${job.status}, not awaiting selection.`);
  job.phase = 2;
  job.status = "running";
  runPhase2(job, { segmentIds, style, platform }).catch((e) => fail(job, e));
}

async function runPhase2(job, { segmentIds, style, platform }) {
  const env = { SHORTS_TMP: job.tmp };
  const input = path.join(job.tmp, "input.mp4");
  const contentType = job.contentType?.content_type || "talking-head";
  const finalStyle = style || recommendStyle(contentType);
  const chosen = job.candidates.filter((c) => segmentIds.includes(c.id));
  if (chosen.length === 0) throw new Error("No segments selected.");

  writeJson(path.join(job.tmp, "approved_segments.json"), {
    segments: chosen.map((c) => ({
      id: c.id,
      start: c.start,
      end: c.end,
      hook_line1: c.hook_line1,
      hook_line2: c.hook_line2 || "",
      score: c.score,
    })),
    style: finalStyle,
    platform,
    content_type: contentType,
  });

  await stage(job, "snap", async () => {
    await py(job, "snap_boundaries.py", [
      "--segments", path.join(job.tmp, "approved_segments.json"),
      "--transcript", path.join(job.tmp, "transcript.json"),
      "--input-video", input,
      "--output", path.join(job.tmp, "snapped_segments.json"),
    ], env);
  });

  const snapped = readJson(path.join(job.tmp, "snapped_segments.json"));

  await stage(job, "extract", async () => {
    for (const seg of snapped.segments) {
      const out = path.join(job.tmp, "clips", `clip_${String(seg.id).padStart(2, "0")}.mp4`);
      await spawnLines(
        "ffmpeg",
        ["-y", "-ss", String(seg.start), "-to", String(seg.end), "-i", input, "-c", "copy", out],
        { env },
        () => {}
      );
    }
  });

  await stage(job, "reframe", async () => {
    await py(job, "compute_reframe.py", [
      "--clips-dir", path.join(job.tmp, "clips") + path.sep,
      "--content-type", contentType,
      "--output", path.join(job.tmp, "reframe.json"),
    ], env);
  });

  await stage(job, "render", async () => {
    await spawnLines(
      "node",
      [
        REMOTION_RENDER,
        "--segments", path.join(job.tmp, "snapped_segments.json"),
        "--reframe", path.join(job.tmp, "reframe.json"),
        "--captions", path.join(job.tmp, "transcript_cleaned.json"),
        "--style", finalStyle,
        "--clips-dir", path.join(job.tmp, "clips") + path.sep,
        "--output-dir", path.join(job.tmp, "render") + path.sep,
      ],
      { env },
      (line) => emit(job, { type: "log", stage: "render", line })
    );
  });

  await stage(job, "export", async () => {
    await spawnLines(
      "bash",
      [
        path.join(SCRIPTS_DIR, "export.sh"),
        "--input-dir", path.join(job.tmp, "render") + path.sep,
        "--platform", platform,
        "--output-dir", path.join(job.tmp, "out") + path.sep,
      ],
      { env },
      () => {}
    );
  });

  const outDir = path.join(job.tmp, "out");
  job.outputs = fs.existsSync(outDir)
    ? fs
        .readdirSync(outDir)
        .filter((f) => f.endsWith(".mp4"))
        .map((f) => ({ file: f, url: `/api/jobs/${job.id}/file/${encodeURIComponent(f)}` }))
    : [];
  job.status = "done";
  job.stage = null;
  emit(job, { type: "status", status: "done", outputs: job.outputs });
}
