import { OffthreadVideo, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import type { Crop, CropKeyframe } from "../types";

interface VideoFrame43Props {
  clipSrc: string;
  sourceWidth: number;
  sourceHeight: number;
  crop: Crop; // the 9:16 reframe crop — reused for its face-centered x
  cropKeyframes?: CropKeyframe[];
  bandTop: number; // y (px) where the 4:3 band starts on the 1920px canvas
  bandHeight: number; // 810 for a full-width 4:3 band
}

/**
 * Renders the source video as a 4:3 band centered on the canvas (black bars
 * above/below). The horizontal window is re-derived from the face-tracked
 * 9:16 reframe crop: same center, widened to 4:3, clamped to the source.
 */
export const VideoFrame43: React.FC<VideoFrame43Props> = ({
  clipSrc,
  sourceWidth,
  sourceHeight,
  crop,
  cropKeyframes,
  bandTop,
  bandHeight,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  if (!clipSrc) return null;

  const currentTime = frame / fps;
  const outputWidth = 1080;

  // Face-center x in source px (animated when the reframe has pan keyframes)
  let cropX = crop.x;
  if (cropKeyframes && cropKeyframes.length >= 2) {
    cropX = interpolate(
      currentTime,
      cropKeyframes.map((k) => k.t),
      cropKeyframes.map((k) => k.x),
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );
  }
  const centerX = cropX + crop.w / 2;

  // 4:3 window in source coordinates, centered on the face
  const wide = sourceWidth >= (sourceHeight * 4) / 3;
  const w43 = wide ? Math.round((sourceHeight * 4) / 3) : sourceWidth;
  const h43 = wide ? sourceHeight : Math.round((sourceWidth * 3) / 4);
  const x43 = wide
    ? Math.max(0, Math.min(centerX - w43 / 2, sourceWidth - w43))
    : 0;
  // Narrow sources: bias the vertical window upward — faces sit high in frame
  const y43 = wide ? 0 : (sourceHeight - h43) * 0.25;

  const scale = outputWidth / w43;

  return (
    <div
      style={{
        position: "absolute",
        top: bandTop,
        left: 0,
        width: outputWidth,
        height: bandHeight,
        overflow: "hidden",
      }}
    >
      <OffthreadVideo
        src={clipSrc}
        style={{
          position: "absolute",
          width: sourceWidth * scale,
          height: sourceHeight * scale,
          transform: `translate(${-x43 * scale}px, ${-y43 * scale}px)`,
        }}
      />
    </div>
  );
};
