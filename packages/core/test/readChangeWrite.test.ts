import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { counted, pairsWithoutEntry, readsAndWrites } from "./helpers/readChangeWrite.js";

/**
 * The core's half of the guard that keeps every change of a file that exists
 * on the ONE entry of the vault's chain (finding 2026-10-12; the shells'
 * halves are `apps/desktop/src/readChangeWrite.test.ts` and
 * `apps/mobile/src/readChangeWrite.test.ts`, the reasons are written there).
 *
 * The core is where the chain lives, so most of what reads and writes here is
 * the chain itself or a file of the app's own below it. Listed so that a new
 * shared writer that reads a note and hands back the whole text — the shape
 * that lost changes (Sammelplan S3) — turns this red, as it would in a shell.
 *
 * And what the helper sees, against planted examples: since § 3.151 Nr. 1 a
 * read or write by a free function counts like one by a method.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");

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

const CHAIN = "the chain itself, below its entry: this is what `updateTextFile` and the editor's save call into, inside the gate it holds for the path";
const CONFLICT =
  "the conflict machinery of the chain, below its entry: the working copy, a revision kept aside and a resolution are files of the conflict session, written whole and read back to confirm";
const NEW_FILE = "a new file: the read compares a file that is there already (or reads back what was just written), and a file that is there is never written";
const OWN_FILE = "the app's own file in `.plainva`, below the chain on purpose: no version, no conflict, never a note";

type Site = [what: string, times: number, why: string];

const SITES: Record<string, Site[]> = {
  "ai/acp/protocol.ts": [
    ["a pair of read and write without the entry, in acpInitializeParams", 1, "no read and no write: the client's capabilities in the agent protocol's handshake are two flags named `readTextFile` and `writeTextFile`; every file an agent asks for goes through acpFiles.ts and the chain's entry"],
  ],
  "comments/commentMoveJournal.ts": [["reads and writes path in persistCommentMoves (callback)", 1, `${NEW_FILE} (a journal of comment moves)`]],
  "pim/taskNoteIdentity.ts": [["reads and writes path in preserveDisplacedTask", 1, `${NEW_FILE} (the copy of a task note a repair would displace)`]],
  "settingsSync/KeyfileSyncStep.ts": [["reads and writes KEYFILE_SYNC_PATH in run", 1, `${OWN_FILE} — the synced keyfile, taken over whole where the remote one is newer`]],
  "settingsSync/SettingsSyncStep.ts": [["reads and writes path in runPartition", 1, `${OWN_FILE} — a settings profile, merged field by field and written whole`]],
  "textFileShape.ts": [
    ["reads and writes path in writeText", 1, "hands an editor's whole text to the file in the shape the file has (line ends, mark): the read is for the shape only, the text is the editor's"],
  ],
  "vault/ConflictAwareVaultAdapter.ts": [["reads and writes path in writeEditorText (callback)", 1, CHAIN]],
  "vault/conflictCopy.ts": [
    ["reads and writes originalPath in settleConflictText", 1, "a comparison's answer over an adapter without the chain's gate (none the shells hand out): the read checks that the file still is what the person compared, and the text written is the one they chose — through the chain it is `resolveConflict`, one step under its gate (Sammelplan § 3.86 no. 8)"],
  ],
  "vault/ConflictFileStore.ts": [["reads and writes path in write", 1, `${OWN_FILE} — a record of the conflict store, read back to confirm`]],
  "vault/conflictSession.ts": [
    ["reads and writes session.workingCopyPath in recoverDraft", 1, CONFLICT],
    ["reads and writes snapshot in preserveRevision", 1, CONFLICT],
    ["reads and writes session.originalPath in finishResolution", 1, CONFLICT],
  ],
};

describe("a change of a file that exists goes through the chain's one entry — the core", () => {
  it("no function reads a text file and writes it back by itself, and no pair of read and write is handed on without the entry — but where this list says so", () => {
    const found: string[] = [];
    for (const { rel, text } of shipped()) {
      for (const [what, lines] of counted([...readsAndWrites(rel, text), ...pairsWithoutEntry(rel, text)])) found.push(`${rel} — ${what} ×${lines.length}`);
    }
    const listed = Object.entries(SITES).flatMap(([file, sites]) => sites.map(([what, times]) => `${file} — ${what} ×${times}`));
    expect(
      found.sort(),
      "A function reads a text file and writes a whole text back to the same path, or builds a read and a write to hand on. " +
        "A shared function that changes a place of a note takes the vault's files and calls `updateVaultText(files, path, change)`; " +
        "for a file of the chain or the app's own, enter it in SITES with why it may stay.",
    ).toEqual(listed.sort());
    for (const [file, sites] of Object.entries(SITES)) for (const [what, , why] of sites) expect(why.length, `${file} — ${what}`).toBeGreaterThan(20);
  }, 60_000);
});

describe("what the helper sees", () => {
  const seen = (text: string) => readsAndWrites("probe.ts", text).map((finding) => finding.what);

  it("a read and a write by a method", () => {
    expect(seen("async function f(files, path) { const text = await files.readTextFile(path); await files.writeTextFile(path, text + 'x'); }"))
      .toEqual(["reads and writes path in f"]);
  });

  it("a read by a free function — a reader that was handed in — and a write by a method (§ 3.151 Nr. 1)", () => {
    // The shape of the rule of a note and "keep on this device" on the AI harness branch.
    expect(seen("async function keep(read, adapter, path) { const text = await read(path); const next = text.replace('a', 'b'); await adapter.writeTextFile(path, next); }"))
      .toEqual(["reads and writes path in keep"]);
    expect(seen("const keep = async (path) => { const text = await readTextFile(path); await vault.write(path, text.trim()); };"))
      .toEqual(["reads and writes path in keep"]);
  });

  it("a write by a free function, and the vault first in the phone's shape", () => {
    expect(seen("async function f(files, path) { const text = await files.read(path); await writeTextFile(path, text); }")).toEqual(["reads and writes path in f"]);
    expect(seen("async function f(v, path) { const text = await read(v, path); await save(v, path, text + '!'); }")).toEqual(["reads and writes path in f"]);
  });

  it("leaves alone a read and a write of different paths, a read alone, and a nested function's own calls", () => {
    expect(seen("async function f(path, other) { const text = await read(path); await writeTextFile(other, text); }")).toEqual([]);
    expect(seen("async function f(path) { return read(path); }")).toEqual([]);
    expect(seen("async function f(path) { const text = await read(path); return async () => { await writeTextFile(path, text); }; }")).toEqual([]);
  });
});
