import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { renderMermaidDiagram, getRenderedMermaid } from "../services/mermaidRender";

/**
 * Renders a ```mermaid code block in read mode (P3.5). Rendering (lazy
 * bundle, strict securityLevel, per-theme cache) is shared with the live
 * preview via services/mermaidRender.
 *
 * Wrapped in React.memo (below): read mode re-parses the ENTIRE markdown on
 * every editor re-render (unstable handler closures, the 15 s sync tick, …),
 * which reconciled the large SVG subtree each time and made it flicker. With a
 * stable `code` prop React now skips this component entirely on those renders.
 */
const MermaidDiagramImpl: React.FC<{ code: string }> = ({ code }) => {
  const { t } = useTranslation();
  // Seed from the synchronous cache: once a diagram has been rendered, a
  // re-render/remount shows it instantly instead of flashing "loading" (the
  // recurring flicker on large diagrams).
  const cached = getRenderedMermaid(code);
  const [svg, setSvg] = useState<string | null>(cached && "svg" in cached ? cached.svg : null);
  const [error, setError] = useState<string | null>(cached && "error" in cached ? cached.error : null);

  useEffect(() => {
    const hit = getRenderedMermaid(code);
    if (hit) {
      if ("svg" in hit) { setSvg(hit.svg); setError(null); } else { setError(hit.error); }
      return;
    }
    let alive = true;
    void renderMermaidDiagram(code).then((result) => {
      if (!alive) return;
      if ("svg" in result) {
        setSvg(result.svg);
        setError(null);
      } else {
        setError(result.error);
      }
    });
    return () => {
      alive = false;
    };
  }, [code]);

  if (error) {
    return (
      <div style={{ border: "1px solid var(--warning-border)", background: "var(--warning-bg)", color: "var(--warning-text)", borderRadius: "var(--radius-sm)", padding: "0.6em 1em", margin: "0.8em 0", fontSize: "0.85rem" }}>
        <div style={{ fontWeight: 600, marginBottom: "0.3em" }}>{t("reader.mermaidError")}</div>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "0.8rem" }}>{error}</pre>
      </div>
    );
  }
  if (!svg) {
    return <div style={{ color: "var(--text-faint)", padding: "0.6em 0" }}>{t("reader.mermaidLoading")}</div>;
  }
  // The SVG string comes from mermaid's renderer (strict mode), not from the
  // note text — the note only ever supplies the diagram SOURCE.
  return <div style={{ margin: "0.8em 0", overflowX: "auto" }} dangerouslySetInnerHTML={{ __html: svg }} />;
};

export const MermaidDiagram = React.memo(MermaidDiagramImpl);
