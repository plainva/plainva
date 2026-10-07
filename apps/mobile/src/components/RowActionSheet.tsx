import { useRef, type ReactNode } from "react";
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
  detail,
  actions,
  onClose,
}: {
  title: string;
  /** Shown in place of the title when what the sheet is about needs more than
   *  one bold line — the full target of a mail link (plan Befunde 06.10., M1). */
  detail?: ReactNode;
  actions: RowAction[];
  onClose: () => void;
}) {
  /**
   * A sheet opened by a HOLD appears under a finger that is still down. Where
   * the platform turns the release into a click, that click lands on whatever
   * is under the finger NOW — the backdrop (the sheet closes in the moment it
   * opened) or one of its rows (an action nobody chose). So a pointer click
   * only counts when its press began on the sheet too. A click without a
   * pointer (keyboard, `detail` 0) has no press to check.
   */
  const pressedHere = useRef(false);
  return (
    <div
      className="m-sheet-backdrop"
      onClick={onClose}
      onClickCapture={(e) => {
        const began = pressedHere.current;
        pressedHere.current = false;
        if (e.detail === 0 || began) return;
        e.stopPropagation();
        e.preventDefault();
      }}
      onPointerDownCapture={() => {
        pressedHere.current = true;
      }}
    >
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        {detail ?? <p className="m-sheet-title">{title}</p>}
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
