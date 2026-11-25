import type { MouseEvent } from "react";
import { segmentInlineText } from "../lib/linkParser";
import { safeHref } from "../lib/safeUrl";

/**
 * Free text of a database cell with its links alive — `[[wiki|alias]]`,
 * `[label](target)` and a bare `https://…` — the way a link reads in a note.
 * One renderer for both shells (parity `base-cell-text-links`): the desktop's
 * cells always followed such a link, the phone's opened the cell editor over
 * it. A press on the link follows it and goes no further (the cell around it
 * would start editing); a press on any other word of the text is the cell's.
 */
export function hasInlineLinks(text: string): boolean {
  return segmentInlineText(text).some((s) => s.type !== "text");
}

export interface InlineTextLinksProps {
  text: string;
  /** A link inside the vault: a wiki link or a Markdown link to a note or file. */
  onOpenLink: (target: string, kind: "wiki" | "markdown", ev: MouseEvent) => void;
  /**
   * A web link. Given, the owner opens it (the phone hands it to the system
   * browser through the platform service); absent, the anchor opens itself.
   */
  onOpenExternal?: (url: string) => void;
}

export function InlineTextLinks({ text, onOpenLink, onOpenExternal }: InlineTextLinksProps) {
  const segments = segmentInlineText(text);
  if (!segments.some((s) => s.type !== "text")) return <>{text}</>;
  const external = (key: number, url: string, label: string) => (
    <a
      key={key}
      className="pv-web-link"
      href={safeHref(url)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.stopPropagation();
        if (!onOpenExternal) return;
        e.preventDefault();
        if (safeHref(url)) onOpenExternal(url);
      }}
    >
      {label}
    </a>
  );
  return (
    <span>
      {segments.map((seg, i) => {
        if (seg.type === "text") return <span key={i}>{seg.text}</span>;
        if (seg.type === "url") return external(i, seg.target, seg.target);
        if (seg.type === "markdown") {
          const label = seg.text || seg.target;
          if (/^https?:\/\//.test(seg.target)) return external(i, seg.target, label);
          return (
            <span key={i} className="pv-web-link" role="link" onClick={(e) => { e.stopPropagation(); onOpenLink(seg.target, "markdown", e); }}>
              {label}
            </span>
          );
        }
        return (
          <span key={i} className="pv-web-link" role="link" onClick={(e) => { e.stopPropagation(); onOpenLink(seg.target, "wiki", e); }}>
            {seg.display}
          </span>
        );
      })}
    </span>
  );
}
