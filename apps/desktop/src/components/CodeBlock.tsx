import React, { useState } from "react";
import { Copy, Check } from "lucide-react";
import { useTranslation } from "react-i18next";

// Read-view fenced code block (#10): a themed container with a language label
// and a copy button. (Live/source highlighting is handled by CodeMirror's
// codeLanguages; the read view keeps a clean monospace block.)
export const CodeBlock: React.FC<{ code: string; lang?: string }> = ({ code, lang }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
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
          title={t("editor.copy", { defaultValue: "Kopieren" })}
          aria-label={t("editor.copy", { defaultValue: "Kopieren" })}
          style={{ display: "flex", alignItems: "center", gap: 4, background: "transparent", border: "none", color: copied ? "var(--accent-color)" : "var(--text-muted)", cursor: "pointer", fontSize: "1em" }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? t("editor.copied", { defaultValue: "Kopiert" }) : t("editor.copy", { defaultValue: "Kopieren" })}
        </button>
      </div>
      <pre style={{ margin: 0, padding: "0.8em 1em", overflowX: "auto" }}>
        <code style={{ fontFamily: "monospace", fontSize: "0.9em", color: "var(--text-main)", background: "transparent" }}>{code}</code>
      </pre>
    </div>
  );
};
