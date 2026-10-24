import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Four silent failures (S20).
 *
 * Each of these did exactly what it was told and said nothing about it. The
 * shape they share is a branch that returns — an `if` guard, a missing
 * `.catch`, a condition on the wrong thing — where the user is left believing
 * the action landed.
 *
 * The assertions read the SOURCE on purpose. Three of the four are about a
 * question being asked, a promise being caught, or a branch not being taken;
 * a test with mocks would assert against its own mocks and stay green while
 * the branch quietly returns in the app.
 */

const SRC = fileURLToPath(new URL(".", import.meta.url));
const LOCALES = join(SRC, "..", "..", "..", "packages", "ui", "src", "locales");
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("renewing recovery asks before it invalidates", () => {
  const text = strip(read("screens", "SecurityAreaScreen.tsx"));

  it("asks, and stops when the answer is no", () => {
    // The tap used to rotate straight away. Renewing makes the recovery file
    // the user is holding worthless — if the share sheet is then dismissed,
    // they have no working recovery at all.
    const body = text.slice(text.indexOf("const renewRecovery"), text.indexOf("setBusyAction(\"renew\")"));
    expect(body, "renewRecovery must ask before it rotates").toMatch(/await mConfirm\(/);
    expect(body, "a declined question must stop the rotation").toMatch(/if \(!ok\) return;/);
  });

  it("the question names the consequence, in every language", () => {
    for (const lang of LANGS) {
      const d = dict(lang);
      expect(d.workspaceSecurity?.renewConfirmTitle, `${lang} lacks the question`).toBeTruthy();
      expect(d.workspaceSecurity?.renewConfirmBody, `${lang} lacks the consequence`).toBeTruthy();
    }
  });
});

describe("the composer without a mailbox says so", () => {
  const text = strip(read("screens", "MailComposeScreen.tsx"));

  it("shows the empty state instead of a form that cannot send", () => {
    // Reachable from a note ("send as mail") with no account at all: the form
    // rendered, and send() returned wordlessly on `if (!vaultId || !account)`.
    expect(text).toMatch(/accountsLoaded && accounts\.length === 0/);
    expect(text).toMatch(/mail\.noAccounts/);
    expect(text, "an empty state without a way out is a dead end").toMatch(/onOpenAccounts/);
  });

  it("waits for the account list before claiming there is none", () => {
    // Without the flag the empty state flashes on every open, because the
    // list arrives one tick later.
    expect(text).toMatch(/setAccountsLoaded\(true\)/);
  });

  it("is wired to the accounts screen", () => {
    expect(strip(read("routes.tsx"))).toMatch(/onOpenAccounts=\{\(\) => c\.push\(\{ kind: "mailaccounts"/);
  });
});

describe("a property change that fails, says it failed", () => {
  const text = strip(read("components", "NoteContextSheet.tsx"));

  it("catches the write", () => {
    const commit = text.slice(text.indexOf("commitCellValue(vault"), text.indexOf("rows={[]}"));
    expect(commit, "a bare .then() swallows the failure").toMatch(/\.catch\(/);
    expect(commit).toMatch(/mobile\.propertyWriteFailed/);
  });

  it("does not offer editing where the workspace forbids writing", () => {
    // Read-only and comment-only membership: the editor opened, the write
    // failed at the adapter, and the old value stayed on screen.
    expect(text).toMatch(/canWrite = true/);
    expect(text, "rows must be static without the write right").toMatch(/LOCKED\.has\(k\) \|\| !canWrite/);
    expect(text, "adding a property must be gated too").toMatch(/\{canWrite && \(/);
    const note = strip(read("screens", "NoteScreen.tsx"));
    // Counted per SURFACE, not as a total: D5 added a third consumer of the same
    // right (the comments sheet, which hides "accept suggestion" without it), and
    // a bare total would have read that as a regression. What must not drift is
    // that BOTH property surfaces - the sheet and the docked column - are told.
    expect(
      [...note.matchAll(/<NoteContextSheet[\s\S]{0,200}?canWrite=\{workspaceCanWrite\}/g)].length,
      "both the sheet and the docked column must be told",
    ).toBe(2);
  });

  it("names the failure in every language", () => {
    for (const lang of LANGS) {
      const v = dict(lang).mobile?.propertyWriteFailed;
      expect(v, `${lang} lacks mobile.propertyWriteFailed`).toBeTruthy();
      expect(v, `${lang} must carry the reason`).toContain("{{message}}");
    }
  });
});

describe("a database cell that cannot be written, says so", () => {
  const text = strip(read("screens", "base", "BaseScreen.tsx"));
  const from = (anchor: string, length: number) => text.slice(text.indexOf(anchor), text.indexOf(anchor) + length);

  it("writes every cell through the one function that catches", () => {
    // The checkbox in the table, a card carried to another column and a bar's
    // edge in the timeline each called `commitCellValue` with a bare `.then()`
    // or none at all: a refused write — a properties block that is no YAML map,
    // a read-only membership — was an unhandled rejection and nothing on screen.
    expect(text.indexOf("const writeCell"), "BaseScreen lost its one cell write").toBeGreaterThan(-1);
    expect([...text.matchAll(/commitCellValue\(/g)].length, "a cell is written past writeCell").toBe(1);
    const write = from("const writeCell", 500);
    expect(write).toMatch(/await commitCellValue\(/);
    expect(write).toMatch(/catch \(e\)/);
    expect(write).toMatch(/mobile\.propertyWriteFailed/);
    expect(write, "the caller has to learn that nothing was written").toMatch(/return false;/);
  });

  it("does not announce a retry that nothing makes", () => {
    // `mobile.saveRetry` is the editor's sentence — its saver does try again.
    // The cell editor said it too, and a refused write is never tried again.
    expect(from("const commitCell", 300)).not.toMatch(/mobile\.saveRetry/);
  });

  it("queries the rows anew only after a write that landed", () => {
    // The screen shows the index's rows, not the value being written: left
    // alone after a failure, the cell goes on showing what the note says.
    for (const call of text.matchAll(/void writeCell\([^\n]*/g)) {
      expect(call[0], "a cell write that re-queries without asking").toMatch(/\.then\(\(written\) => \{ if \(written\) requery\(/);
    }
  });
});

describe("a write that fails is said for what it is", () => {
  // Three kinds of the same silence (finding 2026-10-09, read on 2026-10-12):
  // "retrying in the background" where nothing retries, the bare message of an
  // error where `errorText` words it — for a properties block that is no YAML
  // that message is the parser's quote of the note's own line —, and a loop
  // that swallowed whatever a note threw. The desktop's
  // `silentPropertyWrites.test.ts` lists every such call of both shells; what
  // stands here are the phone's own sentences.
  const from = (text: string, anchor: string, length: number) => text.slice(text.indexOf(anchor), text.indexOf(anchor) + length);

  it("the context graph does not announce a retry after a link it could not write", () => {
    const accept = from(strip(read("components", "ContextGraph.tsx")), "const accept = (", 900);
    expect(accept).toMatch(/catch \{\s*toast\.error\(t\("graph\.cleanupActionFailed"\)\);/);
    expect(accept).not.toMatch(/mobile\.saveRetry/);
  });

  it("the database screen does not announce a retry for its own file or for a folder", () => {
    const text = strip(read("screens", "base", "BaseScreen.tsx"));
    expect(text).not.toMatch(/mobile\.saveRetry/);
    expect(from(text, "const persistConfig = useStableHandler(", 1000)).toMatch(/toast\.error\(t\("editor\.saveFailed"\)\);/);
    expect(from(text, "const askStorageFolder = useCallback(", 1500)).toMatch(/toast\.error\(t\("database\.createFolderFailed"\)\);\s*return null;/);
  });

  it("the tasks screen says a refused write in the sentence of a property write, not in the error's own words", () => {
    // The write of a task note is the shared row hook's since E1 (2026-10-24).
    const text = strip(read("screens", "TasksScreen.tsx")) + strip(read("components", "useTaskRowActions.tsx"));
    for (const anchor of ["const writeDbNote = useCallback(", "const setNoteExcluded = async (", "const toggleDbRow = useCallback("]) {
      const stretch = from(text, anchor, 800);
      expect(stretch, anchor).toMatch(/mobile\.propertyWriteFailed", \{ message: errorText\(e\) \}/);
      expect(stretch, anchor).not.toMatch(/e instanceof Error \? e\.message/);
    }
  });

  it("hiding every template at once counts the notes it could not write", () => {
    const hide = from(strip(read("screens", "TasksScreen.tsx")), "const hideAllTemplates = async (", 600);
    expect(hide).toMatch(/failed \+= 1;/);
    expect(hide).toMatch(/if \(failed > 0\) toast\.error\(t\("database\.bulkSetPartial", \{ done: hidden, failed \}\)\);/);
  });

  it("a tick from a notification or in the calendar says why it did not land", () => {
    const text = strip(read("services", "reminderActions.ts"));
    expect(from(text, "export async function runReminderIntent(", 900)).toMatch(/toast\.error\(i18n\.t\("mobile\.propertyWriteFailed", \{ message: errorText\(e\) \}\)\);/);
    const calendar = from(strip(read("screens", "PimCalendarScreen.tsx")), "const toggleTask = useCallback(", 1400);
    // A database entry's tick gets the sentence of a property write; a checkbox in a note says its reason.
    expect(calendar).toMatch(/\.catch\(\(e\) => \{\s*if \(row\.source === "database"\) toast\.error\(t\("mobile\.propertyWriteFailed", \{ message: errorText\(e\) \}\)\);\s*else toast\.error\(errorText\(e\)\);/);
    expect(calendar).not.toMatch(/e instanceof Error \? e\.message/);
  });

  it("the pinboard says a refused colour or label through errorText", () => {
    const text = strip(read("screens", "base", "PinboardView.tsx"));
    expect([...text.matchAll(/toast\.error\(t\("mobile\.propertyWriteFailed", \{ message: errorText\(e\) \}\)\);/g)]).toHaveLength(2);
    expect(from(text, "const pickColor = useCallback(", 1500)).not.toMatch(/toast\.error\(String\(/);
  });

  it("a property renamed or removed from the sheet waits for what happened and says it", () => {
    const text = strip(read("screens", "base", "PropertyEditSheet.tsx"));
    const rename = from(text, "const rename = () => {", 1600);
    expect(rename).toMatch(/const outcome = await renameBaseProperty\(/);
    expect(rename, "a refusal leaves the sheet open on the property as it is").toMatch(/toast\.error\(renameRefusedText\(column, outcome\.refused\)\);\s*return;/);
    expect(rename).toMatch(/database\.bulkSetPartial/);
    const remove = from(text, "const remove = () => {", 1400);
    expect(remove).toMatch(/const result = await deleteBaseProperty\(/);
    expect(remove).toMatch(/if \(result\.failed\.length > 0\) toast\.error\(t\("database\.bulkSetPartial"/);
    // Neither loop of the service swallows a note any more.
    const ops = strip(read("services", "baseOps.ts"));
    expect(from(ops, "export async function renameBaseProperty(", 700)).not.toMatch(/catch/);
    expect(from(ops, "export async function deleteBaseProperty(", 700)).not.toMatch(/catch/);
  });

  it("the sentences exist in every language", () => {
    for (const lang of LANGS) {
      const d = dict(lang);
      expect(d.database?.renamePropertyRefused, `${lang} lacks database.renamePropertyRefused`).toContain("{{notes}}");
      expect(d.database?.bulkSetPartial, `${lang} lacks database.bulkSetPartial`).toContain("{{failed}}");
      expect(d.database?.createFolderFailed, `${lang} lacks database.createFolderFailed`).toBeTruthy();
      expect(d.inputRejected?.propertyNameTaken, `${lang} lacks inputRejected.propertyNameTaken`).toBeTruthy();
      expect(d.graph?.cleanupActionFailed, `${lang} lacks graph.cleanupActionFailed`).toBeTruthy();
      expect(d.editor?.saveFailed, `${lang} lacks editor.saveFailed`).toBeTruthy();
    }
  });
});

describe("saving with .eml saves the .eml", () => {
  const text = strip(read("screens", "MailMessageScreen.tsx"));

  it("decides on the raw copy, not on whether the note is new", () => {
    // `mode === "eml" && res.created` skipped the whole point of the action
    // the second time a message was captured — and the toast said only that
    // the note already existed.
    expect(text, "the .eml must not hang on res.created").not.toMatch(/mode === "eml" && res\.created/);
    expect(text).toMatch(/if \(mode === "eml"\) \{/);
    // Read by the shared linear reader since plan Befunde 24.09., E6 (was an
    // inline `[[….eml]]` pattern, quadratic on a run of "[").
    expect(text, "an already linked raw copy must not be written twice").toMatch(/if \(!hasEmlWikiLink\(existing\)\)/);
  });

  it("says that the raw copy was added", () => {
    expect(text).toMatch(/mail\.emlAdded/);
    for (const lang of LANGS) {
      expect(dict(lang).mail?.emlAdded, `${lang} lacks mail.emlAdded`).toBeTruthy();
    }
  });
});

const LANGS = ["en", "de", "fr", "es", "it", "nl", "pl", "pt-BR", "ja", "zh-CN"] as const;

function dict(lang: string): {
  workspaceSecurity?: Record<string, string>;
  mobile?: Record<string, string>;
  mail?: Record<string, string>;
  database?: Record<string, string>;
  inputRejected?: Record<string, string>;
  graph?: Record<string, string>;
  editor?: Record<string, string>;
} {
  return JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), "utf8")) as never;
}
