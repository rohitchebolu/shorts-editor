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
        hook_line1: z
          .string()
          .describe(
            "punchy on-screen hook; wrap exactly ONE power word in *asterisks* — it renders in an accent color"
          ),
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
    "You are a short-form editor for a Telugu food vlogger. You pick the most entertaining " +
    "REACTION moments from his tasting/exploring videos to become vertical Shorts. The transcript " +
    "is romanized Telugu (Tenglish) plus English and captures only what he SAYS — the on-camera " +
    "reaction is visual, so treat this as a best-effort helper, not the final say.\n\n" +
    `From the timestamped transcript, choose the ${lo}-${hi} strongest standalone reaction clips ` +
    "and score each. Follow these rules exactly:\n" +
    "1. Favor strong reactions: first-bite verdicts, exclamations (\"abba\", \"super\", " +
    "\"adirindi\", \"spicy\"), surprise, delight, disgust, big laughs, or a punchy opinion on the food.\n" +
    "2. Reject setup/filler — travel, walking, intros, prices, sponsor reads, flat narration — by scoring it low.\n" +
    "3. Each clip must run 15-40s (aim 20-35s), start and end on natural speech boundaries, and make sense on its own.\n" +
    "4. Score each clip 0-100 using the rubric's weighted dimensions.\n" +
    "5. Write hook_line1 as a punchy Tenglish/English hook of 3-7 words grounded ONLY in what he " +
    "actually says — never invent words. Wrap exactly ONE power word (the reaction/verdict word) " +
    "in *asterisks*; it is rendered in a bright accent color on screen (e.g. \"Idi *adirindi* anthe!\").\n" +
    `Return between ${lo} and ${hi} clips, highest score first.`;

  const prompt =
    `Scoring rubric:\n${rubric}\n\n` +
    `Transcript (timestamps in seconds):\n${lines}\n\n` +
    `Return ${lo}-${hi} candidate clips. For each: start/end in seconds (must fall within the ` +
    `transcript), a specific hook_line1 grounded in what's actually said, a score 0-100, and a ` +
    `one-sentence rationale naming the reaction or moment that makes the clip pop.`;

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
