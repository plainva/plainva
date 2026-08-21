/**
 * Fitting a mail message into the frame it was given.
 *
 * Mail HTML is written for a desktop column: newsletters routinely carry a
 * `<table width="600">` with fixed cell widths, and `table{max-width:100%}`
 * (which buildMailFrameDoc already sets) cannot help there — a table whose
 * cells declare their own widths keeps a minimum width no percentage can
 * undercut. On a 375px phone the reader then showed the left third of a
 * message with no way to reach the rest: the page around the frame does not
 * scroll sideways, and the frame's own scrollbar is invisible under a finger.
 *
 * So we scale instead: measure what the content really needs, and shrink the
 * document body to the frame's width. The desktop has the same gap — its
 * column is wider, so it bites less often — which is why the maths and the
 * DOM application both live here and both shells call the same function.
 *
 * Scaling, not reflowing, is the deliberate choice: reflowing a mail means
 * rewriting the sender's layout, and Plainva's mail viewer shows what was
 * sent. A scaled table stays the table the sender built.
 */

/** What a frame needs to show its content in full. */
export interface FrameFit {
  /** 1 when the content already fits; below 1 when it must be scaled down. */
  scale: number;
  /** The height the frame needs at that scale, in CSS pixels. */
  height: number;
}

/**
 * Below this the text is no longer readable, and shrinking further trades one
 * unusable view for another. Content that wide keeps its own horizontal
 * scroll inside the frame rather than becoming a grey pattern.
 */
export const MIN_FRAME_SCALE = 0.4;

/** The pure half: no DOM, so the arithmetic can be pinned in a test. */
export function computeFrameFit(input: {
  frameWidth: number;
  contentWidth: number;
  contentHeight: number;
  minScale?: number;
}): FrameFit {
  const min = input.minScale ?? MIN_FRAME_SCALE;
  const frame = finite(input.frameWidth);
  const width = finite(input.contentWidth);
  const height = finite(input.contentHeight);

  // A frame that has not been laid out yet (width 0) tells us nothing; leave
  // the content alone rather than scaling it to nothing.
  if (frame <= 0 || width <= 0) return { scale: 1, height: Math.ceil(height) };

  const scale = width <= frame ? 1 : Math.max(min, frame / width);
  return { scale, height: Math.ceil(height * scale) };
}

function finite(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export interface ApplyFrameFitOptions {
  /**
   * Grow the frame element to the content's height. True on mobile, where the
   * page scrolls and a frame with its own scroller would trap the gesture;
   * false on the desktop, where the frame fills its column and scrolls itself.
   */
  growHeight?: boolean;
  minScale?: number;
}

/**
 * Measure and scale. Safe to call repeatedly (on load, on resize, on
 * rotation): it resets its own previous transform before measuring, so the
 * second call sees the same numbers as the first.
 *
 * Reaching into `contentDocument` requires the frame to carry
 * `sandbox="allow-same-origin"` — WITHOUT `allow-scripts`, so the mail HTML
 * still cannot run a single line of code. Returns null when the document is
 * unreachable (a frame that kept the opaque origin, or one not loaded yet).
 */
export function applyFrameFit(
  frame: HTMLIFrameElement,
  options?: ApplyFrameFitOptions
): FrameFit | null {
  let doc: Document | null;
  try {
    doc = frame.contentDocument;
  } catch {
    // A cross-origin frame throws instead of returning null.
    return null;
  }
  const body = doc?.body;
  const root = doc?.documentElement;
  if (!doc || !body || !root) return null;

  // Undo the last fit BEFORE measuring: a scaled body still reports its full
  // layout width, but `overflow-x: hidden` clamps scrollWidth to the frame —
  // measuring on top of our own result would report "it fits" every time.
  body.style.transform = "";
  body.style.width = "";
  root.style.overflowX = "";

  const contentWidth = Math.max(root.scrollWidth, body.scrollWidth);
  const contentHeight = Math.max(root.scrollHeight, body.scrollHeight);
  const fit = computeFrameFit({
    frameWidth: frame.clientWidth,
    contentWidth,
    contentHeight,
    minScale: options?.minScale,
  });

  if (fit.scale < 1) {
    body.style.transformOrigin = "0 0";
    body.style.transform = `scale(${fit.scale})`;
    // The transform does not shrink the layout box, so the frame would still
    // offer a horizontal scroll over empty space. Pin the body to the width
    // it actually needs and hide what the scale already took care of.
    body.style.width = `${contentWidth}px`;
    root.style.overflowX = "hidden";
  }

  if (options?.growHeight) frame.style.height = `${fit.height}px`;
  return fit;
}
