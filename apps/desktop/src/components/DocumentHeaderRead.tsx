import React from "react";
import type { PlainvaDocMeta } from "@plainva/core";
import { DocIcon, ICON_DOC_HEADER, type TrustBadge } from "@plainva/ui";

/**
 * Read-mode document header: full-width color stripe + document icon above the
 * first content (Notion-like). Display-only — editing happens in live mode.
 * Rendered as a sibling above MarkdownReader inside the read scroll container,
 * so the stripe naturally spans the whole pane and scrolls with the content.
 *
 * Since OKF 0.2 (plan P3a) the header also carries the lifecycle badge — a
 * small pill for `draft` and `deprecated`; `stable` stays silent and a foreign
 * `status` value (a task database's column) never becomes a badge. The live
 * widget in `@plainva/ui` renders the same pill from the same texts.
 */
export const DocumentHeaderRead: React.FC<{
  meta: PlainvaDocMeta;
  fullWidth: boolean;
  badge?: TrustBadge | null;
  badgeTexts?: { statusDraft: string; statusDeprecated: string };
}> = ({ meta, fullWidth, badge = null, badgeTexts }) => {
  if (!meta.icon && !meta.headerColor && !badge) return null;
  const badgeLabel = badge === "draft" ? badgeTexts?.statusDraft : badge === "deprecated" ? badgeTexts?.statusDeprecated : undefined;
  return (
    <div className="pv-doc-header pv-doc-header-read" style={{ flexShrink: 0 }}>
      {meta.headerColor && (
        <div className="pv-doc-header-stripe" style={{ background: meta.headerColor }} />
      )}
      {(meta.icon || badge) && (
        <div
          style={{
            maxWidth: fullWidth ? "none" : "800px",
            margin: "0 auto",
            padding: "0 2rem",
            width: "100%",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: "var(--space-1)",
          }}
        >
          {meta.icon && (
            <span className="pv-doc-header-icon" role="img" aria-hidden="true">
              <DocIcon icon={meta.icon} color={meta.iconColor} size={ICON_DOC_HEADER} />
            </span>
          )}
          {badge && (
            <span
              className={`pv-chip pv-chip--sm${badge === "deprecated" ? " pv-chip--danger" : ""}`}
              data-testid="okf-status-badge"
              data-status={badge}
            >
              {badgeLabel ?? badge}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
