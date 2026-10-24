import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { counted, pairsWithoutEntry, readsAndWrites } from "../../../packages/core/test/helpers/readChangeWrite";

/**
 * Whoever changes a place of a file that exists goes through the ONE entry of
 * the vault's chain — the phone's half (finding 2026-10-12; the desktop's,
 * with the shared package's and what the finding was, is
 * `readChangeWrite.test.ts` there).
 *
 * On the phone that entry is `vaultOps.update(vault, path, change)`: the
 * pending text of an open editor goes to the file first, the chain reads the
 * file inside its gate and writes what `change` makes of it, and the index
 * follows. A shared function is handed `vaultTextFiles(vault)`, which carries
 * it as `updateTextFile` beside the read and the write. What the finding cost
 * is shown, with the phone's own code and real files, in
 * `services/vaultChainWrites.test.ts`.
 *
 * So the two shapes that brought it about are listed here, each with why it
 * may stay: a function that reads a text file and writes a whole text to the
 * same path, and a pair of read and write built to hand on without the entry.
 * A new one turns this red until it is moved or entered with its reason.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

function shipped(): { rel: string; text: string }[] {
  const files: { rel: string; text: string }[] = [];
  (function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) files.push({ rel: relative(SRC, full).replace(/\\/g, "/"), text: readFileSync(full, "utf8") });
    }
  })(SRC);
  return files.sort((a, b) => (a.rel < b.rel ? -1 : 1));
}

const EDITOR_WITHOUT_CHAIN =
  "the note saver's write where the vault's files carry no chain: the editor holds the text it started from, merges against the disk itself and reads back what it wrote. Where there is a chain this is `writeEditorText`, a few lines above";
const NEW_FILE = "a new file: written once and read back to confirm; a file that is there already is compared, never written";
const RESTORE = "gives back a note that was deleted a moment ago: a whole text that was held, to a path where no file is";
const OWN_FILE = "the app's own file, below the chain on purpose (see `rawVaultAdapter.test.ts`): no version, no conflict, never queued";

type Site = [what: string, times: number, why: string];

const SITES: Record<string, Site[]> = {
  "services/pim/pimService.ts": [
    ["a pair of read and write without the entry, in openMeetingNoteFor", 1, "a new meeting note: `resolveOrCreateMeetingNote` finds the note of an appointment or creates it, and never writes one that is there"],
  ],
  "services/pim/taskSyncRuntime.ts": [["a pair of read and write without the entry, in startTaskSyncRuntime", 1, `${RESTORE} (\`initTaskDeletion\`)`]],
  "services/profileImportJournal.ts": [
    ["reads and writes path in copyProfilePreferences", 1, `${OWN_FILE} — \`.plainva/bookmarks.json\`, copied from one vault's storage into another's and read back to confirm`],
  ],
  "services/shareImport.ts": [["reads and writes plan.notePath in runImport", 1, `${NEW_FILE} (the note a share was planned as)`]],
  "services/vaultService.ts": [
    [
      "a pair of read and write without the entry, in createNoteWithContent",
      1,
      "a new note with a text that was made whole (a draft of the assistant, an answer kept as a note): `writeCapturedNote` asks for a name no file has and writes there once — it never writes a file that is there",
    ],
    ['reads and writes ".plainva/recents.json" in forgetRecent', 1, `${OWN_FILE} — "Remove from list" in the Recent list drops one entry`],
    ['reads and writes ".plainva/recents.json" in pushRecent', 1, `${OWN_FILE} — the notes opened last on this device`],
    ["reads and writes path in write", 1, EDITOR_WITHOUT_CHAIN],
  ],
};

describe("a change of a file that exists goes through the chain's one entry", () => {
  it("no function reads a text file and writes it back by itself, and no pair of read and write is handed on without the entry — but where this list says so", () => {
    const found: string[] = [];
    for (const { rel, text } of shipped()) {
      for (const [what, lines] of counted([...readsAndWrites(rel, text), ...pairsWithoutEntry(rel, text)])) found.push(`${rel} — ${what} ×${lines.length}`);
    }
    const listed = Object.entries(SITES).flatMap(([file, sites]) => sites.map(([what, times]) => `${file} — ${what} ×${times}`));
    expect(
      found.sort(),
      "A function reads a text file and writes a whole text back to the same path, or builds a read and a write to hand on " +
        "(or no longer does where this list says). Whoever changes a place of a file that exists calls " +
        "`vaultOps.update(vault, path, change)`: the vault's chain reads the file inside its gate, so the change starts from " +
        "the file as it lies there, and a note with an open conflict keeps the user's own version. A shared function is handed " +
        "`vaultTextFiles(vault)`. For a text that is held or made whole — an editor, a new file — enter the place in SITES " +
        "with why it may stay.",
    ).toEqual(listed.sort());
  });

  it("every entry says why", () => {
    for (const [file, sites] of Object.entries(SITES)) {
      for (const [what, times, why] of sites) {
        expect(times, `${file} — ${what}`).toBeGreaterThan(0);
        expect(why.length, `${file} — ${what} carries no reason`).toBeGreaterThan(20);
      }
    }
  });

  it("the phone's one way is the chain's entry, with the editor's pending text landed first and the index following", () => {
    const service = readFileSync(join(SRC, "services/vaultService.ts"), "utf8");
    const update = /\n {2}async update\(v: MobileVault, path: string, change: TextChange\): Promise<TextFileUpdate> \{\n([\s\S]*?)\n {2}\},\n/.exec(service)?.[1];
    expect(update, "vaultOps.update moved — re-point this guard").toBeDefined();
    const flush = update!.indexOf("await noteSaver.flush(path, v);");
    const entry = update!.indexOf("await updateVaultText(v.files, path, change);");
    const index = update!.indexOf("await v.reindexPaths(written);");
    expect(flush).toBeGreaterThanOrEqual(0);
    expect(entry).toBeGreaterThan(flush);
    expect(index).toBeGreaterThan(entry);
    // What the shared functions are handed carries it.
    expect(service).toContain("updateTextFile: (path, change) => vaultOps.update(v, path, change),");
  });
});
