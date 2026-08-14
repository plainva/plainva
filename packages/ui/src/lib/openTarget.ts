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
 *   known text     → a plain text tab inside Plainva
 *   anything else  → the operating system, which knows what a PDF is
 *
 * The fourth line is C15, and it arrived the careful way round. Text-decodable
 * attachments used to open as an editable note buffer — not a feature, the
 * absence of a decision — and the attachment work then sent them all to the OS
 * (E1, 2026-08-12). Bringing them back needed an answer to "who decides the
 * list", and the answer is: this function, and only this function.
 *
 * A fixed base list plus a per-vault setting that can only EXTEND it, both
 * flowing through here. The setting deliberately cannot take an extension away:
 * a shrinking list would let a vault turn `.md` or an image into an OS handoff,
 * and the whole point of one rule is that no surface can reach a different
 * answer than another one.
 */
export type OpenAction = "editor" | "image" | "base" | "text" | "external";

/**
 * Virtual tabs (`plainva://graph`, `plainva://tasks`, the calendar and mail
 * views) are not files. They must never reach the OS, so they are recognised
 * here and reported as "editor" — App renders them by their own route.
 */
const VIRTUAL_PREFIX = "plainva://";

/**
 * The base list: plain text, configuration and source. Deliberately not
 * exhaustive — an unknown extension keeps going to the system, which is the
 * safe direction, and a vault that needs more says so in its settings.
 *
 * `svg` is absent on purpose. It is text AND an image, and it is already in the
 * image list; the image check runs first, so an SVG keeps opening in the
 * viewer that can actually show it.
 */
const BASE_TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  "txt", "text", "log", "csv", "tsv",
  "json", "jsonc", "yaml", "yml", "toml", "ini", "cfg", "conf", "properties", "env",
  "xml", "html", "htm", "css", "scss", "less",
  "js", "jsx", "mjs", "cjs", "ts", "tsx", "py", "rb", "rs", "go", "java", "kt", "swift",
  "c", "h", "cpp", "hpp", "cs", "php", "lua", "r", "dart", "vue", "svelte",
  "sh", "bash", "zsh", "fish", "ps1", "bat", "sql", "diff", "patch", "gitignore",
]);

/**
 * The vault's extra extensions, lower-cased and without the dot.
 *
 * Module state rather than a parameter, and that is the point: a parameter is
 * something a call site can forget, and a forgotten one here means the same
 * file opens in the editor on one surface and in the OS on another — the exact
 * split this module exists to end. The vault lifecycle sets it (on load and
 * whenever the setting changes); every reader keeps asking the same question.
 */
let extraTextExtensions: ReadonlySet<string> = new Set();

/** Called by the shell when a vault opens and when its setting changes. */
export function setExtraTextExtensions(extensions: readonly string[] | null | undefined): void {
  extraTextExtensions = new Set(
    (extensions ?? [])
      .map((entry) => entry.trim().replace(/^[.*]+/, "").toLowerCase())
      .filter((entry) => /^[a-z0-9_-]+$/.test(entry)),
  );
}

/** What the vault currently adds — for the settings surface to render back. */
export function getExtraTextExtensions(): readonly string[] {
  return [...extraTextExtensions];
}

function extensionOf(path: string): string {
  const match = /\.([a-z0-9_-]+)$/i.exec(path);
  return match ? match[1].toLowerCase() : "";
}

export function isTextExtension(path: string): boolean {
  const extension = extensionOf(path);
  return BASE_TEXT_EXTENSIONS.has(extension) || extraTextExtensions.has(extension);
}

export function resolveOpenAction(path: string): OpenAction {
  if (path.startsWith(VIRTUAL_PREFIX)) return "editor";
  if (/\.md$/i.test(path)) return "editor";
  if (/\.base$/i.test(path)) return "base";
  // Before the text list: `.svg` is in both, and the viewer is the one that
  // can show it.
  if (isImagePath(path)) return "image";
  if (isTextExtension(path)) return "text";
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

/**
 * How much of a file the binary probe reads. Git's own heuristic looks at the
 * first 8000 bytes for a NUL, and the number is a compromise for the same
 * reason here: far enough in to catch a header that starts with printable
 * magic ("PK", "%PDF"), short enough to cost nothing.
 */
export const BINARY_PROBE_BYTES = 8000;

/**
 * True when these bytes are not text.
 *
 * An extension is a claim, not evidence. A file called `.log` can be a rotated
 * archive and a `.csv` can be a database dump; opening either as text and
 * saving it once destroys it, because what the editor holds is a lossy decode
 * of bytes it never understood. So the name decides WHERE a file would open,
 * and the first bytes decide whether it may.
 *
 * A NUL byte is the test — it is what UTF-8 text does not contain and what
 * every common binary format has near its start. Deliberately nothing cleverer:
 * a charset guess would be wrong often enough to refuse real text files, and
 * refusing a file the user can see is worse than handing an odd one to the OS.
 *
 * Takes bytes or the already decoded text, because both are the same evidence:
 * a 0x00 byte decodes to U+0000 and nothing else does. One function rather than
 * two so the two call sites cannot drift — the editor has the string in hand
 * and would otherwise pay for a second read of the same file.
 */
export function looksBinary(input: Uint8Array | string): boolean {
  const end = Math.min(input.length, BINARY_PROBE_BYTES);
  if (typeof input === "string") {
    for (let index = 0; index < end; index += 1) if (input.charCodeAt(index) === 0) return true;
    return false;
  }
  for (let index = 0; index < end; index += 1) if (input[index] === 0) return true;
  return false;
}
