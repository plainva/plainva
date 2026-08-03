/**
 * What a paste into the editor MEANS (S17).
 *
 * Two pastes deserve more than plain text, and both shells should agree on
 * which: an image on the clipboard becomes an attachment plus an embed, and a
 * bare URL pasted over a selection becomes a link around that selection. Every
 * switcher tries both in the first ten minutes.
 *
 * The decision lives here because it is the part that must not differ; how the
 * bytes are stored afterwards is genuinely shell-specific (a Tauri file dialog
 * and a Capacitor filesystem are not the same thing).
 */

export type PastePlan =
  | { kind: "image"; file: File }
  /** Wrap the selection: `[selected](url)`. */
  | { kind: "link"; insert: string }
  /** Nothing special — let the editor paste as usual. */
  | { kind: "default" };

/** A bare URL and nothing else: a link WITH text around it is already prose. */
const BARE_URL = /^https?:\/\/\S+$/;

export function planPaste(
  files: readonly File[],
  text: string,
  selection: { empty: boolean; text: string },
): PastePlan {
  const img = files.find((f) => f.type.startsWith("image/"));
  if (img) return { kind: "image", file: img };
  const url = text.trim();
  if (url !== "" && BARE_URL.test(url) && !selection.empty) {
    return { kind: "link", insert: `[${selection.text}](${url})` };
  }
  return { kind: "default" };
}
