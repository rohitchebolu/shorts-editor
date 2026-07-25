import { useEffect, useRef, useState } from "react";
import { inputUrl, getCaptions, type Candidate, type Caption, type EditorSegment } from "../api";

// A clip being edited on the timeline. `id` is a local key only.
// captionText: null = use the auto transcript text; a string = user-edited text.
type Clip = {
  id: number;
  start: number;
  end: number;
  title: string;
  subtitle: string;
  captionsOff: boolean;
  captionStyle: string;
  captionText: string | null;
  layout: string;
  captionY: number;
};

type Drag =
  | { kind: "create"; anchor: number; start: number; end: number }
  | { kind: "move"; id: number; grabOffset: number; len: number }
  | { kind: "trim-start"; id: number }
  | { kind: "trim-end"; id: number };

const MIN_CLIP = 3; // seconds — sub-3s drags are treated as a seek, not a clip
const SWEET_LO = 15;
const SWEET_HI = 40;
const NEW_LEN = 40; // default length for "add at playhead"

const fmt = (s: number) =>
  `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, "0")}`;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

let uid = 0;
const newClip = (start: number, end: number, title = "", subtitle = ""): Clip => ({
  id: ++uid,
  start,
  end,
  title,
  subtitle,
  captionsOff: false,
  captionStyle: "bold",
  captionText: null,
  layout: "fill",
  captionY: 0.8,
});

const clipsFromCandidates = (cands: Candidate[]): Clip[] =>
  cands.map((c) => newClip(c.start, c.end, c.hook_line1 || "", c.hook_line2 || ""));

// Parse "ss", "mm:ss", or "hh:mm:ss" into seconds; null if not a valid time.
function parseTime(str: string): number | null {
  const s = str.trim();
  if (!s) return null;
  const parts = s.split(":");
  if (parts.length > 3 || parts.some((p) => p.trim() === "" || !/^\d*\.?\d*$/.test(p.trim()))) return null;
  const n = parts.map((p) => Number(p));
  if (n.some((x) => Number.isNaN(x) || x < 0)) return null;
  return n.length === 1 ? n[0] : n.length === 2 ? n[0] * 60 + n[1] : n[0] * 3600 + n[1] * 60 + n[2];
}

// Editable mm:ss (or hh:mm:ss) time field. Commits on blur/Enter; reverts if invalid.
function TimeInput({ value, onCommit, title }: { value: number; onCommit: (s: number) => void; title?: string }) {
  const [text, setText] = useState(() => fmt(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(fmt(value));
  }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const parsed = parseTime(text);
    if (parsed == null) setText(fmt(value)); // revert on invalid
    else onCommit(parsed);
  };
  return (
    <input
      className="timeinput mono"
      value={text}
      title={title}
      inputMode="numeric"
      onFocus={() => setEditing(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

/**
 * In-browser clip editor. Both modes feed into this: AI mode pre-loads its
 * candidates as editable clips; Manual mode starts empty. Drag the track to
 * create, drag a clip to move, drag an edge to trim. Per clip: title/subtitle
 * overlay + editable captions (edit text, keep timings, toggle + style).
 */
export default function ClipEditor({
  jobId,
  duration,
  candidates,
  rendering,
  onRender,
}: {
  jobId: string;
  duration: number;
  candidates: Candidate[];
  rendering: boolean;
  onRender: (segments: EditorSegment[], platform: string) => void;
}) {
  const [clips, setClips] = useState<Clip[]>(() => clipsFromCandidates(candidates));
  const [selectedId, setSelectedId] = useState<number | null>(clips[0]?.id ?? null);
  const [dur, setDur] = useState(duration || 0);
  const [now, setNow] = useState(0);
  const [platform, setPlatform] = useState("youtube");
  const [pending, setPending] = useState<{ start: number; end: number } | null>(null);
  const [allCaps, setAllCaps] = useState<Caption[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const videoWrapRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const capDragRef = useRef(false);

  // Auto-transcribed caption tokens (absolute ms) — the source for caption editing.
  useEffect(() => {
    getCaptions(jobId)
      .then((r) => setAllCaps(r.captions || []))
      .catch(() => setAllCaps([]));
  }, [jobId]);

  // Seed from AI candidates if they stream in after mount and nothing's drawn yet.
  useEffect(() => {
    if (candidates.length) setClips((cs) => (cs.length ? cs : clipsFromCandidates(candidates)));
  }, [candidates]);

  const pxToTime = (clientX: number) => {
    const el = trackRef.current;
    if (!el || dur <= 0) return 0;
    const r = el.getBoundingClientRect();
    return clamp(((clientX - r.left) / r.width) * dur, 0, dur);
  };
  const pct = (t: number) => (dur > 0 ? (t / dur) * 100 : 0);

  // Word tokens inside a clip's window, and their joined auto text.
  const capsFor = (c: Clip) =>
    allCaps.filter((w) => w.startMs >= c.start * 1000 && w.endMs <= c.end * 1000);
  const autoText = (c: Clip) => capsFor(c).map((w) => w.text).join("").trim();

  // Global pointer listeners while dragging (re-attached only when `dur` changes).
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const t = pxToTime(e.clientX);
      if (d.kind === "create") {
        d.start = Math.min(d.anchor, t);
        d.end = Math.max(d.anchor, t);
        setPending({ start: d.start, end: d.end });
      } else if (d.kind === "move") {
        setClips((cs) =>
          cs.map((c) => {
            if (c.id !== d.id) return c;
            const start = clamp(t - d.grabOffset, 0, Math.max(0, dur - d.len));
            return { ...c, start, end: start + d.len };
          })
        );
      } else if (d.kind === "trim-start") {
        setClips((cs) =>
          cs.map((c) => (c.id === d.id ? { ...c, start: clamp(t, 0, c.end - MIN_CLIP) } : c))
        );
      } else if (d.kind === "trim-end") {
        setClips((cs) =>
          cs.map((c) => (c.id === d.id ? { ...c, end: clamp(t, c.start + MIN_CLIP, dur) } : c))
        );
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (d?.kind === "create") {
        const { start, end } = d;
        setPending(null);
        if (end - start >= MIN_CLIP) {
          const clip = newClip(start, end);
          setClips((cs) => [...cs, clip].sort((a, b) => a.start - b.start));
          setSelectedId(clip.id);
        } else if (videoRef.current) {
          videoRef.current.currentTime = start; // sub-threshold drag = seek
        }
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [dur]);

  const startCreate = (e: React.PointerEvent) => {
    if (e.target !== trackRef.current) return; // only empty track, not a clip
    const t = pxToTime(e.clientX);
    dragRef.current = { kind: "create", anchor: t, start: t, end: t };
    setPending({ start: t, end: t });
  };
  const startMove = (e: React.PointerEvent, c: Clip) => {
    e.stopPropagation();
    setSelectedId(c.id);
    dragRef.current = { kind: "move", id: c.id, grabOffset: pxToTime(e.clientX) - c.start, len: c.end - c.start };
  };
  const startTrim = (e: React.PointerEvent, c: Clip, edge: "start" | "end") => {
    e.stopPropagation();
    setSelectedId(c.id);
    dragRef.current = { kind: edge === "start" ? "trim-start" : "trim-end", id: c.id };
  };

  const update = (id: number, patch: Partial<Clip>) =>
    setClips((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  // Manual time entry: clamp start below end (min length) and end within the video.
  const setStart = (c: Clip, s: number) =>
    update(c.id, { start: Math.max(0, Math.min(s, c.end - MIN_CLIP)) });
  const setEnd = (c: Clip, s: number) =>
    update(c.id, { end: Math.max(c.start + MIN_CLIP, dur > 0 ? Math.min(s, dur) : s) });
  const remove = (id: number) => {
    setClips((cs) => cs.filter((c) => c.id !== id));
    setSelectedId((s) => (s === id ? null : s));
  };
  const seek = (t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t;
  };
  const addAtPlayhead = () => {
    const start = clamp(now, 0, Math.max(0, dur - MIN_CLIP));
    const clip = newClip(start, clamp(start + NEW_LEN, start + MIN_CLIP, dur));
    setClips((cs) => [...cs, clip].sort((a, b) => a.start - b.start));
    setSelectedId(clip.id);
  };

  // Build the caption override for a clip: off, edited (zip words with token
  // timings by index), or omitted (server auto-fills from the transcript window).
  const capOverride = (c: Clip): Partial<EditorSegment> => {
    if (c.captionsOff) return { captionsOff: true, captionStyle: c.captionStyle };
    if (c.captionText != null) {
      const toks = capsFor(c);
      const words = c.captionText.trim().split(/\s+/).filter(Boolean);
      const captions: Caption[] = toks.map((t, i) => ({
        text: (i === 0 ? "" : " ") + (words[i] ?? t.text.trim()),
        startMs: t.startMs,
        endMs: t.endMs,
      }));
      return { captions, captionStyle: c.captionStyle };
    }
    return { captionStyle: c.captionStyle };
  };

  const ready = clips.filter((c) => c.end - c.start >= MIN_CLIP);
  const submit = () =>
    onRender(
      [...ready]
        .sort((a, b) => a.start - b.start)
        .map((c) => ({
          start: c.start,
          end: c.end,
          title: c.title,
          subtitle: c.subtitle,
          layout: c.layout,
          captionY: c.captionY,
          ...capOverride(c),
        })),
      platform
    );

  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const sel = clips.find((c) => c.id === selectedId) || null;

  // Drag the caption position marker over the video preview (vertical only).
  const onCapDown = (e: React.PointerEvent) => {
    if (!sel) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    capDragRef.current = true;
  };
  const onCapMove = (e: React.PointerEvent) => {
    if (!capDragRef.current || !sel || !videoWrapRef.current) return;
    const r = videoWrapRef.current.getBoundingClientRect();
    update(sel.id, { captionY: clamp((e.clientY - r.top) / r.height, 0.05, 0.95) });
  };
  const onCapUp = (e: React.PointerEvent) => {
    capDragRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="panel">
      <h2>Edit clips on the timeline</h2>
      <div ref={videoWrapRef} style={{ position: "relative", lineHeight: 0 }}>
        <video
          ref={videoRef}
          src={inputUrl(jobId)}
          controls
          playsInline
          onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDur(e.currentTarget.duration || duration || 0)}
          style={{ width: "100%", maxHeight: 360, borderRadius: 10, background: "#000", display: "block" }}
        />
        {sel && !sel.captionsOff && (
          <div
            className="capghost"
            style={{ top: `${(sel.captionY ?? 0.8) * 100}%` }}
            title="Drag to move captions up/down"
            onPointerDown={onCapDown}
            onPointerMove={onCapMove}
            onPointerUp={onCapUp}
          >
            Captions ⇕
          </div>
        )}
      </div>

      <div className="row" style={{ margin: "10px 0", alignItems: "center" }}>
        <button className="ghost" onClick={addAtPlayhead} disabled={dur <= 0}>
          + Add clip at playhead
        </button>
        <span className="muted mono" style={{ fontSize: 12 }}>
          {fmt(now)} / {fmt(dur)}
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          Drag the track to create · drag a clip to move · drag an edge to trim
        </span>
      </div>

      <div className="timeline" ref={trackRef} onPointerDown={startCreate}>
        {sorted.map((c) => (
          <div
            key={c.id}
            className={`timeline-clip${c.id === selectedId ? " sel" : ""}`}
            style={{ left: `${pct(c.start)}%`, width: `${pct(c.end - c.start)}%` }}
            onPointerDown={(e) => startMove(e, c)}
            title={`${fmt(c.start)}–${fmt(c.end)}`}
          >
            <span className="handle l" onPointerDown={(e) => startTrim(e, c, "start")} />
            <span className="clip-label">{c.title || fmt(c.start)}</span>
            <span className="handle r" onPointerDown={(e) => startTrim(e, c, "end")} />
          </div>
        ))}
        {pending && (
          <div
            className="timeline-pending"
            style={{ left: `${pct(pending.start)}%`, width: `${pct(pending.end - pending.start)}%` }}
          />
        )}
        <div className="playhead" style={{ left: `${pct(now)}%` }} />
      </div>

      {sorted.length > 0 ? (
        <table>
          <thead>
            <tr>
              <th>In → Out</th>
              <th>Dur</th>
              <th>Title / subtitle</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c) => {
              const d = c.end - c.start;
              const off = d < SWEET_LO || d > SWEET_HI;
              return (
                <tr key={c.id} className={c.id === selectedId ? "sel" : ""} onClick={() => setSelectedId(c.id)}>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>
                    <TimeInput value={c.start} title="Start (mm:ss)" onCommit={(s) => setStart(c, s)} />
                    {" → "}
                    <TimeInput value={c.end} title="End (mm:ss)" onCommit={(s) => setEnd(c, s)} />
                  </td>
                  <td className={off ? "warn-dur" : ""} title={off ? "outside the 15–40s sweet spot" : ""}>
                    {Math.round(d)}s
                  </td>
                  <td>
                    <input
                      value={c.title}
                      placeholder="Title (top overlay)"
                      onChange={(e) => update(c.id, { title: e.target.value })}
                      style={{ marginBottom: 4 }}
                    />
                    <input
                      value={c.subtitle}
                      placeholder="Subtitle (optional)"
                      onChange={(e) => update(c.id, { subtitle: e.target.value })}
                    />
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="ghost" onClick={() => seek(c.start)} title="Preview from start">
                      ▶
                    </button>{" "}
                    <button className="ghost" onClick={() => remove(c.id)} title="Delete clip">
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="muted">No clips yet — drag on the track above, or use “Add clip at playhead”.</p>
      )}

      {sel && (
        <div className="capbox">
          <div className="row" style={{ alignItems: "flex-end", marginBottom: 10 }}>
            <div className="field" style={{ maxWidth: 260 }}>
              <label>Layout · clip {fmt(sel.start)}–{fmt(sel.end)}</label>
              <select value={sel.layout} onChange={(e) => update(sel.id, { layout: e.target.value })}>
                <option value="fill">Full screen (crop to fill)</option>
                <option value="fit">Letterbox + title card</option>
              </select>
            </div>
          </div>
          <div className="row" style={{ alignItems: "flex-end", justifyContent: "space-between" }}>
            <strong style={{ fontSize: 13 }}>
              Captions
            </strong>
            <label className="chk">
              <input
                type="checkbox"
                checked={!sel.captionsOff}
                onChange={(e) => update(sel.id, { captionsOff: !e.target.checked })}
              />
              Show captions
            </label>
            <div className="field" style={{ maxWidth: 120 }}>
              <label>Style</label>
              <select
                value={sel.captionStyle}
                disabled={sel.captionsOff}
                onChange={(e) => update(sel.id, { captionStyle: e.target.value })}
              >
                <option value="bold">bold</option>
                <option value="bounce">bounce</option>
                <option value="clean">clean</option>
              </select>
            </div>
          </div>
          {!sel.captionsOff && (
            <>
              <textarea
                className="capedit"
                rows={4}
                value={sel.captionText ?? autoText(sel)}
                onChange={(e) => update(sel.id, { captionText: e.target.value })}
                placeholder={allCaps.length ? "" : "No transcript captions for this clip."}
              />
              <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
                Fix wording only — original word timings are kept.{" "}
                {sel.captionText != null && (
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      update(sel.id, { captionText: null });
                    }}
                  >
                    reset to auto
                  </a>
                )}
              </p>
            </>
          )}
        </div>
      )}

      <div className="row" style={{ marginTop: 14, alignItems: "flex-end" }}>
        <div className="field" style={{ maxWidth: 150 }}>
          <label>Platform</label>
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="youtube">YouTube</option>
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="all">All</option>
          </select>
        </div>
        <button onClick={submit} disabled={rendering || ready.length === 0}>
          Render {ready.length} clip{ready.length === 1 ? "" : "s"}
        </button>
      </div>
    </div>
  );
}
