import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { cx } from "./cx";
import { useOutsidePress } from "./useOutsidePress";

/**
 * Menu primitives (plan Designsprache P2). ONE floating-menu look for
 * dropdowns, context menus and pickers: .pv-menu surface (radius md,
 * --shadow-2, --z-menu) + .pv-menu-item rows. Two anchor modes:
 *   anchorRef — opens below/above an element (dropdown pattern)
 *   at        — opens at a point, viewport-clamped (context-menu pattern)
 * Closes on a press outside, Escape, scroll and resize (same contract as the
 * previous DropdownMenu, which now renders through this surface).
 *
 * This is the one place `.pv-menu` is drawn. A menu drawn by hand has the
 * look and none of the contract: the two that existed until 2026-10-11 did
 * not close on Escape, and one of them not on a press beside it either.
 */

const MenuCtx = createContext<{ onClose: () => void } | null>(null);

export interface MenuSurfaceProps {
  open: boolean;
  onClose: () => void;
  /** Anchor element — menu opens below it (or above when space is short). */
  anchorRef?: RefObject<HTMLElement | null>;
  /** Point mode (context menus): open at these viewport coordinates. */
  at?: { x: number; y: number };
  align?: "left" | "right";
  minWidth?: number;
  /**
   * As wide as the anchor, no narrower and no wider — for a menu that hangs on
   * a line across its whole panel (the vault line at the foot of the sidebar)
   * and reads as that line's other half. A long entry is cut short like the
   * line's own text, and under a narrow line the menu does not hang out of the
   * panel. `minWidth` does not apply then.
   */
  matchAnchorWidth?: boolean;
  ariaLabel?: string;
  className?: string;
  /**
   * Whether opening moves focus into the menu (default true).
   *
   * False is for a menu that COMPLETES a field the caret is in - the mention
   * picker. There the roving focus would be the bug: taking the caret out of
   * the textarea is exactly what stops typing from narrowing the list, which is
   * the whole point of that surface. The owner then drives the highlight from
   * the field via `active` on MenuItem.
   */
  autoFocus?: boolean;
  children: ReactNode;
}

const MARGIN = 8;

export function MenuSurface({
  open,
  onClose,
  anchorRef,
  at,
  align = "left",
  minWidth = 180,
  matchAnchorWidth = false,
  ariaLabel,
  className,
  autoFocus = true,
  children,
}: MenuSurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; fit: number | null } | null>(null);

  // Measure after render, then clamp/flip into the viewport.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const r = anchorRef?.current?.getBoundingClientRect();
    // The anchor's width is taken on before the menu is measured: how wide the
    // menu is decides where it fits.
    const fit = matchAnchorWidth && r ? r.width : null;
    if (fit !== null) {
      el.style.minWidth = `${fit}px`;
      el.style.maxWidth = `${fit}px`;
    }
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left: number;
    let top: number;
    if (r) {
      left = align === "right" ? r.right - w : r.left;
      const spaceBelow = window.innerHeight - r.bottom;
      const openUp = spaceBelow < h + MARGIN + 6 && r.top > spaceBelow;
      top = openUp ? r.top - h - 6 : r.bottom + 6;
    } else {
      left = at?.x ?? MARGIN;
      top = at?.y ?? MARGIN;
      if (top + h > window.innerHeight - MARGIN) top = Math.max(MARGIN, top - h);
    }
    left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, window.innerWidth - w - MARGIN));
    top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, window.innerHeight - h - MARGIN));
    setPos({ left, top, fit });
    // Roving focus starts on the first enabled item.
    if (autoFocus) {
      const first = el.querySelector<HTMLElement>(".pv-menu-item:not(:disabled)");
      first?.focus({ preventScroll: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => onClose();
    // The menu's own scroll (max-height + overflow-y:auto) must NOT close it —
    // only page/anchor scroll dismisses. scroll doesn't bubble, but a capturing
    // window listener also receives the menu's own descendant scroll, which used
    // to close it on the first wheel delta (making a scrollable menu unusable).
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    // No native context menu ON a menu (a right-click elsewhere is a press
    // outside and closes it).
    const onCtx = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) e.preventDefault();
    };
    // A scroll that happened BEFORE the menu opened is not a reason to close
    // it — and its event is still on its way: the browser reports a scroll in
    // the next frame. A folder opened in the tree and right-clicked at once
    // closed its own context menu that way (finding 2026-10-06). The listener
    // therefore starts with the first frame after the menu, when everything
    // that was pending has been delivered.
    const frame = requestAnimationFrame(() => window.addEventListener("scroll", onScroll, true));
    window.addEventListener("resize", close);
    document.addEventListener("keydown", onKey);
    document.addEventListener("contextmenu", onCtx);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("contextmenu", onCtx);
    };
  }, [open, onClose]);

  // A press anywhere but on the menu and on what it hangs on — the anchor's
  // own press is the anchor's to answer.
  useOutsidePress(open, onClose, ref, anchorRef);

  if (!open) return null;

  const moveFocus = (dir: 1 | -1, edge?: "first" | "last") => {
    const el = ref.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>(".pv-menu-item:not(:disabled)"));
    if (!items.length) return;
    if (edge === "first") return items[0].focus();
    if (edge === "last") return items[items.length - 1].focus();
    const cur = items.indexOf(document.activeElement as HTMLElement);
    items[(cur + dir + items.length) % items.length].focus();
  };

  return (
    <MenuCtx.Provider value={{ onClose }}>
      <div
        ref={ref}
        role="menu"
        aria-label={ariaLabel}
        className={cx("pv-menu", className)}
        style={{
          left: pos?.left ?? -9999,
          top: pos?.top ?? -9999,
          minWidth: pos?.fit ?? minWidth,
          maxWidth: pos?.fit ?? undefined,
          visibility: pos ? "visible" : "hidden",
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); moveFocus(1); }
          else if (e.key === "ArrowUp") { e.preventDefault(); moveFocus(-1); }
          else if (e.key === "Home") { e.preventDefault(); moveFocus(1, "first"); }
          else if (e.key === "End") { e.preventDefault(); moveFocus(1, "last"); }
        }}
      >
        {children}
      </div>
    </MenuCtx.Provider>
  );
}

export interface MenuItemButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  /** Right-aligned hint (e.g. a shortcut). */
  hint?: string;
  danger?: boolean;
  /** Action; the surrounding menu closes afterwards unless keepOpen is set. */
  onSelect?: () => void;
  keepOpen?: boolean;
  /**
   * Highlighted without holding focus.
   *
   * Only for a menu opened with `autoFocus={false}`: there the keyboard lives in
   * the field below, so :focus-visible can never mark the row the arrow keys
   * are on.
   */
  active?: boolean;
}

export function MenuItem({
  icon,
  hint,
  danger,
  onSelect,
  keepOpen,
  active,
  className,
  children,
  onClick,
  ...rest
}: MenuItemButtonProps) {
  const ctx = useContext(MenuCtx);
  return (
    <button
      type="button"
      role="menuitem"
      className={cx("pv-menu-item", danger && "pv-menu-item--danger", active && "is-active", className)}
      onClick={(e) => {
        onClick?.(e);
        onSelect?.();
        if (!keepOpen) ctx?.onClose();
      }}
      {...rest}
    >
      {icon ? <span className="pv-menu-ic">{icon}</span> : null}
      <span className="pv-menu-text">{children}</span>
      {hint ? <span className="pv-menu-hint">{hint}</span> : null}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="pv-menu-sep" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="pv-menu-label">{children}</div>;
}
