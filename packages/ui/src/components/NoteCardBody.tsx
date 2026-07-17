import type React from "react";
import type { InlineNode } from "../lib/inlineMarkdown";
import type { NoteCardBlock } from "../lib/noteCardModel";

/**
 * Shared renderer of a parsed note card (plan Pinboard P3, decision E6) —
 * used by the desktop pinboard view and the mobile BaseScreen alike.
 *
 * Interaction model (D6): the CARD is the single click target (opens the
 * note); the only interactive elements inside the body are the task
 * checkboxes. Links render as tinted display text — the tasks-view pattern,
 * no nested interactive elements.
 */

const inlineLinkStyle: React.CSSProperties = { color: "var(--accent-color)" };
const inlineCodeStyle: React.CSSProperties = { background: "var(--code-bg)", borderRadius: "var(--radius-xs)", padding: "0 3px", fontSize: "0.9em" };
const inlineMarkStyle: React.CSSProperties = { background: "var(--highlight-bg)", color: "inherit", borderRadius: "var(--radius-xs)" };

function renderInlineNodes(nodes: InlineNode[], keyPrefix = ""): React.ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}${i}`;
    switch (n.kind) {
      case "text": return <span key={key}>{n.text}</span>;
      case "br": return <br key={key} />;
      case "code": return <code key={key} style={inlineCodeStyle}>{n.text}</code>;
      case "strong": return <strong key={key}>{renderInlineNodes(n.children, `${key}.`)}</strong>;
      case "em": return <em key={key}>{renderInlineNodes(n.children, `${key}.`)}</em>;
      case "strike": return <del key={key}>{renderInlineNodes(n.children, `${key}.`)}</del>;
      case "strongEm": return <strong key={key}><em>{renderInlineNodes(n.children, `${key}.`)}</em></strong>;
      case "highlight": return <mark key={key} style={inlineMarkStyle}>{renderInlineNodes(n.children, `${key}.`)}</mark>;
      case "wikiLink": return <span key={key} style={inlineLinkStyle}>{n.display}</span>;
      case "link": return <span key={key} style={inlineLinkStyle}>{n.label}</span>;
      case "url": return <span key={key} style={inlineLinkStyle}>{n.href}</span>;
      default: return null;
    }
  });
}

export interface NoteCardBodyProps {
  blocks: NoteCardBlock[];
  /** Toggle the task with this document ordinal; absent = read-only checkboxes. */
  onToggleTask?: (ordinal: number, checked: boolean) => void;
  /** Shell-specific image rendering (blob loading differs per shell). */
  renderImage?: (target: string, alt: string) => React.ReactNode;
  /** Localized placeholder labels (i18n lives in the shells). */
  labels: { table: string; math: string; embed: string };
}

const blockText: React.CSSProperties = { margin: 0, fontSize: "var(--text-sm)", lineHeight: 1.45, overflowWrap: "anywhere" };
const placeholderStyle: React.CSSProperties = {
  display: "inline-block",
  fontSize: "var(--text-xs)",
  color: "var(--text-muted)",
  background: "var(--bg-secondary)",
  border: "1px solid var(--border-color)",
  borderRadius: "var(--radius-pill)",
  padding: "1px 8px",
};

export function NoteCardBody({ blocks, onToggleTask, renderImage, labels }: NoteCardBodyProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.kind) {
          case "heading": {
            const size = b.depth === 1 ? "1.02rem" : b.depth === 2 ? "0.95rem" : "0.88rem";
            return <div key={key} style={{ ...blockText, fontWeight: 600, fontSize: size }}>{renderInlineNodes(b.inline)}</div>;
          }
          case "para":
            return <p key={key} style={blockText}>{renderInlineNodes(b.inline)}</p>;
          case "task":
            return (
              <div key={key} style={{ ...blockText, display: "flex", alignItems: "flex-start", gap: 6, paddingLeft: b.indent * 14 }}>
                <input
                  type="checkbox"
                  checked={b.done}
                  disabled={!onToggleTask}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) => onToggleTask?.(b.ordinal, e.currentTarget.checked)}
                  style={{ marginTop: 3, flexShrink: 0, accentColor: "var(--accent-color)", cursor: onToggleTask ? "pointer" : "default" }}
                  aria-label={undefined}
                />
                <span style={b.done ? { textDecoration: "line-through", color: "var(--text-muted)" } : undefined}>
                  {renderInlineNodes(b.inline)}
                </span>
              </div>
            );
          case "bullet":
            return (
              <div key={key} style={{ ...blockText, display: "flex", alignItems: "flex-start", gap: 6, paddingLeft: b.indent * 14 }}>
                <span aria-hidden="true" style={{ color: "var(--text-muted)", flexShrink: 0 }}>{b.ordered ? "·" : "•"}</span>
                <span>{renderInlineNodes(b.inline)}</span>
              </div>
            );
          case "quote":
            return (
              <div key={key} style={{ ...blockText, borderLeft: "2px solid var(--border-color)", paddingLeft: 8, color: "var(--text-muted)" }}>
                {renderInlineNodes(b.inline)}
              </div>
            );
          case "image":
            return (
              <div key={key}>
                {renderImage
                  ? renderImage(b.target, b.alt)
                  : <span style={{ ...placeholderStyle }}>{b.alt || b.target}</span>}
              </div>
            );
          case "hr":
            return <hr key={key} style={{ border: "none", borderTop: "1px solid var(--border-color)", margin: "2px 0" }} />;
          case "code":
            return (
              <pre key={key} style={{ margin: 0, padding: "4px 6px", background: "var(--code-bg)", borderRadius: "var(--radius-xs)", fontSize: "var(--text-xs)", overflow: "hidden" }}>
                {b.lines.join("\n")}{b.truncated ? "\n…" : ""}
              </pre>
            );
          case "placeholder":
            return <span key={key} style={placeholderStyle}>{labels[b.label]}</span>;
          default:
            return null;
        }
      })}
    </div>
  );
}
