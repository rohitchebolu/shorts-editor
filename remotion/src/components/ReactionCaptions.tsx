import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { useCaptionPages } from "../hooks/useCaptionPages";
import { REACTION_THEME } from "../styles/theme";
import type { Caption } from "../types";

interface ReactionCaptionsProps {
  captions: Caption[];
}

/**
 * Reaction-style captions for the 4:3 preset: same font as the hook
 * (Montserrat 800), max 1-2 words on screen at a time, white with the
 * spoken word in the accent color. A word wrapped in *asterisks* (via the
 * caption editor) stays accent-colored for extra emphasis.
 *
 * Font: Montserrat 800 (matches HookBand)
 * Words per page: 1-2 (600ms combine window + hard cap of 2)
 * Animation: quick pop-in, barely any overshoot
 */
export const ReactionCaptions: React.FC<ReactionCaptionsProps> = ({ captions }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTimeMs = (frame / fps) * 1000;

  const pages = useCaptionPages(captions, 600, 2);

  const currentPage = pages.find(
    (p) => currentTimeMs >= p.startMs && currentTimeMs < p.startMs + p.durationMs
  );

  if (!currentPage) return null;

  const pageStartFrame = Math.floor((currentPage.startMs / 1000) * fps);
  const localFrame = frame - pageStartFrame;

  // Quick, clean pop: 0.88 → 1.0 with minimal bounce
  const pop = spring({
    frame: localFrame,
    fps,
    config: { mass: 0.6, damping: 15, stiffness: 260 },
  });
  const scale = interpolate(pop, [0, 1], [0.88, 1]);

  return (
    <div
      style={{
        position: "absolute",
        bottom: 350,
        left: 40,
        right: 40,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 18,
        transform: `scale(${scale})`,
      }}
    >
      {currentPage.tokens.map((token, i) => {
        const isActive = currentTimeMs >= token.fromMs && currentTimeMs < token.toMs;
        // Any token carrying a * (from *word* markup in the caption editor) is
        // emphasized permanently — transcript text never contains asterisks, and
        // multi-word marks split across tokens still light up each word.
        const isMarked = token.text.includes("*");

        return (
          <span
            key={`${currentPage.startMs}-${i}`}
            style={{
              fontFamily: "'Montserrat', 'Noto Sans Telugu', sans-serif",
              fontWeight: 800,
              fontSize: 80,
              textTransform: "uppercase",
              letterSpacing: 1,
              color:
                isMarked || isActive
                  ? REACTION_THEME.accentColor
                  : REACTION_THEME.textColor,
              textShadow: `
                3px 3px 0 ${REACTION_THEME.strokeColor},
                -3px -3px 0 ${REACTION_THEME.strokeColor},
                3px -3px 0 ${REACTION_THEME.strokeColor},
                -3px 3px 0 ${REACTION_THEME.strokeColor},
                0 8px 24px rgba(0, 0, 0, 0.55)
              `,
              lineHeight: 1.15,
              textAlign: "center",
            }}
          >
            {token.text.replace(/\*/g, "").trim().toUpperCase()}
          </span>
        );
      })}
    </div>
  );
};
