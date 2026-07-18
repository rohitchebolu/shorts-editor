import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

interface HookOverlayProps {
  line1: string;
  line2: string;
}

/**
 * Title / hook overlay pinned to the top-center of the video.
 *
 * Line 1: large white title — the attention-grabbing hook (from the LLM).
 * Line 2: optional smaller cyan subtitle for context.
 *
 * Springs in over the first ~0.5s, then stays on screen for the whole clip
 * so it reads as a persistent title rather than a brief intro card.
 */
export const HookOverlay: React.FC<HookOverlayProps> = ({ line1, line2 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Spring pop-in on entry, then hold at full scale for the rest of the clip.
  const scale = spring({
    frame,
    fps,
    config: { mass: 1, damping: 14, stiffness: 200 },
  });

  // Quick fade-in; stays fully visible afterwards (no fade-out).
  const opacity = interpolate(frame, [0, Math.round(0.35 * fps)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        top: 150,
        left: 60,
        right: 60,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      {line1 && (
        <div
          style={{
            fontFamily: "'Montserrat', sans-serif",
            fontWeight: 800,
            fontSize: 56,
            color: "white",
            textShadow:
              "3px 3px 0 black, -3px -3px 0 black, 3px -3px 0 black, -3px 3px 0 black",
            textAlign: "center",
            lineHeight: 1.15,
          }}
        >
          {line1}
        </div>
      )}
      {line2 && (
        <div
          style={{
            fontFamily: "'Inter', sans-serif",
            fontWeight: 600,
            fontSize: 30,
            color: "#00BFFF",
            textShadow: "2px 2px 0 black",
            textAlign: "center",
            lineHeight: 1.3,
          }}
        >
          {line2}
        </div>
      )}
    </div>
  );
};
