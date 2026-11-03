import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "./helpers/realSqlite.js";
import { FILES_IN_ANOTHER_ENCODING, lossy, sha256, utf8, vaultWith, windows1252, type Reader } from "./helpers/textReaders.js";
import { BackupVaultAdapter } from "../src/vault/BackupVaultAdapter.js";
import { QueueingVaultAdapter } from "../src/vault/QueueingVaultAdapter.js";
import { ConflictAwareVaultAdapter, ConflictError } from "../src/vault/ConflictAwareVaultAdapter.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { SyncQueue } from "../src/sync/SyncQueue.js";
import { seeConflictCopy, settleConflictCopy, settleConflictText } from "../src/vault/conflictCopy.js";

/**
 * What was left of Sammelplan § 3.86 after the app learned to ask the bytes
 * of a file whether it is text (the four points numbered 2, 6 and 8 there; 7
 * is the shells' and has its tests there):
 *
 * - no. 2 — a file that is not UTF-8, converted back to UTF-8 by another
 *   program: a writer that read it since writes into it, without a conflict
 *   copy. The sync row now says which version was no text (`not_text_sha256`),
 *   so this is no guess about a row without a base text — and a writer that
 *   holds a reading from before still ends as a conflict copy, not as a silent
 *   loss of what the other program wrote.
 * - no. 6 — the conflict sessions read their working copy and the file by
 *   their bytes: a working copy another program saved in another encoding is
 *   set aside byte for byte, never as a reading, and a session over one does
 *   not stop with a raw error.
 * - no. 8 — a conflict copy without a session is checked and settled in one
 *   step, under the gate every write of the chain takes: a write of the app
 *   that arrives in between waits, and is not overwritten.
 *
 * The real core: the adapter chain both shells build, the indexer, real
 * SQLite and real folders. Every case runs with both kinds of text reader
 * (`helpers/textReaders.ts`), and the assertions read bytes.
 */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (closers.length > 0) await closers.pop()!();
});

async function device(reader: Reader) {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-conflict-rest-"));
  const db = await realSqlite();
  closers.push(async () => {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const raw = vaultWith(reader, root);
  await raw.initialize();
  let clock = 1_760_000_000_000;
  const backup = new BackupVaultAdapter(raw, { policy: { minSnapshotIntervalSeconds: 0 }, now: () => (clock += 1000) });
  const repo = new SyncStateRepository(db);
  const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, new SyncQueue(db)), repo);
  const indexer = new VaultIndexer(app, db, { isOwnWrite: (p, sha) => app.wasWrittenByUs(p, sha) });
  const file = (p: string) => path.join(root, p);
  return {
    raw, app, repo, db,
    /** Another program writes the file: exactly these bytes, past the app. */
    async put(p: string, bytes: readonly number[]) {
      await fs.mkdir(path.dirname(file(p)), { recursive: true });
      await fs.writeFile(file(p), new Uint8Array(bytes));
    },
    async index() { await indexer.indexVaultFull(); },
    async bytes(p: string) { return [...await fs.readFile(file(p))]; },
    async files() { return (await fs.readdir(root)).filter((name) => !name.startsWith(".")).sort(); },
    /** What the sessions set aside under `.plainva/conflict-revisions/`, as bytes. */
    async revisions() {
      const dir = path.join(root, ".plainva", "conflict-revisions");
      const names = await fs.readdir(dir).catch(() => [] as string[]);
      return Promise.all(names.map(async (name) => [...await fs.readFile(path.join(dir, name))]));
    },
    async row(p: string) {
      return db.queryOne<{ local_sha256: string | null; base_text: string | null; not_text_sha256?: string | null }>("SELECT * FROM sync_state WHERE path = ?", [p]);
    },
  };
}

const text = (bytes: readonly number[]) => new TextDecoder().decode(new Uint8Array(bytes));
const conflictCopies = async (d: Awaited<ReturnType<typeof device>>) => (await d.files()).filter((name) => name.includes(".CONFLICT-"));

for (const reader of ["replaces", "refuses"] as const) {
  describe(`§ 3.86 no. 2 — converted back to UTF-8 by another program (a text reader that ${reader})`, () => {
    for (const file of FILES_IN_ANOTHER_ENCODING) {
      const first = [...file.first], asUtf8 = [...file.asUtf8];

      it(`${file.what}: the row says the version it names is no text — set where the file was found so, gone once a text is recorded`, async () => {
        const d = await device(reader);
        await d.put(file.path, first);
        await d.index();
        expect((await d.row(file.path))?.not_text_sha256).toBe(await sha256(first));
        // The sync records a version: no text, and the mark follows; text, and it goes.
        await d.repo.recordSyncedBase(file.path, { sha256: await sha256(first), etag: "e1", text: null, notText: true }, { sha256: await sha256(first) });
        expect((await d.row(file.path))?.not_text_sha256).toBe(await sha256(first));
        await d.repo.recordSyncedBase(file.path, { sha256: await sha256(asUtf8), etag: "e2", text: text(asUtf8) }, { sha256: await sha256(asUtf8) });
        expect((await d.row(file.path))?.not_text_sha256).toBeNull();
        // A version whose bytes were never in hand (a streamed upload) says nothing either way.
        await d.repo.recordSyncedBase(file.path, { sha256: await sha256(first), etag: "e3", text: null });
        expect((await d.row(file.path))?.not_text_sha256).toBeNull();
      });

      it(`${file.what}: a writer that read it after the conversion writes into it — no conflict copy`, async () => {
        const d = await device(reader);
        await d.put(file.path, first);
        await d.index();
        // Another program saves it as UTF-8. No editor opened it since.
        await d.put(file.path, asUtf8);
        const read = await d.app.readTextFile(file.path);
        expect(utf8(read)).toEqual(asUtf8);
        const written = `${read}added in the app\r\n`;
        await d.app.writeTextFile(file.path, written);
        expect(await d.bytes(file.path)).toEqual(utf8(written));
        expect(await conflictCopies(d)).toEqual([]);
        // The row names the version written now, a text: the mark is gone, and the next write is an ordinary one.
        expect((await d.row(file.path))?.local_sha256).toBe(await sha256(utf8(written)));
        expect((await d.row(file.path))?.not_text_sha256 ?? null).toBeNull();
        await d.app.writeTextFile(file.path, `${written}once more\r\n`);
        expect(await d.bytes(file.path)).toEqual(utf8(`${written}once more\r\n`));
        expect(await conflictCopies(d)).toEqual([]);
      });

      it(`${file.what}: a writer that holds a reading from before the file was no text ends as a conflict copy — what the other program wrote stays the file`, async () => {
        const d = await device(reader);
        await d.put(file.path, asUtf8);
        await d.index();
        // A view read the file while it was text, and holds that reading.
        const stale = await d.app.readTextFile(file.path);
        // Another program saved it in its encoding; the app opened it (the "no text" state records its bytes).
        await d.put(file.path, first);
        await d.app.acknowledgeExternalUpdate(file.path);
        expect((await d.row(file.path))?.not_text_sha256).toBe(await sha256(first));
        // Then it converted it back to UTF-8 and changed it.
        const converted = [...asUtf8, ...utf8("from the other program\r\n")];
        await d.put(file.path, converted);
        // Something else reads the file as it is now…
        expect(utf8(await d.app.readTextFile(file.path))).toEqual(converted);
        // …and the view that held the old reading writes it back with a change of its own.
        await expect(d.app.writeTextFile(file.path, `${stale}the view's change\r\n`)).rejects.toBeInstanceOf(ConflictError);
        expect(await d.bytes(file.path)).toEqual(converted);
        expect(await conflictCopies(d)).toHaveLength(1);
      });

      it(`${file.what}: a reading of the converted file that another change outdated since is no licence either`, async () => {
        const d = await device(reader);
        await d.put(file.path, first);
        await d.index();
        await d.put(file.path, asUtf8);
        const read = await d.app.readTextFile(file.path);
        // The other program changes it once more before the writer writes.
        const later = [...asUtf8, ...utf8("later\r\n")];
        await d.put(file.path, later);
        await expect(d.app.writeTextFile(file.path, `${read}the writer's change\r\n`)).rejects.toBeInstanceOf(ConflictError);
        expect(await d.bytes(file.path)).toEqual(later);
      });
    }

    it("a row without a base text for any other reason is not taken for one that was no text: the write ends as a conflict copy, as before", async () => {
      const d = await device(reader);
      const before = utf8("# Note\n\nfirst\n");
      await d.put("Note.md", before);
      await d.index();
      // A streamed upload: the row names the version and holds no text for it.
      await d.repo.recordSyncedBase("Note.md", { sha256: await sha256(before), etag: "e1", text: null }, { sha256: await sha256(before) });
      const after = utf8("# Note\n\nfirst\nchanged by another program\n");
      await d.put("Note.md", after);
      const read = await d.app.readTextFile("Note.md");
      await expect(d.app.writeTextFile("Note.md", `${read}the writer's change\n`)).rejects.toBeInstanceOf(ConflictError);
      expect(await d.bytes("Note.md")).toEqual(after);
    });
  });

  describe(`§ 3.86 no. 6 — the conflict sessions read their files by their bytes (a text reader that ${reader})`, () => {
    it("a working copy another program saved in another encoding is set aside byte for byte, and the draft goes back in", async () => {
      const d = await device(reader);
      await d.put("Note.md", utf8("# Note\n\nthe file\n"));
      await d.index();
      const draft = "# Note\n\nmy own version\n";
      const session = await d.app.preserveConflict("Note.md", draft, "editor-save");
      const foreign = windows1252("# Note\n\nGrüße from another program\n");
      await d.put(session.workingCopyPath, foreign);
      // The next look at the conflict: no raw error, and nothing kept as a reading.
      const again = await d.app.getConflictSession("Note.md");
      expect(again?.workingCopyPath).toBe(session.workingCopyPath);
      const kept = await d.revisions();
      expect(kept).toContainEqual(foreign);
      expect(kept).not.toContainEqual(lossy(foreign));
      expect(await d.bytes(session.workingCopyPath)).toEqual(utf8(draft));
    });

    it("a resolution that was confirmed and not carried out, over a working copy turned into another encoding since: it is not carried out, and the session goes on", async () => {
      const d = await device(reader);
      await d.put("Note.md", utf8("# Note\n\nthe file\n"));
      await d.index();
      const draft = "# Note\n\nmy own version\n";
      const session = await d.app.preserveConflict("Note.md", draft, "editor-save");
      // A resolution confirmed, and the app went before it was carried out.
      const stored = (await d.repo.getConflictSession("Note.md"))!;
      stored.resolution = { content: draft, originalHash: await sha256(utf8("# Note\n\nthe file\n")), copyHash: await sha256(utf8(draft)) };
      await d.repo.saveConflictSession(stored);
      const foreign = windows1252("# Note\n\nGrüße from another program\n");
      await d.put(session.workingCopyPath, foreign);
      // New evidence says the confirmation no longer holds — as for any change
      // since (`conflict-session.test.ts`), not a raw error of the text reader…
      await expect(d.app.getConflictSession("Note.md")).rejects.toThrow("comparisonChanged");
      // …and the next look goes on with the session.
      const again = await d.app.getConflictSession("Note.md");
      expect(again).not.toBeNull();
      expect(again!.resolution).toBeNull();
      expect(await d.bytes("Note.md")).toEqual(utf8("# Note\n\nthe file\n"));
      expect(await d.revisions()).toContainEqual(foreign);
      expect(await d.bytes(session.workingCopyPath)).toEqual(utf8(draft));
    });

    it("the file of the conflict saved in another encoding: the text answer says the comparison changed, not a raw error", async () => {
      const d = await device(reader);
      await d.put("Note.md", utf8("# Note\n\nthe file\n"));
      await d.index();
      const draft = "# Note\n\nmy own version\n";
      await d.app.preserveConflict("Note.md", draft, "editor-save");
      await d.put("Note.md", windows1252("# Note\n\nGrüße\n"));
      await expect(d.app.resolveConflict("Note.md", { originalText: "# Note\n\nthe file\n", copyText: draft, content: draft })).rejects.toThrow("comparisonChanged");
      expect(await d.bytes("Note.md")).toEqual(windows1252("# Note\n\nGrüße\n"));
      expect(await d.app.getConflictSession("Note.md")).not.toBeNull();
    });
  });

  describe(`§ 3.86 no. 8 — a copy without a session is checked and settled in one step (a text reader that ${reader})`, () => {
    /**
     * Fires `write` the moment the settling has read the file to check it —
     * the one place a write of the app could slip in between before.
     */
    function between(d: Awaited<ReturnType<typeof device>>, target: string, write: () => Promise<void>) {
      let fired: Promise<void> | null = null;
      const hook = (original: (p: string) => Promise<unknown>) => async (p: string) => {
        const result = await original(p);
        if (!fired && path.normalize(String(p)).endsWith(path.normalize(target))) fired = write();
        return result;
      };
      const binary = d.raw.readBinaryFile.bind(d.raw), textual = d.raw.readTextFile.bind(d.raw);
      vi.spyOn(d.raw, "readBinaryFile").mockImplementation(hook(binary) as typeof d.raw.readBinaryFile);
      vi.spyOn(d.raw, "readTextFile").mockImplementation(hook(textual) as typeof d.raw.readTextFile);
      return async () => { await fired; };
    }

    it("byte for byte: a write of the app that arrives between the check and the copy taking the file's place lands after it, and is kept", async () => {
      const d = await device(reader);
      const table = windows1252("id;name\r\n1;Grün\r\n");
      const copyBytes = windows1252("id;name\r\n1;Grün\r\n2;Blau\r\n");
      const meanwhile = windows1252("id;name\r\n1;Grün\r\n3;Rot\r\n");
      const copy = "Data.CONFLICT-2026-10-11T08-00-00-000Z.csv";
      await d.put("Data.csv", table);
      await d.put(copy, copyBytes);
      await d.index();
      const seen = await seeConflictCopy(d.app, "Data.csv", copy);
      const landed = between(d, "Data.csv", () => d.app.writeBinaryFile("Data.csv", new Uint8Array(meanwhile)));
      await settleConflictCopy(d.app, "Data.csv", copy, seen, { disposition: "adopt" });
      await landed();
      expect(await d.bytes("Data.csv")).toEqual(meanwhile);
      expect(await d.files()).toEqual(["Data.csv"]);
    });

    it("as text: a write of the app that arrives between the check and the copy's text taking the note's place lands after it, and is kept", async () => {
      const d = await device(reader);
      const note = "# Note\n\nthe note\n";
      const copyText = "# Note\n\nthe copy\n";
      const meanwhile = "# Note\n\nthe note\nwritten meanwhile\n";
      const copy = "Note.CONFLICT-2026-10-11T08-00-00-000Z.md";
      await d.put("Note.md", utf8(note));
      await d.put(copy, utf8(copyText));
      await d.index();
      const landed = between(d, "Note.md", () => d.app.writeTextFile("Note.md", meanwhile));
      await settleConflictText(d.app, "Note.md", copy, { original: note, copy: copyText }, { disposition: "adopt", content: copyText });
      await landed();
      expect(text(await d.bytes("Note.md"))).toBe(meanwhile);
      expect(await d.files()).toEqual(["Note.md"]);
    });

    it("as text: the copy changed between the check and its deletion is not deleted", async () => {
      const d = await device(reader);
      const note = "# Note\n\nthe note\n";
      const copyText = "# Note\n\nthe copy\n";
      const copy = "Note.CONFLICT-2026-10-11T08-00-00-000Z.md";
      await d.put("Note.md", utf8(note));
      await d.put(copy, utf8(copyText));
      await d.index();
      const landed = between(d, copy, () => d.app.writeTextFile(copy, `${copyText}typed into the copy\n`));
      await settleConflictText(d.app, "Note.md", copy, { original: note, copy: copyText }, { disposition: "discard" });
      await landed();
      expect(text(await d.bytes(copy))).toBe(`${copyText}typed into the copy\n`);
    });

    it("as text: each answer checks what it was asked for, keeps both, and refuses the copy's place where a conflict of another copy is open", async () => {
      const d = await device(reader);
      const note = "# Note\n\nthe note\n";
      const copyText = "# Note\n\nthe copy\n";
      const copy = "Note.CONFLICT-2026-10-11T08-00-00-000Z.md";
      await d.put("Note.md", utf8(note));
      await d.put(copy, utf8(copyText));
      await d.index();
      await expect(settleConflictText(d.app, "Note.md", copy, { original: "something else", copy: copyText }, { disposition: "discard" })).rejects.toThrow("comparisonChanged");
      await expect(settleConflictText(d.app, "Note.md", copy, { original: note, copy: "something else" }, { disposition: "discard" })).rejects.toThrow("comparisonChanged");
      await settleConflictText(d.app, "Note.md", copy, { original: note, copy: copyText }, { disposition: "discard", keepCopyAs: "Note (kept).md" });
      expect(await d.files()).toEqual(["Note (kept).md", "Note.md"]);
      expect(text(await d.bytes("Note (kept).md"))).toBe(copyText);

      await d.put(copy, utf8(copyText));
      const session = await d.app.preserveConflict("Note.md", "# Note\n\nmy draft\n", "editor-save");
      expect(session.workingCopyPath).not.toBe(copy);
      await expect(settleConflictText(d.app, "Note.md", copy, { original: note, copy: copyText }, { disposition: "adopt", content: copyText })).rejects.toBeInstanceOf(ConflictError);
      expect(text(await d.bytes("Note.md"))).toBe(note);
    });
  });
}
