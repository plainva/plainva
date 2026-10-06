import { describeLink, type LinkTarget } from "../lib/linkTarget";

/**
 * Links in a mail body (plan Befunde 06.10., M1) — one wiring for both shells
 * and both kinds of body.
 *
 * A mail is written by a stranger, and its links are the part that can hurt.
 * Until this module the desktop only caught the click, the phone left links to
 * whatever its WebView does with them, and a plain-text mail had no links at
 * all. Now:
 *
 *  - a link never navigates the surface it is shown in: every activation goes
 *    to the shell's own opener (`onOpen`), which decides where it opens;
 *  - the reader can see WHERE a link leads before following it: the desktop is
 *    told which link the pointer or the keyboard focus is on (`onPoint`), the
 *    phone which link is being held, the desktop which one was right-clicked
 *    (`onHold`);
 *  - what is shown comes from the shared link description (`lib/linkTarget`),
 *    so a Safe Link names its real target and a link whose visible text names
 *    another host says so.
 *
 * `attachMailLinks` works on the document of the sandboxed message frame (it
 * is same-origin and runs no scripts, so the parent may listen there) and on
 * the element that holds a plain-text body — the same listeners either way.
 */

export interface MailLinkEvents {
  /** A link was activated (click, tap, Enter). Never called after a hold. */
  onOpen: (link: LinkTarget) => void;
  /** The link under the pointer or holding the keyboard focus; `null` when none. */
  onPoint?: (link: LinkTarget | null) => void;
  /**
   * The link's own menu was asked for: a hold (touch) or the context menu
   * (right click, the platform's long press). The tap that ends a hold does
   * not open the link. `at` is where, in the coordinates of the window the
   * shell draws in — for a link inside the message frame the frame's own
   * position is already added.
   */
  onHold?: (link: LinkTarget, at: { x: number; y: number }) => void;
  /** How long a hold takes — the shell's ONE hold duration, never a number of this module's own. */
  holdMs?: number;
}

/** How far a finger may drift before a hold is a scroll instead. */
const HOLD_SLOP_PX = 10;

interface AnchorLike {
  getAttribute(name: string): string | null;
  textContent: string | null;
  contains(other: unknown): boolean;
}

/** The link an event happened on, across realms (an iframe's elements are not `instanceof` ours). */
function anchorOf(target: EventTarget | null): AnchorLike | null {
  const el = target as { closest?: (selector: string) => unknown; parentElement?: unknown } | null;
  if (!el) return null;
  // A text node has no `closest`; its parent does.
  const start = typeof el.closest === "function" ? el : (el.parentElement as typeof el | null);
  if (!start || typeof start.closest !== "function") return null;
  return (start.closest("a[href]") as AnchorLike | null) ?? null;
}

/** The description of a link element, or `null` when it is not one to follow. */
export function mailLinkOf(anchor: { getAttribute(name: string): string | null; textContent: string | null }): LinkTarget | null {
  const href = anchor.getAttribute("href") ?? "";
  return describeLink(href, anchor.textContent);
}

/**
 * Wires the links below `root`. Returns the function that removes every
 * listener again (and tells `onPoint` that nothing is pointed at any more).
 */
export function attachMailLinks(root: Document | HTMLElement, events: MailLinkEvents): () => void {
  let hovered: AnchorLike | null = null;
  let focused: AnchorLike | null = null;
  let pointed: AnchorLike | null = null;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let holdStart: { x: number; y: number; anchor: AnchorLike } | null = null;
  /** The hold already answered this touch; the click that follows must not open. */
  let held = false;

  const point = () => {
    const next = hovered ?? focused;
    if (next === pointed) return;
    pointed = next;
    events.onPoint?.(next ? mailLinkOf(next) : null);
  };

  const cancelHold = () => {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    holdStart = null;
  };

  /** A point of `root`'s own viewport, in the window the shell draws in. */
  const inShell = (x: number, y: number) => {
    const frame = (root as Document).defaultView?.frameElement;
    const box = frame?.getBoundingClientRect();
    return box ? { x: x + box.left, y: y + box.top } : { x, y };
  };

  const fireHold = (anchor: AnchorLike, x: number, y: number, fromTouch: boolean) => {
    cancelHold();
    const link = mailLinkOf(anchor);
    if (!link || !events.onHold) return;
    // Only a finger is followed by a click that must not open the link.
    held = fromTouch;
    events.onHold(link, inShell(x, y));
  };

  const onClick = (e: Event) => {
    const anchor = anchorOf(e.target);
    if (!anchor) return;
    const href = (anchor.getAttribute("href") ?? "").trim();
    // A jump inside the message is the message's own business.
    if (href.startsWith("#")) return;
    // Everything else must not navigate the reading surface itself — whether
    // or not it is a link we open.
    e.preventDefault();
    if (held) {
      held = false;
      return;
    }
    const link = mailLinkOf(anchor);
    if (link) events.onOpen(link);
  };

  const onOver = (e: Event) => {
    hovered = anchorOf(e.target);
    point();
  };
  const onOut = (e: Event) => {
    const to = anchorOf((e as MouseEvent).relatedTarget);
    hovered = to;
    point();
  };
  const onFocusIn = (e: Event) => {
    focused = anchorOf(e.target);
    point();
  };
  const onFocusOut = () => {
    focused = null;
    point();
  };

  const onPointerDown = (e: Event) => {
    held = false;
    cancelHold();
    const anchor = anchorOf(e.target);
    if (!anchor || !events.onHold || !events.holdMs) return;
    const p = e as PointerEvent;
    // A mouse has the right button for this; only a finger (or a pen) holds.
    if (p.pointerType === "mouse") return;
    holdStart = { x: p.clientX, y: p.clientY, anchor };
    holdTimer = setTimeout(() => fireHold(anchor, p.clientX, p.clientY, true), events.holdMs);
  };
  const onPointerMove = (e: Event) => {
    if (!holdStart) return;
    const p = e as PointerEvent;
    if (Math.abs(p.clientX - holdStart.x) > HOLD_SLOP_PX || Math.abs(p.clientY - holdStart.y) > HOLD_SLOP_PX) cancelHold();
  };
  /**
   * The context menu of a link is the link's own menu: a right click on the
   * desktop, and where the platform has a long press of its own (Android's
   * WebView raises `contextmenu`) that IS the hold. The system's menu would
   * otherwise open over ours, with "open in new tab" entries that lead
   * nowhere here.
   */
  const onContextMenu = (e: Event) => {
    if (!events.onHold) return;
    const anchor = anchorOf(e.target);
    if (!anchor) return;
    e.preventDefault();
    if (held) return;
    const m = e as MouseEvent;
    // Raised by a finger while one is down (a pending hold); by a mouse otherwise.
    fireHold(anchor, m.clientX, m.clientY, holdStart !== null);
  };

  const listen: Array<[string, (e: Event) => void, boolean]> = [
    ["click", onClick, true],
    ["mouseover", onOver, false],
    ["mouseout", onOut, false],
    ["focusin", onFocusIn, false],
    ["focusout", onFocusOut, false],
    ["pointerdown", onPointerDown, false],
    ["pointermove", onPointerMove, false],
    ["pointerup", cancelHold, false],
    ["pointercancel", cancelHold, false],
    ["scroll", cancelHold, true],
    ["contextmenu", onContextMenu, false],
  ];
  for (const [type, handler, capture] of listen) root.addEventListener(type, handler, capture);

  return () => {
    for (const [type, handler, capture] of listen) root.removeEventListener(type, handler, capture);
    cancelHold();
    if (pointed) events.onPoint?.(null);
    hovered = focused = pointed = null;
  };
}

// ---------------------------------------------------------------------------
// Plain-text bodies
// ---------------------------------------------------------------------------

export type MailTextSegment = { kind: "text"; text: string } | { kind: "link"; href: string; text: string };

const TRAILING_PUNCT = ").,;:!?'\"]>";

function startsWithHttp(text: string, at: number): boolean {
  const head = text.slice(at, at + 8).toLowerCase();
  return head.startsWith("http://") || head.startsWith("https://");
}

function isWordChar(ch: string | undefined): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

/**
 * A plain-text body as text and links. Only http(s) addresses become links,
 * and the text is kept character for character: joining the segments' `text`
 * gives the input back. One forward scan — nothing a sender writes makes it
 * slow — and the result is rendered as elements, never as HTML.
 */
export function mailTextSegments(text: string): MailTextSegment[] {
  const out: MailTextSegment[] = [];
  let run = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text.charCodeAt(i);
    // "h" or "H" — the only place an address can start.
    if ((ch !== 104 && ch !== 72) || !startsWithHttp(text, i) || isWordChar(text[i - 1])) {
      i++;
      continue;
    }
    const at = i;
    let end = at;
    while (end < text.length) {
      const c = text.charCodeAt(end);
      // Whitespace, control characters, and the brackets and quotes that
      // surround an address in running text.
      if (c <= 32 || c === 60 || c === 62 || c === 34 || c === 160) break;
      end++;
    }
    while (end > at && TRAILING_PUNCT.includes(text[end - 1])) end--;
    const candidate = text.slice(at, end);
    if (describeLink(candidate)?.kind === "web") {
      if (at > run) out.push({ kind: "text", text: text.slice(run, at) });
      out.push({ kind: "link", href: candidate, text: candidate });
      run = end;
    }
    // Past the whole candidate either way: scanning it again from its next
    // "http" would make a long non-address quadratic.
    i = Math.max(end, at + 4);
  }
  if (run < text.length) out.push({ kind: "text", text: text.slice(run) });
  return out;
}
