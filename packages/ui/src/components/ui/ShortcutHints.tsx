import { cx } from "./cx";

/**
 * A row of "key cap + what it does" pairs under an input.
 *
 * Written as one sentence it broke in the middle of a shortcut: "Shift+Enter
 * starts a new" / "line · Esc discards" — and where the sentence was longer
 * than the English one, which is most of the ten languages, it broke somewhere
 * else again (finding 2026-09-22). Each pair is therefore its own unbreakable
 * box; the line wraps between pairs and never inside one.
 *
 * Key caps stay untranslated, the way `acceleratorLabels` already prints the
 * global shortcut: they name what is written on the keyboard, not a word.
 */
export interface ShortcutHint {
  /** Key caps of one shortcut, e.g. `["Shift", "Enter"]`. */
  keys: string[];
  /** What that shortcut does, in the user's language. */
  label: string;
}

export function ShortcutHints({ hints, className, id }: { hints: ShortcutHint[]; className?: string; id?: string }) {
  return (
    <span className={cx("pv-shortcut-hints", className)} id={id}>
      {hints.map((hint) => (
        <span className="pv-shortcut-hint" key={hint.keys.join("+")}>
          <span className="pv-journal-keys">
            {hint.keys.map((cap) => <kbd className="pv-journal-key" key={cap}>{cap}</kbd>)}
          </span>
          {hint.label}
        </span>
      ))}
    </span>
  );
}
