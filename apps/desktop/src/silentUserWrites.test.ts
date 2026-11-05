import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, shippedSources } from "./test-sourceTree";

/**
 * A write the user started is never answered by the console alone
 * (Sammelplan § 3.63 no. 1, § 3.134 nos. 2 and 3, § 3.135 no. 3, § 3.87
 * nos. 1, 2 and 5; plan Fehlerbereinigung, P11).
 *
 * A database created in the editor or in the settings, a ticked checkbox, a
 * new entry and a new template of a database, an overview adopted, a
 * database saved, a task moved into its database: when the vault refused the
 * write — an open conflict, a workspace role without write access, a folder
 * that could not be made — the failure went to the console, came back as
 * `null` and was taken for "nothing to do", or stood on screen as the raw
 * English of the vault ("File or directory already exists: …"). Each of them
 * says now, in both shells, what could not be done and why: a sentence of its
 * own (`writeFailed.*`) and the reason as `errorText` reads it, which turns
 * the vault's own refusals into the user's words.
 *
 * The `silentPropertyWrites.test.ts` guard holds the same line for the
 * property writers. This one lists the creators and the handlers of this
 * package: every call of a watched function in both shells, with the sentence
 * that must stand behind it, and nothing that answers a failure with `null`.
 * The assertions read the source on purpose: what is checked is that a branch
 * exists, and a mock would assert against itself.
 */

const SHELLS = ["apps/desktop/src", "apps/mobile/src", "packages/ui/src"];

/** The functions a user-started write goes through, and the sentence their failure gets. */
const WATCHED = ["createInlineBase", "createTaskDatabase", "createNewTemplate", "saveNoteAsTemplate", "createTemplateIn", "saveNoteAsTemplateIn", "createBaseItem", "promoteTask", "adoptFileAsIndex"];

interface Site {
  file: string;
  writer: string;
  calls: number;
  /** How a failure of this call reaches the user. */
  how: string;
  /** What must stand behind each call, within `within` characters. */
  says: RegExp[];
  within: number;
}

const said = (key: string) => new RegExp(`t\\("writeFailed\\.${key}", \\{[^}]*(reason|keptReason)[^}]*errorText\\(`);
/** A failure answered as "nothing to do". */
const SWALLOWED = /^\.catch\(\(\) => (null|\{\}|undefined)\)/;

const SITES: Site[] = [
  // ── A database created in the editor or in the settings (§ 3.63 no. 1) ──
  { file: "apps/desktop/src/components/Editor.tsx", writer: "createInlineBase", calls: 1, how: "the sentence of a new database, with its reason", says: [said("newDatabase")], within: 700 },
  { file: "apps/mobile/src/EditorHost.tsx", writer: "createInlineBase", calls: 1, how: "the sentence of a new database, with its reason", says: [said("newDatabase")], within: 900 },
  { file: "apps/desktop/src/components/SettingsModal.tsx", writer: "createTaskDatabase", calls: 1, how: "the sentence of a new database, with its reason", says: [said("newDatabase")], within: 1500 },
  { file: "apps/mobile/src/screens/SettingsAreaScreens.tsx", writer: "createTaskDatabase", calls: 1, how: "the sentence of a new database, with its reason", says: [said("newDatabase")], within: 900 },
  // The task database made from the hint of the task capture (plan Rückmeldungen 2026-11-05, E1).
  { file: "apps/desktop/src/components/tasks/TasksView.tsx", writer: "createTaskDatabase", calls: 1, how: "the sentence of a new database, with its reason", says: [said("newDatabase")], within: 900 },
  { file: "apps/mobile/src/screens/TasksScreen.tsx", writer: "createTaskDatabase", calls: 1, how: "the sentence of a new database, with its reason", says: [said("newDatabase")], within: 300 },
  // ── A new template (§ 3.134 no. 3) ──
  { file: "apps/desktop/src/AppShell.tsx", writer: "createNewTemplate", calls: 1, how: "the sentence of a new template, with its reason", says: [said("newTemplate")], within: 700 },
  { file: "apps/desktop/src/components/BaseViewer.tsx", writer: "createNewTemplate", calls: 1, how: "the sentence of a new template, with its reason", says: [said("newTemplate")], within: 800 },
  { file: "apps/desktop/src/AppShell.tsx", writer: "saveNoteAsTemplate", calls: 1, how: "the sentence of a new template, with its reason", says: [said("newTemplate")], within: 700 },
  { file: "apps/desktop/src/services/templateActions.ts", writer: "createTemplateIn", calls: 1, how: "thrown on to createNewTemplate's callers, listed above", says: [/^adapter, \{ folder, noteType \}, stem, assignTo\);\s*\}/], within: 70 },
  { file: "apps/desktop/src/services/templateActions.ts", writer: "saveNoteAsTemplateIn", calls: 1, how: "thrown on to saveNoteAsTemplate's caller, listed above", says: [/^adapter, folder, notePath\);\s*\}/], within: 70 },
  { file: "apps/mobile/src/services/templatePrompt.ts", writer: "createTemplateIn", calls: 1, how: "the sentence of a new template, with its reason", says: [said("newTemplate")], within: 400 },
  { file: "apps/mobile/src/screens/NoteScreen.tsx", writer: "saveNoteAsTemplateIn", calls: 1, how: "the sentence of a new template, with its reason", says: [said("newTemplate")], within: 400 },
  // ── A new entry of a database (§ 3.134 no. 3; the desktop's is checked below) ──
  { file: "apps/mobile/src/screens/base/BaseScreen.tsx", writer: "createBaseItem", calls: 2, how: "the sentence of a new entry, with its reason", says: [said("newEntry")], within: 700 },
  // ── A task moved into its database (§ 3.87 no. 5) ──
  {
    file: "apps/desktop/src/components/tasks/TasksView.tsx", writer: "promoteTask", calls: 1,
    how: "a kept checkbox is said; a failure gets the sentence of a move, with its reason",
    says: [/writeFailed\.promotedCheckboxKept/, said("checkbox"), said("promote")], within: 2600,
  },
  {
    file: "apps/mobile/src/components/useTaskRowActions.tsx", writer: "promoteTask", calls: 1,
    how: "a kept checkbox is said; a failure gets the sentence of a move, with its reason",
    says: [/writeFailed\.promotedCheckboxKept/, said("checkbox"), said("promote")], within: 2000,
  },
  // ── An overview adopted (§ 3.135 no. 3) ──
  { file: "apps/desktop/src/components/IndexMdModal.tsx", writer: "adoptFileAsIndex", calls: 1, how: "a result line with the sentence of an adoption and its reason", says: [/t\("writeFailed\.adopt", \{ file: [^}]*reason \}\)/, /const reason = errorText\(e\);/], within: 1400 },
  { file: "apps/mobile/src/screens/OverviewsScreen.tsx", writer: "adoptFileAsIndex", calls: 1, how: "the sentence of an adoption and its reason, through the run's failure text", says: [/\(reason\) => t\("writeFailed\.adopt", \{ file: name, reason \}\)/], within: 900 },
];

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let code: { rel: string; text: string }[] | null = null;
const shipped = () => (code ??= shippedSources(SHELLS).map(({ rel, text }) => ({ rel, text: strip(text) })));
const source = (rel: string) => shipped().find((file) => file.rel === rel)!.text;

function callsOf(writer: string): Map<string, { text: string; at: number[] }> {
  const found = new Map<string, { text: string; at: number[] }>();
  const call = new RegExp(`(?<![\\w.])(?<!function )${writer}\\(`, "g");
  for (const { rel, text } of shipped()) {
    const at = [...text.matchAll(call)].map((m) => m.index!);
    if (at.length > 0) found.set(rel, { text, at });
  }
  return found;
}

/** The parenthesis that closes the one at `open` (strings are not read: the calls watched hold none with a parenthesis). */
function closeOf(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return i;
  }
  return text.length;
}

/** The stretch of a file that begins with `anchor`, `length` characters long. */
function stretch(rel: string, anchor: string, length: number): string {
  const text = source(rel);
  const at = text.indexOf(anchor);
  expect(at, `${rel}: "${anchor}" moved — re-point this guard`).toBeGreaterThanOrEqual(0);
  return text.slice(at, at + length);
}

describe("a write the user started is never answered by the console alone", () => {
  it("knows every call of a watched creator in both shells", () => {
    const seen: string[] = [];
    for (const writer of WATCHED) for (const [file, { at }] of callsOf(writer)) seen.push(`${file} — ${writer} ×${at.length}`);
    expect(
      seen.sort(),
      "A watched creator is called somewhere this guard does not know (or no longer where it says). Enter the call in SITES " +
        "with the sentence its failure gets — a writeFailed.* sentence with its reason through errorText.",
    ).toEqual(SITES.map((site) => `${site.file} — ${site.writer} ×${site.calls}`).sort());
  });

  it.each(SITES)("$file — $writer: $how", (site) => {
    const { text, at } = callsOf(site.writer).get(site.file) ?? { text: "", at: [] };
    expect(at.length, "the call is gone — see the first test").toBe(site.calls);
    for (const start of at) {
      const behind = text.slice(text.indexOf("(", start) + 1, start + site.within);
      for (const sentence of site.says) expect(behind, `nothing behind ${site.writer}( says ${sentence}`).toMatch(sentence);
      expect(text.slice(closeOf(text, text.indexOf("(", start)) + 1).trimStart().slice(0, 40), `a failure of ${site.writer}( is answered as nothing to do`).not.toMatch(SWALLOWED);
    }
  });

  it("the shared creators throw their reason instead of answering null", () => {
    const actions = source("packages/ui/src/lib/templateActions.ts");
    expect(actions).not.toMatch(/Promise<string \| null>/);
    expect(stretch("packages/ui/src/lib/templateActions.ts", "async function ensureFolder(", 400)).toMatch(/throw error;/);
  });

  it("the handlers of this package say what failed, with its reason, in both shells", () => {
    // A checkbox ticked in the task list, on a pinboard card, in the calendar (§ 3.134 no. 2).
    expect(stretch("apps/desktop/src/components/tasks/TasksView.tsx", "const mutateCheckbox = useCallback(", 1800)).toMatch(said("checkbox"));
    expect(stretch("apps/mobile/src/screens/TasksScreen.tsx", "const mutateCheckbox = useCallback(", 1500)).toMatch(said("checkbox"));
    expect(stretch("apps/desktop/src/components/base/BasePinboardView.tsx", "const handleToggleTask = useCallback(", 1600)).toMatch(said("checkbox"));
    expect(stretch("apps/mobile/src/screens/base/PinboardView.tsx", "const handleToggleTask = useCallback(", 1600)).toMatch(said("checkbox"));
    expect(stretch("apps/desktop/src/components/pimcal/CalendarView.tsx", "const toggleTaskFromCalendar = useCallback(", 2800)).toMatch(said("checkbox"));
    expect(stretch("apps/mobile/src/screens/PimCalendarScreen.tsx", "const toggleTask = useCallback(", 1600)).toMatch(said("checkbox"));
    // The desktop's new entry and new template of a database (§ 3.134 no. 3).
    expect(stretch("apps/desktop/src/components/BaseViewer.tsx", "const doCreateItem = async (", 4200)).toMatch(said("newEntry"));
    // A database that could not be saved names its reason (§ 3.87 no. 1) …
    expect(stretch("apps/desktop/src/components/BaseViewer.tsx", "const saveConfig = async (", 2600)).toMatch(said("databaseSave"));
    expect(stretch("apps/mobile/src/screens/base/BaseScreen.tsx", "const persistConfig = useStableHandler(", 1400)).toMatch(said("databaseSave"));
    // … and the desktop puts back what the caller set ahead of the save (§ 3.71 no. 5).
    expect(stretch("apps/desktop/src/components/BaseViewer.tsx", "const saveConfig = async (", 2600)).toMatch(/if \(save === saveTurn\.current && shownConfig\) showViewLayout\(shownConfig, activeViewIndex\);/);
    // An overview written again from its note or its folder.
    expect(stretch("apps/desktop/src/components/Editor.tsx", "const refreshManagedIndex = async () => {", 1400)).toMatch(said("overview"));
    expect(stretch("apps/mobile/src/screens/NoteScreen.tsx", "const refreshManagedIndex = () => {", 600)).toMatch(said("overview"));
    expect(stretch("apps/mobile/src/services/indexOverviews.ts", "export async function generateOverviewForFolder(", 700)).toMatch(/i18n\.t\("writeFailed\.overview", \{ reason: errorText\(e\) \}\)/);
    // A remark refused by an open conflict is named as one (§ 3.87 no. 2).
    expect(source("packages/ui/src/lib/commentActionView.ts")).toMatch(/refusedByOpenConflict\(error\)\) return "writeFailed\.openConflict";/);
  });

  it("the desktop does not offer an adoption the vault refuses (§ 3.135 no. 3)", () => {
    expect(source("apps/desktop/src/components/IndexMdModal.tsx")).toMatch(/\{!info\.hasIndex && info\.candidates\.map\(/);
  });

  it("the sentences exist in every language, each with its reason", () => {
    const LANGS = ["en", "de", "fr", "es", "it", "nl", "pl", "pt-BR", "ja", "zh-CN"];
    for (const lang of LANGS) {
      const bundle = JSON.parse(readFileSync(join(REPO, "packages", "ui", "src", "locales", `${lang}.json`), "utf8")) as { writeFailed?: Record<string, string> };
      const sentences = bundle.writeFailed ?? {};
      for (const key of ["checkbox", "newEntry", "newTemplate", "newDatabase", "databaseSave", "overview", "adopt", "promote"]) {
        expect(sentences[key], `${lang} lacks writeFailed.${key}`).toContain("{{reason}}");
      }
      for (const key of ["permission", "exists", "notFound"]) expect(sentences[key], `${lang} lacks writeFailed.${key}`).toContain("{{name}}");
      expect(sentences.openConflict, `${lang} lacks writeFailed.openConflict`).toBeTruthy();
      expect(sentences.promotedCheckboxKept, `${lang} lacks writeFailed.promotedCheckboxKept`).toContain("{{name}}");
      expect(sentences.rewriteSkipped, `${lang} lacks writeFailed.rewriteSkipped`).toContain("{{count}}");
    }
  });
});
