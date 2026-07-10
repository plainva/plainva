import React from "react";
import { LUCIDE_ICON_MAP } from "./lucideIconData";

/**
 * Document icons come in two flavours (ADR 0009): a plain emoji/grapheme, or
 * an icon-set reference persisted as "lucide:<name>" with an optional tint in
 * `plainva.icon_color`. This module is the single place that interprets the
 * format — React rendering for tabs/tree/read view, raw DOM for the CM widget.
 */

const LUCIDE_PREFIX = "lucide:";

export function parseDocIcon(
  icon: string
): { kind: "emoji"; char: string } | { kind: "lucide"; name: string } {
  if (icon.startsWith(LUCIDE_PREFIX)) {
    return { kind: "lucide", name: icon.slice(LUCIDE_PREFIX.length) };
  }
  return { kind: "emoji", char: icon };
}

export function docIconValue(name: string): string {
  return `${LUCIDE_PREFIX}${name}`;
}

/** False only for icon-set references whose name is unknown to the registry. */
export function isRenderableDocIcon(icon: string): boolean {
  const parsed = parseDocIcon(icon);
  return parsed.kind === "emoji" || LUCIDE_ICON_MAP.has(parsed.name);
}

const SVG_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const DocIcon: React.FC<{ icon: string; color?: string; size: number }> = ({
  icon,
  color,
  size,
}) => {
  const parsed = parseDocIcon(icon);
  if (parsed.kind === "emoji") {
    return (
      <span aria-hidden="true" style={{ fontSize: size, lineHeight: 1 }}>
        {parsed.char}
      </span>
    );
  }
  const entry = LUCIDE_ICON_MAP.get(parsed.name);
  if (!entry) return null;
  return (
    <svg
      {...SVG_PROPS}
      width={size}
      height={size}
      stroke={color ?? "currentColor"}
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {entry.node.map(([tag, attrs], i) => React.createElement(tag, { ...attrs, key: i }))}
    </svg>
  );
};

const SVG_NS = "http://www.w3.org/2000/svg";

/** Raw-DOM twin of <DocIcon/> for CodeMirror widgets. Returns null for unknown icon-set names. */
export function renderDocIconDOM(icon: string, color: string | undefined, size: number): Node | null {
  const parsed = parseDocIcon(icon);
  if (parsed.kind === "emoji") {
    const span = document.createElement("span");
    span.textContent = parsed.char;
    span.style.fontSize = `${size}px`;
    span.style.lineHeight = "1";
    span.setAttribute("aria-hidden", "true");
    return span;
  }
  const entry = LUCIDE_ICON_MAP.get(parsed.name);
  if (!entry) return null;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", color ?? "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const [tag, attrs] of entry.node) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, String(value));
    }
    svg.appendChild(el);
  }
  return svg;
}
