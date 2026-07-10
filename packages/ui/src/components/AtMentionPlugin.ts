import {
  CompletionContext,
  CompletionResult,
  Completion,
  pickedCompletion,
} from "@codemirror/autocomplete";
import i18n from "../i18n";

// The editor's `@` mention menu (Notion-style). Typing `@` opens a menu that
// blends two kinds of entries:
//   - dynamic dates (today / tomorrow / yesterday + "pick a date…") inserted as
//     plain ISO `YYYY-MM-DD` text (Plainva stays plain Markdown);
//   - note links: a live search of the vault index that inserts `[[Title]]`.
// (People mentions are planned for later.)
//
// It is registered as a completion *source* and combined with the slash source
// into ONE autocompletion config (see editorCompletion.ts) — two separate
// autocompletion extensions cannot both set `override`.

export interface AtMentionDeps {
  /** Read the current query service (may be null before a vault is open). */
  getQueryService: () => { db: { query: (sql: string, params?: any[]) => Promise<any[]> } } | null;
}

export type AtCompletion = Completion & { description?: string };

/** Local ISO date (YYYY-MM-DD) for today + an optional day offset (no TZ skew). */
function isoDate(offsetDays: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Apply that clears the typed `@query` and then fires a window event so the
// editor can take over (open a picker / create a file at that caret position).
function clearAndEmit(eventName: string): NonNullable<Completion["apply"]> {
  return (view, completion, from, to) => {
    view.dispatch({
      changes: { from, to, insert: "" },
      selection: { anchor: from },
      annotations: pickedCompletion.of(completion),
      userEvent: "input.complete",
    });
    setTimeout(() => window.dispatchEvent(new CustomEvent(eventName, { detail: { pos: from } })), 0);
  };
}

// "Pick a date…" opens the calendar; "New database" creates an inline `.base`.
const openDatePicker = clearAndEmit("plainva-open-date-mention");
const createInlineBaseApply = clearAndEmit("plainva-create-inline-base");

export function atMentionCompletionSource(deps: AtMentionDeps) {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    // Match `@` plus everything typed after it on the line (note titles have spaces).
    const word = context.matchBefore(/@[^\n@]*/u);
    if (!word) return null;
    // The `@` must sit at a boundary (line start, or after whitespace / an opening
    // bracket) so we don't hijack email addresses or `@` inside a word.
    const before = word.from > 0 ? context.state.sliceDoc(word.from - 1, word.from) : "";
    if (before && !/[\s([{>]/.test(before)) return null;
    const query = word.text.slice(1);
    if (query.length > 60) return null; // user is typing prose, not a mention
    const q = query.trim().toLowerCase();

    const options: AtCompletion[] = [];

    // --- Dynamic dates ---
    const dateSection = { name: i18n.t("editor.atSecDates", { defaultValue: "Datum" }), rank: 1 };
    const dateDesc = i18n.t("editor.atDateDesc", { defaultValue: "Als Datum einfügen" });
    const dateDefs: { key: string; labelKey: string; off: number; kws: string }[] = [
      { key: "today", labelKey: "editor.atDateToday", off: 0, kws: "today heute" },
      { key: "tomorrow", labelKey: "editor.atDateTomorrow", off: 1, kws: "tomorrow morgen" },
      { key: "yesterday", labelKey: "editor.atDateYesterday", off: -1, kws: "yesterday gestern" },
    ];
    for (const d of dateDefs) {
      const label = i18n.t(d.labelKey);
      const iso = isoDate(d.off);
      if (!q || label.toLowerCase().includes(q) || d.kws.includes(q) || iso.includes(q)) {
        // Insert a dynamic `@YYYY-MM-DD` token (rendered relatively in live/read).
        options.push({ label, apply: `@${iso}`, detail: iso, type: "date", section: dateSection, description: dateDesc });
      }
    }
    const pickLabel = i18n.t("editor.atDatePick", { defaultValue: "Datum wählen…" });
    if (!q || pickLabel.toLowerCase().includes(q) || "date datum kalender calendar pick wählen waehlen".includes(q)) {
      options.push({ label: pickLabel, type: "date", section: dateSection, apply: openDatePicker });
    }

    // --- Note links (live vault search) ---
    const qs = deps.getQueryService();
    if (qs) {
      try {
        const term = query.trim();
        const like = `%${term}%`;
        const rows = await qs.db.query(
          `SELECT path, title FROM files
           WHERE (title LIKE ? OR path LIKE ?) AND path LIKE '%.md'
           ORDER BY (CASE WHEN title LIKE ? THEN 1 ELSE 2 END), mtime_local DESC
           LIMIT 8`,
          [like, like, `${term}%`],
        );
        const noteSection = { name: i18n.t("editor.atSecNotes", { defaultValue: "Notizen" }), rank: 2 };
        for (const r of rows) {
          const title = r.title || r.path.split(/[/\\]/).pop()?.replace(/\.md$/i, "") || r.path;
          options.push({
            label: title,
            apply: `[[${title}]]`,
            detail: "[[ ]]",
            type: "wikilink",
            section: noteSection,
            description: r.path,
          });
        }

        // --- Inline database embeds (#8): search .base files, insert ![[path]] ---
        const baseRows = await qs.db.query(
          `SELECT path, title FROM files
           WHERE (title LIKE ? OR path LIKE ?) AND path LIKE '%.base'
           ORDER BY (CASE WHEN title LIKE ? THEN 1 ELSE 2 END), mtime_local DESC
           LIMIT 6`,
          [like, like, `${term}%`],
        );
        const baseSection = { name: i18n.t("editor.atSecBases", { defaultValue: "Datenbanken" }), rank: 3 };
        for (const r of baseRows) {
          const name = (r.title || r.path.split(/[/\\]/).pop() || r.path).replace(/\.base$/i, "");
          options.push({
            label: name,
            apply: `![[${r.path}]]`,
            detail: "![[ ]]",
            type: "base",
            section: baseSection,
            description: r.path,
          });
        }
        const newBaseLabel = i18n.t("editor.atNewBase", { defaultValue: "Neue Datenbank einbetten" });
        if (!q || newBaseLabel.toLowerCase().includes(q) || "base database datenbank neu new inline".includes(q)) {
          options.push({
            label: newBaseLabel,
            type: "base",
            section: baseSection,
            apply: createInlineBaseApply,
            description: i18n.t("editor.atNewBaseDesc", { defaultValue: "Neue .base im Ordner der Notiz anlegen" }),
          });
        }
      } catch {
        /* search failed — still offer date entries */
      }
    }

    if (options.length === 0) return null;
    // We filter ourselves; no `validFor` so the source re-runs on every keystroke.
    return { from: word.from, filter: false, options };
  };
}
