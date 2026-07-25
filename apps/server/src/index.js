// HTTP API + SSE for the shorts pipeline.
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { PORT } from "./paths.js";
import { publicConfig, setConfig, getSecret } from "./config.js";
import { testConnection } from "./llm.js";
import {
  startJob,
  getJob,
  selectAndRender,
  snapshot,
  listJobs,
  rerunJob,
  PHASE1_STAGES,
  PHASE2_STAGES,
} from "./pipeline.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, stages: { phase1: PHASE1_STAGES, phase2: PHASE2_STAGES } })
);

// ---- Provider config ---------------------------------------------------------
app.get("/api/config", (_req, res) => res.json(publicConfig()));

app.post("/api/config", (req, res) => {
  const { provider, model, apiKey } = req.body || {};
  if (provider && !["google", "groq"].includes(provider)) {
    return res.status(400).json({ error: "provider must be 'google' or 'groq'" });
  }
  res.json(setConfig({ provider, model, apiKey }));
});

app.post("/api/config/test", async (_req, res) => {
  try {
    const ok = await testConnection(getSecret());
    res.json({ ok });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e.message || e) });
  }
});

// ---- Jobs --------------------------------------------------------------------
app.post("/api/jobs", (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== "string") return res.status(400).json({ error: "url is required" });
  const job = startJob(req.body);
  res.json({ id: job.id });
});

// Recent jobs (newest first) — for the UI history list.
app.get("/api/jobs", (_req, res) => res.json(listJobs()));

// Re-run: start a fresh job with the same URL + options as an existing one.
app.post("/api/jobs/:id/rerun", (req, res) => {
  const nj = rerunJob(req.params.id);
  if (!nj) return res.status(404).json({ error: "job not found" });
  res.json({ id: nj.id });
});

app.get("/api/jobs/:id", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  res.json(snapshot(job));
});

app.post("/api/jobs/:id/select", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "job not found" });
  const { segmentIds, segments } = req.body || {};
  const hasIds = Array.isArray(segmentIds) && segmentIds.length > 0;
  const hasSegments = Array.isArray(segments) && segments.length > 0;
  if (!hasIds && !hasSegments) {
    return res.status(400).json({ error: "segmentIds or segments (non-empty array) is required" });
  }
  try {
    selectAndRender(job, req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// Server-Sent Events: replay past events, then stream new ones.
app.get("/api/jobs/:id/events", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).end();
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  send({ type: "snapshot", value: snapshot(job) });
  job.events.forEach(send);
  const onEvent = (ev) => send(ev);
  job.emitter.on("event", onEvent);
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  req.on("close", () => {
    clearInterval(ping);
    job.emitter.off("event", onEvent);
  });
});

// Serve the downloaded source video for the in-browser clip editor.
// sendFile handles HTTP range requests, so <video> scrubbing/seeking works.
app.get("/api/jobs/:id/input", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).end();
  const file = path.join(job.tmp, "input.mp4");
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

// Auto-transcribed captions (word tokens) for the clip editor to edit.
app.get("/api/jobs/:id/captions", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).end();
  const file = path.join(job.tmp, "transcript.json");
  if (!fs.existsSync(file)) return res.json({ captions: [] });
  try {
    const t = JSON.parse(fs.readFileSync(file, "utf-8"));
    res.json({ captions: t.captions || [] });
  } catch {
    res.json({ captions: [] });
  }
});

// Previously-rendered clip segments for a job (to reopen it in the editor).
app.get("/api/jobs/:id/segments", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).end();
  const file = path.join(job.tmp, "approved_segments.json");
  if (!fs.existsSync(file)) return res.json({ segments: [] });
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    res.json({ segments: data.segments || [] });
  } catch {
    res.json({ segments: [] });
  }
});

// Serve a rendered/exported short.
app.get("/api/jobs/:id/file/:name", (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).end();
  const file = path.join(job.tmp, "out", path.basename(req.params.name));
  if (!fs.existsSync(file)) return res.status(404).end();
  res.sendFile(file);
});

app.listen(PORT, () => {
  console.log(`[shorts-server] http://localhost:${PORT}`);
});
