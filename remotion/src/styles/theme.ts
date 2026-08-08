/**
 * Color palettes and style constants for each caption preset.
 */

// Single accent color shared by the hook text and caption emphasis so the
// 4:3 reaction preset reads as one system (yellow pops on the black bars).
export const ACCENT_COLOR = "#FFD700";

export const REACTION_THEME = {
  textColor: "#FFFFFF",
  accentColor: ACCENT_COLOR, // active/emphasized caption words + hook accent word
  strokeColor: "#000000",
  backgroundColor: "transparent",
};

export const BOLD_THEME = {
  textColor: "#FFFFFF",
  activeColor: "#FFD700", // Yellow highlight on active word
  shadowColor: "#000000",
  backgroundColor: "transparent",
};

export const BOUNCE_THEME = {
  textColor: "#FFFFFF",
  shadowColor: "#000000",
  backgroundColor: "transparent",
  // Rotating bright colors per page
  rotatingColors: [
    "#00FFFF", // Cyan
    "#FF00FF", // Magenta
    "#00FF00", // Lime
    "#FFFF00", // Yellow
    "#FF6600", // Orange
    "#FF0066", // Hot pink
  ],
};

export const CLEAN_THEME = {
  textColor: "#FFFFFF",
  activeColor: "#E0E0E0", // Subtle lighter white for active word
  shadowColor: "rgba(0, 0, 0, 0.6)",
  backgroundColor: "transparent",
};
