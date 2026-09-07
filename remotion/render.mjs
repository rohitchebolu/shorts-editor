#!/usr/bin/env node
/**
 * Bundle-once-render-many orchestrator for claude-shorts.
 *
 * Bundles the Remotion project once, opens a shared Chrome instance,
 * then renders each approved segment sequentially.
 *
 * Usage:
 *   node render.mjs \
 *     --segments /tmp/claude-shorts/approved_segments.json \
 *     --reframe /tmp/claude-shorts/reframe.json \
 *     --captions /tmp/claude-shorts/transcript.json \
 *     --style bold \
 *     --clips-dir /tmp/claude-shorts/clips/ \
 *     --output-dir /tmp/claude-shorts/render/
 *
 * IMPORTANT: Uses selectComposition() before renderMedia() to resolve
 * calculateMetadata (dynamic duration per segment).
 */
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition, openBrowser } from "@remotion/renderer";
import path from "path";
import fs from "fs";
import http from "http";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, "");
    parsed[key] = args[i + 1];
  }
  return parsed;
}

async function main() {
  const args = parseArgs();

  const segmentsPath = args.segments;
  const reframePath = args.reframe;
  const captionsPath = args.captions;
  const style = args.style || "reaction";
  const clipsDir = args["clips-dir"];
  const outputDir = args["output-dir"] || "/tmp/claude-shorts/render/";

  if (!segmentsPath || !reframePath || !captionsPath || !clipsDir) {
    console.error(JSON.stringify({
      error: "Missing required arguments",
      usage: "node render.mjs --segments FILE --reframe FILE --captions FILE --clips-dir DIR [--style reaction|bold|bounce|clean] [--output-dir DIR]",
    }));
    process.exit(1);
  }

  // Load data files
  const segmentsData = JSON.parse(fs.readFileSync(segmentsPath, "utf-8"));
  const reframeData = JSON.parse(fs.readFileSync(reframePath, "utf-8"));
  const transcriptData = JSON.parse(fs.readFileSync(captionsPath, "utf-8"));

  const segments = segmentsData.segments;
  const allCaptions = transcriptData.captions;

  // Ensure output directory exists
  fs.mkdirSync(outputDir, { recursive: true });

  // Start a local HTTP server to serve clip files.
  // Remotion's renderer proxy only supports http/https URLs, not file://.
  const clipServer = http.createServer((req, res) => {
    const filePath = path.join(clipsDir, decodeURIComponent(req.url.slice(1)));
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": "video/mp4" });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((resolve) => clipServer.listen(0, "127.0.0.1", resolve));
  const clipServerPort = clipServer.address().port;
  const clipBaseUrl = `http://127.0.0.1:${clipServerPort}`;
  console.log(JSON.stringify({ action: "clip_server", port: clipServerPort, url: clipBaseUrl }));

  console.log(JSON.stringify({ action: "bundle", status: "starting" }));
  const startBundle = Date.now();

  // Bundle once
  const serveUrl = await bundle({
    entryPoint: path.resolve(__dirname, "src/index.ts"),
  });

  const bundleTime = ((Date.now() - startBundle) / 1000).toFixed(1);
  console.log(JSON.stringify({ action: "bundle", status: "complete", time_sec: bundleTime }));

  // Open shared browser instance
  const browser = await openBrowser("chrome");

  // Hardware-accelerated encoding on macOS (VideoToolbox) — a big speedup on Apple
  // Silicon. Remotion forbids `crf` together with hardware acceleration, so on macOS
  // we switch to bitrate control; other platforms keep the existing CRF software path
  // unchanged. "if-possible" still falls back to software if no HW encoder is found.
  const encodingOptions =
    process.platform === "darwin"
      ? { hardwareAcceleration: "if-possible", videoBitrate: "16M" }
      : { crf: 18 };

  // Speed knobs: JPEG frames render faster than PNG (negligible quality loss for
  // video), and concurrency parallelizes frame rendering across CPU cores. Leave
  // concurrency unset to use Remotion's default; override via SHORTS_RENDER_CONCURRENCY
  // (e.g. lower it on a RAM-constrained box, raise it on a many-core server).
  const perfOptions = { imageFormat: "jpeg", jpegQuality: 90 };
  if (process.env.SHORTS_RENDER_CONCURRENCY) {
    perfOptions.concurrency = Number(process.env.SHORTS_RENDER_CONCURRENCY);
  } else if (os.freemem() / 1e9 < 4) {
    // Low free RAM: each Chromium render tab needs a few hundred MB. Cap concurrency
    // so we don't swap/OOM (common on a 16 GB laptop with lots of browser tabs open).
    perfOptions.concurrency = 2;
    console.log(JSON.stringify({ action: "perf", note: "low memory — capping concurrency at 2" }));
  }

  const results = [];

  try {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const segId = seg.id ?? (i + 1);
      const clipName = `clip_${String(segId).padStart(2, "0")}.mp4`;
      const clipPath = path.resolve(clipsDir, clipName);
      const outputPath = path.resolve(outputDir, `short_${String(segId).padStart(2, "0")}.mp4`);

      if (!fs.existsSync(clipPath)) {
        console.error(JSON.stringify({ error: `Clip not found: ${clipPath}` }));
        continue;
      }

      // Get reframe data for this clip
      const reframe = reframeData.clips?.[clipName] || {};
      if (!reframe.crop) {
        console.error(JSON.stringify({
          warning: `No reframe data for ${clipName}, using default 9:16 center crop for 1920x1080`,
        }));
      }
      const crop = reframe.crop || { x: 0, y: 0, w: 607, h: 1080 };
      const cropKeyframes = reframe.crop_keyframes || [];

      // Get source resolution from reframe data
      const [srcW, srcH] = (reframe.source_resolution || "1920x1080")
        .split("x")
        .map(Number);

      // Captions for this clip. A per-clip override wins (edited text keeps the
      // original word timings); captionsOff = none; otherwise the auto transcript
      // words in this clip's window. All offset to clip-local milliseconds.
      const segStartMs = seg.start * 1000;
      const segEndMs = seg.end * 1000;
      const durationMs = (seg.end - seg.start) * 1000;
      let segCaptions;
      if (seg.captionsOff) {
        segCaptions = [];
      } else if (Array.isArray(seg.captions)) {
        segCaptions = seg.captions
          .map((c) => ({ text: c.text, startMs: c.startMs - segStartMs, endMs: c.endMs - segStartMs }))
          .filter((c) => c.endMs > 0 && c.startMs < durationMs);
      } else {
        segCaptions = allCaptions
          .filter((c) => c.startMs >= segStartMs && c.endMs <= segEndMs)
          .map((c) => ({ text: c.text, startMs: c.startMs - segStartMs, endMs: c.endMs - segStartMs }));
      }

      const durationInSeconds = seg.end - seg.start;

      // Default preset: 4:3 reaction layout with captions at the clip's center
      const layout = seg.layout || "four_three";
      const inputProps = {
        clipSrc: `${clipBaseUrl}/${clipName}`,
        sourceWidth: srcW,
        sourceHeight: srcH,
        crop,
        cropKeyframes,
        captions: segCaptions,
        captionStyle: seg.captionStyle || style,
        layout,
        captionY: typeof seg.captionY === "number" ? seg.captionY : layout === "four_three" ? 0.5 : 0.8,
        hookLine1: seg.hook_line1 || "",
        hookLine2: seg.hook_line2 || "",
        showProgressBar: false,
        durationInSeconds,
      };

      console.log(JSON.stringify({
        action: "render",
        segment: i + 1,
        total: segments.length,
        duration: `${durationInSeconds.toFixed(1)}s`,
        status: "starting",
      }));

      // Retry once on failure before skipping this segment
      let rendered = false;
      const maxAttempts = 2;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const startRender = Date.now();

          // selectComposition resolves calculateMetadata for dynamic duration
          const composition = await selectComposition({
            serveUrl,
            id: "ShortVideo",
            inputProps,
            puppeteerInstance: browser,
          });

          await renderMedia({
            composition,
            serveUrl,
            codec: "h264",
            ...encodingOptions,
            ...perfOptions,
            outputLocation: outputPath,
            inputProps,
            puppeteerInstance: browser,
          });

          const renderTime = ((Date.now() - startRender) / 1000).toFixed(1);
          const fileSizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(1);

          const result = {
            action: "render",
            segment: i + 1,
            output: outputPath,
            duration: `${durationInSeconds.toFixed(1)}s`,
            render_time_sec: renderTime,
            file_size_mb: fileSizeMB,
            status: "complete",
          };

          results.push(result);
          console.log(JSON.stringify(result));
          rendered = true;
          break;
        } catch (renderErr) {
          if (attempt < maxAttempts) {
            console.log(JSON.stringify({
              action: "render",
              segment: i + 1,
              status: "retrying",
              attempt,
              error: renderErr.message,
            }));
          } else {
            console.error(JSON.stringify({
              action: "render",
              segment: i + 1,
              status: "failed",
              error: renderErr.message,
            }));
          }
        }
      }

      if (!rendered) {
        results.push({
          action: "render",
          segment: i + 1,
          output: outputPath,
          status: "failed",
        });
      }
    }
  } finally {
    await browser.close({ silent: true });
    clipServer.close();
  }

  // Final summary
  console.log(JSON.stringify({
    action: "render_complete",
    segments_rendered: results.length,
    total_segments: segments.length,
    output_dir: outputDir,
    results,
  }));
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message, stack: err.stack }));
  process.exit(1);
});
