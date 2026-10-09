import { CompletionContext, CompletionResult, Completion, pickedCompletion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import i18n from "../i18n";
import { searchEmoji } from "./emojiData";
import { parseHeadings } from "../lib/outline";
import { searchLinkTargets, searchTags } from "../lib/inlineTriggers";

// `[[` note-link and `#` tag autocomplete (#10), combined into the editor's
// single autocompletion (see editorCompletion.ts). Both are completion *sources*.

/**
 * How many `]` directly after the completed range the insertion must consume:
 * closeBrackets already produced the closing `]]` while the user typed `[[`,
 * so a plain string apply would leave `[[Title]]]]` behind.
 */
export function closersToConsume(after: string): number {
  return after.startsWith("]]") ? 2 : after.startsWith("]") ? 1 : 0;
}

/** Apply for `[[`/`![[` completions: insert the full link, swallowing any
 *  auto-closed `]]` right of the caret, and park the caret after the link. */
function applyLinkText(insert: string) {
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    const extra = closersToConsume(view.state.sliceDoc(to, Math.min(view.state.doc.length, to + 2)));
    view.dispatch({
      changes: { from, to: to + extra, insert },
      selection: { anchor: from + insert.length },
      annotations: pickedCompletion.of(completion),
    });
  };
}

export interface EditorTriggerDeps {
  getQueryService: () => {
    db: { query: (sql: string, params?: any[]) => Promise<any[]> };
    getAllTags: () => Promise<{ tag: string; count: number }[]>;
    /** Where a link leads (`VaultQueryService.resolveNotePath`) — which note `[[Note#` means. */
    resolveNotePath?: (target: string, sourcePath?: string) => Promise<string | null>;
  } | null;
  /** A note's text, for the headings behind `[[Note#` (issue #92); absent = no heading completion for other notes. */
  readNote?: (path: string) => Promise<string | null>;
  /** The note being edited: a link is read from its folder. */
  hostPath?: () => string | undefined;
}

type TriggerCompletion = Completion & { description?: string };

/**
 * The `[[query` the caret stands in: `context.matchBefore(/\[\[[^\]\n]*$/)`,
 * read without the pattern (plan Befunde 24.09., E6), which tried every `[` of
 * the window and ran each to the caret. The query is bounded by the last `]`
 * (or line break) before the caret and opened by the first `[[` after it. The
 * window is matchBefore's: the line, at most 250 characters back.
 */
export function wikiQueryBefore(context: CompletionContext): { from: number; to: number; text: string } | null {
  const line = context.state.doc.lineAt(context.pos);
  const start = Math.max(line.from, context.pos - 250);
  const before = line.text.slice(start - line.from, context.pos - line.from);
  const bound = Math.max(before.lastIndexOf("]"), before.lastIndexOf("\n"));
  const found = before.indexOf("[[", bound + 1);
  return found < 0 ? null : { from: start + found, to: context.pos, text: before.slice(found) };
}

// `[[` -> live note search; selection inserts `[[Title]]`.
//
// Attachments are offered too since issue #56, but SECOND (E4): notes keep the
// top of the list without a heading, attachments follow under one. A link to a
// PDF is a normal thing to want — and Plainva already resolves `[[Report.pdf]]`
// and renders it as a working link, so the app was producing references it
// would not help you write.
export function wikiLinkCompletionSource(deps: EditorTriggerDeps) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const word = wikiQueryBefore(context);
    if (!word) return null;
    // A leading "!" means an embed (`![[`) — handled by embedCompletionSource.
    if (context.state.sliceDoc(Math.max(0, word.from - 1), word.from) === "!") return null;
    const qs = deps.getQueryService();
    if (!qs) return null;
    const term = word.text.slice(2).trim(); // drop the leading [[
    if (term.length > 80) return null;
    // `[[Note#` and `[[#` (issue #92): the headings of that note — or of
    // this one — instead of a note search that the `#` could never match.
    // Inserted as Obsidian writes them (the heading's text), which is also
    // what the resolver reads first.
    const hashAt = term.indexOf("#");
    if (hashAt >= 0) {
      try {
        const notePart = term.slice(0, hashAt).trim();
        const headPart = term.slice(hashAt + 1).trim().toLowerCase();
        let content: string | null = null;
        let noteLabel = "";
        if (!notePart) {
          content = context.state.doc.toString();
        } else {
          // The note the link names — by the link rule, as a click finds it.
          // What was typed stays: it is a name that leads there.
          const path = deps.readNote && qs.resolveNotePath ? await qs.resolveNotePath(notePart, deps.hostPath?.()) : null;
          if (!path || !deps.readNote) return null;
          noteLabel = notePart;
          content = await deps.readNote(path);
        }
        if (!content) return null;
        const headings = parseHeadings(content).filter((h) => !headPart || h.text.toLowerCase().includes(headPart)).slice(0, 12);
        if (headings.length === 0) return null;
        return {
          from: word.from,
          filter: false,
          options: headings.map((h) => ({
            label: h.text,
            detail: "#".repeat(h.level),
            apply: applyLinkText(`[[${noteLabel}#${h.text}]]`),
            type: "wikilink",
            section: { name: i18n.t("editor.completionHeadings", { defaultValue: "Headings" }), rank: 0 },
          })),
        };
      } catch {
        return null;
      }
    }
    try {
      // Notes first, then attachments — the search carries the ranking (it is
      // the one the capture fields read too, `lib/inlineTriggers`), the section
      // carries the heading. `.base` files stay out: they are opened, not
      // linked to as text, and `![[…]]` already offers them.
      const found = await searchLinkTargets(qs, term);
      const options: TriggerCompletion[] = found.map((hit) =>
        hit.kind === "attachment"
          ? {
              label: hit.label,
              apply: applyLinkText(hit.insert),
              type: "attachfile",
              description: hit.detail,
              section: { name: i18n.t("editor.completionAttachments", { defaultValue: "Anhänge" }), rank: 1 },
            }
          : { label: hit.label, apply: applyLinkText(hit.insert), type: "wikilink", description: hit.detail },
      );
      if (options.length === 0) return null;
      return { from: word.from, filter: false, options };
    } catch {
      return null;
    }
  };
}

// `![[` -> embed search across all files (notes, images, .base); inserts
// `![[path]]`. Powers the slash "internal image" / "embed" entries and any
// manually typed `![[`.
export function embedCompletionSource(deps: EditorTriggerDeps) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const word = context.matchBefore(/!\[\[[^\]\n]*$/);
    if (!word) return null;
    const qs = deps.getQueryService();
    if (!qs) return null;
    const term = word.text.slice(3).trim(); // drop the leading ![[
    if (term.length > 80) return null;
    const like = `%${term}%`;
    try {
      const rows = await qs.db.query(
        `SELECT path, title FROM files
         WHERE title LIKE ? OR path LIKE ?
         ORDER BY (CASE WHEN title LIKE ? THEN 1 ELSE 2 END), mtime_local DESC
         LIMIT 12`,
        [like, like, `${term}%`],
      );
      const options: TriggerCompletion[] = rows.map((r) => {
        const name = r.title || r.path.split(/[/\\]/).pop() || r.path;
        const isImg = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i.test(r.path);
        const isBase = /\.base$/i.test(r.path);
        return { label: name, apply: applyLinkText(`![[${r.path}]]`), type: isImg ? "image" : isBase ? "base" : "embed", description: r.path };
      });
      if (options.length === 0) return null;
      return { from: word.from, filter: false, options };
    } catch {
      return null;
    }
  };
}

// `#tag` -> tag suggestions from the vault index; inserts `#tag`.
export function tagCompletionSource(deps: EditorTriggerDeps) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    // Require at least one tag char so a bare `#` (or an ATX heading "# ") never triggers.
    const word = context.matchBefore(/#[\p{L}\p{N}/_-]+/u);
    if (!word) return null;
    const before = word.from > 0 ? context.state.sliceDoc(word.from - 1, word.from) : "";
    if (before && !/[\s([{]/.test(before)) return null; // not part of a word
    const qs = deps.getQueryService();
    if (!qs) return null;
    const term = word.text.slice(1); // drop the leading #
    try {
      const found = await searchTags(qs, term);
      const options: TriggerCompletion[] = found.map((hit) => ({
        label: hit.label,
        apply: hit.insert,
        type: "tag",
        description: i18n.t("editor.tagCount", { count: hit.count ?? 0, defaultValue: `${hit.count ?? 0}×` }),
      }));
      if (options.length === 0) return null;
      return { from: word.from, filter: false, options };
    } catch {
      return null;
    }
  };
}

// `:name` -> emoji suggestions; selection inserts the Unicode emoji CHARACTER,
// never a `:shortcode:`. Shortcodes are not CommonMark: Obsidian core would
// render `:smile:` literally, breaking the "Obsidian must open files cleanly"
// rule — so we store the portable character instead. Requires >=2 name chars
// and a word boundary before the colon, so times ("10:30"), URLs and YAML-style
// "key:" never trigger it. Synchronous — the catalog is bundled (no deps).
export function emojiColonCompletionSource() {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/:[\p{L}\p{N}_+-]{2,}/u);
    if (!word) return null;
    const before = word.from > 0 ? context.state.sliceDoc(word.from - 1, word.from) : "";
    if (before && !/[\s([{]/.test(before)) return null; // mid-word / after a digit (e.g. "10:30")
    const matches = searchEmoji(word.text.slice(1)); // drop the leading :
    if (matches.length === 0) return null;
    const options: TriggerCompletion[] = matches.map((e) => ({
      label: `${e.char}  ${e.name}`,
      apply: e.char,
      type: "emoji",
    }));
    return { from: word.from, filter: false, options };
  };
}
