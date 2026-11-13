import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reading the index is safe by default (performance plan L3, second review of 11.11.).
 *
 * The first index of a vault is built behind the open app, and an index owed a
 * full scan is not whole either. Two reviews found a planner that read half an
 * index because it was not on a list of planners: a list of planners is a
 * deny-list, and whoever is not on it reads half an index without knowing.
 * So the default is the other way round:
 *
 * - The reader both shells hand out (`queryService`, core `VaultQueryService`)
 *   refuses with `IndexNotWholeError` while its vault's index is not whole —
 *   every read method of the class, and a query on its `db`.
 * - A surface that only SHOWS asks for the view (`indexView`, `.view()`), by a
 *   name that says so. A planner's parameter asks for the reader's type
 *   (`IndexReader` or the class): the view does not fit it.
 *
 * This file therefore has nothing to say about planners — they cannot be
 * handed a partial reader. It lists the other side: every file that takes the
 * view, with what it shows from it and why nothing is written from it, and
 * every file that queries the index's tables beside the query service, with the
 * handle it takes. A new one fails here until somebody decided.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (rel: string) => readFileSync(join(REPO, rel), "utf8");

/** Every file that takes the view, with what it shows from it and why nothing is written from it. */
const VIEW_USES: Record<string, string> = {
  "apps/mobile/src/lib/folderDeletion.ts": "the count of the rows read so far, while the reader refuses: the deletion threshold's total, too small and so asking more often",
  "packages/core/src/vault/GraphService.ts": "forIndex takes the view's database for the map; its own planners (clean-up verdicts, mentions) ask the wholeness it is given",
  "apps/desktop/src/App.tsx": "the conflict rows of the error dialog: a list to look at",
  "apps/desktop/src/AppShell.tsx": "a plainva:// link opens a note the index holds (noteLinkReceiver resolves, never creates)",
  "apps/desktop/src/components/ai/McpPairing.tsx": "the top-level folders offered as a scope: a list to pick from",
  "apps/desktop/src/components/BacklinksPanel.tsx": "the backlinks of the open note: a list",
  "apps/desktop/src/components/base/BaseCreateWizard.tsx": "the tags offered as a source: a list to pick from",
  "apps/desktop/src/components/base/BasePinboardView.tsx": "a card's file by its name: shown",
  "apps/desktop/src/components/base/useBaseCells.tsx": "rows, values offered and the relation picker's list; a pick's link text is written as a path while the index is not whole (pathsForLinkText); the reverse-relation edit takes the reader",
  "apps/desktop/src/components/BasePicker.tsx": "the databases to pick from: a list",
  "apps/desktop/src/components/BaseViewer.tsx": "the rows, the search and the scope of a database; every column change, relation link and template assignment takes the reader",
  "apps/desktop/src/components/CalendarWidget.tsx": "the tasks due in the widget's menu: a list",
  "apps/desktop/src/components/DatabasesList.tsx": "the databases of the vault: a list",
  "apps/desktop/src/components/DatabaseSourceConfig.tsx": "the tags offered as a source: a list to pick from",
  "apps/desktop/src/components/Editor.tsx": "the governing database, the open note's indexed identity, the completion, the database context; parked suggestions use the unrefused handle for their own table; renames, overviews, tasks and the #110 verdict take the reader",
  "apps/desktop/src/components/FileTree.tsx": "the tree and its search: shown; every move goes through fileActions with the reader",
  "apps/desktop/src/components/graph/VaultGraphView.tsx": "icons and tags of the map; renames, connections and link removals take the reader",
  "apps/desktop/src/components/journal/JournalView.tsx": "the journal's notes: shown; a link opens through the reader's view and refuses to create",
  "apps/desktop/src/components/MarkdownReader.tsx": "embeds and links resolved for reading",
  "apps/desktop/src/components/pimcal/CalendarView.tsx": "the task and database overlays of the calendar and the note picker; a pick's link text is decided whole or written as a path",
  "apps/desktop/src/components/PropertiesSection.tsx": "suggestions, the governing database and the relation picker; a pick's spelling asks pathsSharingNames, which writes the path while the index is not whole",
  "apps/desktop/src/components/QuickSwitcher.tsx": "search and recent files; creating a note takes the reader",
  "apps/desktop/src/components/RightSidebar.tsx": "the database context and backlink count of the open note",
  "apps/desktop/src/components/settings/AiVaultSettingsPage.tsx": "the folders offered for the AI's scope: a list to pick from",
  "apps/desktop/src/components/settings/ExternalToolsDialogs.tsx": "the folders offered as a scope: a list to pick from",
  "apps/desktop/src/components/SettingsModal.tsx": "the vault's numbers on the About page",
  "apps/desktop/src/components/TagTree.tsx": "the tags and their notes; renaming a tag takes the reader",
  "apps/desktop/src/components/tasks/TasksQueryView.tsx": "a query block's tasks: shown",
  "apps/desktop/src/components/tasks/TasksView.tsx": "the task list and its databases; creating, promoting and blocking time take the reader",
  "apps/desktop/src/components/TemplateTargetsModal.tsx": "the databases a template can be assigned to; the assignment's link text takes the reader",
  "apps/desktop/src/components/useOpenFileLookup.ts": "the #110 search reads the view's database once the index is whole (searchMissingFile waits)",
  "apps/desktop/src/contexts/VaultContext.tsx": "hands out the view; at open, how many rows the index holds decides whether it is cold",
  "apps/desktop/src/hooks/useDocumentIcons.ts": "the icons of documents: shown",
  "apps/desktop/src/hooks/useDocumentTitles.ts": "the titles of documents: shown",
  "apps/desktop/src/services/openLink.ts": "a link to a note the index holds opens from the view; creating one refuses on the reader",
  "apps/mobile/src/BookmarksScreen.tsx": "the icons of the bookmarks: shown",
  "apps/mobile/src/components/NotePickSheet.tsx": "the notes to pick from: a list",
  "apps/mobile/src/components/useTaskRowActions.tsx": "the databases a task can be sent to: a list; writing takes the reader",
  "apps/mobile/src/EditorHost.tsx": "the completion, titles and databases of the editor: shown",
  "apps/mobile/src/lib/useLinkTargetLookup.ts": "which links lead nowhere: drawn",
  "apps/mobile/src/screens/AiPolicyScreen.tsx": "the folders offered for the AI's scope: a list to pick from",
  "apps/mobile/src/screens/base/BaseConfigSheet.tsx": "the values and tags offered while a database is configured",
  "apps/mobile/src/screens/base/PinboardView.tsx": "the cards, their previews and the board's search: shown, in the database screen's cache (one per index object)",
  "apps/mobile/src/screens/base/BaseScreen.tsx": "the rows, search, map and link lookup of a database; a new row's link text takes the reader",
  "apps/mobile/src/screens/base/CellEditSheet.tsx": "suggestions and the relation picker; a pick's link text is written as a path while the index is not whole (pathsForLinkText)",
  "apps/mobile/src/screens/BrowseScreen.tsx": "the folder's notes and icons; the deletion threshold counts on the reader",
  "apps/mobile/src/screens/DatabasesScreen.tsx": "the databases of the vault: a list",
  "apps/mobile/src/screens/GraphScreen.tsx": "tags and icons of the map; connections take the reader",
  "apps/mobile/src/screens/JournalScreen.tsx": "the journal's notes: shown",
  "apps/mobile/src/screens/PimCalendarScreen.tsx": "the database overlays of the calendar",
  "apps/mobile/src/screens/SearchScreen.tsx": "search, icons and the search corpus",
  "apps/mobile/src/screens/SettingsAreaScreens.tsx": "the databases offered in a setting: a list to pick from",
  "apps/mobile/src/screens/TodayScreen.tsx": "the notes changed today: shown",
  "apps/mobile/src/services/baseOps.ts": "a database's rows and the relation picker's list; the reverse-relation edit takes the reader",
  "apps/mobile/src/services/dueTasks.ts": "the tasks due on Today and in the widget: a list",
  "apps/mobile/src/services/noteLinkRoute.ts": "a plainva:// link opens a note the index holds; a copied link's text takes the reader",
  "apps/mobile/src/services/reminderActions.ts": "finds the task a tapped reminder belongs to (it exists: its reminder was planned from a whole index)",
  "apps/mobile/src/services/vaultService.ts": "hands out the view; folder counts, search and resolving a link to open read it",
  "apps/mobile/src/TagsScreen.tsx": "the tags and their notes; renaming a tag takes the reader",
};

/**
 * Every file that queries the index's own tables beside the query service,
 * with the handle it takes: the reader's `db` (refuses), the view's `db`
 * (partial, named), or a handle of its own — then why that is no reading of
 * the index as truth about the vault.
 */
const RAW_SQL: Record<string, string> = {
  "packages/core/src/ai/context/gistWriter.ts": "its own handle; background work that starts once the index is whole (the shells' `ready` waits for it)",
  "packages/core/src/ai/embeddings/pipeline.ts": "its own handle; background work that starts once the index is whole (the shells' `ready` waits for it)",
  "packages/core/src/sync/owedToRemote.ts": "the sync's bookkeeping (deletion marks, `local_ahead` rows): a mark the index holds again is settled, any other is sent only once the disk says the file is gone (`stillGone`) — half an index decides nothing",
  "packages/core/src/sync/SyncQueue.ts": "the sync's bookkeeping on a file's row (its stamp, its state): no plan from what the index says the vault holds",
  "packages/core/src/vault/GraphService.ts": "the view's handle for the map; its planners ask the wholeness first",
  "packages/core/src/vault/missingFile.ts": "the view's handle, read for a verdict only once the index is whole (untilWholeIndex)",
  "packages/core/src/workspace/sliceObjects.ts": "asks requireWholeIndex of the reader before it reads",
  "packages/ui/src/components/AtMentionPlugin.ts": "the completion's view: a list; the link text asks pathsSharingNames",
  "packages/ui/src/components/editorTriggers.ts": "the completion's view: a list; an embed is written by its path",
  "packages/ui/src/lib/indexMdAutoUpdate.ts": "the reader's handle (refuses); the listing waits, also across a close (owed listings)",
  "packages/ui/src/lib/indexMdGenerate.ts": "the reader's handle (refuses)",
  "packages/ui/src/lib/inlineTriggers.ts": "the completion's view: a list; the link text asks pathsSharingNames",
  "packages/ui/src/lib/renameNote.ts": "the reader's handle (refuses)",
  "packages/ui/src/lib/wikiLinkText.ts": "asks the wholeness first; over half an index every name counts as taken",
  "packages/ui/src/pim/entryEventSync.ts": "its own handle; both shells run it only once the index is whole",
  "apps/desktop/src/ai/embeddingTestVault.ts": "a test vault the evidence runs build; no vault of the person",
  "apps/desktop/src/App.tsx": "the view's handle: the conflict rows of a dialog",
  "apps/desktop/src/components/BasePicker.tsx": "the view's handle: the databases to pick from",
  "apps/desktop/src/components/BaseViewer.tsx": "the reader's handle (refuses): the link text of a template assignment",
  "apps/desktop/src/components/FileTree.tsx": "the view's handle: the tree",
  "apps/desktop/src/components/QuickSwitcher.tsx": "the view's handle: recent files",
  "apps/desktop/src/components/TemplateTargetsModal.tsx": "the reader's handle (refuses): the link text of a template assignment",
  "apps/desktop/src/contexts/VaultContext.tsx": "the view's handle at open: how many rows the index holds decides whether it is cold",
  "apps/desktop/src/services/baseSchema.ts": "the handle of whatever it is given: callers that show give the view, the governing database is shown",
  "apps/desktop/src/services/fileActions.ts": "the reader's handle (refuses)",
  "apps/desktop/src/services/okfConversion.ts": "the reader's handle (refuses)",
  "apps/desktop/src/services/okfMigration.ts": "the reader's handle (refuses)",
  "apps/mobile/src/lib/folderDeletion.ts": "the reader's handle for the deletion threshold; while it refuses, the view's count of the rows read so far — a smaller total makes the question come more often, never less",
  "apps/mobile/src/services/okfConversion.ts": "the reader's handle (refuses)",
  "apps/mobile/src/services/okfMigration.ts": "the reader's handle (refuses)",
  "apps/mobile/src/services/vaultService.ts": "its own handle at open: whether the index is warm",
};

const SOURCE_ROOTS = ["packages/core/src", "packages/ui/src", "apps/desktop/src", "apps/mobile/src"];
const INDEX_ITSELF = /^packages\/core\/src\/db\/|^packages\/core\/src\/vault\/(VaultIndexer|VaultQueryService)\.ts$/;

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(REPO, dir))) {
      if (name === "node_modules" || name === "dist") continue;
      const rel = `${dir}/${name}`;
      if (statSync(join(REPO, rel)).isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|\.spec\.|\.d\.ts$|^test-/.test(name)) out.push(rel);
    }
  };
  for (const root of SOURCE_ROOTS) walk(root);
  return out;
}

/** Code without its comments and strings: a mention in a comment takes nothing. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1")
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
}

const TAKES_VIEW = /\bindexView\b|\.view\(\)/;
const INDEX_SQL = /\bFROM\s+(files|links|tags|properties|fts_notes)\b/;

describe("reading the index (performance plan L3, second review of 11.11.)", () => {
  const files = sourceFiles();

  it("every file that takes the view says what it shows from it", () => {
    const takers = files.filter((f) => TAKES_VIEW.test(code(read(f))));
    expect(takers.filter((f) => !(f in VIEW_USES)), "takes the view without a decision in VIEW_USES").toEqual([]);
    expect(Object.keys(VIEW_USES).filter((f) => !takers.includes(f)), "listed in VIEW_USES and takes no view any more").toEqual([]);
  });

  it("every file that queries the index's tables beside the query service says which handle it takes", () => {
    // Template strings stay in: the SQL is in them.
    const querying = files.filter((f) => !INDEX_ITSELF.test(f) && INDEX_SQL.test(read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1")));
    expect(querying.filter((f) => !(f in RAW_SQL)), "queries the index without a decision in RAW_SQL").toEqual([]);
    expect(Object.keys(RAW_SQL).filter((f) => !querying.includes(f)), "listed in RAW_SQL and queries the index no more").toEqual([]);
  });

  it("no planner module takes the view", () => {
    // The shared planners live here; a view in one of them would be a planner
    // over half an index with a type cast around the brand.
    const planners = files.filter((f) => /^packages\/ui\/src\/(lib|base|services|ai|hooks)\//.test(f) || /^packages\/core\/src\/(?!vault\/GraphService\.ts)/.test(f));
    expect(planners.filter((f) => TAKES_VIEW.test(code(read(f))))).toEqual([]);
  });

  it("only tests declare a hand-made reader whole", () => {
    const declaring = files.filter((f) => /\bwholeIndexReader\(/.test(code(read(f))));
    // Its declaration (`wholeIndexReader<T …>(`) is no call: no source file calls it.
    expect(declaring).toEqual([]);
  });

  it("the app builds a graph service only over the index's wholeness", () => {
    const building = files.filter((f) => !f.startsWith("packages/core/") && /new GraphService\(/.test(code(read(f))));
    expect(building).toEqual([]);
  });

  it("the view is kept out of a planner's parameter by its type", () => {
    // The brand is declared in the class and missing from the view (core
    // index-reader.test.ts holds the @ts-expect-error that proves it).
    const service = read("packages/core/src/vault/VaultQueryService.ts");
    expect(service).toContain("declare readonly wholeIndex: true;");
    expect(service).toMatch(/export type IndexView = IndexReading & \{ readonly partialIndex: true \};/);
    expect(service).toMatch(/export type IndexReader<K extends keyof VaultQueryService> = Pick<VaultQueryService, K \| "wholeIndex">;/);
  });

  it("hands out the reader and the view in both shells, and only the view is partial", () => {
    const desktop = read("apps/desktop/src/contexts/VaultContext.tsx");
    expect(desktop).toContain("indexView: state.queryService ? state.queryService.view() : null");
    const mobile = read("apps/mobile/src/services/vaultService.ts");
    expect(mobile).toContain("indexView: queryService ? queryService.view() : null");
  });
});

describe("rows of the view never reach a write (third review of 11.11.)", () => {
  // A judgement per file was not enough: BaseViewer and the boards show rows
  // of the view AND saved an arrangement, a column order and "every note" from
  // them. The rows of a view read while the index is not whole carry that
  // (core `markPartialRows`); every writer from shown rows takes the proof
  // `WholeRows`, which only `requireWholeRows` hands out.
  const files = sourceFiles();
  const ROW_WRITERS = ["applyPin", "applyUnpin", "spliceIntoSequence", "fillMissingProperty"];

  it("the shared writers from shown rows take the proof by their type", () => {
    const sources = ["packages/ui/src/base/pinboardModel.ts", "packages/ui/src/base/columnFill.ts"].map(read).join("\n");
    for (const writer of ROW_WRITERS) {
      const signature = new RegExp(`export function ${writer}\\([\\s\\S]*?\\)[^{]*\\{`).exec(sources)?.[0] ?? "";
      expect(signature, writer).toMatch(/: WholeRows\b/);
    }
  });

  it("every file that writes from shown rows asks requireWholeRows, and nobody makes the proof by hand", () => {
    const writing = files.filter((f) => !f.startsWith("packages/") && new RegExp(`\\b(${[...ROW_WRITERS, "fillBaseProperty"].join("|")})\\(`).test(code(read(f))));
    expect(writing.length).toBeGreaterThanOrEqual(4);
    for (const f of writing) {
      // baseOps hands the proof its caller got on; it does not make one.
      if (f === "apps/mobile/src/services/baseOps.ts") continue;
      expect(code(read(f)), f).toMatch(/\brequireWholeRows\(/);
    }
    const forged = files.filter((f) => f !== "packages/core/src/vault/indexWholeness.ts" && /\bas WholeRows\b|wholeRows:\s*true/.test(code(read(f))));
    expect(forged).toEqual([]);
  });

  it("the board's column order and the column fill of the desktop ask before they write", () => {
    const viewer = code(read("apps/desktop/src/components/BaseViewer.tsx"));
    for (const fn of ["handleReorderBoardColumns", "materializeColumn", "applyRequirement"]) {
      const body = viewer.slice(viewer.indexOf(`const ${fn} = `), viewer.indexOf(`const ${fn} = `) + 900);
      expect(body, fn).toMatch(/wholeRowsOrSay\(\)/);
    }
  });
});

describe("a refusal over half an index reaches the person (third review of 11.11.)", () => {
  it("a move in the desktop's tree that is refused is said, never only logged", () => {
    const tree = code(read("apps/desktop/src/components/FileTree.tsx"));
    const run = tree.slice(tree.indexOf("const runMove = "), tree.indexOf("const handleDrop = "));
    expect(run).toMatch(/try \{\s*result = await moveItems\(/);
    expect(run).toMatch(/catch \(err\) \{\s*toast\.error\(/);
  });

  it("the quick switcher opens a note that is there before it asks whether the index is whole", () => {
    const switcher = code(read("apps/desktop/src/components/QuickSwitcher.tsx"));
    const create = switcher.slice(switcher.indexOf("const handleCreate = "));
    expect(create.indexOf("vaultAdapter.exists(path)")).toBeGreaterThan(-1);
    expect(create.indexOf("vaultAdapter.exists(path)")).toBeLessThan(create.indexOf("requireWholeIndex()"));
  });

  it("the desktop's reminders say nothing wrong while the index is built: no unreadable task database", () => {
    const scheduler = code(read("apps/desktop/src/services/reminderScheduler.ts"));
    // (String literals are blanked by `code`.)
    expect(scheduler).toMatch(/if \(!isIndexNotWholeError\(e\)\) \{\s*reason = "";\s*console\.warn\(/);
  });

  it("the phone's security screen goes on past slices it cannot count yet", () => {
    const screen = code(read("apps/mobile/src/screens/SecurityAreaScreen.tsx"));
    expect(screen).toMatch(/await sliceObjects\(\)\.then\(\(objects\) => refreshMobileWorkspaceSliceCounts\(/);
    expect(screen).not.toMatch(/objects: await sliceObjects\(\)/);
  });
});


