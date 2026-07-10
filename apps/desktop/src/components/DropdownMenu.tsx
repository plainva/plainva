import { type ReactNode, type RefObject } from "react";
import { MenuSurface, MenuItem as UiMenuItem, MenuSeparator } from "@plainva/ui";

export interface MenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export type MenuEntry = MenuItem | "separator";

interface DropdownMenuProps {
  open: boolean;
  /** Element the menu is anchored to (positioned below it). */
  anchorRef: RefObject<HTMLElement | null>;
  items: MenuEntry[];
  onClose: () => void;
  align?: "left" | "right";
  minWidth?: number;
  ariaLabel?: string;
}

/**
 * Item-model dropdown, since plan Designsprache P2 a thin adapter over the
 * ui/Menu primitives (one themed look for every floating menu). API unchanged
 * — callers keep passing MenuEntry arrays; visuals/keyboard come from
 * MenuSurface (.pv-menu classes, roving focus, Escape/outside-click/scroll).
 */
export function DropdownMenu({
  open,
  anchorRef,
  items,
  onClose,
  align = "left",
  minWidth = 200,
  ariaLabel,
}: DropdownMenuProps) {
  // Old contract: the menu is at least as wide as its anchor.
  const anchorWidth = open ? anchorRef.current?.getBoundingClientRect().width ?? 0 : 0;
  return (
    <MenuSurface
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      align={align}
      minWidth={Math.max(minWidth, Math.round(anchorWidth))}
      ariaLabel={ariaLabel}
    >
      {items.map((item, i) =>
        item === "separator" ? (
          <MenuSeparator key={`sep-${i}`} />
        ) : (
          <UiMenuItem
            key={item.id}
            icon={item.icon}
            hint={item.hint}
            danger={item.danger}
            disabled={item.disabled}
            onSelect={item.onSelect}
          >
            {item.label}
          </UiMenuItem>
        )
      )}
    </MenuSurface>
  );
}
