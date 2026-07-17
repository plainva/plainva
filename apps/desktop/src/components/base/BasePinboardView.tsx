import { useTranslation } from "react-i18next";
import { EmptyState } from "@plainva/ui";

/**
 * Pinboard view (plan Pinboard 2026-07-16): a Keep-style board of note cards.
 *
 * P1 scaffold: routes and renders the view's rows as plain title tiles so the
 * view type, config panel wiring and format round-trip are exercised end to
 * end. P3 replaces the tile body with the shared note-card renderer (masonry
 * layout, pinned section, drag reorder, quick capture, label chips).
 */
export function BasePinboardView({
  dbData,
  onOpenNote,
}: {
  dbData: any[];
  onOpenNote: (path: string, ev?: { ctrlKey?: boolean; metaKey?: boolean }) => void;
}) {
  const { t } = useTranslation();
  if (!dbData || dbData.length === 0) {
    return <EmptyState>{t("database.emptyView", { defaultValue: "Keine Einträge in dieser Ansicht." })}</EmptyState>;
  }
  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "1rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        {dbData.map((row) => {
          const path = String(row["file.path"] ?? "");
          return (
            <button
              key={path}
              type="button"
              onClick={(e) => onOpenNote(path, { ctrlKey: e.ctrlKey, metaKey: e.metaKey })}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-secondary)",
                color: "var(--text-main)",
                cursor: "pointer",
                fontSize: "var(--text-ui)",
              }}
            >
              {String(row["file.name"] ?? path)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
