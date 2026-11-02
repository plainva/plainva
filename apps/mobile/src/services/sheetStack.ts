/**
 * Open bottom sheets, as navigation state (S12).
 *
 * A sheet used to be pure component state, so the system back button walked
 * PAST it and popped the screen underneath — the sheet stayed on a surface that
 * had already gone. NN/g names that as the reason nested sheets disorient: the
 * one control every Android user reaches for does not close them.
 *
 * The registry is a stack rather than a flag because sheets do nest (a picker
 * over an editor sheet): back closes the topmost one, one press at a time.
 * A sheet registers while it is mounted and unregisters on the way out, so a
 * sheet that closes itself never leaves an entry behind.
 */

type Close = () => void;

const stack: Close[] = [];

/** Called by a sheet for its whole lifetime. Returns the unregister. */
export function registerSheet(close: Close): () => void {
  stack.push(close);
  return () => {
    const at = stack.lastIndexOf(close);
    if (at >= 0) stack.splice(at, 1);
  };
}

/**
 * Closes the topmost sheet, if any. True means the back press was consumed —
 * the caller must not also pop a screen, or one press would undo two things.
 *
 * The entry stays until the sheet unregisters on its way out. A close may ask
 * first — a sheet holding typed input does (finding 2026-10-22, § 3.139
 * Nr. 3) — and with "Cancel" the sheet is still there: had the press taken
 * its entry, the next back would have walked past it to the screen below.
 */
export function closeTopSheet(): boolean {
  const close = stack[stack.length - 1];
  if (!close) return false;
  close();
  return true;
}

export function openSheetCount(): number {
  return stack.length;
}
