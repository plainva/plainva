import { describe, expect, it } from "vitest";
import { shippedSources } from "./test-sourceTree";

/**
 * A property that did not reach its note through the shared property writers
 * is never silent (finding 2026-10-09).
 *
 * A database cell and the properties panel of the desktop showed the new value
 * and wrote it afterwards; when the write failed, the failure went to the
 * console and the value stayed on screen. Three loops over many notes logged
 * each note they could not write and then showed every row as changed. On the
 * phone a ticked checkbox, a carried card and a dragged bar had no `.catch`.
 * All of them had the same shape: a call of `writeNoteProperty` or of what it
 * is built on, and nothing that tells the user when it throws.
 *
 * So every such call is listed here, with what stands behind it. A new caller
 * turns this red until it is entered with its way of saying so — the phone's
 * `silentFailures.test.ts` holds the same line for its own screens.
 *
 * The surgical helpers (`setFrontmatterPath` and its siblings) have many more
 * callers — tasks, the pinboard, a note's icon and colour, a property renamed
 * across notes, the calendar anchors. They are listed in the second half of
 * this file (finding 2026-10-12), by the stretch of code a call stands in.
 *
 * The assertions read the source on purpose (see there): what is checked is
 * that a branch exists, and a mock would assert against itself.
 */

const SHELLS = ["apps/desktop/src", "apps/mobile/src", "packages/ui/src"];

/** The functions a property reaches a note through, and where a call of each is looked for. */
const WRITERS: Record<string, string[]> = {
  writeNoteProperty: SHELLS,
  // What `writeNoteProperty` is built on: a note's text with one column set.
  // Called directly where a property is one part of a larger change of a note.
  withNoteProperty: SHELLS,
  updateFrontmatterString: SHELLS,
  bulkSetProperty: SHELLS,
  rewriteNoteProperties: SHELLS,
  // The phone's wrapper around `writeNoteProperty`. The desktop's cell hook has
  // a function of the same name; that one answers a boolean and never throws.
  commitCellValue: ["apps/mobile/src"],
  // The phone's wrapper around `bulkSetProperty`: the same note files as a
  // cell, one note at a time (finding 2026-10-09, `vaultChainWrites.test.ts`).
  commitBulkValue: ["apps/mobile/src"],
};

interface Site {
  file: string;
  writer: string;
  calls: number;
  /** How a failure of this call reaches the user. */
  how: string;
  /** What must stand behind each call … */
  says: RegExp[];
  /** … and what must not … */
  never?: RegExp[];
  /** … within this many characters of it. */
  within: number;
}

const SAID = /toast\.error\(t\("mobile\.propertyWriteFailed", \{ message: errorText\(/;
const COUNTED = /database\.bulkSetPartial/;

const SITES: Site[] = [
  // ── Desktop ──────────────────────────────────────────────────────────────
  {
    file: "apps/desktop/src/components/base/useBaseCells.tsx", writer: "writeNoteProperty", calls: 1,
    how: "a message, the cell takes the note's value back, and the caller is told",
    says: [SAID, /settled\.had\) back\[col\] = settled\.value/, /return false;/], within: 900,
  },
  {
    file: "apps/desktop/src/components/PropertiesSection.tsx", writer: "updateFrontmatterString", calls: 1,
    how: "a message, the panel keeps what the note says, and the handler is told",
    says: [SAID, /setRefusals\(/, /return false;/], within: 500,
  },
  {
    file: "apps/desktop/src/components/BaseViewer.tsx", writer: "bulkSetProperty", calls: 1,
    how: "one message that counts the notes written and the notes that failed",
    says: [COUNTED], within: 1500,
  },
  {
    file: "apps/desktop/src/components/BaseViewer.tsx", writer: "rewriteNoteProperties", calls: 2,
    how: "one message that counts the notes written and the notes that failed",
    says: [/reportRewrite\(result, /], within: 700,
  },
  {
    file: "apps/desktop/src/components/journal/JournalView.tsx", writer: "writeNoteProperty", calls: 1,
    how: "a message; the rating is drawn from the note and never shown ahead of it",
    says: [SAID], within: 300,
  },
  {
    file: "apps/desktop/src/components/pimcal/CalendarView.tsx", writer: "writeNoteProperty", calls: 1,
    how: "a message, and the entry goes back to its day",
    says: [SAID, /day: entry\.day/], within: 600,
  },
  {
    file: "apps/desktop/src/services/pim/entryEventSync.ts", writer: "withNoteProperty", calls: 1,
    // Decided, not forgotten: this runs after every calendar cycle without
    // anyone asking for it, and a note that cannot follow its appointment
    // fails again on the next one — a message per cycle would never stop. The
    // anchor is kept, so the move is tried again once the note can be written.
    how: "no message — a background reconcile: collected in errors for the caller, tried again every cycle",
    // The date goes in with the anchor's new start, in one change of the note (`updateVaultText`): what the
    // writer throws for the note leaves that change, and the catch around it collects it.
    says: [/result\.errors\.push\(/], within: 700,
  },
  // ── Phone ────────────────────────────────────────────────────────────────
  {
    file: "apps/mobile/src/services/baseOps.ts", writer: "writeNoteProperty", calls: 1,
    how: "thrown on to the caller of commitCellValue, which is listed below",
    says: [/syncSoon\(\);\s*\}/], never: [/catch/], within: 260,
  },
  {
    file: "apps/mobile/src/screens/base/BaseScreen.tsx", writer: "commitCellValue", calls: 1,
    how: "a message, and the caller is told; the rows are queried anew only after a write that landed",
    says: [SAID, /return false;/], within: 300,
  },
  {
    file: "apps/mobile/src/components/NoteContextSheet.tsx", writer: "commitCellValue", calls: 3,
    how: "a message; the sheet reads the note again only after a write that landed",
    says: [SAID], within: 600,
  },
  {
    file: "apps/mobile/src/services/baseOps.ts", writer: "bulkSetProperty", calls: 1,
    how: "handed back to the caller of commitBulkValue, which is listed below: the notes written and the notes that failed",
    says: [/return result;\s*\}/], never: [/catch/], within: 200,
  },
  {
    file: "apps/mobile/src/screens/base/BaseScreen.tsx", writer: "commitBulkValue", calls: 1,
    how: "one message that counts the notes written and the notes that failed",
    says: [COUNTED], within: 800,
  },
  {
    file: "apps/mobile/src/screens/JournalScreen.tsx", writer: "writeNoteProperty", calls: 1,
    how: "a message; the rating is drawn from the note and never shown ahead of it",
    says: [SAID], within: 600,
  },
  // ── Shared ───────────────────────────────────────────────────────────────
  {
    file: "packages/ui/src/base/bulkSetProperty.ts", writer: "writeNoteProperty", calls: 1,
    how: "collected per note in failed, which every caller above counts",
    says: [/failed\.push\(\{ path, message: /], within: 300,
  },
  {
    file: "packages/ui/src/base/bulkSetProperty.ts", writer: "updateFrontmatterString", calls: 1,
    how: "collected per note in failed, which every caller above counts",
    says: [/failed\.push\(\{ path, message: /], within: 300,
  },
  {
    file: "packages/ui/src/base/writeProperty.ts", writer: "updateFrontmatterString", calls: 1,
    // Inside the change `writeNoteProperty` hands the vault's chain: what it throws for the note is the caller's.
    how: "thrown on to the caller of writeNoteProperty, which is listed above",
    says: [/^text, next\);\s*\}/], within: 60,
  },
  {
    file: "packages/ui/src/base/writeProperty.ts", writer: "withNoteProperty", calls: 1,
    // The change itself: `writeNoteProperty` is this one call, handed to the vault's chain.
    how: "thrown on to the caller of writeNoteProperty, which is listed above — its one change",
    says: [/^text, column, value\)\);\s*\}/], within: 60,
  },
];

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The shipped code of both shells and the shared layer, without its comments. */
let code: { rel: string; text: string }[] | null = null;
const shipped = () => (code ??= shippedSources(SHELLS).map(({ rel, text }) => ({ rel, text: strip(text) })));

/** Where a writer is called, by file — its definition and its imports are no calls. */
function callsOf(writer: string): Map<string, { text: string; at: number[] }> {
  const found = new Map<string, { text: string; at: number[] }>();
  const call = new RegExp(`(?<!function )\\b${writer}\\(`, "g");
  for (const { rel, text } of shipped()) {
    if (!WRITERS[writer].some((root) => rel.startsWith(`${root}/`))) continue;
    const at = [...text.matchAll(call)].map((m) => m.index!);
    if (at.length > 0) found.set(rel, { text, at });
  }
  return found;
}

describe("a property write through the shared writers is never silent", () => {
  it("knows every call of a property writer in both shells", () => {
    const seen: string[] = [];
    for (const writer of Object.keys(WRITERS)) {
      for (const [file, { at }] of callsOf(writer)) seen.push(`${file} — ${writer} ×${at.length}`);
    }
    const listed = SITES.map((site) => `${site.file} — ${site.writer} ×${site.calls}`);
    expect(
      seen.sort(),
      "A property writer is called somewhere this guard does not know (or no longer where it says). " +
        "Enter the call in SITES with how its failure reaches the user: a message through the toast store " +
        "and the value shown taken back to the note's, a count for a loop over many notes — or the reason " +
        "why it stays quiet.",
    ).toEqual(listed.sort());
  });

  it.each(SITES)("$file — $writer: $how", (site) => {
    const { text, at } = callsOf(site.writer).get(site.file) ?? { text: "", at: [] };
    expect(at.length, "the call is gone — see the first test").toBe(site.calls);
    for (const start of at) {
      const behind = text.slice(text.indexOf("(", start) + 1, start + site.within);
      for (const said of site.says) expect(behind, `nothing behind ${site.writer}( says ${said}`).toMatch(said);
      for (const quiet of site.never ?? []) expect(behind, `${quiet} stands behind ${site.writer}(`).not.toMatch(quiet);
    }
  });

  it("the loops of the desktop's database count what they could not write", () => {
    const viewer = shipped().find((s) => s.rel === "apps/desktop/src/components/BaseViewer.tsx")!.text;
    const report = viewer.slice(viewer.indexOf("const reportRewrite"), viewer.indexOf("const reportRewrite") + 500);
    expect(report).toMatch(/if \(result\.failed\.length > 0\) toast\.error\(t\("database\.bulkSetPartial"/);
  });

  it("could not read is not has none: a whole set of properties starts from writableProperties", () => {
    // `updateFrontmatterString` removes what the set it is handed does not
    // name. A set built from a reader that failed is empty, and a note with an
    // empty `tags:` lost every other property that way.
    for (const [file, { text, at }] of callsOf("updateFrontmatterString")) {
      for (const start of at) {
        expect(
          text.slice(Math.max(0, start - 400), start),
          `${file} hands updateFrontmatterString a set without asking writableProperties first`,
        ).toMatch(/\bwritableProperties\(/);
      }
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// The surgical helpers (finding 2026-10-12)
// ════════════════════════════════════════════════════════════════════════════

/**
 * `setFrontmatterPath` and its siblings touch ONE key of a note's properties
 * block and throw where the block cannot be written — it is no YAML map, its
 * YAML cannot be read, a rename meets a key that is already there. Their
 * callers had the same shape as those of `writeNoteProperty`, in three kinds:
 * the error went to the console (a note's icon and colour, a property renamed
 * or removed across notes), it left as an unhandled rejection (a reverse
 * relation edited in its cell), or the bare message was shown — which, for
 * YAML that cannot be parsed, is the parser's quote of the note's own line
 * (the pinboard, the phone's task list).
 *
 * A call is listed by the STRETCH of code it stands in: a file and the text
 * its declaration begins with. A stretch runs to the next one listed for the
 * file, at most `span` characters. For each stretch: which of the watched
 * functions it calls, how often, and how a failure reaches the user.
 *
 * Watched are the four helpers and every function a stretch names in
 * `passesOn` — one that does not catch, so that its callers have to. Their
 * calls are listed the same way, until a stretch says the failure, counts it,
 * or carries the reason why it stays quiet.
 */
const SURGICAL = ["setFrontmatterPath", "deleteFrontmatterPath", "renameFrontmatterKey", "upsertFrontmatterKeys"];

interface Stretch {
  file: string;
  /** The text the stretch begins with; "" for the whole file. */
  at: string;
  /** How far it is read where no other stretch of the file follows sooner (default 2600). */
  span?: number;
  /** Instead of `span`: the text the stretch ends in front of. */
  until?: string;
  /** Its calls of the watched functions. */
  calls: Record<string, number>;
  /** How a failure of these calls reaches the user — or why it need not. */
  how: string;
  /** What must stand in the stretch … */
  says?: RegExp[];
  /** … what must not … */
  never?: RegExp[];
  /** … and what must stand right in front of every watched call in it. */
  ahead?: RegExp;
  /** Functions that hand the failure on to their callers: every call of them is listed in turn. */
  passesOn?: string[];
}

/** The one sentence where the stretch has no `t` of its own. */
const SAID_SHARED = /toast\.error\(i18n\.t\("mobile\.propertyWriteFailed", \{ message: errorText\(/;
/**
 * No `try … catch`, and no promise's `.catch(`, between the call and whoever called
 * the function. The index update behind a write may catch on its own: the
 * note is written by then, and an index that lags behind is no failed write.
 */
const THROWN_ON = [/\}\s*catch\s*[({]|(?<!applyIndexChanges\([^()]*\))\.catch\(/];
const set = "setFrontmatterPath";
const del = "deleteFrontmatterPath";
const upsert = "upsertFrontmatterKeys";

const STRETCHES: Stretch[] = [
  // ── Shared: a property renamed or removed across the notes of a database ──
  {
    file: "packages/ui/src/base/noteRewrite.ts", at: "export async function rewriteNoteTexts(", calls: {},
    how: "the loop: collected per note in failed, and the next note is tried",
    says: [/result\.failed\.push\(\{ path, message: reasonOf\(e\) \}\)/],
  },
  {
    file: "packages/ui/src/base/noteRewrite.ts", at: "export async function renamePropertyAcrossNotes(", calls: { renameFrontmatterKey: 1 },
    how: "asked of every note first: a note that refuses stops the rename before anything is written; a write that fails later is counted — both are answered to the caller",
    says: [/if \(refused\.length > 0\) return \{ status: "refused", refused \};/, /await opts\.saveConfig\(\);\s*return \{ status: "renamed", result: await rewriteNoteTexts\(/],
    passesOn: ["renamePropertyAcrossNotes"],
  },
  {
    file: "packages/ui/src/base/noteRewrite.ts", at: "export function removePropertyAcrossNotes(", calls: { [del]: 1 },
    how: "not asked first: collected per note in failed, which the caller counts",
    says: [/return rewriteNoteTexts\(adapter, paths, /],
    passesOn: ["removePropertyAcrossNotes"],
  },
  {
    file: "apps/desktop/src/components/BaseViewer.tsx", at: "const renameColumn = async (", span: 4200, calls: { renamePropertyAcrossNotes: 1 },
    how: "a refusal names the notes and nothing is written; a failed write is counted; only the notes that were renamed are shown as renamed",
    says: [/toast\.error\(renameRefusedText\(oldName, outcome\.refused\)\);\s*return false;/, /reportRewrite\(outcome\.result, /, /!written\.has\(String\(r\["file\.path"\]\)\)\) return r;/],
  },
  {
    file: "apps/desktop/src/components/BaseViewer.tsx", at: "const performDeleteColumn = async (", span: 3200, calls: { removePropertyAcrossNotes: 1 },
    how: "one message that counts the notes cleaned and the notes that failed; a note that failed keeps the property in its row",
    says: [/reportRewrite\(result, /, /kept\.has\(String\(r\["file\.path"\]\)\)\) return r;/],
  },
  {
    file: "apps/mobile/src/services/baseOps.ts", at: "export async function renameBaseProperty(", calls: { renamePropertyAcrossNotes: 1 },
    how: "answered to the caller of renameBaseProperty, which is listed below",
    says: [/return outcome;\s*\}/], never: THROWN_ON, passesOn: ["renameBaseProperty"],
  },
  {
    file: "apps/mobile/src/services/baseOps.ts", at: "export async function deleteBaseProperty(", calls: { removePropertyAcrossNotes: 1 },
    how: "answered to the caller of deleteBaseProperty, which is listed below",
    says: [/return result;\s*\}/], never: THROWN_ON, passesOn: ["deleteBaseProperty"],
  },
  {
    file: "apps/mobile/src/screens/base/PropertyEditSheet.tsx", at: "const rename = () => {", calls: { renameBaseProperty: 1 },
    how: "a refusal names the notes and the sheet stays open; a failed write is counted; an error of the database is said",
    says: [/toast\.error\(renameRefusedText\(column, outcome\.refused\)\);\s*return;/, COUNTED, SAID],
  },
  {
    file: "apps/mobile/src/screens/base/PropertyEditSheet.tsx", at: "const remove = () => {", calls: { deleteBaseProperty: 1 },
    how: "one message that counts the notes cleaned and the notes that failed; an error of the database is said",
    says: [COUNTED, SAID],
  },

  // ── A note's icon and colour ─────────────────────────────────────────────
  {
    file: "packages/ui/src/lib/notePropertyEdit.ts", at: "export function editedNoteProperties(", calls: {},
    how: "a message, and nothing is handed to the editor: icon and colour are drawn from the text, which did not change",
    says: [SAID_SHARED, /return null;/],
  },
  {
    file: "packages/ui/src/lib/notePropertyEdit.ts", at: "export function withNoteIcon(", calls: { [set]: 2, [del]: 2 },
    how: "thrown on to the caller of withNoteIcon", never: THROWN_ON, passesOn: ["withNoteIcon"],
  },
  {
    file: "packages/ui/src/lib/noteCardTint.ts", at: "export function withNoteColor(", calls: { [set]: 1, [del]: 1 },
    how: "thrown on to the caller of withNoteColor", never: THROWN_ON, passesOn: ["withNoteColor"],
  },
  {
    file: "apps/desktop/src/components/Editor.tsx", at: "", calls: { withNoteIcon: 3, withNoteColor: 2 },
    how: "every change goes through applyNoteProperties, and that through editedNoteProperties, which says it",
    ahead: /applyNoteProperties\(\(text\) => $/,
    says: [/const applyNoteProperties = \(change: \(text: string\) => string\) => \{\s*const next = editedNoteProperties\(currentText\(\), change\);\s*if \(next !== null\) handlePropertiesChange\(next\);/],
  },
  {
    file: "apps/mobile/src/EditorHost.tsx", at: "", calls: { withNoteIcon: 2, withNoteColor: 2 },
    how: "every change goes through applyPlainva, and that through editedNoteProperties, which says it",
    ahead: /applyPlainva\(\(text\) => $/,
    says: [/const next = editedNoteProperties\(view\.state\.doc\.toString\(\), change\);\s*if \(next === null\) return;/],
  },
  {
    file: "apps/desktop/src/components/BaseViewer.tsx", at: "const setEntryColor = useCallback(", span: 800, calls: { withNoteColor: 1 },
    how: "a message; a board card is drawn from the note, so it keeps the colour the note has", says: [SAID],
  },
  {
    file: "apps/desktop/src/components/base/BasePinboardView.tsx", at: "const handleSetColor = useCallback(", span: 900, calls: { withNoteColor: 1 },
    how: "a message; the card is drawn from the note", says: [SAID], never: [/toast\.error\(String\(/],
  },
  {
    file: "apps/mobile/src/screens/base/PinboardView.tsx", at: "const pickColor = useCallback(", span: 1800, calls: { withNoteColor: 1 },
    how: "a message; the card is drawn from the note", says: [SAID], never: [/toast\.error\(String\(/],
  },

  // ── The pinboard's labels ────────────────────────────────────────────────
  {
    file: "apps/desktop/src/components/base/BasePinboardView.tsx", at: "const toggleLabel = useCallback(", span: 2200, calls: { [set]: 1, [del]: 1 },
    how: "a message, and the open popover learns of a tag only once it is in the note",
    says: [SAID, /const update = await updateVaultText\(vaultAdapter, path, \(fresh\) => labelled\(fresh\)\.next\);\s*if \(!labelProp\) \{\s*const \{ list \} = labelled\(update\.before\);\s*setLabelEdit\(/], never: [/toast\.error\(String\(/],
  },
  {
    file: "apps/mobile/src/screens/base/PinboardView.tsx", at: "const editLabels = useCallback(", until: "const openActions = useCallback(", calls: { [set]: 1, [del]: 1 },
    how: "a message; the labels on the card come from the index, which heard of no write",
    says: [SAID], never: [/toast\.error\(String\(/],
  },

  // ── Tasks ────────────────────────────────────────────────────────────────
  {
    file: "apps/desktop/src/components/tasks/TasksView.tsx", at: "const writeDbNote = useCallback(", span: 900, calls: {},
    how: "the desktop's write of a task note — a status, a priority, a repeat rule: a message with the reason", says: [SAID],
  },
  {
    file: "apps/mobile/src/screens/TasksScreen.tsx", at: "const writeDbNote = useCallback(", span: 900, calls: {},
    how: "the phone's write of a task note: a message with the reason as errorText reads it, not the bare one",
    says: [SAID], never: [/toast\.error\(e instanceof Error/],
  },
  {
    file: "apps/desktop/src/components/tasks/TasksView.tsx", at: "const setDbRowStatus = useCallback(", span: 500, calls: { [set]: 1 },
    how: "inside the mutation handed to writeDbNote, which says it",
    says: [/void writeDbNote\(path, \(raw\) => applyTaskStatusOption\(/],
  },
  {
    file: "apps/mobile/src/screens/TasksScreen.tsx", at: "const pickDbStatus = useCallback(", span: 900, calls: { [set]: 1 },
    how: "inside the mutation handed to writeDbNote, which says it",
    says: [/await writeDbNote\(row\.path, \(raw\) =>\s*applyTaskStatusOption\(/],
  },
  {
    file: "packages/ui/src/lib/taskPriorityWrite.ts", at: "export async function setDbTaskPriority(", calls: { [set]: 1, [del]: 1 },
    how: "inside the mutation handed to the shell's write of a task note (deps.writeNote); both shells hand it their writeDbNote",
    says: [/await deps\.writeNote\(notePath, \(raw\) => /], passesOn: ["setDbTaskPriority"],
  },
  {
    file: "apps/desktop/src/components/tasks/TasksView.tsx", at: "const applyPriority = async (", span: 1700, calls: { setDbTaskPriority: 1 },
    how: "the note through writeDbNote, which says it; the database's own file through the catch here", says: [/writeNote: writeDbNote,?\s*\}/, /toast\.error\(errorText\(e\)\)/],
  },
  {
    file: "apps/mobile/src/screens/TasksScreen.tsx", at: "const pickPriority = useCallback(", span: 2400, calls: { setDbTaskPriority: 1 },
    how: "the note through writeDbNote, which says it; the database's own file through the catch here", says: [/writeNote: writeDbNote \}/, /toast\.error\(errorText\(e\)\)/],
  },
  {
    file: "packages/ui/src/lib/taskRecurrence.ts", at: "export function writeRepeatRule(", span: 300, calls: { [set]: 1, [del]: 1 },
    how: "thrown on to the caller of writeRepeatRule", never: THROWN_ON, passesOn: ["writeRepeatRule"],
  },
  {
    file: "apps/desktop/src/components/tasks/TasksView.tsx", at: "<RepeatTaskModal", span: 900, calls: { writeRepeatRule: 1 },
    how: "inside the mutation handed to writeDbNote, which says it", says: [/await writeDbNote\(path, \(raw\) => \{/],
  },
  {
    file: "apps/mobile/src/screens/TasksScreen.tsx", at: "<RepeatTaskSheet", span: 700, calls: { writeRepeatRule: 1 },
    how: "inside the mutation handed to writeDbNote, which says it", says: [/await writeDbNote\(path, \(raw\) => \{/],
  },
  {
    file: "packages/ui/src/lib/taskPromotion.ts", at: "export async function prepareTaskNote(", span: 3200, calls: { writeRepeatRule: 1 },
    how: "a NEW note for a task, its block the app's or a template's: thrown on to the task's creation, which both shells answer with tasks.promoteFailed",
  },
  {
    file: "packages/ui/src/lib/taskList.ts", at: "export function setNoteTaskExclusion(", calls: { [set]: 1, [del]: 1 },
    how: "thrown on to the caller of setNoteTaskExclusion", never: THROWN_ON, passesOn: ["setNoteTaskExclusion"],
  },
  {
    file: "apps/desktop/src/components/tasks/TasksView.tsx", at: "const writeNoteExcluded = useCallback(", span: 800, calls: { setNoteTaskExclusion: 1 },
    how: "thrown on to its two gestures, listed next", never: THROWN_ON, passesOn: ["writeNoteExcluded"],
  },
  {
    file: "apps/desktop/src/components/tasks/TasksView.tsx", at: "const setNoteExcluded = useCallback(", span: 500, calls: { writeNoteExcluded: 1 },
    how: "one note hidden or shown again: a message", says: [SAID],
  },
  {
    file: "apps/desktop/src/components/tasks/TasksView.tsx", at: "const hideAllTemplates = useCallback(", span: 800, calls: { writeNoteExcluded: 1 },
    how: "every template hidden at once: one message that counts", says: [COUNTED],
  },
  {
    file: "apps/mobile/src/screens/TasksScreen.tsx", at: "const writeNoteExcluded = async (", span: 400, calls: { setNoteTaskExclusion: 1 },
    how: "thrown on to its two gestures, listed next", never: THROWN_ON, passesOn: ["writeNoteExcluded"],
  },
  {
    file: "apps/mobile/src/screens/TasksScreen.tsx", at: "const setNoteExcluded = async (", span: 400, calls: { writeNoteExcluded: 1 },
    how: "one note hidden or shown again: a message", says: [SAID], never: [/toast\.error\(e instanceof Error/],
  },
  {
    file: "apps/mobile/src/screens/TasksScreen.tsx", at: "const hideAllTemplates = async (", span: 600, calls: { writeNoteExcluded: 1 },
    how: "every template hidden at once: one message that counts", says: [COUNTED],
  },
  {
    file: "packages/ui/src/lib/taskDueWrite.ts", at: "export async function applyTaskDueChanges(", span: 6000, calls: { [set]: 1, [del]: 1 },
    how: "collected in failed, with how many tasks were to move — not in skipped, whose sentence is \"changed in the meantime\": only a note that is gone is skipped",
    says: [/if \(isFileNotFound\(e\)\) out\.skipped \+= 1;\s*else out\.failed\.push\(\{ path: change\.path, message: reasonOf\(e\), tasks: 1 \}\);/, /if \(isFileNotFound\(e\)\) out\.skipped \+= list\.length;\s*else out\.failed\.push\(\{ path, message: reasonOf\(e\), tasks: list\.length \}\);/],
  },
  {
    file: "packages/ui/src/lib/taskDueWrite.ts", at: "export function taskDueFailureText(", span: 700, calls: {},
    how: "the words for failed: the sentence of a property write for one task, one count for a section",
    says: [/i18n\.t\("mobile\.propertyWriteFailed", \{ message: errorText\(outcome\.failed\[0\]\.message\) \}\)/, COUNTED],
  },
  {
    file: "apps/desktop/src/components/tasks/TasksView.tsx", at: "const moveDue = async (", span: 900, calls: {},
    how: "the desktop says what taskDueFailureText words", says: [/const failed = taskDueFailureText\(outcome\);\s*if \(failed\) toast\.error\(failed\);/],
  },
  {
    file: "apps/mobile/src/services/taskDueAction.ts", at: "export function announceTaskDue(", span: 900, calls: {},
    how: "the phone says what taskDueFailureText words, on the tasks screen and on Today", says: [/const failed = taskDueFailureText\(outcome\);\s*if \(failed\) toast\.error\(failed\);/],
  },
  {
    file: "packages/ui/src/lib/taskRecurrence.ts", at: "export async function writeNextOccurrenceNote(", span: 4200, calls: { [set]: 3, [del]: 3 },
    how: "thrown on to whoever ticks the task off: the tick has landed by then, and the failure is answered as spawnFailed",
    passesOn: ["writeNextOccurrenceNote"],
  },
  {
    file: "apps/desktop/src/services/taskCompletion.ts", at: "export async function toggleTaskDone(", span: 300, calls: {},
    how: "the tick of the desktop, behind the task's own gate", says: [/toggleTaskDoneLocked\(deps, path, done\)/], passesOn: ["toggleTaskDone"],
  },
  {
    file: "apps/desktop/src/services/taskCompletion.ts", at: "async function toggleTaskDoneLocked(", span: 900, calls: { [set]: 1, spawnNextOccurrence: 1 },
    how: "the completion is thrown on to the caller of toggleTaskDone; a successor that could not be written is answered as spawnFailed",
    says: [/catch \(e\) \{[\s\S]{0,200}return \{ spawnedDue: null, spawnFailed: true \};/],
  },
  {
    file: "apps/desktop/src/services/taskCompletion.ts", at: "export async function spawnNextOccurrence(", span: 2600, calls: { [set]: 2, [del]: 1, writeNextOccurrenceNote: 1 },
    how: "thrown on to toggleTaskDoneLocked, listed above", never: THROWN_ON, passesOn: ["spawnNextOccurrence"],
  },
  {
    file: "apps/desktop/src/components/tasks/TasksView.tsx", at: "const toggleDbRowDone = useCallback(", span: 1200, calls: { toggleTaskDone: 1 },
    how: "a message with the reason; a successor that failed has its own sentence", says: [SAID, /tasks\.repeatFailed/],
  },
  {
    file: "apps/desktop/src/components/pimcal/CalendarView.tsx", at: "const toggleTaskFromCalendar = useCallback(", span: 1900, calls: { toggleTaskDone: 1 },
    how: "a message with the reason, and the row goes back to what the note says", says: [SAID, /done: task\.done \} : x\)\)\);/, /tasks\.repeatFailed/],
  },
  {
    file: "apps/mobile/src/services/taskCompletionAction.ts", at: "async function setTaskDoneLocked(", span: 2600, calls: { [set]: 3, writeNextOccurrenceNote: 1 },
    how: "the completion is thrown on to the caller of setTaskDone; a successor that could not be written is answered as spawnFailed",
    says: [/catch \{ return \{ changed, spawnFailed: true \}; \}/], passesOn: ["setTaskDone"],
  },
  {
    file: "apps/mobile/src/screens/TasksScreen.tsx", at: "const toggleDbRow = useCallback(", span: 900, calls: { setTaskDone: 1 },
    how: "a message with the reason as errorText reads it; a successor that failed has its own sentence",
    says: [/\.catch\(\(e\) => toast\.error\(t\("mobile\.propertyWriteFailed", \{ message: errorText\(e\) \}\)\)\)/, /tasks\.repeatFailed/],
  },
  {
    file: "apps/mobile/src/screens/PimCalendarScreen.tsx", at: "const toggleTask = useCallback(", span: 1200, calls: { setTaskDone: 1 },
    how: "a tick in the phone's calendar: a message with the reason as errorText reads it; a successor that failed has its own sentence",
    says: [/\.catch\(\(e\) => toast\.error\(t\("mobile\.propertyWriteFailed", \{ message: errorText\(e\) \}\)\)\)/, /tasks\.repeatFailed/],
  },
  {
    file: "apps/mobile/src/services/reminderActions.ts", at: "export async function runReminderIntent(", span: 1200, calls: { setTaskDone: 1 },
    how: "a tick from a notification: a message with the reason", says: [SAID_SHARED],
  },
  {
    file: "apps/mobile/src/services/widgetService.ts", at: "export async function redeemWidgetActions(", span: 1400, calls: { setTaskDone: 1 },
    // Decided there, not forgotten: a tick made on the home screen is redeemed
    // when the app comes back, and a dialogue about a tap someone made
    // yesterday helps nobody. The task is still open in the next snapshot.
    how: "no message — a home-screen tick redeemed later: the task falls out of the count and stays open in the widget",
    says: [/if \(\(await setTaskDone\(ref\.path, true\)\)\.changed\) done \+= 1;/],
  },

  // ── Relations ────────────────────────────────────────────────────────────
  {
    file: "apps/desktop/src/services/relations.ts", at: "export async function addRelationLink(", calls: { [upsert]: 2 },
    how: "thrown on to the caller of addRelationLink", never: THROWN_ON, passesOn: ["addRelationLink"],
  },
  {
    file: "apps/desktop/src/services/relations.ts", at: "export async function removeRelationLinksToNote(", calls: { removeRelationLinksToNoteShared: 1 },
    how: "thrown on to the caller of removeRelationLinksToNote", never: THROWN_ON, passesOn: ["removeRelationLinksToNote"],
  },
  {
    file: "packages/ui/src/base/relationCleanup.ts", at: "export async function removeRelationLinksToNoteShared(", calls: { [del]: 1, [upsert]: 1 },
    how: "thrown on to the caller of removeRelationLinksToNoteShared", never: THROWN_ON, passesOn: ["removeRelationLinksToNoteShared"],
  },
  {
    file: "apps/desktop/src/components/base/useBaseCells.tsx", at: "const commitReverseCellValue = async (", span: 4600, calls: { addRelationLink: 1, removeRelationLinksToNote: 1 },
    how: "each counterpart note is a write of its own: one that fails is said (several are counted), and the cell shows what the notes hold",
    says: [SAID, COUNTED, /if \(p === rowPath\) return \{ \.\.\.r, \[col\]: shown \};/, /notAdded\.add\(key\);/, /notRemoved\.add\(key\);/],
  },
  {
    file: "apps/desktop/src/services/cascadeDelete.ts", at: "export async function executeDeletionPlan(", span: 2200, calls: { removeRelationLinksToNote: 1 },
    how: "collected in errors, which the deletion's host says", says: [/errors\.push\(ref\.source\.split\(/],
  },
  {
    file: "apps/mobile/src/services/cascadeDelete.ts", at: "export async function executeMobileCascade(", span: 2200, calls: { removeRelationLinksToNoteShared: 1 },
    how: "counted in errors, which the deletion's host says", says: [/errors\+\+;/],
  },
  {
    file: "packages/ui/src/services/graphRelationTargets.ts", at: "export async function removeRelationLink(", calls: { [upsert]: 1 },
    how: "thrown on to the caller of removeRelationLink", never: THROWN_ON, passesOn: ["removeRelationLink"],
  },
  {
    file: "packages/ui/src/services/graphRelationTargets.ts", at: "export async function writeRelationLink(", calls: { [upsert]: 2 },
    how: "thrown on to the caller of writeRelationLink", never: THROWN_ON, passesOn: ["writeRelationLink"],
  },
  {
    file: "apps/desktop/src/components/graph/VaultGraphView.tsx", at: "const removeEdgeRelation = useCallback(", span: 1200, calls: { removeRelationLink: 1 },
    how: "a message with the reason", says: [SAID],
  },
  {
    file: "apps/desktop/src/components/graph/GraphMapMenus.tsx", at: "const linkAsRelation = async (", span: 1200, calls: { writeRelationLink: 1 },
    how: "a message with the reason", says: [SAID],
  },
  {
    file: "apps/mobile/src/screens/GraphScreen.tsx", at: "const runConnect = async (", span: 2200, calls: { writeRelationLink: 1 },
    how: "a message with the reason as errorText reads it, and no \"link created\" behind it",
    says: [/catch \(e\) \{\s*toast\.error\(t\("mobile\.propertyWriteFailed", \{ message: errorText\(e\) \}\)\);\s*return;/],
  },
  {
    file: "apps/desktop/src/components/BaseViewer.tsx", at: "const linkHostTo = async (", span: 1300, calls: { writeRelationLink: 1 },
    how: "a message, and the new entry is shown all the same: what did not reach its note is the link in the host", says: [SAID, /return false;\s*\}\s*return true;/],
  },
  {
    file: "apps/desktop/src/components/base/useBaseCells.tsx", at: "const createRelationTarget = async (", span: 2600, calls: { [upsert]: 1 },
    how: "a NEW note for a relation target: the block is the app's own, built in the line before",
    says: [/let content = buildNewNoteContent\([^\n]*\n\s*if \(tags\.length > 0\) content = upsertFrontmatterKeys\(content, \{ tags \}\);/],
  },

  // ── Templates ────────────────────────────────────────────────────────────
  {
    file: "packages/ui/src/base/templateFiles.ts", at: "export function addTemplateForAssignment(", span: 800, calls: { [set]: 1 },
    how: "thrown on to the caller of addTemplateForAssignment — \"nothing changed\" is the answer of a template that is assigned already",
    never: THROWN_ON, passesOn: ["addTemplateForAssignment"],
  },
  {
    file: "packages/ui/src/base/templateFiles.ts", at: "export function removeTemplateForAssignment(", span: 900, calls: { [set]: 1, [del]: 1 },
    how: "cannot be refused: reached only for a block that was read as a YAML map holding the assignment",
    says: [/const raw = rawTemplateForOf\(content\);\s*if \(!raw\) return \{ content, changed: false \};/],
  },
  {
    file: "apps/desktop/src/components/BaseViewer.tsx", at: "const toggleTemplateAssignment = useCallback(", span: 1300, calls: { addTemplateForAssignment: 1 },
    how: "a message; the menu reads the templates again and shows what they hold", says: [SAID],
  },
  {
    file: "apps/desktop/src/components/TemplateTargetsModal.tsx", at: "const add = async (", span: 900, calls: { addTemplateForAssignment: 1 },
    how: "a message; the chips are drawn from the text that was written", says: [SAID],
  },
  {
    file: "packages/ui/src/lib/templateActions.ts", at: "export async function createTemplateIn(", span: 900, calls: { [set]: 1, addTemplateForAssignment: 1 },
    how: "a NEW template: the block is the app's own, built in the same statement",
    says: [/let content = setFrontmatterPath\(\s*buildNewNoteContent\(/],
  },
  {
    file: "packages/ui/src/lib/templateActions.ts", at: "export async function saveNoteAsTemplateIn(", span: 900, calls: { [set]: 1 },
    how: "a COPY of a note as a template: where the note's block cannot be written the copy is verbatim — the template is made, without its opt-out of the task list",
    says: [/catch \{\s*content = raw;\s*\}/],
  },
  {
    // Moved here from templateFiles.ts with the one place that takes a template's own keys out (finding 2026-10-11).
    file: "packages/ui/src/lib/newNoteContent.ts", at: "function withoutTemplateOnlyKeys(", span: 500, calls: { [del]: 1 },
    how: "a NEW note from a template: an entry that cannot be taken out where it stands stays, the other keys go — the note is made",
    says: [/\} catch \{\s*\}\s*\}\s*return text;/],
  },
  {
    file: "packages/ui/src/base/templateFiles.ts", at: "export async function retargetTemplateForInFolder(", span: 1900, calls: { [set]: 1 },
    how: "the sweep behind a database's rename: a template that could not be written is answered in failed, and the rename says that not every link could be updated",
    says: [/if \(!isFileNotFound\(e\)\) failed\.push\(item\.path\);/, /return \{ changedPaths, renamed, failed \};/],
  },
  {
    file: "apps/desktop/src/services/fileActions.ts", at: "const sweep = await retargetTemplateForInFolder(", span: 900, calls: {},
    how: "the rename reports what the sweep could not write", says: [/if \(sweep\.failed\.length > 0\) linkUpdateFailed = true;/],
  },

  // ── New notes the app builds, and what runs without a gesture ────────────
  {
    file: "packages/ui/src/base/pinboardEntry.ts", at: "export function applyPinboardEntryTitle(", span: 700, calls: { [set]: 1 },
    how: "the entry's own draft, made a moment ago: a template's block that cannot be written keeps its title key — the heading carries the title",
    says: [/next = setFrontmatterPath\(next, \["title"\], t\);\s*\} catch \{\s*\}/],
  },
  {
    file: "packages/ui/src/base/pinboardEntry.ts", at: "export function removePinboardEntryChips(", span: 900, calls: { [set]: 1, [del]: 2 },
    how: "the entry's own draft: in a template's block that cannot be written a chip stays — nothing is guessed",
    says: [/next = deleteFrontmatterPath\(next, \[chip\.key\]\);\s*\}\s*\} catch \{\s*\}/],
  },
  {
    file: "packages/ui/src/lib/newItemContent.ts", at: "export function finalizeItemContent(", span: 1500, calls: { [upsert]: 1 },
    how: "a NEW entry: a template's block that cannot be written is taken as it stands — the entry is made",
    says: [/catch \{\s*return content;\s*\}/],
  },
  {
    file: "packages/ui/src/mail/mailCapture.ts", at: "export function buildEmailNoteContent(", span: 1700, calls: { [upsert]: 2 },
    how: "a NEW note for a captured mail: the block is the app's own (buildNewNoteContent)",
    says: [/let content = buildNewNoteContent\("Email", title\);/],
  },
  {
    file: "packages/ui/src/mail/mailOut.ts", at: "export function buildReplyNoteContent(", span: 900, calls: { [upsert]: 1 },
    how: "a NEW note for a reply: the block is the app's own (buildNewNoteContent)",
    says: [/buildNewNoteContent\(/],
  },
  {
    file: "packages/ui/src/vaultTemplates/scaffold.ts", at: "export function buildTemplateNoteContent(", span: 700, calls: { [upsert]: 1 },
    how: "a NEW note of a vault template: its text is the app's own",
  },
  {
    file: "packages/ui/src/pim/meetingNote.ts", at: "function withEventFields(", span: 1300, calls: { [set]: 1, [upsert]: 2 },
    how: "a NEW meeting note from a template: one whose block cannot carry the anchor answers null, and the built-in note is written instead",
    says: [/out = upsertFrontmatterKeys\(text, \{ plainva: \{ pim: anchor \} \}\);\s*\} catch \{\s*return null;/, /out = upsertFrontmatterKeys\(out, updates\);\s*\} catch \{\s*return null;/],
  },
  {
    file: "packages/ui/src/pim/meetingNote.ts", at: "export function buildMeetingNoteContent(", span: 900, calls: { [upsert]: 1 },
    how: "a NEW meeting note: the block is the app's own (buildNewNoteContent)",
    says: [/const base = buildNewNoteContent\(/],
  },
  {
    file: "packages/ui/src/pim/taskSync.ts", at: "async function createTaskNote(", span: 3600, calls: { [set]: 2 },
    how: "no message — the provider sync, a NEW note for a mirrored task: one that cannot carry its anchor is not written",
    says: [/identity: taskAnchorIdentity\(account\),\s*\}\)\);\s*\} catch \{\s*return null;/],
  },
  {
    file: "packages/ui/src/pim/taskSync.ts", at: "function markRecurringAtProvider(", span: 500, calls: { [set]: 1 },
    how: "no message — the provider sync: a label that cannot be written must not cost the edit it rides on",
    says: [/catch \{\s*return content;/],
  },
  {
    file: "packages/ui/src/pim/taskSync.ts", at: "function upgradeAnchorIfStale(", span: 1100, calls: { [set]: 1 },
    how: "no message — the provider sync: an anchor's upgrade rides on a write that happens anyway and waits for the next one",
    says: [/catch \{\s*return content;/],
  },
  {
    file: "packages/ui/src/pim/taskSync.ts", at: "export function applyFieldsToNote(", span: 1100, calls: { [set]: 1, [del]: 1, [upsert]: 1 },
    // Runs in every sync cycle without anyone asking: a note that cannot take
    // the provider's date differs from it again on the next cycle. A message
    // per cycle would never stop.
    how: "no message — the provider sync, a background reconcile: the title still follows, the fields are tried again every cycle",
    says: [/catch \{/],
  },
  {
    file: "apps/desktop/src/services/pim/entryEventSync.ts", at: "export async function runEntryEventSync(", until: "\n}\n", calls: { [set]: 1 },
    how: "no message — a background reconcile: collected in errors for the caller, tried again every cycle",
    says: [/result\.errors\.push\(/],
  },
  {
    file: "packages/ui/src/pim/taskTimeBlock.ts", at: "export async function createTaskTimeBlock(", span: 1900, calls: { [set]: 1 },
    how: "answers anchored: false — the event exists; both shells say that the note could not be linked",
    says: [/catch \{\s*anchored = false;/],
  },
  {
    file: "packages/ui/src/pim/entryEvent.ts", at: "export async function createEntryEvent(", span: 2200, calls: { [set]: 1 },
    how: "answers anchored: false — the appointment exists; both shells say that the note could not be linked",
    says: [/catch \{\s*anchored = false;/],
  },
  {
    file: "packages/ui/src/pim/providerTask.ts", at: "export async function createProviderTask(", span: 1700, calls: { [set]: 1 },
    how: "answers anchored: false — the task exists at the provider; both shells say that the note could not be linked",
    says: [/catch \{\s*anchored = false;/],
  },
];

/** The watched functions: the four helpers and whatever a stretch hands a failure on through. */
const WATCHED = [...new Set([...SURGICAL, ...STRETCHES.flatMap((s) => s.passesOn ?? [])])];
const DEFAULT_SPAN = 2600;

interface Placed { stretch: Stretch; from: number; to: number }

/** The listed stretches of a file, by where they stand in its text. */
function placed(file: string, text: string): Placed[] {
  const starts = STRETCHES.filter((s) => s.file === file)
    .map((stretch) => ({ stretch, from: stretch.at === "" ? 0 : text.indexOf(stretch.at) }))
    .filter((p) => p.from >= 0)
    .sort((a, b) => a.from - b.from);
  const endOf = (p: { stretch: Stretch; from: number }): number => {
    if (p.stretch.until === undefined) return p.from + (p.stretch.span ?? DEFAULT_SPAN);
    const end = text.indexOf(p.stretch.until, p.from);
    return end < 0 ? p.from : end;
  };
  return starts.map((p, i) => ({
    ...p,
    to: p.stretch.at === "" ? text.length : Math.min(endOf(p), starts[i + 1]?.from ?? text.length),
  }));
}

interface WatchedCall { file: string; name: string; index: number; stretch: Stretch | null }

/** Every call of a watched function in the shipped code: where it stands and which stretch it falls into. */
let calls: WatchedCall[] | null = null;
function watchedCalls(): WatchedCall[] {
  if (calls) return calls;
  calls = [];
  for (const { rel, text } of shipped()) {
    let stretches: Placed[] | null = null;
    for (const name of WATCHED) {
      const call = new RegExp(`(?<!function )\\b${name}\\(`, "g");
      for (const m of text.matchAll(call)) {
        stretches ??= placed(rel, text);
        const home = stretches.find((p) => m.index! >= p.from && m.index! < p.to) ?? null;
        calls.push({ file: rel, name, index: m.index!, stretch: home?.stretch ?? null });
      }
    }
  }
  return calls;
}

const label = (file: string, at: string, name: string, count: number) => `${file} @ ${at || "(whole file)"} — ${name} ×${count}`;

describe("a property write through the surgical helpers is never silent", () => {
  it("knows every call of a surgical helper, and of what hands its failure on, in both shells", () => {
    const counts = new Map<string, number>();
    for (const call of watchedCalls()) {
      const key = JSON.stringify([call.file, call.stretch ? call.stretch.at : null, call.name]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const seen = [...counts].map(([key, count]) => {
      const [file, at, name] = JSON.parse(key) as [string, string | null, string];
      return at === null ? `${file} @ NO LISTED STRETCH — ${name} ×${count}` : label(file, at, name, count);
    });
    const listed = STRETCHES.flatMap((s) => Object.entries(s.calls).map(([name, count]) => label(s.file, s.at, name, count)));
    expect(
      seen.sort(),
      "A surgical helper — or a function that hands its failure on — is called somewhere this guard does not know " +
        "(or no longer where it says). Enter the call in STRETCHES with how its failure reaches the user: the " +
        "sentence of a property write through the toast store and nothing shown that the note does not hold, one " +
        "count for a loop over many notes — or the reason why it stays quiet.",
    ).toEqual(listed.sort());
  });

  it("names a function in a stretch's calls only if it is watched", () => {
    for (const s of STRETCHES) for (const name of Object.keys(s.calls)) expect(WATCHED, `${s.file} @ ${s.at}: ${name} is not watched`).toContain(name);
  });

  it.each(STRETCHES)("$file @ $at: $how", (s) => {
    const text = shipped().find((file) => file.rel === s.file)?.text ?? "";
    expect(text, `${s.file} is gone`).not.toBe("");
    if (s.at !== "") expect(text.split(s.at).length - 1, `"${s.at}" must stand in ${s.file} exactly once`).toBe(1);
    const here = placed(s.file, text).find((p) => p.stretch === s)!;
    const stretch = text.slice(here.from, here.to);
    for (const said of s.says ?? []) expect(stretch, `nothing in the stretch says ${said}`).toMatch(said);
    for (const quiet of s.never ?? []) expect(stretch, `${quiet} stands in the stretch`).not.toMatch(quiet);
    if (s.ahead) {
      for (const call of watchedCalls().filter((c) => c.stretch === s)) {
        expect(text.slice(Math.max(0, call.index - 120), call.index), `${call.name}( in ${s.file} is not handed to its way of saying so`).toMatch(s.ahead);
      }
    }
  });

  it("\"retrying in the background\" is said only by the saver that retries", () => {
    // `mobile.saveRetry` is the phone editor's sentence: its saver does try
    // again. The context graph said it after a link it could not write, the
    // database screen after a `.base` it could not save and after a folder it
    // could not create — and nothing retried any of them (finding 2026-10-09).
    expect(shipped().filter((file) => /mobile\.saveRetry/.test(file.text)).map((file) => file.rel)).toEqual(["apps/mobile/src/services/vaultService.ts"]);
  });

  it("a database that could not be saved is said in both shells", () => {
    // The desktop wrote it to the console and went on to rename the notes of a
    // database that still carried the old name; the phone announced a retry.
    const desktop = shipped().find((file) => file.rel === "apps/desktop/src/components/BaseViewer.tsx")!.text;
    const save = desktop.slice(desktop.indexOf("const saveConfig = async ("), desktop.indexOf("const restoreHere = async ("));
    expect(save).toMatch(/console\.error\("Failed to save database config", e\);\s*toast\.error\(t\("editor\.saveFailed"\)\);\s*return false;/);
    expect(save, "a query that fails behind a save that landed is no failed save").toMatch(/await vaultAdapter\.writeTextFile\(activePath, newText\);\s*\} catch \(e: any\) \{/);
    // The view goes back to the database it showed, and a change other files
    // follow is not kept for a file that has moved (finding 2026-10-21).
    expect(save).toMatch(/setDbConfig\(\(shown: any\) => \(shown === newConfig \? shownConfig : shown\)\);\s*setContent\(\(shown\) => \(shown === newText \? shownText : shown\)\);/);
    expect(save).toMatch(/if \(moved && park\) \{/);
    // What other files follow waits for the save's answer: the notes a property
    // is taken out of (they were cleaned while the database kept the column),
    // the notes of a rename, the other database of a relation.
    expect(desktop).toMatch(/if \(!\(await saveConfig\(nc, \{ park: false \}\)\)\) return;\s*if \(ask\.reverseInTarget && ask\.reverseInTarget\.base !== activePath\)/);
    expect(desktop).toMatch(/if \(!\(await saveConfig\(renamed, \{ park: false \}\)\)\) throw new ColumnChangeNotDone\(\);/);
    expect(desktop).toMatch(/if \(!\(await saveConfig\(nc, \{ park: !reverseIntent \}\)\)\) throw new ColumnChangeNotDone\(\);/);
    expect(desktop, "a computed column's rename waits for its save").toMatch(/if \(!\(await saveConfig\(renamePropertyInConfig\(dbConfig, oldName, newName, schema\)\)\)\) return false;/);
    expect(desktop, "the storage folder's new entry waits for the save").toMatch(/const nc = applyNewItemFolder\(dbConfig, clean, dlg\.mode\);\s*if \(!nc\) return;\s*if \(!\(await saveConfig\(nc\)\)\) return;/);
    // A computed column is renamed in the database alone: the index fills it on every row.
    expect(desktop).toMatch(/if \(computed === "reverse" \|\| computed === "rollup"\) \{/);
    const phone = shipped().find((file) => file.rel === "apps/mobile/src/screens/base/BaseScreen.tsx")!.text;
    const persist = phone.slice(phone.indexOf("const persistConfig = useStableHandler("), phone.indexOf("const restoreHere = useStableHandler("));
    expect(persist).toMatch(/toast\.error\(t\("editor\.saveFailed"\)\);/);
    // The phone puts its screen back as well, and makes no entry for a database it did not save.
    expect(persist).toMatch(/if \(shown !== undefined\) setLoaded\(\(now\) => \(now && now\.config === next \? \{ \.\.\.now, config: shown \} : now\)\);/);
    expect(phone).toMatch(/if \(!\(await persistConfig\(next, loaded\.config\)\)\) return null;/);
    expect([...phone.matchAll(/persistConfig\(next\)/g)], "a save of the phone's database without what it showed").toHaveLength(0);
  });

  it("who is told that a note could not be linked, says so", () => {
    // `createTaskTimeBlock`, `createEntryEvent` and `createProviderTask` answer
    // `anchored: false` instead of throwing: what was asked for exists by then.
    const warns = /pim\.blockNotAnchored|tasks\.providerAnchorFailed|"notAnchored"/;
    const readers = shipped().filter((file) => /\bres\.anchored\b/.test(file.text));
    expect(readers.map((file) => file.rel).sort()).toEqual([
      "apps/desktop/src/components/BaseViewer.tsx",
      "apps/desktop/src/components/tasks/TasksView.tsx",
      "apps/mobile/src/screens/TasksScreen.tsx",
      "apps/mobile/src/screens/base/BaseScreen.tsx",
      "packages/ui/src/pim/taskToProvider.ts",
    ]);
    for (const file of readers) expect(file.text, `${file.rel} reads anchored and never says it`).toMatch(warns);
  });
});
