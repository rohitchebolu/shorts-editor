import { renderAccented } from "./AccentText";

interface HookBandProps {
  line1: string;
  line2: string;
  bandTop: number; // y (px) of the video band's top edge — the hook centers in the bar above it
}

/**
 * Clean hook text for the 4:3 reaction layout: centered in the black bar
 * above the video. No outline/shadow (it sits on pure black), Montserrat 800,
 * with `*word*` markup rendering one word in the accent color.
 *
 * Static (no animation) so the hook is readable from the very first frame.
 */
export const HookBand: React.FC<HookBandProps> = ({ line1, line2, bandTop }) => {
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: bandTop,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: "40px 70px",
        gap: 20,
      }}
    >
      {line1 && (
        <div
          style={{
            fontFamily: "'Montserrat', 'Noto Sans Telugu', sans-serif",
            fontWeight: 800,
            fontSize: 60,
            lineHeight: 1.25,
            color: "white",
            textAlign: "center",
          }}
        >
          {renderAccented(line1)}
        </div>
      )}
      {line2 && (
        <div
          style={{
            fontFamily: "'Montserrat', 'Noto Sans Telugu', sans-serif",
            fontWeight: 800,
            fontSize: 34,
            lineHeight: 1.3,
            color: "rgba(255, 255, 255, 0.75)",
            textAlign: "center",
          }}
        >
          {renderAccented(line2)}
        </div>
      )}
    </div>
  );
};
