import type { ReactNode } from "react";

export interface RowAction {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}

/**
 * Shared mobile bottom-sheet for row context menus (long-press). Mirrors the
 * hand-built `.m-sheet` markup that BrowseScreen uses, so Today / Databases /
 * `.base` rows get the same delete affordance without duplicating it per screen.
 */
export function RowActionSheet({
  title,
  actions,
  onClose,
}: {
  title: string;
  actions: RowAction[];
  onClose: () => void;
}) {
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="m-sheet-grip" />
        <p className="m-sheet-title">{title}</p>
        {actions.map((a, i) => (
          <button key={i} className={a.danger ? "m-row m-danger" : "m-row"} onClick={a.onClick}>
            {a.icon}
            <span>{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
