import React from "react";
import { Bold, Italic, Strikethrough, Code, Highlighter, Link } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON } from "@plainva/ui";

export type FormatAction = "bold" | "italic" | "strike" | "code" | "highlight" | "link";

interface Props {
  x: number;
  y: number;
  /** Render above the selection (true) or below it (near the top edge). */
  above: boolean;
  onAction: (action: FormatAction) => void;
}

// Notion-style floating formatting toolbar shown over a non-empty selection (#5).
// `onMouseDown preventDefault` is essential: it keeps the editor's selection and
// focus while a button is clicked, so the formatting applies to the right range.
export const SelectionToolbar: React.FC<Props> = ({ x, y, above, onAction }) => {
  const { t } = useTranslation();
  const items: { a: FormatAction; icon: React.ReactNode; label: string }[] = [
    { a: "bold", icon: <Bold size={ICON.ui} />, label: t("editor.fmtBold", { defaultValue: "Fett" }) },
    { a: "italic", icon: <Italic size={ICON.ui} />, label: t("editor.fmtItalic", { defaultValue: "Kursiv" }) },
    { a: "strike", icon: <Strikethrough size={ICON.ui} />, label: t("editor.fmtStrike", { defaultValue: "Durchgestrichen" }) },
    { a: "code", icon: <Code size={ICON.ui} />, label: t("editor.fmtCode", { defaultValue: "Inline-Code" }) },
    { a: "highlight", icon: <Highlighter size={ICON.ui} />, label: t("editor.fmtHighlight", { defaultValue: "Markierung" }) },
    { a: "link", icon: <Link size={ICON.ui} />, label: t("editor.fmtLink", { defaultValue: "Link" }) },
  ];

  return (
    <div
      role="toolbar"
      aria-label={t("editor.fmtToolbar", { defaultValue: "Formatierung" })}
      onMouseDown={(e) => e.preventDefault()}
      style={{
        position: "fixed",
        left: x,
        top: y,
        transform: above ? "translateY(-100%)" : "none",
        zIndex: 1000,
        display: "flex",
        gap: "2px",
        background: "var(--bg-primary)",
        border: "1px solid var(--border-color)",
        borderRadius: "var(--radius-md)",
        boxShadow: "var(--shadow-2)",
        padding: "4px",
      }}
    >
      {items.map((it) => (
        <button
          key={it.a}
          type="button"
          data-tip={it.label}
          aria-label={it.label}
          onClick={() => onAction(it.a)}
          className="pv-iconbtn"
        >
          {it.icon}
        </button>
      ))}
    </div>
  );
};
