import { useMemo } from "react";
import { createTikTokStyleCaptions } from "@remotion/captions";
import type { Caption } from "../types";

type Pages = ReturnType<typeof createTikTokStyleCaptions>["pages"];

/**
 * Hard-cap tokens per page. createTikTokStyleCaptions only supports a time
 * window, so fast speech can still produce 3+ word pages — this re-chunks
 * them, recomputing each chunk's start/duration from its token timings so
 * the on-screen rhythm still follows the audio.
 */
const capTokensPerPage = (pages: Pages, maxTokens: number): Pages => {
  const result: Pages = [];
  for (const page of pages) {
    if (page.tokens.length <= maxTokens) {
      result.push(page);
      continue;
    }
    const pageEndMs = page.startMs + page.durationMs;
    for (let i = 0; i < page.tokens.length; i += maxTokens) {
      const tokens = page.tokens.slice(i, i + maxTokens);
      const next = page.tokens[i + maxTokens];
      const startMs = i === 0 ? page.startMs : tokens[0].fromMs;
      const endMs = next ? next.fromMs : Math.max(pageEndMs, tokens[tokens.length - 1].toMs);
      result.push({
        ...page,
        text: tokens.map((t) => t.text).join(""),
        startMs,
        durationMs: Math.max(1, endMs - startMs),
        tokens,
      });
    }
  }
  return result;
};

/**
 * Converts word-level captions into TikTok-style pages using
 * @remotion/captions createTikTokStyleCaptions().
 *
 * Each page groups N words together based on combineTokensWithinMilliseconds.
 * Pass maxTokensPerPage to hard-cap how many words share the screen.
 * Returns pages with: text, startMs, durationMs, tokens[{text, fromMs, toMs}]
 */
export const useCaptionPages = (
  captions: Caption[],
  combineMs: number = 800,
  maxTokensPerPage?: number
) => {
  return useMemo(() => {
    if (!captions || captions.length === 0) return [];

    // Convert our Caption format to Remotion's expected format
    const remotionCaptions = captions.map((c) => ({
      text: c.text,
      startMs: c.startMs,
      endMs: c.endMs,
      timestampMs: null as number | null,
      confidence: null as number | null,
    }));

    const { pages } = createTikTokStyleCaptions({
      captions: remotionCaptions,
      combineTokensWithinMilliseconds: combineMs,
    });

    return maxTokensPerPage ? capTokensPerPage(pages, maxTokensPerPage) : pages;
  }, [captions, combineMs, maxTokensPerPage]);
};
