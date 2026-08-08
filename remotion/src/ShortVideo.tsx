import { AbsoluteFill, OffthreadVideo } from "remotion";
import { VideoFrame } from "./components/VideoFrame";
import { VideoFrame43 } from "./components/VideoFrame43";
import { Captions } from "./components/Captions";
import { HookOverlay } from "./components/HookOverlay";
import { HookBand } from "./components/HookBand";
import { TitleCard } from "./components/TitleCard";
import { ProgressBar } from "./components/ProgressBar";
import { fontFaceCSS } from "./styles/fonts";
import type { ShortVideoProps } from "./types";

// The caption band's natural center (matches the caption components' default anchor),
// as a fraction of the 1920px frame. captionY shifts the band relative to this.
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

  // Render captions with their band centered at `centerY` (px). captionY is a
  // fraction of the visible video, so this stays consistent across layouts.
  const renderCaptions = (centerY: number) => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        transform: `translateY(${centerY - CAPTION_Y_DEFAULT * 1920}px)`,
      }}
    >
      <Captions captions={captions} style={captionStyle} />
    </div>
  );

  // "four_three": 4:3 face-centered crop, vertically centered on the black
  // canvas. Clean hook in the top bar, captions default to the clip's center
  // (captionY 0.5) so face + captions sit in one glance.
  if (layout === "four_three") {
    const bandH = 810; // 1080 x 810 = 4:3
    const bandTop = Math.round((1920 - bandH) / 2);
    return (
      <AbsoluteFill style={{ backgroundColor: "black" }}>
        <style dangerouslySetInnerHTML={{ __html: fontFaceCSS }} />
        <VideoFrame43
          clipSrc={clipSrc}
          sourceWidth={sourceWidth}
          sourceHeight={sourceHeight}
          crop={crop}
          cropKeyframes={cropKeyframes}
          bandTop={bandTop}
          bandHeight={bandH}
        />
        {/* captionY is a fraction of the 4:3 band — 0.5 = center of the clip */}
        {renderCaptions(bandTop + captionY * bandH)}
        {hasTitle && <HookBand line1={hookLine1 ?? ""} line2={hookLine2 ?? ""} bandTop={bandTop} />}
        {showProgressBar && <ProgressBar durationInSeconds={durationInSeconds} />}
      </AbsoluteFill>
    );
  }

  // "fit": whole source frame scaled to width, vertically centered (black bars),
  // title in the black band above, captions over the video.
  if (layout === "fit") {
    const videoH = Math.round((1080 * sourceHeight) / sourceWidth);
    const bandTop = Math.round((1920 - videoH) / 2); // vertically centered
    return (
      <AbsoluteFill style={{ backgroundColor: "black" }}>
        <style dangerouslySetInnerHTML={{ __html: fontFaceCSS }} />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: bandTop,
            width: 1080,
            height: videoH,
          }}
        >
          {clipSrc && <OffthreadVideo src={clipSrc} style={{ width: "100%", height: "100%" }} />}
        </div>
        {/* captionY is a fraction of the video band, so captions stay on the video */}
        {renderCaptions(bandTop + captionY * videoH)}
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

      {/* Word-level captions (position adjustable — fraction of the full frame here) */}
      {renderCaptions(captionY * 1920)}

      {/* Optional title pinned to the top-center, overlaid on the video */}
      {hasTitle && <HookOverlay line1={hookLine1 ?? ""} line2={hookLine2 ?? ""} />}

      {/* Progress bar at bottom */}
      {showProgressBar && <ProgressBar durationInSeconds={durationInSeconds} />}
    </AbsoluteFill>
  );
};
