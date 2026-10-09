import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GripVertical } from "lucide-react";
import { cx } from "./cx";
import { isModalOpen } from "./Modal";

/**
 * FloatingWindow (design sweep 2026-07-19): THE free-floating, non-modal
 * window — draggable by its tinted head (six-dot grip), resizable from the
 * bottom-right grip, viewport-clamped, position/size remembered per
 * `persistKey` for the session. Extracted from the peek/compose copy-paste
 * twins (BasePeekModal, MailDraftModal); renders the shared .pv-peek-*
 * classes so themes keep one docking point for every floating window.
 *
 * The window does NOT dim the app and never closes on an outside click —
 * that is its contract (work beside it). `onEscape` opts into Escape-to-close
 * and `escapeScope` says whose key it is first: a preview closes on Escape
 * wherever the focus is, the composer lets its own menus and the work beside
 * it have the key, and asks before a changed draft goes.
 */

const MARGIN = 8;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export interface FloatingRect { x: number; y: number; w: number; h: number }

// Session memory per window kind (not persisted to disk): each window type
// reopens where the user last left it.
const savedRects = new Map<string, FloatingRect>();

// --- Where a floating window lies (Design_Language.md, "Z layers") ---------
// The app stays usable beside a floating window, so other things open while it
// is there. Where the window lies among them is decided here, not by its
// callers:
//  - on a layer of its own BELOW the dialogs (--z-floating), so a dialog, a
//    palette or a menu opened beside it lies in front of it;
//  - in front of the other floating windows while it is the one in use;
//  - in front of a dialog only when that dialog opened it;
//  - and it takes Escape only when nothing lies in front of it.

// The open floating windows from back to front. A window joins in front and
// comes forward again whenever it is used; its place here is what
// `--peek-order` adds to the layer. Until 2026-10-09 the order the windows
// were opened in was the order they kept: a window opened earlier could not be
// brought forward, and a menu it opened hung behind the later one.
const frontOrder: symbol[] = [];
const frontListeners = new Set<() => void>();
const subscribeFront = (listener: () => void) => {
  frontListeners.add(listener);
  return () => {
    frontListeners.delete(listener);
  };
};
const notifyFront = () => {
  for (const listener of [...frontListeners]) listener();
};
function bringToFront(id: symbol): void {
  if (frontOrder[frontOrder.length - 1] === id) return;
  const at = frontOrder.indexOf(id);
  if (at >= 0) frontOrder.splice(at, 1);
  frontOrder.push(id);
  notifyFront();
}
function leaveFrontOrder(id: symbol): void {
  const at = frontOrder.indexOf(id);
  if (at < 0) return;
  frontOrder.splice(at, 1);
  notifyFront();
}
// The layers leave the windows a hundred places: --z-floating to --z-modal,
// and --z-modal to --z-menu for a window a dialog opened. Nobody opens a
// hundred windows; the cap only keeps the next layer out of reach.
const LAST_PLACE = 99;
/** A window that has not joined yet counts as the one in front — which is where it joins. */
const placeInFrontOrder = (id: symbol) => {
  const at = frontOrder.indexOf(id);
  return Math.min(at < 0 ? frontOrder.length : at, LAST_PLACE);
};

// What a floating window can be opened FROM and then belongs to: a dialog or a
// palette. Read off the document, because that is the one thing a window
// opened from an embedded database still shares with its dialog — the embed
// renders in a React root of its own, so no context reaches it.
const DIALOG = ".pv-overlay, .pv-palette-overlay";
// What lies in front of a floating window and takes Escape wherever the
// keyboard is: Modal and MenuSurface listen on the document, a palette holds
// the keyboard for as long as it is open. Named by what ONLY those primitives
// render. `.pv-menu` alone is also the vault menu and a database's header
// menu, and the bare `.pv-overlay` the click catcher of the calendar's
// quick-create card — none of them has an Escape of its own, and a window
// that stood back for them would not hear the key again until they are gone.
const TAKES_ESCAPE = '.pv-modal, .pv-menu[role="menu"], .pv-palette-overlay';
// What takes Escape only while the keyboard is in it: a popover with a field,
// the quick-create card, a select list (its trigger has the focus then).
const HOLDS_KEYBOARD = `${DIALOG}, .pv-menu, .pv-selectpanel, .pv-popover--fixed, .pv-selecttrigger[aria-expanded="true"]`;

/**
 * Whether Escape belongs to something in front of the window whose mount
 * point is `anchor`. The dialog that opened the window is behind it, not in
 * front — it holds the anchor, and that is how it is told apart.
 */
function escapeBelongsInFront(target: EventTarget | null, anchor: Element | null): boolean {
  const behind = (el: Element) => !!anchor && el.contains(anchor);
  const holder = target instanceof Element ? target.closest(HOLDS_KEYBOARD) : null;
  if (holder && !behind(holder)) return true;
  for (const el of document.querySelectorAll(TAKES_ESCAPE)) {
    if (!behind(el)) return true;
  }
  return false;
}

function defaultRect(w0: number, h0: number, minW: number, minH: number): FloatingRect {
  const w = clamp(w0, minW, window.innerWidth - MARGIN * 2);
  const h = clamp(h0, minH, window.innerHeight - MARGIN * 2);
  return {
    x: Math.max(MARGIN, Math.round((window.innerWidth - w) / 2)),
    y: Math.max(MARGIN, Math.round((window.innerHeight - h) / 2)),
    w,
    h,
  };
}

function fitRect(base: FloatingRect, minW: number, minH: number): FloatingRect {
  const w = clamp(base.w, minW, window.innerWidth - MARGIN * 2);
  const h = clamp(base.h, minH, window.innerHeight - MARGIN * 2);
  const x = clamp(base.x, MARGIN, Math.max(MARGIN, window.innerWidth - w - MARGIN));
  const y = clamp(base.y, MARGIN, Math.max(MARGIN, window.innerHeight - h - MARGIN));
  return { x, y, w, h };
}

export interface FloatingWindowProps {
  /** Session rect-memory key — one per window kind ("peek", "compose"). */
  persistKey: string;
  defaultWidth: number;
  defaultHeight: number;
  minWidth?: number;
  minHeight?: number;
  ariaLabel: string;
  /** Head-row content after the grip: nav, title, actions (head buttons keep
   * working during drag — pointer-down on a button never starts a drag). */
  head: ReactNode;
  /** Escape handler; who gets the key first is `escapeScope`. Omit to keep
   * Escape for the window's content. */
  onEscape?: () => void;
  /**
   * Whose key Escape is (finding 2026-10-09).
   *
   * `"window"`, the default and the behaviour every preview has always had:
   * this window's, wherever the focus is and before its own content — in the
   * capture phase, so a preview closes on Escape even while the editor it
   * shows has the caret.
   *
   * `"content"`: the content's first. The window takes the key only when
   * nothing inside used it, never when it was pressed in something else, and
   * not while a `Modal` is open on top of it. That is for a window people
   * WRITE in beside their other work, the composer: its command menu and its
   * sender list close on Escape themselves, an Escape meant for a note or a
   * palette next to it has nothing to do with the message, and Escape in the
   * question "discard this draft?" answers the question.
   *
   * In both scopes the key first goes to what lies in FRONT of the window —
   * another floating window in use, a dialog, a palette, a menu — and to one
   * taker only (see the listener).
   */
  escapeScope?: "window" | "content";
  children: ReactNode;
  className?: string;
  testId?: string;
  /**
   * What the window shows, as its host names it (a path, an event's key).
   * When it changes, the host has opened something else into the window that
   * was already open — and the window comes forward, as a new one would: a
   * row clicked to see it must not open behind another window.
   */
  subject?: string;
}

export function FloatingWindow({
  persistKey,
  defaultWidth,
  defaultHeight,
  minWidth = 420,
  minHeight = 320,
  ariaLabel,
  head,
  onEscape,
  escapeScope = "window",
  children,
  className,
  testId,
  subject,
}: FloatingWindowProps) {
  const [rect, setRect] = useState<FloatingRect>(() =>
    fitRect(savedRects.get(persistKey) ?? defaultRect(defaultWidth, defaultHeight, minWidth, minHeight), minWidth, minHeight)
  );

  // --- Where the window lies among the other windows and the dialogs ---
  const [id] = useState(() => Symbol("pv-floating-window"));
  const order = useSyncExternalStore(subscribeFront, () => placeInFrontOrder(id));
  useLayoutEffect(() => {
    bringToFront(id);
    return () => leaveFrontOrder(id);
  }, [id]);
  // Something else was opened into the open window: forward, like a new one.
  useLayoutEffect(() => {
    bringToFront(id);
  }, [id, subject]);
  const comeForward = () => bringToFront(id);
  // The portal moves the window to the end of the body; the anchor stays where
  // the window was mounted and remembers what it was opened from.
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [overDialog, setOverDialog] = useState(false);
  useLayoutEffect(() => {
    setOverDialog(!!anchorRef.current?.closest(DIALOG));
  }, []);

  useEffect(() => {
    savedRects.set(persistKey, rect);
  }, [persistKey, rect]);

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!onEscape) return;
    const contentFirst = escapeScope === "content";
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // In both scopes Escape goes to what is in front, and to one taker. The
      // listener of a preview used to take the key first whatever lay over the
      // window: Escape closed the window under a dialog and left the dialog,
      // closed the window together with its own open menu, and reached every
      // open window at once.
      //  - Used already. Every window listens for itself, and closing one makes
      //    the next the front window before that one's listener has run. For a
      //    window people write in it is also its own content that used the
      //    key: the composer's command menu (CodeMirror prevents the default);
      //    its sender list stops the event before it gets here.
      //  - Not the window in front: the key is that window's.
      //  - Something in front of this window takes it (see TAKES_ESCAPE).
      if (e.defaultPrevented || frontOrder[frontOrder.length - 1] !== id || escapeBelongsInFront(e.target, anchorRef.current)) return;
      if (contentFirst) {
        // A dialog on top owns the key — first of all the question about this
        // very window: Escape there answers "Cancel", it is not a second
        // request to close.
        if (isModalOpen()) return;
        // Pressed in something else — a note, a palette, a search field. With
        // the focus nowhere (the page itself) the window still takes it:
        // nothing else is claiming the key.
        const at = e.target;
        if (at instanceof Node && at !== document.body && at !== document.documentElement && !rootRef.current?.contains(at)) return;
      }
      // Nobody further out acts on a key this window used.
      e.stopPropagation();
      // Used, and marked as used for whoever reads the event after this — a
      // second window's listener is still to come in this very dispatch.
      e.preventDefault();
      // A held key closes one window, not one with every repeat.
      if (!e.repeat) onEscape();
    };
    // "window": first of all, in the capture phase. "content": last, once the
    // event has passed everything inside and React's handlers on the way up.
    if (contentFirst) {
      document.addEventListener("keydown", onKey);
      return () => document.removeEventListener("keydown", onKey);
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onEscape, escapeScope, id]);

  // --- Drag (by head) and resize (bottom-right grip) via pointer capture ---
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const onHeadDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return; // head buttons stay clickable
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: rect.x, oy: rect.y };
  };
  const onHeadMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setRect((r) => ({
      ...r,
      x: clamp(d.ox + (e.clientX - d.px), MARGIN, Math.max(MARGIN, window.innerWidth - r.w - MARGIN)),
      y: clamp(d.oy + (e.clientY - d.py), MARGIN, Math.max(MARGIN, window.innerHeight - r.h - MARGIN)),
    }));
  };
  const endDrag = (e: React.PointerEvent) => {
    drag.current = null;
    try {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* not captured */
    }
  };

  const resize = useRef<{ px: number; py: number; ow: number; oh: number } | null>(null);
  const onResizeDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    resize.current = { px: e.clientX, py: e.clientY, ow: rect.w, oh: rect.h };
  };
  const onResizeMove = (e: React.PointerEvent) => {
    const s = resize.current;
    if (!s) return;
    setRect((r) => ({
      ...r,
      w: clamp(s.ow + (e.clientX - s.px), minWidth, window.innerWidth - r.x - MARGIN),
      h: clamp(s.oh + (e.clientY - s.py), minHeight, window.innerHeight - r.y - MARGIN),
    }));
  };
  const endResize = (e: React.PointerEvent) => {
    resize.current = null;
    try {
      (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
    } catch {
      /* not captured */
    }
  };

  const portalled = createPortal(
    <div
      ref={rootRef}
      className={cx("pv-peek-card", "pv-peek-window", className)}
      role="dialog"
      aria-label={ariaLabel}
      data-testid={testId}
      // A window a dialog opened lies on that dialog's layer (App.css).
      data-over-dialog={overDialog ? "" : undefined}
      // Using the window brings it forward: a pointer pressed in it, or a key
      // while the keyboard is in it (key-up too — that is where the Tab that
      // entered the window arrives). Focus alone does not: code moves focus as
      // well, and that is not somebody using the window. Capture, so the
      // window is in front before the press opens a menu.
      onPointerDownCapture={comeForward}
      onKeyDownCapture={comeForward}
      onKeyUpCapture={comeForward}
      style={
        {
          "--peek-x": `${rect.x}px`,
          "--peek-y": `${rect.y}px`,
          "--peek-w": `${rect.w}px`,
          "--peek-h": `${rect.h}px`,
          "--peek-order": order,
        } as CSSProperties
      }
    >
      <div
        className="pv-peek-head"
        onPointerDown={onHeadDown}
        onPointerMove={onHeadMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <GripVertical size={14} className="pv-peek-grip" aria-hidden />
        {head}
      </div>
      {children}
      <div
        className="pv-peek-resize"
        aria-hidden="true"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      />
    </div>,
    document.body
  );
  // The anchor is what stays at the mount point (see above).
  return (
    <>
      <span ref={anchorRef} hidden />
      {portalled}
    </>
  );
}
