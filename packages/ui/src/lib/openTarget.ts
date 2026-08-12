import { isImagePath } from "../services/imageFiles";

/**
 * What Plainva does with a vault path when the user opens it (issue #55).
 *
 * The decision used to exist exactly ONCE — in the desktop file tree — while
 * every other route to a file (wiki link, bookmark, recent list, tag tree,
 * backlinks, split, graph, peek) went straight to the editor, which then called
 * readTextFile on a PDF. The handbook meanwhile promised, in all ten languages,
 * that "other attachments open in the system's default program".
 *
 * So the rule lives here, once, and every render path asks it:
 *
 *   .md            → the editor
 *   .base          → the database viewer
 *   image          → Plainva's own image viewer tab
 *   anything else  → the operating system, which knows what a PDF is
 *
 * That last line is the deliberate part (decision E1, 2026-08-12). Text-decodable
 * attachments (.csv, .txt, .svg, .json) open externally too, even though the
 * editor *could* display them — today they open as an editable buffer only
 * because nobody asked the question, not because it was designed. Opening them
 * inside Plainva on purpose is planned separately (C15 in the maintainer's
 * backlog); it needs a named allowlist and an answer to what saving one should
 * do, and a half-decided version of that is what produced this bug.
 */
export type OpenAction = "editor" | "image" | "base" | "external";

/**
 * Virtual tabs (`plainva://graph`, `plainva://tasks`, the calendar and mail
 * views) are not files. They must never reach the OS, so they are recognised
 * here and reported as "editor" — App renders them by their own route.
 */
const VIRTUAL_PREFIX = "plainva://";

export function resolveOpenAction(path: string): OpenAction {
  if (path.startsWith(VIRTUAL_PREFIX)) return "editor";
  if (/\.md$/i.test(path)) return "editor";
  if (/\.base$/i.test(path)) return "base";
  if (isImagePath(path)) return "image";
  return "external";
}

/**
 * True when opening this path means handing it to the operating system rather
 * than rendering it in Plainva. The one predicate an open path should branch on
 * — spelling out `resolveOpenAction(p) === "external"` at every call site is how
 * a second, drifting copy of the rule gets born.
 */
export function opensExternally(path: string): boolean {
  return resolveOpenAction(path) === "external";
}
