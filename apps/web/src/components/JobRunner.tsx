import { useEffect, useRef, useState } from "react";
import {
  startJob,
  selectSegments,
  subscribe,
  listJobs,
  rerunJob,
  type Candidate,
  type EditorSegment,
  type Output,
  type ProviderConfig,
  type JobSummary,
} from "../api";
import ClipEditor from "./ClipEditor";

const STAGES = [
  "fetch",
  "transcribe",
  "detect",
  "score",
  "snap",
  "extract",
  "reframe",
  "render",
  "export",
] as const;
type Stage = (typeof STAGES)[number];
type StageState = "pending" | "running" | "done" | "error";

const STAGE_LABEL: Record<Stage, string> = {
  fetch: "Fetch (yt-dlp)",
  transcribe: "Transcribe (Whisper)",
  detect: "Detect content type",
  score: "Score clips (LLM)",
  snap: "Snap boundaries",
  extract: "Extract clips",
  reframe: "Reframe 9:16",
  render: "Render (Remotion)",
  export: "Export",
};

// macOS (incl. Apple Silicon) runs the GPU-accelerated Whisper `mlx` backend, so
// default the backend to mlx there; other platforms default to faster-whisper (CPU).
const IS_MAC =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent || "");

export default function JobRunner({ config }: { config: ProviderConfig }) {
  const [url, setUrl] = useState("");
  const [model, setModel] = useState(IS_MAC ? "large-v3-turbo" : "small");
  const [backend, setBackend] = useState(IS_MAC ? "mlx" : "faster-whisper");
  const [mode, setMode] = useState<"ai" | "manual">("ai");

  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [jobMode, setJobMode] = useState<string>("ai");
  const [duration, setDuration] = useState(0);
  const [stageState, setStageState] = useState<Record<string, StageState>>({});
  const [logs, setLogs] = useState<string[]>([]);
  const [transcript, setTranscript] = useState<any>(null);
  const [contentType, setContentType] = useState<any>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [style, setStyle] = useState("bold");
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recentJobs, setRecentJobs] = useState<JobSummary[]>([]);
  const unsubRef = useRef<null | (() => void)>(null);

  const refreshRecent = () => listJobs().then(setRecentJobs).catch(() => {});

  useEffect(() => {
    refreshRecent();
    return () => unsubRef.current?.();
  }, []);

  function reset() {
    setStageState(Object.fromEntries(STAGES.map((s) => [s, "pending"])));
    setLogs([]);
    setTranscript(null);
    setContentType(null);
    setCandidates([]);
    setDuration(0);
    setOutputs([]);
    setError(null);
  }

  function onEvent(ev: any) {
    switch (ev.type) {
      case "stage":
        setStageState((m) => ({ ...m, [ev.stage]: ev.status }));
        break;
      case "log":
        setLogs((l) => [...l.slice(-60), `[${ev.stage}] ${ev.line}`]);
        break;
      case "data":
        if (ev.key === "transcript") {
          setTranscript(ev.value);
          setDuration(ev.value?.duration || 0);
        }
        if (ev.key === "contentType") setContentType(ev.value);
        if (ev.key === "candidates") setCandidates(ev.value);
        break;
      case "status":
        setStatus(ev.status);
        if (ev.status === "awaiting_selection") {
          if (ev.mode) setJobMode(ev.mode);
          if (ev.duration) setDuration(ev.duration);
          if (ev.candidates) setCandidates(ev.candidates);
          if (ev.contentType) setContentType(ev.contentType);
          if (ev.recommendedStyle) setStyle(ev.recommendedStyle);
        }
        if (ev.status === "done") setOutputs(ev.outputs || []);
        if (ev.status === "error") setError(ev.error);
        refreshRecent();
        break;
      case "snapshot":
        // hydrate on (re)connect / when viewing a past job
        if (ev.value?.options?.mode) setJobMode(ev.value.options.mode);
        if (ev.value?.transcript?.duration) setDuration(ev.value.transcript.duration);
        if (ev.value?.candidates?.length) setCandidates(ev.value.candidates);
        if (ev.value?.contentType) setContentType(ev.value.contentType);
        if (ev.value?.status) setStatus(ev.value.status);
        if (ev.value?.outputs?.length) setOutputs(ev.value.outputs);
        if (ev.value?.status === "done")
          setStageState(Object.fromEntries(STAGES.map((s) => [s, "done"])));
        break;
    }
  }

  function attach(id: string) {
    reset();
    setJobId(id);
    setStatus("running");
    unsubRef.current?.();
    unsubRef.current = subscribe(id, onEvent);
  }

  async function run() {
    try {
      const { id } = await startJob({ url, model, backend, maxHeight: 1080, mode });
      attach(id);
    } catch (e: any) {
      setError(e.message);
      setStatus("error");
    }
  }

  async function rerun(id: string) {
    try {
      const { id: newId } = await rerunJob(id);
      attach(newId);
      refreshRecent();
    } catch (e: any) {
      setError(e.message);
    }
  }

  // Load a past job into the view (its snapshot populates status/candidates/outputs).
  function view(id: string) {
    attach(id);
  }

  // Render the segments authored/edited in the timeline editor.
  async function renderSegments(segments: EditorSegment[], platform: string) {
    if (!jobId) return;
    try {
      await selectSegments(jobId, { segments, style, platform });
      setStatus("running");
    } catch (e: any) {
      setError(e.message);
    }
  }

  const running = status === "running";
  const canStart = !!url && (mode === "manual" || config.hasKey) && !running;
  const stages = jobMode === "manual" ? STAGES.filter((s) => s !== "score") : STAGES;

  return (
    <>
      <div className="panel">
        <h2>New short</h2>
        <div className="row">
          <div className="field grow">
            <label>YouTube URL (or local file path)</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </div>
          <div className="field" style={{ maxWidth: 130 }}>
            <label>Whisper model</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              <option>tiny</option>
              <option>base</option>
              <option>small</option>
              <option>medium</option>
              <option>large-v3</option>
              <option>large-v3-turbo</option>
            </select>
          </div>
          <div className="field" style={{ maxWidth: 150 }}>
            <label>Backend</label>
            <select value={backend} onChange={(e) => setBackend(e.target.value)}>
              <option value="faster-whisper">faster-whisper (CPU)</option>
              <option value="mlx">mlx (Apple GPU)</option>
              <option value="hf">Tenglish model (HF · needs extra)</option>
            </select>
          </div>
          <div className="field" style={{ maxWidth: 150 }}>
            <label>Mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as "ai" | "manual")}>
              <option value="ai">AI suggest ✨</option>
              <option value="manual">Manual ✎</option>
            </select>
          </div>
          <button onClick={run} disabled={!canStart}>
            {running ? "Running…" : "Start"}
          </button>
        </div>
        {mode === "ai" && !config.hasKey && (
          <p className="err" style={{ marginBottom: 0 }}>
            Configure an LLM provider above for AI suggestions, or switch Mode to Manual.
          </p>
        )}
      </div>

      {jobId && (
        <div className="panel">
          <h2>
            Progress <span className="mono muted" style={{ fontSize: 12 }}>{jobId}</span>
          </h2>
          <ul className="steps">
            {stages.map((s) => {
              const st = (stageState[s] || "pending") as StageState;
              return (
                <li key={s} className={`step ${st}`}>
                  <span className="dot">{st === "done" ? "✓" : st === "error" ? "!" : ""}</span>
                  <span className="name">{STAGE_LABEL[s]}</span>
                  {s === "detect" && contentType && (
                    <span className="meta">content: {contentType.content_type}</span>
                  )}
                  {s === "transcribe" && transcript && (
                    <span className="meta">
                      {transcript.language} · {transcript.word_count} words
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {logs.length > 0 && <div className="log">{logs.slice(-12).join("\n")}</div>}
          {error && <p className="err">{error}</p>}
        </div>
      )}

      {status === "awaiting_selection" && jobId && (
        <ClipEditor
          key={jobId}
          jobId={jobId}
          duration={duration}
          candidates={candidates}
          rendering={running}
          onRender={renderSegments}
        />
      )}

      {outputs.length > 0 && (
        <div className="panel">
          <h2>Done — {outputs.length} short{outputs.length === 1 ? "" : "s"}</h2>
          <div className="outputs">
            {outputs.map((o) => (
              <div key={o.file}>
                <video src={o.url} controls playsInline />
                <div className="muted mono" style={{ fontSize: 12 }}>
                  {o.file} · <a href={o.url} download>download</a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recentJobs.length > 0 && (
        <div className="panel">
          <h2>Recent jobs</h2>
          <table>
            <tbody>
              {recentJobs.map((j) => (
                <tr key={j.id}>
                  <td
                    className="mono"
                    style={{ maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    title={j.url}
                  >
                    {j.url}
                  </td>
                  <td>
                    <span
                      className={`pill ${
                        j.status === "done"
                          ? "ok"
                          : j.status === "error" || j.status === "interrupted"
                          ? "warn"
                          : ""
                      }`}
                    >
                      {j.status}
                    </span>
                  </td>
                  <td className="muted">{j.outputs > 0 ? `${j.outputs} clip${j.outputs === 1 ? "" : "s"}` : ""}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {j.outputs > 0 && (
                      <button className="ghost" onClick={() => view(j.id)} style={{ marginRight: 6 }}>
                        View
                      </button>
                    )}
                    <button className="ghost" onClick={() => rerun(j.id)} disabled={running}>
                      Re-run
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
