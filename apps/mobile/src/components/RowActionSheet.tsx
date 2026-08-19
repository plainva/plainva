import type { ReactNode } from "react";
import { SheetGrip } from "../components/SheetGrip";

export interface RowAction {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
  /** For the tests that reach for one specific entry rather than its label. */
  testId?: string;
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
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{title}</p>
        {/* S21: the `danger` field existed, the ORDER did not. Colour alone is
            not separation — a destructive entry a thumb-width from a harmless
            one is reachable by a stray tap. Destructive actions move to the end
            and sit behind a hairline, structurally, so a future caller cannot
            drop one in the middle. */}
        {[...actions.filter((a) => !a.danger), ...actions.filter((a) => a.danger)].map((a, i, all) => (
          <button
            key={i}
            className={a.danger ? "m-row m-danger" : "m-row"}
            data-sheet-sep={a.danger && !all[i - 1]?.danger ? "" : undefined}
            data-testid={a.testId}
            onClick={a.onClick}
          >
            {a.icon}
            <span>{a.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
