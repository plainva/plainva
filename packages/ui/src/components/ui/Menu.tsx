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
import { useStableHandler } from "../../lib/useStableHandler";

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

/** Inputs nobody types into. Every other one is typed into — text, but also a number, a date, a time. */
const NOT_TYPED = new Set(["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image", "hidden"]);

/** A field someone types into: an input or a textarea that takes input. */
function isTypingField(el: Element | null): boolean {
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  return el instanceof HTMLInputElement && !NOT_TYPED.has(el.type) && !el.readOnly && !el.disabled;
}

/** A one-line field that steps into the entries with the arrow keys: text or search. */
function isLineField(el: Element | null): boolean {
  return el instanceof HTMLInputElement && (el.type === "text" || el.type === "search") && isTypingField(el);
}

/**
 * Puts the keyboard where it starts in a menu: a field of its own — a filter
 * above the entries, as the labels of a pinboard card have — before the first
 * enabled entry; typing is what such a menu is opened for. Whatever does not
 * take the focus (hidden, by an attribute or a style) is passed over.
 */
function focusFirstStop(menu: HTMLElement) {
  for (const el of Array.from(menu.querySelectorAll<HTMLElement>("input, .pv-menu-item"))) {
    const stop = el.classList.contains("pv-menu-item") ? !el.matches(":disabled") : isLineField(el) && !el.closest("[hidden]");
    if (!stop) continue;
    el.focus({ preventScroll: true });
    if (document.activeElement === el) return;
  }
}

/**
 * A key that works a menu acts once. Held down, it repeats into whatever has
 * the focus next — the opener the menu hands the focus back to, where an Enter
 * on "Copy" over the editor went on to replace the selection with a line
 * break. Its repeats are swallowed until it is released: by its keyup, by the
 * window losing the focus, or by a fresh press of it (macOS sends no keyup for
 * a key let go while ⌘ is held).
 */
let heldKey: string | null = null;
function swallowRepeat(e: KeyboardEvent) {
  if (e.key !== heldKey) return;
  if (!e.repeat) {
    releaseHeldKey();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
}
function releaseHeldKey() {
  heldKey = null;
  window.removeEventListener("keydown", swallowRepeat, true);
  window.removeEventListener("keyup", onHeldKeyUp, true);
  window.removeEventListener("blur", releaseHeldKey);
}
function onHeldKeyUp(e: KeyboardEvent) {
  if (e.key === heldKey) releaseHeldKey();
}
function holdUntilReleased(key: string) {
  if (heldKey === null) {
    window.addEventListener("keydown", swallowRepeat, true);
    window.addEventListener("keyup", onHeldKeyUp, true);
    window.addEventListener("blur", releaseHeldKey);
  }
  heldKey = key;
}

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** The element itself if it takes the focus, else the first one inside it that does. */
function focusableIn(el: HTMLElement | null | undefined): HTMLElement | null {
  if (!el) return null;
  return el.matches(FOCUSABLE) ? el : el.querySelector<HTMLElement>(FOCUSABLE);
}

/**
 * What a closing menu is about to hand the focus back to. A menu that opens in
 * that moment — an entry of the first opened it — takes the hand-back over and
 * returns the focus there itself when it closes.
 */
let handingBack: HTMLElement | null = null;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Roving focus starts on the first enabled item — once the menu stands where
  // it belongs. Until `pos` is set it is `visibility: hidden`, and a hidden
  // element takes no focus: the call used to sit in the measuring effect above,
  // did nothing in a browser (jsdom focuses hidden elements, so its unit test
  // stayed green), and the arrow keys reached a menu only after a Tab into it
  // (Sammelplan § 3.99).
  //
  // Closing takes the menu, and the entry that holds the focus, out of the
  // page: the focus would fall to <body>, and Escape left a keyboard nowhere.
  // It goes back to what had it when the menu opened — unless it has moved on
  // by then (an entry put it into a field or a dialog). A press beside the menu
  // decides itself where the focus goes, as any press does: onto what it
  // landed on, or nowhere.
  //
  // Why the menu closed, when it closed itself: a press beside it, or a scroll
  // or resize of the page.
  const closeCause = useRef<"press" | "scroll" | null>(null);
  const closeFor = useStableHandler((cause: "press" | "scroll" | null) => {
    closeCause.current = cause;
    onClose();
  });
  const placed = pos !== null;
  useLayoutEffect(() => {
    if (!open || !placed || !autoFocus) return;
    const el = ref.current;
    if (!el) return;
    closeCause.current = null;
    const had = document.activeElement;
    // What gets the focus back: what had it; else what a menu closing in this
    // moment was handing it back to (an entry of it opened this one); else what
    // the menu hangs on — a clicked button takes no focus in WebKit, so on
    // macOS nothing had it.
    const opener =
      (had instanceof HTMLElement && had !== document.body && !el.contains(had) ? had : null) ??
      (handingBack?.isConnected ? handingBack : null) ??
      focusableIn(anchorRef?.current);
    // A field someone is typing in keeps the keyboard when a menu opens over
    // it — a right-click into it, the row menu of a cell being edited, the menu
    // of a file being renamed. Such a field may end its edit when it loses the
    // focus (a rename commits, a cell saves, a half-typed number empties the
    // value), and the menu would end it just by opening — or a pick with the
    // mouse would, before the pick runs: so a press on the menu takes no focus
    // either. Escape is the menu's first all the same — one press closes the
    // menu, the next is the field's (which may give up its edit on it) —,
    // except while an input method composes.
    const kept = had !== null && !el.contains(had) && isTypingField(had);
    let onEscape: ((e: KeyboardEvent) => void) | null = null;
    const keepFieldFocus = (e: MouseEvent) => e.preventDefault();
    if (kept) {
      onEscape = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) holdUntilReleased(e.key);
        closeFor(null);
      };
      window.addEventListener("keydown", onEscape, true);
      el.addEventListener("mousedown", keepFieldFocus);
    } else {
      focusFirstStop(el);
    }
    return () => {
      if (onEscape) window.removeEventListener("keydown", onEscape, true);
      el.removeEventListener("mousedown", keepFieldFocus);
      const cause = closeCause.current;
      closeCause.current = null;
      if (!opener) return;
      const handBack = () => {
        if (handingBack === opener) handingBack = null;
        const now = document.activeElement;
        if ((now === null || now === document.body || el.contains(now)) && opener.isConnected) {
          opener.focus({ preventScroll: true });
        }
      };
      if (cause === "press") {
        // A press beside the menu decides where the focus goes: onto what it
        // landed on, or nowhere — unless it moves none at all. A handle that
        // takes the press for a drag (a floating window's head, its grip)
        // cancels it, no mousedown follows, and the focus would stay nowhere
        // after the drag; then it comes back when the press ends.
        let moved = false;
        const onDown = (e: MouseEvent) => {
          if (!e.defaultPrevented) moved = true;
        };
        const done = () => {
          window.removeEventListener("mousedown", onDown);
          window.removeEventListener("pointerup", done, true);
          window.removeEventListener("pointercancel", done, true);
          window.clearTimeout(lapse);
          if (!moved) handBack();
        };
        const lapse = window.setTimeout(() => {
          moved = true;
          done();
        }, 30_000);
        window.addEventListener("mousedown", onDown);
        window.addEventListener("pointerup", done, true);
        window.addEventListener("pointercancel", done, true);
        return;
      }
      handingBack = opener;
      // Not during React's commit, which dispatches nothing — the opener's own
      // focus handlers would not run —, but right after it, before the next key
      // or press is handled. When a scroll or a resize closed the menu, after
      // it has reached the page: an editor focused before it has seen a scroll
      // puts a scroll to its very top back.
      if (cause === "scroll") window.setTimeout(handBack, 0);
      else queueMicrotask(handBack);
    };
    // The anchor is read when the menu opens, as the measuring effect reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, placed, autoFocus]);

  useEffect(() => {
    if (!open) return;
    const close = () => closeFor("scroll");
    // The menu's own scroll (max-height + overflow-y:auto) must NOT close it —
    // only page/anchor scroll dismisses. scroll doesn't bubble, but a capturing
    // window listener also receives the menu's own descendant scroll, which used
    // to close it on the first wheel delta (making a scrollable menu unusable).
    const onScroll = (e: Event) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return;
      closeFor("scroll");
    };
    const onKey = (e: KeyboardEvent) => {
      // While an input method composes, Escape is its own (it gives up the composition).
      if (e.key === "Escape" && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        if (!e.repeat) holdUntilReleased(e.key);
        closeFor(null);
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
  }, [open, closeFor]);

  // A press anywhere but on the menu and on what it hangs on — the anchor's
  // own press is the anchor's to answer.
  useOutsidePress(open, () => closeFor("press"), ref, anchorRef);

  if (!open) return null;

  const moveFocus = (dir: 1 | -1, edge?: "first" | "last") => {
    const el = ref.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>(".pv-menu-item:not(:disabled)"));
    if (!items.length) return;
    if (edge === "first") return items[0].focus();
    if (edge === "last") return items[items.length - 1].focus();
    const cur = items.indexOf(document.activeElement as HTMLElement);
    // From a field of the menu's own the arrows step into the entries: down to
    // the first, up to the last.
    if (cur < 0) return items[dir === 1 ? 0 : items.length - 1].focus();
    items[(cur + dir + items.length) % items.length].focus();
  };

  return (
    <MenuCtx.Provider value={{ onClose: () => closeFor(null) }}>
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
          const target = e.target as Element;
          // A field of the menu's own keeps its keys: Home and End move its
          // caret, a held key types on, and the arrow keys are its own too —
          // except in a one-line text field, from which they step into the
          // entries.
          const inField = isTypingField(target);
          if (inField) {
            // While an input method composes, its keys are its own.
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if ((e.key === "ArrowDown" || e.key === "ArrowUp") && isLineField(target)) {
              e.preventDefault();
              moveFocus(e.key === "ArrowDown" ? 1 : -1);
            }
            return;
          }
          // Enter held down on what opened the menu repeats into the entry that
          // has the focus now: without this it picked the first entry the moment
          // the menu was there.
          if (e.key === "Enter" && e.repeat) { e.preventDefault(); return; }
          if ((e.key === "Enter" || e.key === " ") && !e.repeat) holdUntilReleased(e.key);
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
