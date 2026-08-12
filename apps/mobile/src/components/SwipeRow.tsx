import { useRef, useState, type ReactNode } from "react";
import { haptics } from "../services/haptics";

export interface SwipeAction {
  icon: ReactNode;
  label: string;
  /** The destructive one is drawn in the danger colour and sits last. */
  danger?: boolean;
  onClick: () => void;
}

/** One action slot's width, mirrored by `--m-swipe-slot` in mobile.css. */
const SLOT = 66;
/** Below this the finger is still deciding between scrolling and swiping. */
const SLOP = 10;

/**
 * A list row with actions behind it (S12, mockup "Ordner mit Wischaktion").
 *
 * The seven interaction rules give each gesture exactly one meaning: tapping
 * opens, swiping performs the row action, holding opens the row's sheet. Before
 * this, every side action hid behind a hold — so the most frequent actions cost
 * a hold, a read and a second tap.
 *
 * "Holding starts multi-select" is what this said until S22, and it was only
 * ever true of note rows: a hold on a folder or a database opened that row's
 * sheet instead. Selecting several is now the sheet's first entry, so the hold
 * means the same thing on every kind of row and the choice has a name.
 *
 * The drag only claims the gesture once it is clearly horizontal; until then
 * the list scrolls as usual. That order matters on a phone: a row that steals
 * vertical movement makes the whole screen feel stuck.
 */
export function SwipeRow({ actions, children }: { actions: SwipeAction[]; children: ReactNode }) {
  const width = SLOT * actions.length;
  const [open, setOpen] = useState(false);
  const [dx, setDx] = useState<number | null>(null);
  const drag = useRef<{ x: number; y: number; axis: "" | "x" | "y" } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, axis: "" };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (d.axis === "") {
      if (Math.abs(my) > SLOP && Math.abs(my) > Math.abs(mx)) {
        // Vertical wins: hand the gesture back to the list.
        drag.current = null;
        return;
      }
      if (Math.abs(mx) < SLOP) return;
      d.axis = "x";
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    const base = open ? -width : 0;
    setDx(Math.max(-width, Math.min(0, base + mx)));
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.axis !== "x") return;
    const settled = (dx ?? 0) < -width / 2;
    if (settled !== open) haptics.light();
    setOpen(settled);
    setDx(null);
  };

  const shift = dx ?? (open ? -width : 0);
  // The actions exist only while they can be reached. Painted behind a closed
  // row they showed through at the rounded corners, and a screen reader would
  // have announced buttons nobody can see.
  const showActions = open || dx !== null;

  return (
    <div className="m-swipe" style={{ ["--m-swipe-w" as string]: `${width}px` }}>
      {showActions && (
      <div className="m-swipe-act">
        {actions.map((a, i) => (
          <button
            className={a.danger ? "m-swipe-btn m-swipe-btn--danger" : "m-swipe-btn"}
            key={i}
            onClick={() => {
              setOpen(false);
              setDx(null);
              a.onClick();
            }}
            tabIndex={open ? 0 : -1}
            type="button"
          >
            {a.icon}
            <span>{a.label}</span>
          </button>
        ))}
      </div>
      )}
      <div
        className="m-swipe-front"
        onPointerCancel={end}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        // A row that is open swallows the next tap: closing is what the user
        // means by touching it again, not opening the note underneath.
        onClickCapture={(e) => {
          if (!open) return;
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
        }}
        style={{ transform: `translateX(${shift}px)`, transition: dx === null ? undefined : "none" }}
      >
        {children}
      </div>
    </div>
  );
}
