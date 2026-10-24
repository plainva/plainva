import { describe, expect, it } from "vitest";
import { ConflictAwareVaultAdapter } from "@plainva/core";
import { shippedSources, sourceFile } from "./test-sourceTree";
import { counted, pairsWithoutEntry, readsAndWrites } from "../../../packages/core/test/helpers/readChangeWrite";

/**
 * Whoever changes a place of a file that exists goes through the ONE entry of
 * the vault's chain — the desktop's half and the shared package's (finding
 * 2026-10-12; the phone's is `readChangeWrite.test.ts` there).
 *
 * A cell of a database, a value set across a selection, a task's box, a link
 * rewritten after a rename, a line of the journal: each of them read the note
 * through the chain, changed a place and handed the chain the whole text
 * (`writeTextFile`). The chain was not told that the writer had just read the
 * file, and judged it like an editor that had held an old text. Two things
 * followed, both shown with the shells' own code in
 * `readChangeWriteChain.test.ts`: at a note with an open conflict the text went
 * in place of the user's own version — what was typed here was gone, and the
 * write was reported as failed —, and a note somebody else had changed was
 * refused with a conflict copy, although the writer had read exactly what
 * stood on disk.
 *
 * `updateVaultText(files, path, change)` is that entry: the chain reads the
 * file inside the gate it holds for the path and writes what `change` makes of
 * it — no merge, no conflict copy, and a note with an open conflict takes the
 * change in the user's own version as well. So the two shapes that brought the
 * finding about are listed here, each with why it may stay:
 *
 *   - a function that reads a text file and writes a whole text to the same
 *     path — an editor that holds a base text, a new file read back, a file
 *     that is generated whole;
 *   - a pair of read and write built to hand on, without the entry — whoever
 *     is handed it can only read and write.
 *
 * A new one turns this red until it is moved onto the entry or entered with
 * its reason. What this does NOT see: a read and a write that name their path
 * differently, and a write made through somebody else's function.
 */

const TREES = ["packages/ui/src", "apps/desktop/src"];

const EDITOR_WITHOUT_CHAIN =
  "an editor's save where the vault's files carry no chain: the editor holds the text it started from, merges against the disk itself and reads back what it wrote. Where there is a chain this is `writeEditorText`, three lines above";
const EDITOR_TEXT =
  "the text an editor holds, handed back to the user whole (the managed marker of an overview removed); the read is for the shape its file has. A whole text without a starting text: at an open conflict the chain refuses it unless the working copy is such a text itself";
const NEW_FILE = "a new file: the read asks whether it is there already (or reads back what was just written), and a file that is there is never written";
const GENERATED =
  "a file that is generated whole from the folder's contents; the read only decides whether it may be replaced (a managed overview) or is left alone. Moved onto the entry it would generate the user's own version of an open conflict anew as well";
const NO_CHAIN_FALLBACK = "the storage without a chain (a test's double): a shell with a vault brings `update`, and then this is not reached";
const RESTORE = "gives back a note that was deleted a moment ago: a whole text that was held, to a path where no file is";
const APP_DATA =
  "the app's own data on this device (`AiFileStore`), outside the vault: no chain, no sync, no conflict. One lane in front of the read and the write keeps two entries that arrive together from losing one";

type Site = [what: string, times: number, why: string];

const SITES: Record<string, Site[]> = {
  "apps/desktop/src/ai/routineSessionHarness.ts": [["a pair of read and write without the entry, in write", 1, `${NEW_FILE} (a test's stand-in for the shell's capture: the note a routine leaves)`]],
  "packages/ui/src/ai/acpStores.ts": [["reads and writes path in run", 1, `${APP_DATA} (the log of an external agent's sessions)`]],
  "packages/ui/src/ai/mcpStores.ts": [["reads and writes audit in run", 1, `${APP_DATA} (what foreign MCP servers were asked)`]],
  "packages/ui/src/base/pinboardEntry.ts": [["reads and writes draft.path in endPinboardEntry", 1, NO_CHAIN_FALLBACK]],
  "packages/ui/src/lib/indexMdGenerate.ts": [["reads and writes indexPath in generateIndexForFolder", 1, GENERATED]],
  "packages/ui/src/lib/taskRecurrence.ts": [["reads and writes plan.path in writeNextOccurrenceNote", 1, `${NEW_FILE} (the next occurrence of a repeating task)`]],
  "packages/ui/src/mail/mailCapture.ts": [["reads and writes path in captureMailAsNote", 1, `${NEW_FILE} (a mail filed as a note; a note of that name is read to see whether it is this mail)`]],
  "apps/desktop/src/components/Editor.tsx": [
    ["reads and writes activePath in unlockManagedIndex", 1, EDITOR_TEXT],
    ["reads and writes path in persistText (callback)", 1, EDITOR_WITHOUT_CHAIN],
    ["reads and writes to in carryAndFollow (callback)", 1, EDITOR_WITHOUT_CHAIN],
  ],
  "apps/desktop/src/components/base/useBaseCells.tsx": [["reads and writes path in createRelationTarget", 1, `${NEW_FILE} (the note a relation cell creates for a name typed there)`]],
  "apps/desktop/src/contexts/VaultContext.tsx": [["a pair of read and write without the entry, in loadVault", 1, `${RESTORE} (\`initTaskDeletion\`)`]],
};

describe("a change of a file that exists goes through the chain's one entry", () => {
  it("no function reads a text file and writes it back by itself, and no pair of read and write is handed on without the entry — but where this list says so", () => {
    const found: string[] = [];
    for (const { rel, text } of shippedSources(TREES)) {
      for (const [what, lines] of counted([...readsAndWrites(rel, text), ...pairsWithoutEntry(rel, text)])) found.push(`${rel} — ${what} ×${lines.length}`);
    }
    const listed = Object.entries(SITES).flatMap(([file, sites]) => sites.map(([what, times]) => `${file} — ${what} ×${times}`));
    expect(
      found.sort(),
      "A function reads a text file and writes a whole text back to the same path, or builds a read and a write to hand on " +
        "(or no longer does where this list says). Whoever changes a place of a file that exists calls " +
        "`updateVaultText(files, path, change)`: the vault's chain reads the file inside its gate, so the change starts from " +
        "the file as it lies there, and a note with an open conflict keeps the user's own version. A pair that is handed to a " +
        "shared function carries `updateTextFile` beside its read and write. For a text that is held or made whole — an " +
        "editor, a new file, a generated one — enter the place in SITES with why it may stay.",
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

  it("the chain's top carries the entry, and so does what stands for it in a window beside the main one", () => {
    expect(typeof ConflictAwareVaultAdapter.prototype.updateTextFile).toBe("function");
    // Read from the source: the class reaches for the window bus when it is loaded.
    const remote = sourceFile("apps/desktop/src/adapters/RemoteVaultAdapter.ts");
    expect(remote).toContain("\n  async updateTextFile(path: string, change: TextChange): Promise<TextFileUpdate> {");
    // The two halves it is made of are requests the owner's window serves for the vault they name.
    const bus = sourceFile("apps/desktop/src/services/windowBus.ts");
    for (const kind of ["update-read", "update-write"]) expect(bus, kind).toContain(`"${kind}": "vault",`);
    const owner = sourceFile("apps/desktop/src/services/ownerBus.ts");
    for (const kind of ["update-read", "update-write"]) expect(owner, kind).toContain(`bus.handle("${kind}",`);
  });
});
