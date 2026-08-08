import { ACCENT_COLOR } from "../styles/theme";

/**
 * Renders text with `*word*` markup: anything wrapped in single asterisks is
 * shown in the accent color (used to make one hook word pop). Unpaired
 * asterisks are left as literal text.
 */
export const renderAccented = (
  text: string,
  color: string = ACCENT_COLOR
): React.ReactNode[] => {
  const parts = text.split(/\*([^*\n]+)\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} style={{ color }}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
};
