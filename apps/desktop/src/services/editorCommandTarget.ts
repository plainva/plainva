/**
 * Which mounted editor a broadcast editor command is meant for.
 *
 * Several editor commands travel as window events without naming an editor:
 * the slash menu's table, database, icon, colour, emoji and attachment
 * commands, and the template picker's `plainva-insert-text`. That was fine
 * while one editor was on screen. The pinboard's "New entry" window (plan
 * Befunde 2026-09-24, E14) puts a SECOND editor over the first — over the
 * very note an embedded board lives in — and every mounted editor answered:
 * a template picked in the entry landed in the host note too, and `/icon`
 * went to the pane behind the window, never to the entry.
 *
 * The rule: the editor that last took the focus is the one the person is
 * working in, and it alone answers. Until any editor has had the focus (a
 * command from the palette right after start), the active pane answers, as
 * before. An editor that unmounts gives the focus claim back.
 */

let focused: string | null = null;
const mounted = new Set<string>();
let counter = 0;

export const editorCommandTarget = {
  /** A fresh id for one editor instance. */
  newId(): string {
    counter += 1;
    return `editor-${counter}`;
  },
  /** Registers a mounted editor; the returned function unregisters it. */
  mount(id: string): () => void {
    mounted.add(id);
    return () => {
      mounted.delete(id);
      if (focused === id) focused = null;
    };
  },
  /** The editor took the focus (anywhere inside it). */
  focus(id: string): void {
    if (mounted.has(id)) focused = id;
  },
  /** Whether a broadcast command belongs to this editor. */
  is(id: string, isActivePane: boolean): boolean {
    if (focused !== null && mounted.has(focused)) return focused === id;
    return isActivePane;
  },
  /** Test seam. */
  reset(): void {
    focused = null;
    mounted.clear();
  },
};
