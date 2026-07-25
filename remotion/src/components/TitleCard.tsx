interface TitleCardProps {
  line1: string;
  line2: string;
  bandTop: number; // y (px) of the video band's top edge; the title sits just above it
}

/**
 * Title shown in the black band above the video in the "fit" (letterbox) layout.
 * line1 = the statement (white); line2 = an optional name/label prefix (green),
 * rendered inline before it — e.g. "Roy Lee: What separates…".
 */
export const TitleCard: React.FC<TitleCardProps> = ({ line1, line2, bandTop }) => {
  return (
    <div
      style={{
        position: "absolute",
        left: 50,
        right: 50,
        bottom: 1920 - bandTop + 26, // bottom edge 26px above the video
        fontFamily: "'Montserrat', sans-serif",
        fontWeight: 800,
        fontSize: 44,
        lineHeight: 1.25,
        color: "white",
        textAlign: "left",
        textShadow: "0 2px 10px rgba(0,0,0,0.5)",
      }}
    >
      {line2 ? <span style={{ color: "#4ade80" }}>{line2} </span> : null}
      {line1}
    </div>
  );
};
