interface PlainvaLogoProps {
  size?: number;
  /** Adds an accent glow (used on the splash screen, mainly in dark mode). */
  glow?: boolean;
}

/**
 * The Plainva mark ("lines with cursor", maintainer pick 2026-07-05): a rounded
 * square in the accent colour with two "text lines" and a typing cursor,
 * evoking plain Markdown being written. Colours come from CSS variables, so it
 * follows the active theme (light/dark) automatically; the OS icon master
 * (src-tauri/icons/source/plainva-icon.svg) mirrors this geometry with fixed
 * petrol colours.
 */
export function PlainvaLogo({ size = 24, glow = false }: PlainvaLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="Plainva"
      style={glow ? { filter: "drop-shadow(0 0 18px color-mix(in srgb, var(--accent-color) 55%, transparent))" } : undefined}
    >
      <rect x="2" y="2" width="28" height="28" rx="8" fill="var(--accent-color)" />
      <rect x="9" y="11" width="14" height="2.7" rx="1.35" fill="var(--accent-on)" />
      <rect x="9" y="16.6" width="7.6" height="2.7" rx="1.35" fill="var(--accent-on)" />
      <rect x="18.4" y="16.2" width="2.8" height="3.6" rx="0.9" fill="var(--accent-on)" opacity="0.6" />
    </svg>
  );
}
