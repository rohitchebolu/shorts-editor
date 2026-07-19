// The "brain" — replaces Claude's in-session scoring with a pluggable provider.
// Uses the Vercel AI SDK so Gemini (Google) and Groq share one interface and both
// return validated, structured JSON (no fragile prompt-parsing).
import { generateObject } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { z } from "zod";

const CandidatesSchema = z.object({
  candidates: z
    .array(
      z.object({
        start: z.number().describe("clip start time in seconds"),
        end: z.number().describe("clip end time in seconds"),
        hook_line1: z.string().describe("punchy on-screen hook shown in the first ~3s"),
        hook_line2: z.string().default("").describe("optional second hook line"),
        score: z.number().describe("overall retention score 0-100"),
        rationale: z.string().describe("one sentence: why this clip works"),
      })
    )
    .min(1),
});

/** Build an AI SDK model handle for the configured provider + user's API key. */
function resolveModel({ provider, model, apiKey }) {
  if (!provider) throw new Error("No LLM provider configured.");
  if (!apiKey) throw new Error("No API key configured for the provider.");
  if (!model) throw new Error("No model name configured.");
  if (provider === "google") return createGoogleGenerativeAI({ apiKey })(model);
  if (provider === "groq") return createGroq({ apiKey })(model);
  throw new Error(`Unknown provider: ${provider}`);
}

/**
 * Score a transcript into ranked candidate clips.
 * @param transcript parsed transcript.json ({ segments:[{start,end,text}], ... })
 * @param rubric     text of references/scoring-rubric.md
 * @param config     { provider, model, apiKey }
 */
export async function scoreSegments({ transcript, rubric, config }) {
  const model = resolveModel(config);

  const lines = (transcript.segments || [])
    .map((s) => `[${Number(s.start).toFixed(1)}-${Number(s.end).toFixed(1)}] ${s.text}`)
    .join("\n");

  // Scale the candidate pool with video length (~1 per 2 min): long videos get a
  // bigger pool to choose from, short ones aren't over-mined. Bounded to 6-24.
  const durationMin = (Number(transcript.duration) || 0) / 60;
  const target = Math.min(24, Math.max(6, Math.round(durationMin / 2)));
  const lo = Math.max(5, target - 2);
  const hi = target + 3;

  const system =
    "You are a senior financial-content strategist who makes viral short-form videos for a RETAIL " +
    "PERSONAL-FINANCE audience — everyday people focused on budgeting, saving, index investing, " +
    "taxes, debt payoff, and retirement (NOT active traders, options, or crypto speculators). " +
    "From a timestamped transcript, pick the " +
    `${lo}-${hi} best standalone clips to become vertical Shorts. ` +
    "Judge each clip like an analyst: what concrete, useful money takeaway does the viewer walk " +
    "away with, and is it specific and act-on-able for this audience? Ruthlessly down-score " +
    "anything that isn't financially substantive — intros, small talk, sponsor reads, off-topic " +
    "tangents — even if entertaining. Target 30-55s each, aiming for the 35-50s sweet spot (the " +
    "most-watched Shorts length); go shorter only when a tighter cut is clearly stronger, and " +
    "never exceed 55s so the clip can end on a full sentence. Score with the rubric's weighted " +
    "dimensions and apply its niche-relevance gate. Ground every hook in specifics actually " +
    "present in the transcript — never invent numbers, returns, or claims. Prefer clips that make " +
    "sense with zero outside context and end on a satisfying payoff.";

  const prompt =
    `Scoring rubric:\n${rubric}\n\n` +
    `Transcript (timestamps in seconds):\n${lines}\n\n` +
    `Return ${lo}-${hi} candidate clips. For each: start/end in seconds (must fall within the ` +
    `transcript), a specific hook_line1 grounded in what's actually said, a score 0-100, and a ` +
    `one-sentence rationale naming the money takeaway a retail personal-finance viewer gets.`;

  const { object } = await generateObject({ model, schema: CandidatesSchema, system, prompt, temperature: 0.2 });
  return [...object.candidates].sort((a, b) => b.score - a.score);
}

/** Cheap round-trip to validate the provider + model + key. */
export async function testConnection(config) {
  const model = resolveModel(config);
  const { object } = await generateObject({
    model,
    schema: z.object({ ok: z.boolean() }),
    prompt: 'Reply with exactly {"ok": true}.',
  });
  return object.ok === true;
}
