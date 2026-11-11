import {
  SyncQueue,
  MemoryWorkspaceStateStore,
  VaultPermissionDeniedError,
  buildVaultChain,
  isNotTextFileError,
  type VaultChainKind,
  type WorkspaceMutationAuthorizer,
} from "@plainva/core";
import { MemoryVaultAdapter } from "../../core/test/helpers/memoryVault";
import { realSqlite } from "../../core/test/helpers/realSqlite";
import { writeEditorSave, KeepBesideFailedError, type EditorSaveInput } from "../src/lib/editorSave";
import { createDraftJournal, type DraftJournalLayout, type DraftJournalStorage } from "../src/lib/draftJournal";

/**
 * The edge states of the one save path (stability plan R6), run by BOTH
 * shells' suites with each shell's own chain settings (`desktop` and `phone`
 * below): the save step both shells call (`writeEditorSave`) over the chain
 * both build (`buildVaultChain`), and the journal both wire. A write path that
 * changes is tested where it is most likely to lose a text: an open conflict,
 * a file that is not there, a permission check of a shared workspace, an open
 * database transaction, an encrypted workspace's queue, a file changed from
 * outside while a save waited, and the app ending between the draft and the
 * file.
 */

export interface ShellChain {
  kind: VaultChainKind;
  deviceId: string;
}

export const DESKTOP_CHAIN: ShellChain = { kind: "external-folder", deviceId: "desktop-a" };
export const PHONE_CHAIN: ShellChain = { kind: "container", deviceId: "phone-a" };

async function vault(shell: ShellChain, workspace?: WorkspaceMutationAuthorizer) {
  const storage = new MemoryVaultAdapter(1_000);
  const db = await realSqlite();
  const queue = new SyncQueue(db);
  const state = workspace ? new MemoryWorkspaceStateStore() : null;
  const chain = buildVaultChain({
    storage,
    deviceId: shell.deviceId,
    index: { db, queue },
    workspace: state && workspace ? { state, authorize: workspace } : null,
    kind: shell.kind,
  });
  const queued = async () => (await db.query<{ operation: string; file_path: string }>("SELECT operation, file_path FROM offline_queue ORDER BY id")).map((row) => `${row.operation} ${row.file_path}`);
  return { storage, db, queue, chain, state, queued };
}

/** An editor's save, as both shells call it: what the editor holds, against what it last agreed on with the file. */
const save = (files: EditorSaveInput["files"], text: string, base: string | null, path = "Note.md") =>
  writeEditorSave({ files, path, text, base, persisted: base, shape: null, kept: null });

class MemoryDrafts implements DraftJournalStorage {
  readonly files = new Map<string, string>();
  async read(file: string) { return this.files.get(file) ?? null; }
  async write(file: string, text: string) { this.files.set(file, text); }
  async remove(file: string) { this.files.delete(file); }
  async list(dir: string) { return [...this.files.keys()].filter((f) => f.startsWith(`${dir}/`)).map((f) => ({ name: f.slice(dir.length + 1), isFile: true, mtimeMs: 0 })); }
}
const draftLayout: DraftJournalLayout<string> = {
  key: (v) => v, file: (v, note) => `${v}/${note}.json`, dirs: (v) => [v], fileIn: (dir, name) => `${dir}/${name}`, owner: (_v, notePath) => ({ notePath }),
};

/**
 * The test runner's `expect`, handed in by the shell's test file: this file
 * lives beside the shared code, outside both shells' test setups.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Expect = (value: unknown, message?: string) => any;

export function saveEdgeStateCases(shell: ShellChain, expect: Expect): Array<[string, () => Promise<void>]> {
  return [
    ["an unchanged text is not written: no version, no queue entry, no write", async () => {
      const { storage, chain, queued } = await vault(shell);
      await storage.writeTextFile("Note.md", "same\n");
      const before = await storage.getFileInfo("Note.md");
      expect(await save(chain.files, "same\n", "same\n")).toEqual({ kind: "unchanged" });
      expect((await storage.getFileInfo("Note.md")).mtime).toBe(before.mtime);
      expect(await queued()).toEqual([]);
    }],

    ["open conflict: the save goes into the working copy, the file keeps the other side's text", async () => {
      const { storage, chain } = await vault(shell);
      await chain.files.writeTextFile("Note.md", "line\n");
      await storage.writeTextFile("Note.md", "theirs\n");
      const first = await save(chain.files, "mine\n", "line\n");
      expect(first.kind).toBe("written");
      const session = first.kind === "written" ? first.session : null;
      expect(session).not.toBeNull();
      // Typing on: still into the working copy, never over the other side's text.
      const second = await save(chain.files, "mine, more\n", "mine\n");
      expect(second.kind === "written" && second.stored).toBe("mine, more\n");
      expect(await storage.readTextFile("Note.md")).toBe("theirs\n");
      expect(await storage.readTextFile(session!.workingCopyPath)).toBe("mine, more\n");
    }],

    ["unknown file: a note that vanished under the editor is not made again at its old place", async () => {
      const { storage, chain, queued } = await vault(shell);
      await chain.files.writeTextFile("Gone.md", "was here\n");
      await storage.deleteItem("Gone.md");
      const before = await queued();
      await expect(save(chain.files, "typed on\n", "was here\n", "Gone.md")).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
      expect(await storage.exists("Gone.md")).toBe(false);
      expect(await queued()).toEqual(before);
    }],

    ["permission check: a member who may not write changes nothing, and nothing is queued", async () => {
      const refuse: WorkspaceMutationAuthorizer = async () => false;
      const { storage, chain, state } = await vault(shell, refuse);
      await storage.writeTextFile("Note.md", "shared\n");
      await expect(save(chain.files, "changed\n", "shared\n")).rejects.toBeInstanceOf(VaultPermissionDeniedError);
      expect(await storage.readTextFile("Note.md")).toBe("shared\n");
      expect(await state!.listQueue()).toEqual([]);
    }],

    ["encrypted workspace: the save lands in the workspace's own queue, not the plain one", async () => {
      const { storage, chain, state, queued } = await vault(shell, async () => true);
      await storage.writeTextFile("Note.md", "one\n");
      const outcome = await save(chain.files, "two\n", "one\n");
      expect(outcome.kind).toBe("written");
      expect(await storage.readTextFile("Note.md")).toBe("two\n");
      expect(await state!.listQueuedPaths()).toEqual(["Note.md"]);
      expect(await queued()).toEqual([]);
    }],

    ["open transaction: a save during another writer's transaction waits for it and is queued after", async () => {
      const { storage, db, chain, queued } = await vault(shell);
      await storage.writeTextFile("Note.md", "one\n");
      let release!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const transaction = db.transaction(async (tx) => {
        await tx.execute("INSERT INTO meta (key, value) VALUES (?, ?)", ["held", "1"]);
        await held;
      });
      const saving = save(chain.files, "two\n", "one\n");
      await new Promise((resolve) => setTimeout(resolve, 20));
      release();
      await transaction;
      expect((await saving).kind).toBe("written");
      expect(await storage.readTextFile("Note.md")).toBe("two\n");
      expect(await queued()).toEqual(["write Note.md"]);
    }],

    ["changed from outside while the save waited: both changes are in the file", async () => {
      const { storage, chain } = await vault(shell);
      await chain.files.writeTextFile("Note.md", "a\nb\nc\n");
      await storage.writeTextFile("Note.md", "a\nb\nC\n");
      const outcome = await save(chain.files, "A\nb\nc\n", "a\nb\nc\n");
      expect(outcome.kind === "written" && outcome.stored).toBe("A\nb\nC\n");
      expect(await storage.readTextFile("Note.md")).toBe("A\nb\nC\n");
    }],

    ["a file that turned into no text is kept beside, into the same copy while typing goes on", async () => {
      const { storage, chain } = await vault(shell);
      await chain.files.writeTextFile("Note.md", "text\n");
      await storage.writeBinaryFile("Note.md", new Uint8Array([0xff, 0xfe, 0x00, 0xd8]));
      const first = await writeEditorSave({ files: chain.files, path: "Note.md", text: "typed\n", base: "text\n", persisted: "text\n", shape: null, kept: null });
      expect(first.kind).toBe("kept-beside");
      const kept = first.kind === "kept-beside" ? first.kept : null;
      expect(await storage.readTextFile(kept!.copy)).toBe("typed\n");
      const second = await writeEditorSave({ files: chain.files, path: "Note.md", text: "typed on\n", base: "text\n", persisted: "typed\n", shape: null, kept });
      expect(second.kind === "kept-beside" && second.kept.copy).toBe(kept!.copy);
      expect(Array.from(await storage.readBinaryFile("Note.md"))).toEqual([0xff, 0xfe, 0x00, 0xd8]);
    }],

    ["a file that is no text and a copy that cannot be written: the save fails and says why, nothing is lost from the editor", async () => {
      const { storage, chain } = await vault(shell);
      await chain.files.writeTextFile("Note.md", "text\n");
      await storage.writeBinaryFile("Note.md", new Uint8Array([0xff, 0xfe, 0x00, 0xd8]));
      const refusing = { ...chain.files, writeEditorText: chain.files.writeEditorText!.bind(chain.files), readTextFile: chain.files.readTextFile.bind(chain.files), exists: chain.files.exists.bind(chain.files),
        updateTextFile: chain.files.updateTextFile!.bind(chain.files), readTextFileState: chain.files.readTextFileState?.bind(chain.files), writeTextFileChange: chain.files.writeTextFileChange?.bind(chain.files),
        writeTextFile: async () => { throw new Error("disk full"); } };
      const failure = await save(refusing, "typed\n", "text\n").catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(KeepBesideFailedError);
      expect(isNotTextFileError((failure as KeepBesideFailedError).notText)).toBe(true);
    }],

    ["the app ends between the draft and the file: the next run offers the typed text", async () => {
      const { storage, chain } = await vault(shell);
      await chain.files.writeTextFile("Note.md", "saved\n");
      const drafts = new MemoryDrafts();
      // The journal took the snapshot; the save of it never came.
      await createDraftJournal<string>({ storage: drafts, layout: draftLayout, runStartedAt: 1 }).record("V", "Note.md", "saved\ntyped\n", 3, "run-1");
      const next = createDraftJournal<string>({ storage: drafts, layout: draftLayout, runStartedAt: Date.now() + 1 });
      const disk = await storage.readTextFile("Note.md");
      expect((await next.offer("V", "Note.md", disk, "run-2"))?.text).toBe("saved\ntyped\n");
      // Restored and saved through the same path, the file holds it.
      const outcome = await save(chain.files, "saved\ntyped\n", disk);
      expect(outcome.kind).toBe("written");
      expect(await storage.readTextFile("Note.md")).toBe("saved\ntyped\n");
    }],
  ];
}
