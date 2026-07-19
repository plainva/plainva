import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { activeDocument, type ActiveDoc } from "../services/activeDocument";
import { parseHeadings, type Heading } from "../services/outline";

// Right-sidebar outline (#10): lists the active note's headings; clicking one
// dispatches a goto event that the active pane's Editor handles (scrolling its
// CodeMirror view in live/source, or its own read container in read mode).
export function OutlineSection() {
  const { t } = useTranslation();
  const [headings, setHeadings] = useState<Heading[]>([]);

  useEffect(() => {
    const update = (d: ActiveDoc) => setHeadings(d.kind === "markdown" ? parseHeadings(d.content) : []);
    update(activeDocument.get());
    return activeDocument.subscribe(update);
  }, []);

  const goto = (h: Heading) => {
    // Only fire the event; the active pane's Editor scrolls itself (live/source
    // via CodeMirror, read via its own container). A document-wide getElementById
    // here would scroll the first/left pane in a split, not the active one (#4).
    window.dispatchEvent(new CustomEvent("plainva-goto-heading", { detail: { line: h.line, slug: h.slug } }));
  };

  if (headings.length === 0) {
    return <div style={{ padding: "0.25rem 0.25rem 0.5rem", color: "var(--text-muted)", fontSize: "var(--text-md)" }}>{t("rightPanel.outlineEmpty", { defaultValue: "Keine Überschriften" })}</div>;
  }

  const minLevel = Math.min(...headings.map((h) => h.level));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
      {headings.map((h, i) => (
        <button
          key={i}
          type="button"
          onClick={() => goto(h)}
          aria-label={h.text} data-tip={h.text}
          className="pv-rowhover"
          style={{
            display: "block", width: "100%", textAlign: "left", border: "none",
            color: h.level === minLevel ? "var(--text-main)" : "var(--text-muted)",
            cursor: "pointer", borderRadius: "var(--radius-xs)", fontSize: "var(--text-md)",
            padding: "3px 6px", paddingLeft: `${6 + (h.level - minLevel) * 14}px`,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            fontWeight: h.level === minLevel ? 600 : 400,
          }}
        >
          {h.text}
        </button>
      ))}
    </div>
  );
}
