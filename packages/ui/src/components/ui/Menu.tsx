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

/**
 * Menu primitives (plan Designsprache P2). ONE floating-menu look for
 * dropdowns, context menus and pickers: .pv-menu surface (radius md,
 * --shadow-2, --z-menu) + .pv-menu-item rows. Two anchor modes:
 *   anchorRef — opens below/above an element (dropdown pattern)
 *   at        — opens at a point, viewport-clamped (context-menu pattern)
 * Closes on outside click, Escape, scroll and resize (same contract as the
 * previous DropdownMenu, which now renders through this surface).
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
  ariaLabel?: string;
  className?: string;
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
  ariaLabel,
  className,
  children,
}: MenuSurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Measure after render, then clamp/flip into the viewport.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left: number;
    let top: number;
    if (anchorRef?.current) {
      const r = anchorRef.current.getBoundingClientRect();
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
    setPos({ left, top });
    // Roving focus starts on the first enabled item.
    const first = el.querySelector<HTMLElement>(".pv-menu-item:not(:disabled)");
    first?.focus();
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
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      if (anchorRef?.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    // No native context menu ON a menu (right-click elsewhere closes via mousedown).
    const onCtx = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) e.preventDefault();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("contextmenu", onCtx);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("contextmenu", onCtx);
    };
  }, [open, onClose, anchorRef]);

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
          minWidth,
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
}

export function MenuItem({
  icon,
  hint,
  danger,
  onSelect,
  keepOpen,
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
      className={cx("pv-menu-item", danger && "pv-menu-item--danger", className)}
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
