import { useMemo } from "react";
import { qrMatrix } from "../../lib/qr";

export interface QrImageProps {
  /** Text to encode (invitation code, device-pairing token). */
  value: string;
  /** Rendered pixel size of the square (default 176). */
  size?: number;
  /** Accessible label; falls back to the encoded value. */
  label?: string;
  className?: string;
}

/**
 * A QR code rendered offline as a crisp, theme-invariant SVG (dark-on-light so
 * any camera scans it in every theme). Shared by the desktop invitation modal
 * and the mobile pairing flow. Renders nothing when the value cannot be encoded
 * — callers keep the copyable text code as the always-available fallback.
 */
export function QrImage({ value, size = 176, label, className }: QrImageProps) {
  const grid = useMemo(() => qrMatrix(value), [value]);
  if (!grid) return null;
  const count = grid.length;
  const quiet = 4;
  const dim = count + quiet * 2;
  let path = "";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (grid[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  return (
    <svg
      className={className}
      role="img"
      aria-label={label ?? value}
      width={size}
      height={size}
      viewBox={`0 0 ${dim} ${dim}`}
      shapeRendering="crispEdges"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width={dim} height={dim} fill="var(--qr-light)" />
      <path d={path} fill="var(--qr-dark)" />
    </svg>
  );
}
