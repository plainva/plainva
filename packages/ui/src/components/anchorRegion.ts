/**
 * Marking a REGION inside a picture, and reading one back.
 *
 * A comment on an image already works without this (plan Stufe E, E1): the
 * bubble hangs a comment on the whole picture. What it cannot say is WHERE - and
 * on a screenshot of a settings dialog "the third field" is the entire point.
 *
 * Two rules shape everything below.
 *
 * The rectangle is stored in FRACTIONS of the picture, never in pixels (plan
 * section 4). The same image is drawn at one width in the editor, another in
 * read mode and a third on a phone; a pixel box would be wrong the first time
 * anything resizes, and would drift further with every zoom step.
 *
 * And drawing it is ARMED, never implicit. A mousedown handler over the picture
 * would swallow the drag that selects the paragraph around it - the widget
 * replaces a range of Markdown, so a selection has to be able to sweep across
 * it. The bubble is already the one door into commenting a picture, so the
 * bubble is what arms the drawing.
 */

/** A rectangle over a picture, in fractions of the picture's own size. */
export interface AnchorRegionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * What a drawing attempt produced.
 *
 * Three outcomes, kept apart on purpose: a stray click still comments the whole
 * picture (the gesture that was there before), while Escape or a click outside
 * means the reader changed their mind and NOTHING should be written.
 */
export type RegionPick =
  | { kind: "region"; rect: AnchorRegionRect }
  | { kind: "whole" }
  | { kind: "cancelled" };

/**
 * Below this, a drag is a slip of the hand rather than a marking.
 *
 * The protocol refuses an empty rectangle; this refuses a pointless one, which
 * is the interface's job and not the format's.
 */
const MIN_REGION_PX = 6;

function clampPx(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

/**
 * Four decimals is far below a pixel on any picture a person looks at, and it
 * keeps the sealed record free of 0.30000000000000004 noise.
 */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export interface RegionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Two client points plus the picture's box -> the stored rectangle.
 *
 * Clamps to the picture, so a drag that starts or ends outside it still marks
 * only what is inside. Returns null when the result would be too small to mean
 * anything - the caller then falls back to the whole picture.
 */
export function normalizeRegionRect(
  a: { x: number; y: number },
  b: { x: number; y: number },
  box: RegionBox,
): AnchorRegionRect | null {
  if (!(box.width > 0) || !(box.height > 0)) return null;
  const right = box.left + box.width;
  const bottom = box.top + box.height;
  const x0 = clampPx(Math.min(a.x, b.x), box.left, right);
  const x1 = clampPx(Math.max(a.x, b.x), box.left, right);
  const y0 = clampPx(Math.min(a.y, b.y), box.top, bottom);
  const y1 = clampPx(Math.max(a.y, b.y), box.top, bottom);
  // Measured on the CLAMPED pixels: a drag that starts far outside the picture
  // and ends two pixels inside it has marked two pixels, not a region.
  if (x1 - x0 < MIN_REGION_PX || y1 - y0 < MIN_REGION_PX) return null;
  const x = Math.min(round4((x0 - box.left) / box.width), 1);
  const y = Math.min(round4((y0 - box.top) / box.height), 1);
  // Rounding can push an edge past the picture by a ten-thousandth, and the
  // protocol rejects a rectangle that leaves it. Trim the extent, never the
  // corner: the corner is where the reader started.
  const w = Math.min(round4((x1 - x0) / box.width), 1 - x);
  const h = Math.min(round4((y1 - y0) / box.height), 1 - y);
  if (!(w > 0) || !(h > 0)) return null;
  return { x, y, w, h };
}

/**
 * The rectangle as percentages, for an absolutely positioned overlay.
 *
 * Percentages resolve against the positioned ancestor, which is the box around
 * the picture - so the marking rides every resize without a measurement.
 */
export function regionStyle(rect: AnchorRegionRect): { left: string; top: string; width: string; height: string } {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };
}

/** Writes a rectangle onto an overlay element. */
export function applyRegionStyle(el: HTMLElement, rect: AnchorRegionRect): void {
  const style = regionStyle(rect);
  el.style.left = style.left;
  el.style.top = style.top;
  el.style.width = style.width;
  el.style.height = style.height;
}

/**
 * What the picker needs to reach: the box the reader draws on, and the element
 * the overlay lives in.
 *
 * They are two elements on purpose. The rectangle is measured against the
 * PICTURE, but an overlay cannot be a child of an `<img>` — a replaced element
 * renders no children. So the marking is placed in the host around it, and the
 * host's box has to equal the picture's box for the percentages to land right
 * (`.cm-anchor-region-host` is what guarantees that).
 */
export interface RegionPickTarget {
  /** The positioned element the overlay is placed in. */
  host: HTMLElement;
  /** The element whose rectangle the fractions are measured against. */
  box: HTMLElement;
}

/**
 * Arms the picture, draws the live rubber band, resolves once the reader is done.
 *
 * Deliberately DOM-only: mobile draws the same rectangle with a finger and must
 * be able to reuse the pure helpers above without pulling CodeMirror along.
 */
export function pickImageRegion(target: RegionPickTarget, labels: { hint: string }): Promise<RegionPick> {
  const { host, box } = target;
  const doc = host.ownerDocument;
  return new Promise<RegionPick>((resolve) => {
    let start: { x: number; y: number } | null = null;
    let draft: HTMLElement | null = null;
    let settled = false;

    const hint = doc.createElement("span");
    hint.className = "cm-anchor-region-hint";
    hint.textContent = labels.hint;

    const finish = (pick: RegionPick): void => {
      if (settled) return;
      settled = true;
      host.classList.remove("cm-anchor-region-arm");
      hint.remove();
      draft?.remove();
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("pointerdown", onDocDown, true);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onCancel);
      resolve(pick);
    };

    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      finish({ kind: "cancelled" });
    };

    // Armed and then clicked somewhere else: the reader moved on. Capture phase,
    // so this runs before whatever they actually clicked.
    const onDocDown = (e: Event): void => {
      const node = e.target as Node | null;
      if (node && host.contains(node)) return;
      finish({ kind: "cancelled" });
    };

    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      // The picture is a widget over live Markdown: without this the caret lands
      // in the source and live preview flips the picture back to its raw text.
      e.preventDefault();
      e.stopPropagation();
      start = { x: e.clientX, y: e.clientY };
      try {
        host.setPointerCapture(e.pointerId);
      } catch {
        // Capture is a convenience; without it a drag that leaves the picture
        // simply ends there, and the clamp above still yields a sane rectangle.
      }
      draft = doc.createElement("span");
      draft.className = "cm-anchor-region cm-anchor-region--draft";
      host.appendChild(draft);
    };

    const onMove = (e: PointerEvent): void => {
      if (!start || !draft) return;
      e.preventDefault();
      const rect = normalizeRegionRect(start, { x: e.clientX, y: e.clientY }, box.getBoundingClientRect());
      if (!rect) {
        draft.hidden = true;
        return;
      }
      draft.hidden = false;
      applyRegionStyle(draft, rect);
    };

    const onUp = (e: PointerEvent): void => {
      if (!start) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = normalizeRegionRect(start, { x: e.clientX, y: e.clientY }, box.getBoundingClientRect());
      // A tap, or a drag too small to mean a place: that is the older gesture,
      // and it still says something true - this comment is about the picture.
      finish(rect ? { kind: "region", rect } : { kind: "whole" });
    };

    const onCancel = (): void => finish({ kind: "cancelled" });

    host.classList.add("cm-anchor-region-arm");
    host.appendChild(hint);
    doc.addEventListener("keydown", onKey, true);
    doc.addEventListener("pointerdown", onDocDown, true);
    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onCancel);
  });
}
