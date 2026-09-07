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
import {
  REPO_ROOT,
  SCRIPTS_DIR,
  REMOTION_RENDER,
  RUBRIC_FILE,
  JOBS_DIR,
  venvPython,
  ffmpegCmd,
  ffprobeCmd,
  bashCmd,
  pipelineEnv,
} from "./paths.js";
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

// --- Lightweight job persistence (a job.json per job → survives server restarts) ---
function persist(job) {
  try {
    fs.writeFileSync(
      path.join(job.tmp, "job.json"),
      JSON.stringify(
        {
          id: job.id, url: job.url, options: job.options, status: job.status,
          phase: job.phase, stage: job.stage, createdAt: job.createdAt,
          transcript: job.transcript, contentType: job.contentType,
          candidates: job.candidates, outputs: job.outputs, error: job.error,
        },
        null,
        2
      )
    );
  } catch {
    /* best-effort */
  }
}

function loadJobs() {
  let entries = [];
  try {
    entries = fs.readdirSync(JOBS_DIR);
  } catch {
    return;
  }
  for (const d of entries) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, d, "job.json"), "utf-8"));
    } catch {
      continue;
    }
    if (!data.id || jobs.has(data.id)) continue;
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0);
    jobs.set(data.id, {
      ...data,
      // a job that was mid-run when the server stopped can't be live anymore
      status: data.status === "running" ? "interrupted" : data.status,
      tmp: path.join(JOBS_DIR, d),
      events: [],
      emitter,
    });
  }
}

export function listJobs() {
  return [...jobs.values()]
    .map((j) => ({
      id: j.id,
      url: j.url,
      status: j.status,
      phase: j.phase,
      createdAt: j.createdAt || 0,
      outputs: (j.outputs || []).length,
      options: j.options,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function rerunJob(id) {
  const j = jobs.get(id);
  if (!j) return null;
  if (j.status === "running") return j;
  // Resume in place: reuse the same tmp dir and any completed Phase-1 artifacts
  // (source, transcript, content type, candidates). runPhase1 skips every stage
  // whose output already exists, so we don't re-download or re-transcribe.
  j.phase = 1;
  j.status = "running";
  j.stage = null;
  j.error = null;
  j.events = [];
  runPhase1(j).catch((e) => fail(j, e));
  return j;
}

function emit(job, ev) {
  const e = { t: Date.now(), ...ev };
  job.events.push(e);
  job.emitter.emit("event", e);
  if (ev.type !== "log") persist(job); // snapshot on every meaningful transition
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
    recommendedIds:
      j.status === "awaiting_selection"
        ? recommendSelection(j.candidates, j.transcript?.duration)
        : undefined,
    outputs: j.outputs,
    error: j.error,
  };
}

function spawnLines(cmd, args, { cwd = REPO_ROOT, env } = {}, onLine) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: env || pipelineEnv() });
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

// Run a bundled Python script with the venv interpreter (cross-platform; no bash needed).
function py(job, script, args, extraEnv) {
  return spawnLines(
    venvPython(),
    [path.join(SCRIPTS_DIR, script), ...args],
    { env: pipelineEnv(extraEnv) },
    (line) => emit(job, { type: "log", stage: job.stage, line })
  );
}

// ffprobe the media duration (seconds) without transcribing — used to populate the
// editor timeline in manual mode, where transcription is deferred to Phase 2.
function probeDuration(input) {
  return new Promise((resolve) => {
    let out = "";
    try {
      const child = spawn(
        ffprobeCmd(),
        ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", input],
        { env: pipelineEnv() }
      );
      child.stdout.on("data", (d) => (out += d.toString()));
      child.on("close", () => resolve(parseFloat(out.trim()) || 0));
      child.on("error", () => resolve(0));
    } catch {
      resolve(0);
    }
  });
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
  return { "talking-head": "reaction", screen: "clean", podcast: "reaction" }[contentType] || "reaction";
}

// Balanced auto-selection: video length sets the ceiling (~1 clip per 3 min,
// clamped 3-12) and a score gate keeps only strong clips — so a weak or short
// video gets fewer than the max, and a scene-rich one fills it. Falls back to the
// single best clip if nothing clears the gate. The user can still toggle any
// candidate in the UI. Candidates arrive pre-sorted by score (highest first).
const SCORE_GATE = 68;
const MIN_PER_CLIP = 3;
function recommendSelection(candidates, durationSec) {
  if (!candidates || candidates.length === 0) return [];
  const durationMin = (Number(durationSec) || 0) / 60;
  const ceiling = Math.min(12, Math.max(3, Math.round(durationMin / MIN_PER_CLIP)));
  const strong = candidates.filter((c) => c.score >= SCORE_GATE);
  const picked = (strong.length ? strong : candidates).slice(0, ceiling);
  return (picked.length ? picked : candidates.slice(0, 1)).map((c) => c.id);
}

function fail(job, e) {
  job.status = "error";
  job.error = String(e.message || e);
  emit(job, { type: "status", status: "error", error: job.error });
}

// ---- Phase 1: fetch -> transcribe -> detect -> score -------------------------

export function startJob({ url, model = "small", backend = "faster-whisper", maxHeight = 1080, mode = "ai", language = "te" }) {
  const id = newId();
  const tmp = path.join(JOBS_DIR, id);
  fs.mkdirSync(path.join(tmp, "clips"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "render"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "out"), { recursive: true });

  const job = {
    id,
    url,
    createdAt: Date.now(),
    options: { model, backend, maxHeight, mode, language },
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
    if (fs.existsSync(input)) return; // resume: source already downloaded
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

  if (job.options.mode === "manual") {
    // Manual: defer transcription to Phase 2, where only the KEPT clips are transcribed
    // (the big speedup — no whole-video Whisper pass). Just probe the source duration so
    // the editor timeline is ready immediately after the download.
    const duration = await probeDuration(input);
    job.transcript = { language: job.options.language || null, word_count: 0, duration };
    emit(job, { type: "data", key: "transcript", value: job.transcript });
  } else {
    await stage(job, "transcribe", async () => {
      const tPath = path.join(job.tmp, "transcript.json");
      if (!fs.existsSync(tPath)) {
        const args = [input, "--output", tPath, "--model", job.options.model];
        if (job.options.language) args.push("--language", job.options.language);
        if (job.options.backend && job.options.backend !== "faster-whisper")
          args.push("--backend", job.options.backend);
        await py(job, "transcribe.py", args, env);
      }
      const t = readJson(tPath);
      job.transcript = { language: t.language, word_count: t.word_count, duration: t.duration };
      emit(job, { type: "data", key: "transcript", value: job.transcript });
      // Cleaned captions for rendering (copied as-is).
      const cleaned = path.join(job.tmp, "transcript_cleaned.json");
      if (!fs.existsSync(cleaned)) fs.copyFileSync(tPath, cleaned);
    });
  }

  // Content-type detection only informs AI style + face-track reframe choices. Manual
  // mode uses the fixed reaction/center layout, so skip it — saves ~35s and the mediapipe
  // frame-sampling pass entirely.
  if (job.options.mode !== "manual") {
    await stage(job, "detect", async () => {
      const cPath = path.join(job.tmp, "content_type.json");
      if (!fs.existsSync(cPath)) {
        await py(job, "detect_content.py", [input, "--output", cPath], env);
      }
      job.contentType = readJsonSafe(cPath);
      emit(job, { type: "data", key: "contentType", value: job.contentType });
    });
  }

  // AI mode scores the transcript into candidates; manual mode skips the LLM
  // entirely (no provider/key required) and opens an empty editor.
  if (job.options.mode !== "manual") {
    await stage(job, "score", async () => {
      if (job.candidates && job.candidates.length > 0) {
        emit(job, { type: "data", key: "candidates", value: job.candidates }); // resume: reuse
        return;
      }
      const cfg = getSecret();
      if (!cfg.provider || !cfg.apiKey) throw new Error("No LLM provider configured — set one in Settings.");
      const transcript = readJson(path.join(job.tmp, "transcript.json"));
      const rubric = fs.readFileSync(RUBRIC_FILE, "utf-8");
      const cands = await scoreSegments({ transcript, rubric, config: cfg });
      job.candidates = cands.map((c, i) => ({ id: i + 1, ...c }));
      emit(job, { type: "data", key: "candidates", value: job.candidates });
    });
  }

  job.status = "awaiting_selection";
  job.stage = null;
  emit(job, {
    type: "status",
    status: "awaiting_selection",
    mode: job.options.mode,
    duration: job.transcript?.duration || 0,
    candidates: job.candidates,
    contentType: job.contentType,
    recommendedStyle: recommendStyle(job.contentType?.content_type),
    recommendedIds: recommendSelection(job.candidates, job.transcript?.duration),
  });
}

// ---- Phase 2: snap -> extract -> reframe -> render -> export ------------------

export function selectAndRender(job, { segmentIds, segments, style, platform = "youtube" }) {
  if (job.status !== "awaiting_selection") throw new Error(`Job is ${job.status}, not awaiting selection.`);
  job.phase = 2;
  job.status = "running";
  runPhase2(job, { segmentIds, segments, style, platform }).catch((e) => fail(job, e));
}

async function runPhase2(job, { segmentIds, segments, style, platform }) {
  const env = { SHORTS_TMP: job.tmp };
  const input = path.join(job.tmp, "input.mp4");
  const contentType = job.contentType?.content_type || "talking-head";
  const finalStyle = style || recommendStyle(contentType);
  const isManual = job.options.mode === "manual";
  // Manual mode uses the fast static center crop (no mediapipe/opencv). The 4:3
  // reaction layout re-derives its window from this crop's center.
  const reframeType = isManual ? "center" : contentType;

  // Start each render clean so stale clips/outputs from a previous run don't linger.
  for (const sub of ["clips", "render", "out"]) {
    const d = path.join(job.tmp, sub);
    try {
      if (fs.existsSync(d))
        for (const f of fs.readdirSync(d)) fs.rmSync(path.join(d, f), { force: true, recursive: true });
    } catch {
      /* best-effort */
    }
  }

  // Editor-provided segments (edited boundaries/titles/captions) take precedence;
  // otherwise fall back to id-based selection of LLM candidates.
  let chosen;
  if (Array.isArray(segments) && segments.length) {
    chosen = segments.map((s, i) => ({
      id: i + 1,
      start: Number(s.start),
      end: Number(s.end),
      hook_line1: s.hook_line1 ?? s.title ?? "",
      hook_line2: s.hook_line2 ?? s.subtitle ?? "",
      score: Number(s.score) || 0,
      captions: Array.isArray(s.captions) ? s.captions : undefined,
      captionsOff: !!s.captionsOff,
      captionStyle: s.captionStyle || undefined,
      layout: s.layout || undefined,
      captionY: typeof s.captionY === "number" ? s.captionY : undefined,
    }));
  } else {
    chosen = job.candidates.filter((c) => segmentIds.includes(c.id));
  }
  if (chosen.length === 0) throw new Error("No segments selected.");

  writeJson(path.join(job.tmp, "approved_segments.json"), {
    segments: chosen.map((c) => ({
      id: c.id,
      start: c.start,
      end: c.end,
      hook_line1: c.hook_line1,
      hook_line2: c.hook_line2 || "",
      score: c.score,
      ...(c.captions ? { captions: c.captions } : {}),
      ...(c.captionsOff ? { captionsOff: true } : {}),
      ...(c.captionStyle ? { captionStyle: c.captionStyle } : {}),
      ...(c.layout ? { layout: c.layout } : {}),
      ...(typeof c.captionY === "number" ? { captionY: c.captionY } : {}),
    })),
    style: finalStyle,
    platform,
    content_type: contentType,
  });

  const snappedFile = path.join(job.tmp, "snapped_segments.json");
  if (isManual) {
    // Manual in/out points are deliberate — respect them exactly (and there's no full
    // transcript to snap against, since transcription is deferred to the clips below).
    fs.copyFileSync(path.join(job.tmp, "approved_segments.json"), snappedFile);
  } else {
    await stage(job, "snap", async () => {
      await py(job, "snap_boundaries.py", [
        "--segments", path.join(job.tmp, "approved_segments.json"),
        "--transcript", path.join(job.tmp, "transcript.json"),
        "--input-video", input,
        "--output", snappedFile,
      ], env);
    });
  }

  const snapped = readJson(snappedFile);

  await stage(job, "extract", async () => {
    for (const seg of snapped.segments) {
      const out = path.join(job.tmp, "clips", `clip_${String(seg.id).padStart(2, "0")}.mp4`);
      await spawnLines(
        ffmpegCmd(),
        ["-y", "-ss", String(seg.start), "-to", String(seg.end), "-i", input, "-c", "copy", out],
        { env: pipelineEnv(env) },
        () => {}
      );
    }
  });

  // Manual: captions removed for a simpler flow — render with none. Write an empty
  // captions file so the renderer still has its --captions input.
  if (isManual) {
    writeJson(path.join(job.tmp, "transcript_cleaned.json"), { captions: [] });
  }

  await stage(job, "reframe", async () => {
    await py(job, "compute_reframe.py", [
      "--clips-dir", path.join(job.tmp, "clips") + path.sep,
      "--content-type", reframeType,
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
      { env: pipelineEnv(env) },
      (line) => emit(job, { type: "log", stage: "render", line })
    );
  });

  await stage(job, "export", async () => {
    await spawnLines(
      bashCmd(),
      [
        path.join(SCRIPTS_DIR, "export.sh"),
        "--input-dir", path.join(job.tmp, "render") + path.sep,
        "--platform", platform,
        "--output-dir", path.join(job.tmp, "out") + path.sep,
        "--copy-video",
      ],
      { env: pipelineEnv(env) },
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

// Restore historical jobs from disk on startup so the Recent Jobs list persists.
loadJobs();
