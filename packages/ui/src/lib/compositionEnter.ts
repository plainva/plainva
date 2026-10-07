/**
 * An Enter that belongs to the input method never reaches the app.
 *
 * Japanese, Chinese and Korean are typed by COMPOSING: the keyboard shows a
 * reading, offers conversions, and Enter confirms the chosen one. That Enter
 * is a key press like any other as far as the page is concerned - and Plainva
 * has some sixty handlers of the form `if (e.key === "Enter") submit()`. Seven
 * of them checked `isComposing`; the rest submitted the half-typed reading:
 * the cloud folder was created under the name as it stood before conversion,
 * a rename was saved, a search fired, a dialog closed. (Play feedback
 * 2026-09-30, a Japanese tester, names the folder name in the sync target;
 * whether this is what he saw could not be reproduced on a device - the
 * defect follows from the code and is the same on every platform.)
 *
 * It is fixed where it can be fixed once: a capture listener on the window
 * stops such a key event before any handler - React's or a native one - sees
 * it. The key's own effect is untouched: the input method still receives the
 * Enter and confirms the text; only the app does not take it for "submit".
 *
 * How the Enter of a composition is recognised:
 *  - `isComposing` is true on the keydown that confirms (Chromium, Firefox);
 *  - WebKit (macOS, iOS) sends that keydown AFTER `compositionend`, with
 *    `isComposing` false - but with the key code 229, which is what every
 *    engine reports for a key the input method consumed.
 *
 * CodeMirror is left alone: it tracks composition itself and reads key events
 * during it to work around platform quirks.
 */

/** Key code the platform reports for a key the input method consumed. */
const IME_KEYCODE = 229;

/** Is this key event the Enter that confirms a composition? */
export function isCompositionEnter(event: Pick<KeyboardEvent, "key" | "isComposing" | "keyCode">): boolean {
  return event.key === "Enter" && (event.isComposing || event.keyCode === IME_KEYCODE);
}

function insideCodeMirror(target: EventTarget | null): boolean {
  return typeof Element !== "undefined" && target instanceof Element && target.closest(".cm-content") !== null;
}

/**
 * Installs the guard on `target` (the window). Both shells call it once at
 * start; it returns the uninstall for tests.
 */
export function installCompositionEnterGuard(target: Pick<Window, "addEventListener" | "removeEventListener"> = window): () => void {
  const stop = (event: Event) => {
    const key = event as KeyboardEvent;
    if (!isCompositionEnter(key) || insideCodeMirror(key.target)) return;
    key.stopImmediatePropagation();
  };
  // keydown decides; keyup follows so that a handler listening for the release
  // of Enter does not fire for the same confirmation.
  target.addEventListener("keydown", stop, true);
  target.addEventListener("keyup", stop, true);
  return () => {
    target.removeEventListener("keydown", stop, true);
    target.removeEventListener("keyup", stop, true);
  };
}
