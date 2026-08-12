/**
 * A vault path that truncates at the FRONT (E3).
 *
 * Task lists showed the bare file name, so `Fahrplan` said nothing about
 * whether it lived in `Reisen/` or in `Archiv/2026/`. The full path answers
 * that — but only if the end survives, because the file weighs more than the
 * folder it sits in.
 *
 * Two spans rather than one CSS trick over the whole line: the folder part
 * shrinks and clips at its start, the file name cannot shrink at all. A single
 * `direction: rtl` span would move trailing punctuation around (the bidi
 * reordering that makes `…/a/b.md` come out as `b.md/a/…`); splitting keeps the
 * separator INSIDE the file part, so the rtl part ends on a letter and there is
 * nothing for the algorithm to reorder. Only when the file name alone is wider
 * than the row does it clip — and then at the end, where the extension is the
 * cheapest thing to lose.
 */
import { cx } from "./cx";

export interface NotePathProps {
  /** Vault-relative path, e.g. `Archiv/2026/Q3/Foerderung.md`. */
  path: string;
  /** Drop the `.md` extension — every note has it, so it carries no information. */
  stripExtension?: boolean;
  className?: string;
}

export function NotePath({ path, stripExtension = true, className }: NotePathProps) {
  const clean = stripExtension ? path.replace(/\.md$/i, "") : path;
  const cut = clean.lastIndexOf("/");
  const dir = cut < 0 ? "" : clean.slice(0, cut);
  // The separator travels with the file name on purpose — see the note above.
  const file = cut < 0 ? clean : clean.slice(cut);

  return (
    <span className={cx("pv-notepath", className)} data-tip={path}>
      {dir && <span className="pv-notepath-dir">{dir}</span>}
      <span className="pv-notepath-file">{file}</span>
    </span>
  );
}
