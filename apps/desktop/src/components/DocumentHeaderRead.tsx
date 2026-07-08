import React from "react";
import type { PlainvaDocMeta } from "@plainva/core";
import { DocIcon } from "./DocIcon";

/**
 * Read-mode document header: full-width color stripe + document icon above the
 * first content (Notion-like). Display-only — editing happens in live mode.
 * Rendered as a sibling above MarkdownReader inside the read scroll container,
 * so the stripe naturally spans the whole pane and scrolls with the content.
 */
export const DocumentHeaderRead: React.FC<{ meta: PlainvaDocMeta; fullWidth: boolean }> = ({
  meta,
  fullWidth,
}) => {
  if (!meta.icon && !meta.headerColor) return null;
  return (
    <div className="pv-doc-header pv-doc-header-read" style={{ flexShrink: 0 }}>
      {meta.headerColor && (
        <div className="pv-doc-header-stripe" style={{ background: meta.headerColor }} />
      )}
      {meta.icon && (
        <div
          style={{
            maxWidth: fullWidth ? "none" : "800px",
            margin: "0 auto",
            padding: "0 2rem",
            width: "100%",
            boxSizing: "border-box",
          }}
        >
          <span className="pv-doc-header-icon" role="img" aria-hidden="true">
            <DocIcon icon={meta.icon} color={meta.iconColor} size={44} />
          </span>
        </div>
      )}
    </div>
  );
};
