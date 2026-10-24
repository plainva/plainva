import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import { FILES_IN_ANOTHER_ENCODING, REPLACEMENT_BYTES, contains, lossy, lossyText, sha256, utf8, vaultWith, type Reader } from "./helpers/textReaders.js";
import { BackupVaultAdapter } from "../src/vault/BackupVaultAdapter.js";
import { QueueingVaultAdapter } from "../src/vault/QueueingVaultAdapter.js";
import { ConflictAwareVaultAdapter, ConflictError, OpenConflictError } from "../src/vault/ConflictAwareVaultAdapter.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VersionHistoryService } from "../src/vault/VersionHistoryService.js";
import { updateVaultText } from "../src/vault/updateText.js";
import { seeConflictCopy, settleConflictCopy } from "../src/vault/conflictCopy.js";
import { SyncQueue } from "../src/sync/SyncQueue.js";
import {
  NOT_TEXT_FILE_MESSAGE, NotTextFileError, copyFileContent, fileSha256, fileVersionOfBytes, isNotTextFileError, readExactText,
  readLocalFile, readLocalText, writeFileVersion,
} from "../src/vault/localText.js";

/**
 * A text file whose content is not UTF-8, inside the app.
 *
 * A `.csv` that Excel saved in Windows-1252, a `.txt` a Windows tool wrote in
 * UTF-16, a note from an old program: text by its name, and by its bytes
 * something a UTF-8 decoder can only replace. The sync carries such a file
 * byte for byte (`non-utf8-text-sync.test.ts`). The app went by the name alone
 * (finding 2026-10-11), and what that meant hung on the platform's text
 * reader. Where the reader replaces what is not UTF-8, an editor opened the
 * file with replacement characters and its first save wrote that reading over
 * the file — `Grün`, `47 72 FC 6E`, became `47 72 EF BF BD 6E` —, the version
 * kept before that save was the reading too, a version restored from the
 * history came back as its reading, and a duplicate was one. Where the reader
 * refuses, each of those ended in a raw error, and a restore in nothing.
 *
 * The rule now, the one the sync has: a file is text when its name says so AND
 * its bytes are UTF-8. The app's adapter chain hands out a file's text or
 * refuses the file, writes no text over a file it could not read as one, and
 * whatever means to keep or replace such a file goes by its bytes.
 *
 * Everything here is the real core — the adapter chain the shells build, the
 * indexer, the version history, real SQLite and real folders on disk. The
 * assertions read BYTES. Every case runs with the two kinds of text reader the
 * platforms have (`helpers/textReaders.ts`).
 */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (closers.length > 0) await closers.pop()!();
});

async function device(reader: Reader) {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-not-text-"));
  const db = await realSqlite();
  closers.push(async () => {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const raw = vaultWith(reader, root);
  await raw.initialize();
  // Every write keeps a version: what the history holds is part of every case.
  // (So a write that replaces a file keeps the old state once more, beside the
  // version a restore asked for by name.) The clock gives each its own name.
  const snapshotFailures: string[] = [];
  let clock = 1_760_000_000_000;
  const backup = new BackupVaultAdapter(raw, { policy: { minSnapshotIntervalSeconds: 0 }, now: () => (clock += 1000), onBackupError: (p) => void snapshotFailures.push(p) });
  const queue = new SyncQueue(db);
  const repo = new SyncStateRepository(db);
  const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo);
  const indexer = new VaultIndexer(app, db, { isOwnWrite: (p, sha) => app.wasWrittenByUs(p, sha) });
  const file = (p: string) => path.join(root, p);
  return {
    /** The storage itself, with the platform's text reader. */
    raw,
    /** The adapter chain both shells hand out as "the vault". */
    app,
    /** The layer below it, through which the sync writes. */
    backup,
    /** The version history as the phone opens it (over the storage) and as the desktop does (over the chain). */
    histories: [new VersionHistoryService(raw), new VersionHistoryService(app)] as const,
    history: new VersionHistoryService(raw),
    snapshotFailures,
    /** Another program writes the file: exactly these bytes, past the app. */
    async put(p: string, bytes: readonly number[]) {
      await fs.mkdir(path.dirname(file(p)), { recursive: true });
      await fs.writeFile(file(p), new Uint8Array(bytes));
    },
    /** What the shell does when a file appeared or changed: the index looks at it. */
    async index() { await indexer.indexVaultFull(); },
    async bytes(p: string) { return [...await fs.readFile(file(p))]; },
    async files() { return (await fs.readdir(root)).filter((name) => !name.startsWith(".")).sort(); },
    /** The versions of a file in the root of the vault that the history holds, oldest first. */
    async snapshots(p: string) {
      const names = (await fs.readdir(path.join(root, ".plainva", "backups")).catch(() => [] as string[]))
        .filter((name) => name.startsWith(`${p}.`) && name.endsWith(".bak")).sort();
      return Promise.all(names.map(async (name) => [...await fs.readFile(path.join(root, ".plainva", "backups", name))]));
    },
    async marker(p: string) {
      return (await db.queryOne<{ local_sha256: string | null }>("SELECT local_sha256 FROM sync_state WHERE path = ?", [p]))?.local_sha256 ?? null;
    },
    async waiting() {
      return (await db.query<{ file_path: string; operation: string }>("SELECT file_path, operation FROM offline_queue ORDER BY id"))
        .map((op) => `${op.operation} ${op.file_path}`);
    },
  };
}

/** A vault that holds the file, known to the index — as after a pull. */
async function vaultHolding(reader: Reader, p: string, content: readonly number[]) {
  const d = await device(reader);
  await d.put(p, content);
  await d.index();
  return d;
}

const refusal = async (work: Promise<unknown>) => {
  const error = await work.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(NotTextFileError);
  return error as NotTextFileError;
};

for (const reader of ["replaces", "refuses"] as const) {
  describe(`a text file that is not UTF-8, in the app — a text reader that ${reader} such bytes`, () => {
    for (const file of FILES_IN_ANOTHER_ENCODING) {
      const first = [...file.first], other = [...file.other], asUtf8 = [...file.asUtf8];
      const copyName = file.path.replace(/(\.[^.]+)$/, " copy$1");

      it(`${file.what}: the vault hands out no text for it, and opening it leaves it as it lies there`, async () => {
        // The premise: a decoder cannot give these bytes back.
        expect(lossy(first)).not.toEqual(first);
        const d = await vaultHolding(reader, file.path, first);

        const error = await refusal(d.app.readTextFile(file.path));
        expect(error.path).toBe(file.path);
        expect(error.code).toBe("NOT_TEXT_FILE");
        // Opening a file records what the app knows of it: the hash of its bytes.
        await d.app.acknowledgeExternalUpdate(file.path);
        expect(await d.marker(file.path)).toBe(await sha256(first));

        expect(await d.bytes(file.path)).toEqual(first);
        expect(await d.snapshots(file.path)).toEqual([]);
        expect(await d.files()).toEqual([file.path]);
        expect(await d.waiting()).toEqual([]);
      });

      it(`${file.what}: no save and no writer beside the editor writes over it — nothing is written, kept as a version or queued`, async () => {
        const d = await vaultHolding(reader, file.path, first);
        // What an editor on a platform whose reader replaces held for the file.
        const held = lossyText(first);

        // The editor's save, with the text it started from…
        await refusal(d.app.writeEditorText(file.path, `${held}new line\r\n`, held));
        // …and without one.
        await refusal(d.app.writeEditorText(file.path, `${held}new line\r\n`, null));
        // A property, a link a rename rewrites, a line the journal appends —
        // through the chain's one entry for read, change, write…
        await refusal(d.app.updateTextFile(file.path, (text) => text.replace("offen", "fertig")));
        await refusal(updateVaultText(d.app, file.path, (text) => `${text}more\r\n`));
        await refusal(d.app.readTextFileState(file.path));
        // …and on the files below the chain, where no chain is open over them.
        await refusal(updateVaultText(d.raw, file.path, (text) => `${text}more\r\n`));
        // …and by hand: read, change, write.
        await refusal((async () => d.app.writeTextFile(file.path, (await d.app.readTextFile(file.path)).replace("offen", "fertig")))());
        // A writer that does not look first.
        await refusal(d.app.writeTextFile(file.path, "brand new\n"));
        // An editor's unsaved text beside a file that changed under it.
        await refusal(d.app.preserveConflict(file.path, `${held}typed\r\n`, "editor-external"));

        expect(await d.bytes(file.path)).toEqual(first);
        expect(contains(await d.bytes(file.path), REPLACEMENT_BYTES)).toBe(false);
        // No version of a text that never was the file, no conflict copy, no upload.
        expect(await d.snapshots(file.path)).toEqual([]);
        expect(await d.files()).toEqual([file.path]);
        expect(await d.app.listConflictSessions()).toEqual([]);
        expect(await d.waiting()).toEqual([]);
        expect(d.snapshotFailures).toEqual([]);
      });

      it(`${file.what}: a version of it is kept and comes back byte for byte`, async () => {
        const d = await vaultHolding(reader, file.path, first);
        // A version, as a deletion or a restore keeps one.
        await d.backup.forceBackup(file.path);
        expect(await d.snapshots(file.path)).toEqual([first]);
        // Another program changed the file since.
        await d.put(file.path, other);
        await d.index();

        for (const history of d.histories) {
          const [version] = (await history.listVersions(file.path)).slice(-1);
          // Nothing of it is shown as text…
          await refusal(history.readVersionText(version!.backupPath));
          expect([...await history.readVersionBinary(version!.backupPath)]).toEqual(first);
        }
        // …and it goes back as it was. What it replaces is kept first, as it was.
        const [oldest] = (await d.history.listVersions(file.path)).slice(-1);
        await d.history.restoreVersion({
          backupPath: oldest!.backupPath, targetPath: file.path, writeAdapter: d.app,
          beforeWrite: () => d.backup.forceBackup(file.path),
        });
        expect(await d.bytes(file.path)).toEqual(first);
        // Every version in the history is a state the file had, never a reading of one.
        const kept = await d.snapshots(file.path);
        expect(kept[0]).toEqual(first);
        expect(kept).toContainEqual(other);
        for (const version of kept) expect([first, other]).toContainEqual(version);

        // As a copy beside the file: the same bytes under another name.
        await d.history.restoreVersion({ backupPath: oldest!.backupPath, targetPath: copyName, writeAdapter: d.app });
        expect(await d.bytes(copyName)).toEqual(first);
        expect(await d.bytes(file.path)).toEqual(first);
        expect(d.snapshotFailures).toEqual([]);
      });

      it(`${file.what}: a UTF-8 version from the history replaces it byte for byte, and what it replaces is kept`, async () => {
        // The file was UTF-8 once, and an edit in the app kept that version.
        const d = await vaultHolding(reader, file.path, asUtf8);
        const edited = `${new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(asUtf8))}edited in the app\r\n`;
        await d.app.writeTextFile(file.path, edited);
        expect(await d.snapshots(file.path)).toEqual([asUtf8]);
        // Then another program saved it in the other encoding.
        await d.put(file.path, first);
        await d.index();
        await refusal(d.app.readTextFile(file.path));

        const [oldest] = (await d.history.listVersions(file.path)).slice(-1);
        expect(await d.history.readVersionText(oldest!.backupPath)).toBe(new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(asUtf8)));
        await d.history.restoreVersion({
          backupPath: oldest!.backupPath, targetPath: file.path, writeAdapter: d.app,
          beforeWrite: () => d.backup.forceBackup(file.path),
        });
        expect(await d.bytes(file.path)).toEqual(asUtf8);
        // The file in the other encoding is in the history, not its reading.
        const kept = await d.snapshots(file.path);
        expect(kept[0]).toEqual(asUtf8);
        expect(kept).toContainEqual(first);
        for (const version of kept) expect([asUtf8, first]).toContainEqual(version);
        // It is a text file again: the vault reads it.
        expect(await d.app.readTextFile(file.path)).toBe(new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array(asUtf8)));
      });

      it(`${file.what}: the version kept before a text is written over it below the app is the file`, async () => {
        // The sync writes below the app's chain. It asks before it writes a
        // text over such a file; the layer that keeps versions does not rely
        // on that.
        const d = await vaultHolding(reader, file.path, first);
        await d.backup.writeTextFile(file.path, "a text version\n");
        expect(await d.snapshots(file.path)).toEqual([first]);
        expect(d.snapshotFailures).toEqual([]);
      });

      it(`${file.what}: a duplicate holds the same bytes`, async () => {
        const d = await vaultHolding(reader, file.path, first);
        await copyFileContent(d.app, file.path, copyName);
        expect(await d.bytes(copyName)).toEqual(first);
        expect(await d.bytes(file.path)).toEqual(first);
        expect(await d.files()).toEqual([file.path, copyName].sort());
      });

      it(`${file.what}: read through the vault for its hash, its bytes are read once`, async () => {
        const d = await vaultHolding(reader, file.path, first);
        // The app's reads of the bytes, below its chain (a reader that refuses
        // reads them as well, inside its own text read, to refuse them).
        const bytes = vi.spyOn(d.backup, "readBinaryFile");
        expect(await readLocalText(d.app, file.path)).toMatchObject({ exact: false, sha256: await sha256(first) });
        // The vault's refusal read them; whoever goes on byte for byte takes them from it.
        expect(bytes).toHaveBeenCalledTimes(1);
        const refused = await refusal(d.app.readTextFile(file.path));
        expect([...refused.bytes!]).toEqual(first);
        expect(Object.keys(refused)).not.toContain("bytes");
      });

      it(`${file.what}: the copy a sync left beside it takes its place byte for byte, and the file it replaces is kept`, async () => {
        const d = await vaultHolding(reader, file.path, first);
        const copy = file.path.replace(/(\.[^.]+)$/, ".CONFLICT-2026-10-11T08-00-00-000Z$1");
        await d.put(copy, other);
        // Both sides as a comparison that shows nothing of them holds them: the bytes they had.
        const seen = await seeConflictCopy(d.app, file.path, copy);
        expect(seen).toEqual({ original: await sha256(first), copy: await sha256(other) });
        expect(await fileSha256(d.app, "No such file.csv")).toBeNull();

        await d.backup.forceBackup(file.path);
        await settleConflictCopy(d.app, file.path, copy, seen, { disposition: "adopt" });
        expect(await d.bytes(file.path)).toEqual(other);
        expect(await d.files()).toEqual([file.path]);
        expect((await d.snapshots(file.path))[0]).toEqual(first);
      });

      it(`${file.what}: the copy a sync left beside it stays as a file of its own, or goes — and nothing is done where either changed since it was seen`, async () => {
        const d = await vaultHolding(reader, file.path, first);
        const copy = file.path.replace(/(\.[^.]+)$/, ".CONFLICT-2026-10-11T08-00-00-000Z$1");
        const kept = file.path.replace(/(\.[^.]+)$/, " (kept)$1");
        await d.put(copy, other);
        const seen = await seeConflictCopy(d.app, file.path, copy);
        // Another program saved the copy again while the question stood.
        await d.put(copy, [...other, 0x0a]);
        await expect(settleConflictCopy(d.app, file.path, copy, seen, { disposition: "discard", keepCopyAs: kept })).rejects.toThrow("comparisonChanged");
        expect(await d.files()).toEqual([file.path, copy].sort());

        await settleConflictCopy(d.app, file.path, copy, await seeConflictCopy(d.app, file.path, copy), { disposition: "discard", keepCopyAs: kept });
        expect(await d.bytes(kept)).toEqual([...other, 0x0a]);
        expect(await d.bytes(file.path)).toEqual(first);
        expect(await d.files()).toEqual([file.path, kept].sort());

        await d.put(copy, other);
        await settleConflictCopy(d.app, file.path, copy, await seeConflictCopy(d.app, file.path, copy), { disposition: "discard" });
        expect(await d.files()).toEqual([file.path, kept].sort());
        expect(await d.bytes(file.path)).toEqual(first);
      });

      it(`${file.what}: an open conflict whose file another program turned into this ends byte for byte, through its own gate`, async () => {
        const d = await vaultHolding(reader, file.path, asUtf8);
        const draft = "my own version\r\n";
        for (const answer of [{ disposition: "adopt" }, { disposition: "discard", keepCopyAs: "kept" }, { disposition: "discard" }] as const) {
          await d.put(file.path, asUtf8);
          // The conflict began while the file was text: the editor's text went to a working copy.
          const session = await d.app.preserveConflict(file.path, draft, "editor-save");
          // Then the other program saved the file in its own encoding.
          await d.put(file.path, first);
          // Nothing writes bytes into either side while the conflict waits for its answer…
          await expect(d.app.writeBinaryFile(file.path, new Uint8Array(other))).rejects.toBeInstanceOf(OpenConflictError);
          await expect(d.app.writeBinaryFile(session.workingCopyPath, new Uint8Array(other))).rejects.toBeInstanceOf(OpenConflictError);
          // …and the working copy is neither moved nor deleted past it.
          await expect(d.app.deleteItem(session.workingCopyPath)).rejects.toBeInstanceOf(ConflictError);
          expect(await d.bytes(file.path)).toEqual(first);

          const seen = await seeConflictCopy(d.app, file.path, session.workingCopyPath);
          expect(seen).toEqual({ original: await sha256(first), copy: await sha256(utf8(draft)) });
          const keepCopyAs = answer.disposition === "discard" && "keepCopyAs" in answer ? file.path.replace(/(\.[^.]+)$/, ` (${answer.keepCopyAs})$1`) : undefined;
          // Changed since the comparison saw it: nothing happens, and the conflict stays.
          await d.put(file.path, other);
          await expect(settleConflictCopy(d.app, file.path, session.workingCopyPath, seen, answer.disposition === "adopt" ? answer : { disposition: "discard", keepCopyAs }))
            .rejects.toThrow("comparisonChanged");
          expect(await d.app.getConflictSession(file.path)).not.toBeNull();

          await d.put(file.path, first);
          await d.backup.forceBackup(file.path);
          await settleConflictCopy(d.app, file.path, session.workingCopyPath, seen, answer.disposition === "adopt" ? answer : { disposition: "discard", keepCopyAs });
          expect(await d.app.getConflictSession(file.path)).toBeNull();
          expect(await d.app.exists(session.workingCopyPath)).toBe(false);
          if (answer.disposition === "adopt") {
            // The person's own version takes the file's place; the file it replaces is kept.
            expect(await d.bytes(file.path)).toEqual(utf8(draft));
            expect((await d.snapshots(file.path)).at(-1)).toEqual(first);
            expect(await d.marker(file.path)).toBe(await sha256(utf8(draft)));
          } else {
            expect(await d.bytes(file.path)).toEqual(first);
            if (keepCopyAs) {
              expect(await d.bytes(keepCopyAs)).toEqual(utf8(draft));
              await d.app.deleteItem(keepCopyAs);
            }
          }
          // With the conflict ended, bytes are written as ever.
          await d.app.writeBinaryFile(file.path, new Uint8Array(first));
        }
      });

      it(`${file.what}: saved as UTF-8 by another program, it is a text file like any other`, async () => {
        const d = await vaultHolding(reader, file.path, first);
        await refusal(d.app.readTextFile(file.path));
        await d.put(file.path, asUtf8);
        await d.index();
        const text = await d.app.readTextFile(file.path);
        expect(utf8(text)).toEqual(asUtf8);
        // Opened in an editor, changed and saved.
        await d.app.acknowledgeExternalUpdate(file.path);
        const saved = await d.app.writeEditorText(file.path, `${text}edited in the app\r\n`, text);
        expect(saved.session).toBeNull();
        expect(await d.bytes(file.path)).toEqual(utf8(`${text}edited in the app\r\n`));
        expect(await d.snapshots(file.path)).toEqual([asUtf8]);
        expect(await d.files()).toEqual([file.path]);
      });
    }

    it("a UTF-8 file that quotes the replacement character is text: read, saved, kept and copied as text", async () => {
      const quoted = `# Encoding\n\nA decoder writes ${String.fromCharCode(0xfffd)} where bytes are not UTF-8.\n`;
      const d = await vaultHolding(reader, "Note.md", utf8(quoted));
      expect(await d.app.readTextFile("Note.md")).toBe(quoted);
      const saved = await d.app.writeEditorText("Note.md", `${quoted}More.\n`, quoted);
      expect(saved.session).toBeNull();
      expect(await d.bytes("Note.md")).toEqual(utf8(`${quoted}More.\n`));
      expect(await d.snapshots("Note.md")).toEqual([utf8(quoted)]);
      await copyFileContent(d.app, "Note.md", "Note copy.md");
      expect(await d.bytes("Note copy.md")).toEqual(utf8(`${quoted}More.\n`));
      // The copy was written as text: the chain remembers it as its own write.
      expect(d.app.wasWrittenByUs("Note copy.md", await sha256(utf8(`${quoted}More.\n`)))).toBe(true);
      const [version] = await d.history.listVersions("Note.md");
      expect(await d.history.readVersionText(version!.backupPath)).toBe(quoted);
    });

    it("a file that is no text by its name is copied and restored without being put through a text reader", async () => {
      const d = await device(reader);
      const image = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe];
      await d.put("Bild.png", image);
      const reads = vi.spyOn(d.raw, "readTextFile");
      await copyFileContent(d.app, "Bild.png", "Bild copy.png");
      expect(await d.bytes("Bild copy.png")).toEqual(image);
      await d.backup.forceBackup("Bild.png");
      await d.put("Bild.png", [1, 2, 3]);
      const [version] = await d.history.listVersions("Bild.png");
      await d.history.restoreVersion({ backupPath: version!.backupPath, targetPath: "Bild.png", writeAdapter: d.app });
      expect(await d.bytes("Bild.png")).toEqual(image);
      expect(reads).not.toHaveBeenCalled();
    });

    it("a file that is missing stays missing: no refusal is made of it", async () => {
      const d = await device(reader);
      await expect(d.app.readTextFile("Gone.md")).rejects.toMatchObject({ name: "VaultFileNotFoundError" });
      await expect(readExactText(d.app, "Gone.md")).rejects.toMatchObject({ name: "VaultFileNotFoundError" });
      // …and a new file is written as ever.
      await d.app.writeTextFile("New.md", "# New\n");
      expect(await d.bytes("New.md")).toEqual(utf8("# New\n"));
    });
  });
}

describe("a conflict copy whose file is gone", () => {
  it("is not let go — nothing would be left — with an open conflict or without", async () => {
    const d = await device("replaces");
    const copy = "Data.CONFLICT-2026-10-11T08-00-00-000Z.csv";
    await d.put(copy, [0x47, 0xfc, 0x6e]);
    const seen = await seeConflictCopy(d.app, "Data.csv", copy);
    expect(seen.original).toBeNull();
    await expect(settleConflictCopy(d.app, "Data.csv", copy, seen, { disposition: "discard" })).rejects.toThrow("original is missing");
    expect(await d.files()).toEqual([copy]);

    // The same for the working copy of an open conflict whose file went.
    await d.put("Note.md", utf8("# Note\n"));
    const session = await d.app.preserveConflict("Note.md", "# My note\n", "editor-save");
    // Gone below the app: another program, a sync.
    await d.raw.deleteItem("Note.md");
    const gone = await seeConflictCopy(d.app, "Note.md", session.workingCopyPath);
    expect(gone.original).toBeNull();
    await expect(settleConflictCopy(d.app, "Note.md", session.workingCopyPath, gone, { disposition: "discard" })).rejects.toThrow("original is missing");
    expect(await d.app.exists(session.workingCopyPath)).toBe(true);
    expect(await d.app.getConflictSession("Note.md")).not.toBeNull();
  });
});

describe("the refusal, and the pieces a version is written with", () => {
  it("is recognised by its class, and by its name, code or message where an error lost its class", () => {
    const error = new NotTextFileError("Data.csv");
    expect(error.message).toBe(NOT_TEXT_FILE_MESSAGE);
    expect(isNotTextFileError(error)).toBe(true);
    // The desktop's window bus hands the failed write of another window on as a message.
    expect(isNotTextFileError(new Error(error.message))).toBe(true);
    expect(isNotTextFileError({ name: "NotTextFileError" })).toBe(true);
    expect(isNotTextFileError({ code: "NOT_TEXT_FILE" })).toBe(true);
    expect(isNotTextFileError(new Error("cannot read text file: stream did not contain valid UTF-8"))).toBe(false);
    expect(isNotTextFileError(null)).toBe(false);
    expect(isNotTextFileError("The file is not text")).toBe(false);
  });

  it("reads the bytes of a file only where the text read could not be taken at its word", async () => {
    const calls: string[] = [];
    const files: Record<string, number[]> = {
      "Plain.md": utf8("plain\n"),
      "Quoted.md": utf8(`quoted ${String.fromCharCode(0xfffd)}\n`),
      "Old.csv": [0x47, 0x72, 0xfc, 0x6e],
    };
    const adapter = {
      readTextFile: async (p: string) => { calls.push(`text ${p}`); return lossyText(files[p]!); },
      readBinaryFile: async (p: string) => { calls.push(`bytes ${p}`); return new Uint8Array(files[p]!); },
    };
    expect(await readLocalFile(adapter, "Plain.md")).toEqual({ text: "plain\n", exact: true, bytes: null });
    expect(await readLocalFile(adapter, "Quoted.md")).toMatchObject({ text: `quoted ${String.fromCharCode(0xfffd)}\n`, exact: true });
    const old = await readLocalFile(adapter, "Old.csv");
    expect(old.exact).toBe(false);
    expect([...old.bytes!]).toEqual(files["Old.csv"]);
    expect(calls).toEqual(["text Plain.md", "text Quoted.md", "bytes Quoted.md", "text Old.csv", "bytes Old.csv"]);
  });

  it("writes a version as text where it is text and its place takes one, and byte for byte everywhere else", async () => {
    const written: string[] = [];
    const taking = {
      writeTextFile: async (p: string) => { written.push(`text ${p}`); },
      writeBinaryFile: async (p: string, bytes: Uint8Array) => { written.push(`bytes ${p} ${[...bytes].join(",")}`); },
    };
    const refusing = { ...taking, writeTextFile: async (p: string) => { throw new NotTextFileError(p); } };
    const text = fileVersionOfBytes(new Uint8Array(utf8("ab")));
    const bytes = fileVersionOfBytes(new Uint8Array([0x47, 0xfc]));
    expect(text).toMatchObject({ text: "ab", exact: true });
    expect(bytes.exact).toBe(false);

    await writeFileVersion(taking, "Note.md", text);
    // Its name does not say text: bytes, whatever they would decode to.
    await writeFileVersion(taking, "Note.bin", text);
    await writeFileVersion(taking, "Data.csv", bytes);
    // What lies there is no text: the version takes its place all the same.
    await writeFileVersion(refusing, "Old.md", text);
    expect(written).toEqual(["text Note.md", "bytes Note.bin 97,98", "bytes Data.csv 71,252", "bytes Old.md 97,98"]);
    // Any other failure of the write is the caller's.
    await expect(writeFileVersion({ ...taking, writeTextFile: async () => { throw new Error("disk full"); } }, "Note.md", text)).rejects.toThrow("disk full");
  });
});
