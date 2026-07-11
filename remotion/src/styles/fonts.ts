import { staticFile } from "remotion";

/**
 * Font declarations for caption styles.
 *
 * Fonts are loaded from public/fonts/ directory:
 * - Montserrat Bold (Bold style) — Google Fonts, OFL
 * - Bangers (Bounce style) — Google Fonts, OFL
 * - Inter Bold (Clean style) — Google Fonts, OFL
 * - Noto Sans Telugu (Telugu fallback for all styles) — Google Fonts, OFL (variable)
 *
 * The Telugu font is added as a per-glyph fallback in every caption font stack so
 * Telugu-English (Tinglish) content renders: Latin glyphs use the primary Latin font,
 * Telugu glyphs fall back to Noto Sans Telugu.
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
    weight: "100 900",
  },
} as const;

/**
 * CSS @font-face declarations for all caption fonts.
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
