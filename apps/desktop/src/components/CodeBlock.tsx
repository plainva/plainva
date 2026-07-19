import React, { useState, useEffect } from "react";
import { Copy, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { highlightCodeToTokens, ICON, type HighlightedToken } from "@plainva/ui";

// Read-view fenced code block (#10/#13): a themed container with a language
// label and a copy button. Syntax highlighting mirrors the live editor — the
// grammar is lazy-loaded from the SAME @codemirror/language-data table and the
// SAME highlighters paint the tokens (see @plainva/ui highlightCodeToTokens).
// Until the grammar arrives (or for an unknown language) the raw text renders,
// so a code block is never blank or broken.
export const CodeBlock: React.FC<{ code: string; lang?: string }> = ({ code, lang }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [tokens, setTokens] = useState<HighlightedToken[] | null>(null);

  useEffect(() => {
    let alive = true;
    setTokens(null);
    void highlightCodeToTokens(code, lang)
      .then((result) => {
        if (alive) setTokens(result);
      })
      .catch(() => {
        if (alive) setTokens(null);
      });
    return () => {
      alive = false;
    };
  }, [code, lang]);

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }).catch((e) => { console.warn("[CodeBlock] copy to clipboard failed", e); });
  };
  return (
    <div style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)", margin: "0.6em 0", overflow: "hidden", background: "var(--code-bg)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 10px", borderBottom: "1px solid var(--border-color)", fontSize: "0.72em", color: "var(--text-muted)" }}>
        <span style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>{lang || t("editor.codeBlock", { defaultValue: "Code" })}</span>
        <button
          onClick={copy}
          data-tip={t("editor.copy", { defaultValue: "Kopieren" })}
          aria-label={t("editor.copy", { defaultValue: "Kopieren" })}
          className="pv-btn pv-btn--ghost pv-btn--sm"
          style={copied ? { color: "var(--accent-color)" } : undefined}
        >
          {copied ? <Check size={ICON.ui} /> : <Copy size={ICON.ui} />}
          {copied ? t("editor.copied", { defaultValue: "Kopiert" }) : t("editor.copy", { defaultValue: "Kopieren" })}
        </button>
      </div>
      <pre style={{ margin: 0, padding: "0.8em 1em", overflowX: "auto" }}>
        <code style={{ fontFamily: "monospace", fontSize: "0.9em", color: "var(--text-main)", background: "transparent" }}>
          {tokens
            ? tokens.map((token, i) =>
                token.cls
                  ? <span key={i} className={token.cls}>{token.text}</span>
                  : <React.Fragment key={i}>{token.text}</React.Fragment>,
              )
            : code}
        </code>
      </pre>
    </div>
  );
};
