import { AbsoluteFill, OffthreadVideo } from "remotion";
import { VideoFrame } from "./components/VideoFrame";
import { Captions } from "./components/Captions";
import { HookOverlay } from "./components/HookOverlay";
import { TitleCard } from "./components/TitleCard";
import { ProgressBar } from "./components/ProgressBar";
import { fontFaceCSS } from "./styles/fonts";
import type { ShortVideoProps } from "./types";

// In the "fit" (letterbox) layout, the video band's bottom sits this many px above
// the frame bottom — chosen so captions (by default near the bottom) land on the video.
const FIT_BAND_BOTTOM = 270;
// Default vertical center of the caption band as a fraction of the 1920px frame height.
const CAPTION_Y_DEFAULT = 0.8;

export const ShortVideo: React.FC<ShortVideoProps> = ({
  clipSrc,
  sourceWidth,
  sourceHeight,
  crop,
  cropKeyframes,
  captions,
  captionStyle,
  captionY,
  hookLine1,
  hookLine2,
  layout,
  showProgressBar,
  durationInSeconds,
}) => {
  const hasTitle = !!(hookLine1 || hookLine2);

  // Captions, shifted vertically to the user-chosen position (draggable in the editor).
  const captionEl = (
    <div
      style={{
        position: "absolute",
        inset: 0,
        transform: `translateY(${(captionY - CAPTION_Y_DEFAULT) * 1920}px)`,
      }}
    >
      <Captions captions={captions} style={captionStyle} />
    </div>
  );

  // "fit": whole source frame scaled to width (black bars), title in the top band.
  if (layout === "fit") {
    const videoH = Math.round((1080 * sourceHeight) / sourceWidth);
    const bandTop = 1920 - FIT_BAND_BOTTOM - videoH;
    return (
      <AbsoluteFill style={{ backgroundColor: "black" }}>
        <style dangerouslySetInnerHTML={{ __html: fontFaceCSS }} />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: FIT_BAND_BOTTOM,
            width: 1080,
            height: videoH,
          }}
        >
          {clipSrc && <OffthreadVideo src={clipSrc} style={{ width: "100%", height: "100%" }} />}
        </div>
        {captionEl}
        {hasTitle && <TitleCard line1={hookLine1 ?? ""} line2={hookLine2 ?? ""} bandTop={bandTop} />}
        {showProgressBar && <ProgressBar durationInSeconds={durationInSeconds} />}
      </AbsoluteFill>
    );
  }

  // Default "fill": crop the video to fill the entire 1080x1920 frame.
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {/* Load custom fonts for the title and captions */}
      <style dangerouslySetInnerHTML={{ __html: fontFaceCSS }} />

      {/* Reframed video (cropped and scaled to fill 1080x1920) */}
      <VideoFrame
        clipSrc={clipSrc}
        sourceWidth={sourceWidth}
        sourceHeight={sourceHeight}
        crop={crop}
        cropKeyframes={cropKeyframes}
      />

      {/* Word-level captions (position adjustable) */}
      {captionEl}

      {/* Optional title pinned to the top-center, overlaid on the video */}
      {hasTitle && <HookOverlay line1={hookLine1 ?? ""} line2={hookLine2 ?? ""} />}

      {/* Progress bar at bottom */}
      {showProgressBar && <ProgressBar durationInSeconds={durationInSeconds} />}
    </AbsoluteFill>
  );
};
