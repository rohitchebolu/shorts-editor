import { staticFile } from "remotion";

/**
 * Font declarations for on-screen text.
 *
 * Loaded from public/fonts/:
 * - Montserrat Bold — the title / hook overlay (and legacy caption styles)
 * - Inter Bold — the hook subtitle (and legacy caption styles)
 * - Bangers — legacy caption style (kept for the now-disabled caption renderers)
 *
 * For preview mode, fonts are loaded via @font-face in the browser.
 * For rendering, Remotion handles font loading automatically.
 */
export const FONTS = {
  montserrat: {
    family: "Montserrat",
    src: staticFile("fonts/Montserrat-Bold.ttf"),
    weight: "800",
  },
  bangers: {
    family: "Bangers",
    src: staticFile("fonts/Bangers-Regular.ttf"),
    weight: "400",
  },
  inter: {
    family: "Inter",
    src: staticFile("fonts/Inter-Bold.ttf"),
    weight: "700",
  },
  notoTelugu: {
    family: "Noto Sans Telugu",
    src: staticFile("fonts/NotoSansTelugu-Variable.ttf"),
    weight: "100 900", // variable font — full weight range
  },
} as const;

/**
 * CSS @font-face declarations for all fonts.
 * Inject into document head for preview mode.
 */
export const fontFaceCSS = Object.values(FONTS)
  .map(
    (f) => `
@font-face {
  font-family: '${f.family}';
  src: url('${f.src}') format('truetype');
  font-weight: ${f.weight};
  font-display: block;
}
`
  )
  .join("\n");
