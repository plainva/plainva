import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { Fab, ICON, useStableHandler } from "@plainva/ui";
import { haptics } from "../services/haptics";
import { registerSheet } from "../services/sheetStack";

export interface FabItem {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}

/**
 * The create action, as a FAB menu (S12, Material 3 Expressive).
 *
 * It used to open a bottom sheet: the finger travelled from the bottom right to
 * the bottom centre, a surface slid up over the content, and the list arrived
 * somewhere other than where it was asked for. M3E replaced the old speed dial
 * with exactly this — the button stays where it is and the choices unfold along
 * it, so the eye never leaves the point of origin.
 *
 * The first entry is the surface's own meaning (a new note in the notes area,
 * a message in mail): the FAB says what it does HERE, and the rest stays one
 * tap away instead of being spread over five different plus buttons.
 */
export function FabMenu({
  label,
  icon,
  items,
  open,
  onOpenChange,
}: {
  /** The primary action's name — the button's accessible name when closed. */
  label: string;
  icon: ReactNode;
  items: FabItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const change = useStableHandler(onOpenChange);
  // Open choices are navigation state like a sheet: back closes them (S12).
  useEffect(() => {
    if (!open) return;
    return registerSheet(() => change(false));
  }, [open, change]);

  return (
    <>
      {open && (
        <div className="m-fabmenu-scrim" onClick={() => onOpenChange(false)} />
      )}
      <div className={`m-fabmenu${open ? " is-open" : ""}`}>
        {open && (
          <div className="m-fabmenu-items">
            {items.map((it, i) => (
              <button
                className="m-fabmenu-item"
                key={i}
                onClick={() => {
                  onOpenChange(false);
                  it.onClick();
                }}
                // Unfolding upwards: the entry nearest the thumb appears first.
                style={{ ["--m-fab-i" as string]: `${items.length - 1 - i}` }}
                type="button"
              >
                <span className="m-fabmenu-label">{it.label}</span>
                <span className="m-fabmenu-icon">{it.icon}</span>
              </button>
            ))}
          </div>
        )}
        <Fab
          aria-label={open ? label : label}
          aria-expanded={open}
          className="m-fab-float m-fab-float--above-tabs"
          data-testid="capture-fab"
          icon={open ? <X size={ICON.touch} /> : icon}
          onClick={() => {
            haptics.light();
            onOpenChange(!open);
          }}
        />
      </div>
    </>
  );
}
