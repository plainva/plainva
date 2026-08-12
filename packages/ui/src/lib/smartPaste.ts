/**
 * What a paste into the editor MEANS (S17).
 *
 * Two pastes deserve more than plain text, and both shells should agree on
 * which: a file on the clipboard becomes an attachment in the vault, and a bare
 * URL pasted over a selection becomes a link around that selection. Every
 * switcher tries both in the first ten minutes.
 *
 * The decision lives here because it is the part that must not differ; how the
 * bytes are stored afterwards is genuinely shell-specific (a Tauri file dialog
 * and a Capacitor filesystem are not the same thing).
 */

export type PastePlan =
  /**
   * A file — of any type (issue #55). It used to be images only, which made
   * copying a PDF in the file manager and pasting it into a note do nothing at
   * all; the DROP path never had that restriction and has carried arbitrary
   * files since P3.2, so the import behind this plan was already proven.
   */
  | { kind: "file"; file: File }
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
  // The first file wins. Copying text out of an office application puts its
  // rich formats on the clipboard as STRING items, not files — `files` only
  // fills up when something file-shaped was copied (file manager, screenshot
  // tool), which is exactly the case this is here for.
  const [file] = files;
  if (file) return { kind: "file", file };
  const url = text.trim();
  if (url !== "" && BARE_URL.test(url) && !selection.empty) {
    return { kind: "link", insert: `[${selection.text}](${url})` };
  }
  return { kind: "default" };
}
