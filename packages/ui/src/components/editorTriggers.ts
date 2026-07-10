import { CompletionContext, CompletionResult, Completion, pickedCompletion } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import i18n from "../i18n";
import { searchEmoji } from "./emojiData";

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
  } | null;
}

type TriggerCompletion = Completion & { description?: string };

// `[[` -> live note search; selection inserts `[[Title]]`.
export function wikiLinkCompletionSource(deps: EditorTriggerDeps) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const word = context.matchBefore(/\[\[[^\]\n]*$/);
    if (!word) return null;
    // A leading "!" means an embed (`![[`) — handled by embedCompletionSource.
    if (context.state.sliceDoc(Math.max(0, word.from - 1), word.from) === "!") return null;
    const qs = deps.getQueryService();
    if (!qs) return null;
    const term = word.text.slice(2).trim(); // drop the leading [[
    if (term.length > 80) return null;
    const like = `%${term}%`;
    try {
      const rows = await qs.db.query(
        `SELECT path, title FROM files
         WHERE (title LIKE ? OR path LIKE ?) AND path LIKE '%.md'
         ORDER BY (CASE WHEN title LIKE ? THEN 1 ELSE 2 END), mtime_local DESC
         LIMIT 12`,
        [like, like, `${term}%`],
      );
      const options: TriggerCompletion[] = rows.map((r) => {
        const title = r.title || r.path.split(/[/\\]/).pop()?.replace(/\.md$/i, "") || r.path;
        return { label: title, apply: applyLinkText(`[[${title}]]`), type: "wikilink", description: r.path };
      });
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
    const term = word.text.slice(1).toLowerCase(); // drop the leading #
    try {
      const all = await qs.getAllTags();
      const options: TriggerCompletion[] = all
        .filter((t) => t.tag.replace(/^#/, "").toLowerCase().startsWith(term))
        .slice(0, 20)
        .map((t) => {
          const bare = t.tag.replace(/^#/, "");
          return { label: `#${bare}`, apply: `#${bare}`, type: "tag", description: i18n.t("editor.tagCount", { count: t.count, defaultValue: `${t.count}×` }) };
        });
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
