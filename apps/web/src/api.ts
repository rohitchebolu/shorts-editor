// Thin client for the orchestrator API.
export type Provider = "google" | "groq";

export type ProviderConfig = {
  provider: Provider | null;
  model: string;
  hasKey: boolean;
};

export type Candidate = {
  id: number;
  start: number;
  end: number;
  hook_line1: string;
  hook_line2?: string;
  score: number;
  rationale: string;
};

export type Caption = { text: string; startMs: number; endMs: number };

// A segment authored/edited in the clip editor (a manual cut or an edited AI candidate).
export type EditorSegment = {
  start: number;
  end: number;
  title?: string;
  subtitle?: string;
  captions?: Caption[];
  captionsOff?: boolean;
  captionStyle?: string;
};

export type Output = { file: string; url: string };

export type JobSummary = {
  id: string;
  url: string;
  status: string;
  phase: number;
  createdAt: number;
  outputs: number;
  options: { model?: string; backend?: string; maxHeight?: number };
};

async function json<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as any).error || `HTTP ${r.status}`);
  return body as T;
}

export const getConfig = () => fetch("/api/config").then((r) => json<ProviderConfig>(r));

export const saveConfig = (body: { provider?: Provider; model?: string; apiKey?: string }) =>
  fetch("/api/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<ProviderConfig>(r));

export const testConfig = () =>
  fetch("/api/config/test", { method: "POST" }).then((r) => json<{ ok: boolean; error?: string }>(r));

export const startJob = (body: { url: string; model?: string; backend?: string; maxHeight?: number; mode?: string }) =>
  fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<{ id: string }>(r));

export const listJobs = () => fetch("/api/jobs").then((r) => json<JobSummary[]>(r));

export const rerunJob = (id: string) =>
  fetch(`/api/jobs/${id}/rerun`, { method: "POST" }).then((r) => json<{ id: string }>(r));

export const selectSegments = (
  id: string,
  body: { segmentIds?: number[]; segments?: EditorSegment[]; style?: string; platform?: string }
) =>
  fetch(`/api/jobs/${id}/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then((r) => json<{ ok: boolean }>(r));

/** URL of the downloaded source video for a job (for the clip editor's <video>). */
export const inputUrl = (id: string) => `/api/jobs/${id}/input`;

/** Fetch the auto-transcribed caption tokens for a job (for the caption editor). */
export const getCaptions = (id: string) =>
  fetch(`/api/jobs/${id}/captions`).then((r) => json<{ captions: Caption[] }>(r));

/** Subscribe to a job's SSE stream. Returns an unsubscribe fn. */
export function subscribe(id: string, onEvent: (ev: any) => void): () => void {
  const es = new EventSource(`/api/jobs/${id}/events`);
  es.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      /* ignore keep-alive */
    }
  };
  return () => es.close();
}
