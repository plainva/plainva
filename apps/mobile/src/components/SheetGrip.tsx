import { useRef } from "react";

/**
 * Drag-to-dismiss grip for bottom sheets (maintainer feedback: the handle
 * must swipe the sheet away). Dragging moves the sheet with the finger;
 * releasing past the threshold (or with a fast flick) closes it, otherwise
 * it springs back. Pointer events cover touch + mouse.
 */
export function SheetGrip({ onClose }: { onClose: () => void }) {
  const drag = useRef<{ startY: number; startT: number; sheet: HTMLElement | null } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const sheet = (e.currentTarget as HTMLElement).closest<HTMLElement>(".m-sheet");
    drag.current = { startY: e.clientY, startT: performance.now(), sheet };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (sheet) sheet.style.transition = "none";
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d?.sheet) return;
    const dy = Math.max(0, e.clientY - d.startY);
    d.sheet.style.transform = dy > 0 ? `translateY(${dy}px)` : "";
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.sheet) return;
    const dy = Math.max(0, e.clientY - d.startY);
    const speed = dy / Math.max(1, performance.now() - d.startT);
    d.sheet.style.transition = "";
    if (dy > 120 || (dy > 40 && speed > 0.5)) {
      onClose();
      // The sheet unmounts; reset in case the host keeps it alive.
      d.sheet.style.transform = "";
    } else {
      d.sheet.style.transform = "";
    }
  };

  return (
    <div
      className="m-sheet-grip m-sheet-grip--drag"
      onPointerCancel={endDrag}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
    />
  );
}
