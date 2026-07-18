import { useEffect, useRef, useState } from "react";
import {
  startJob,
  selectSegments,
  subscribe,
  listJobs,
  rerunJob,
  type Candidate,
  type Output,
  type ProviderConfig,
  type JobSummary,
} from "../api";

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

const mmss = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// macOS (incl. Apple Silicon) runs the GPU-accelerated Whisper `mlx` backend, so
// default the backend to mlx there; other platforms default to faster-whisper (CPU).
const IS_MAC =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent || "");

export default function JobRunner({ config }: { config: ProviderConfig }) {
  const [url, setUrl] = useState("");
  const [model, setModel] = useState(IS_MAC ? "large-v3-turbo" : "small");
  const [backend, setBackend] = useState(IS_MAC ? "mlx" : "faster-whisper");
  const [platform, setPlatform] = useState("youtube");

  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("idle");
  const [stageState, setStageState] = useState<Record<string, StageState>>({});
  const [logs, setLogs] = useState<string[]>([]);
  const [transcript, setTranscript] = useState<any>(null);
  const [contentType, setContentType] = useState<any>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
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
    setSelected(new Set());
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
        if (ev.key === "transcript") setTranscript(ev.value);
        if (ev.key === "contentType") setContentType(ev.value);
        if (ev.key === "candidates") setCandidates(ev.value);
        break;
      case "status":
        setStatus(ev.status);
        if (ev.status === "awaiting_selection") {
          if (ev.candidates) setCandidates(ev.candidates);
          if (ev.contentType) setContentType(ev.contentType);
          if (ev.recommendedStyle) setStyle(ev.recommendedStyle);
          // Auto-select the server's length-scaled, quality-gated recommendation.
          if (ev.recommendedIds) {
            setSelected(new Set(ev.recommendedIds));
          } else {
            setCandidates((cs) => {
              setSelected(new Set(cs.slice(0, 1).map((c) => c.id)));
              return cs;
            });
          }
        }
        if (ev.status === "done") setOutputs(ev.outputs || []);
        if (ev.status === "error") setError(ev.error);
        refreshRecent();
        break;
      case "snapshot":
        // hydrate on (re)connect / when viewing a past job
        if (ev.value?.candidates?.length) setCandidates(ev.value.candidates);
        if (ev.value?.recommendedIds) setSelected(new Set(ev.value.recommendedIds));
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
      const { id } = await startJob({ url, model, backend, maxHeight: 1080 });
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

  async function render() {
    if (!jobId) return;
    try {
      await selectSegments(jobId, { segmentIds: [...selected], style, platform });
      setStatus("running");
    } catch (e: any) {
      setError(e.message);
    }
  }

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const running = status === "running";
  const canStart = !!url && config.hasKey && !running;

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
            </select>
          </div>
          <button onClick={run} disabled={!canStart}>
            {running ? "Running…" : "Start"}
          </button>
        </div>
        {!config.hasKey && (
          <p className="err" style={{ marginBottom: 0 }}>
            Configure an LLM provider above before running.
          </p>
        )}
      </div>

      {jobId && (
        <div className="panel">
          <h2>
            Progress <span className="mono muted" style={{ fontSize: 12 }}>{jobId}</span>
          </h2>
          <ul className="steps">
            {STAGES.map((s) => {
              const st = (stageState[s] || "pending") as StageState;
              return (
                <li key={s} className={`step ${st}`}>
                  <span className="dot">{st === "done" ? "✓" : st === "error" ? "!" : ""}</span>
                  <span className="name">{STAGE_LABEL[s]}</span>
                  {s === "score" && contentType && (
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

      {status === "awaiting_selection" && candidates.length > 0 && (
        <div className="panel">
          <h2>Pick clips to render</h2>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Time</th>
                <th>Dur</th>
                <th>Score</th>
                <th>Hook / why</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id}>
                  <td>
                    <input
                      type="checkbox"
                      style={{ width: 18 }}
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                    />
                  </td>
                  <td className="mono">
                    {mmss(c.start)}→{mmss(c.end)}
                  </td>
                  <td>{Math.round(c.end - c.start)}s</td>
                  <td className="scorebadge">{Math.round(c.score)}</td>
                  <td>
                    <div className="hook">{c.hook_line1}</div>
                    <div className="why">{c.rationale}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 14 }}>
            <div className="field" style={{ maxWidth: 150 }}>
              <label>Platform</label>
              <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
                <option value="youtube">YouTube</option>
                <option value="tiktok">TikTok</option>
                <option value="instagram">Instagram</option>
                <option value="all">All</option>
              </select>
            </div>
            <button onClick={render} disabled={selected.size === 0}>
              Render {selected.size} clip{selected.size === 1 ? "" : "s"}
            </button>
          </div>
        </div>
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
