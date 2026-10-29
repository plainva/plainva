import { createPortal } from "react-dom";
import type { PlatformSheetProps } from "@plainva/ui";
import { SheetGrip } from "./SheetGrip";

/**
 * The phone's bottom sheet for a small panel that shared code opens — the text
 * behind the info button of a setting (settings plan 2026-10-29, § 3). It is
 * registered as `PlatformServices.Sheet`, which is how the shared `InfoTip`
 * knows to open a sheet here and a popover on the desktop.
 *
 * The same sheet as "What is OKF?": backdrop, grip (drag to dismiss, and the
 * registration that lets the back button close it first), a title line. It is
 * placed at the end of the document, like the dialog sheets: opened from
 * inside a row, it would otherwise inherit the row's single, cut-off line.
 */
export function PlatformSheet({ title, onClose, testId, children }: PlatformSheetProps) {
  return createPortal(
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" data-testid={testId} onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{title}</p>
        {children}
      </div>
    </div>,
    document.body,
  );
}
