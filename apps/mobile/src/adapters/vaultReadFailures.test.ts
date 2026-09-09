import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { initializeSchema, SyncEngine, SyncQueue, VaultFileNotFoundError, type IDatabaseAdapter, type ISyncTarget } from "@plainva/core";
import { CapacitorVaultAdapter } from "./CapacitorVaultAdapter";
import { ExternalVaultAdapter } from "./ExternalVaultAdapter";
import type { VaultFolderNative } from "../platform/vaultFolder";

const native = vi.hoisted(() => ({ read: vi.fn(), stat: vi.fn(), mkdir: vi.fn() }));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" }, Encoding: { UTF8: "utf8" },
  Filesystem: {
    readFile: native.read, stat: native.stat, mkdir: native.mkdir,
  },
}));
vi.mock("../platform/atomicFile", () => ({ atomicWriteText: vi.fn(), atomicWriteBase64: vi.fn() }));

const entry = { name: "note.md", isDirectory: false, size: 4, mtime: 1 };
const plugin = { read: native.read, stat: native.stat, mkdir: native.mkdir } as unknown as VaultFolderNative;
const failure = (code: string) => Object.assign(new Error("read unavailable"), { code });

/** Real SQLite, including transactions: the assertion is about retained rows. */
async function database() {
  const sqlite = new DatabaseSync(":memory:");
  const db: IDatabaseAdapter = {
    async initialize() {}, async close() { sqlite.close(); },
    async execute(sql, params = []) { sqlite.prepare(sql).run(...params as never[]); },
    async query<T>(sql: string, params: unknown[] = []) { return sqlite.prepare(sql).all(...params as never[]) as T[]; },
    async queryOne<T>(sql: string, params: unknown[] = []) { return (sqlite.prepare(sql).get(...params as never[]) ?? null) as T | null; },
    async transaction(fn) {
      sqlite.exec("BEGIN");
      try { const result = await fn(); sqlite.exec("COMMIT"); return result; }
      catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  await initializeSchema(db);
  await db.execute("INSERT INTO files(id, path) VALUES ('note', 'note.md')");
  return db;
}

for (const kind of ["sandbox", "external"] as const) {
  const adapter = () => kind === "sandbox" ? new CapacitorVaultAdapter("vault-A") : new ExternalVaultAdapter(plugin, "folder-A");
  const readable = () => {
    native.read.mockResolvedValue(kind === "sandbox" ? { data: btoa("text") } : { dataBase64: btoa("text") });
    native.stat.mockResolvedValue(kind === "sandbox" ? { type: "file", size: 4, mtime: 1 } : { entry });
  };
  describe(`${kind} vault read failures`, () => {
    beforeEach(() => { vi.resetAllMocks(); readable(); });

    it.each(["EACCES", "EIO", "OS-PLUG-FILE-0007", "OS-PLUG-FILE-0013"])("preserves %s on reads and metadata", async (code) => {
      const error = failure(code);
      native.read.mockRejectedValue(error);
      native.stat.mockRejectedValue(error);
      const vault = adapter();
      await expect(vault.readTextFile("note.md")).rejects.toBe(error);
      await expect(vault.readBinaryFile("note.md")).rejects.toBe(error);
      await expect(vault.exists("note.md")).rejects.toBe(error);
      await expect(vault.getFileInfo("note.md")).rejects.toBe(error);
      await expect(vault.renameItem("note.md", "new.md")).rejects.toBe(error);
      await expect(vault.deleteItem("note.md")).rejects.toBe(error);
    });

    it.each(["ENOENT", "OS-PLUG-FILE-0008"])("still recognizes actual absence (%s)", async (code) => {
      native.read.mockRejectedValue(failure(code));
      native.stat.mockRejectedValue(failure(code));
      const vault = adapter();
      await expect(vault.readBinaryFile("gone.md")).rejects.toBeInstanceOf(VaultFileNotFoundError);
      await expect(vault.readTextFile("gone.md")).rejects.toBeInstanceOf(VaultFileNotFoundError);
      expect(await vault.exists("gone.md")).toBe(false);
    });

    it("does not classify invalid bridge content as a missing file", async () => {
      native.read.mockResolvedValue(kind === "sandbox" ? { data: "invalid%" } : { dataBase64: "invalid%" });
      await expect(adapter().readBinaryFile("note.md")).rejects.not.toBeInstanceOf(VaultFileNotFoundError);
    });

    it("retains the upload and its error, then publishes it after access recovers", async () => {
      const db = await database();
      try {
        const queue = new SyncQueue(db);
        const push = vi.fn().mockResolvedValue({ etag: "new" });
        const target: ISyncTarget = { push, pull: async () => ({ etagMap: new Map() }), download: async () => null };
        const engine = new SyncEngine(queue, target, adapter());
        await queue.queueWrite("note.md");
        native.read.mockRejectedValue(failure("EACCES"));
        await engine.processQueue();
        expect(push).not.toHaveBeenCalled();
        expect(await db.queryOne("SELECT retry_count, last_error FROM offline_queue")).toEqual({ retry_count: 1, last_error: "read unavailable" });
        expect(await db.queryOne("SELECT sync_state FROM files WHERE path = 'note.md'")).toEqual({ sync_state: "local_ahead" });
        readable();
        await queue.resetStuckOperations();
        await engine.processQueue();
        expect(push).toHaveBeenCalledOnce();
        expect(new TextDecoder().decode(push.mock.calls[0][0].content)).toBe("text");
        expect(await db.query("SELECT * FROM offline_queue")).toEqual([]);
        expect(await db.queryOne("SELECT sync_state FROM files WHERE path = 'note.md'")).toEqual({ sync_state: "synced" });
      } finally { await db.close(); }
    });
  });
}

describe("sandbox web filesystem errors", () => {
  it.each(["File does not exist.", "Entry does not exist.", "Folder does not exist."])("recognizes the web plugin's exact missing message: %s", async (message) => {
    native.stat.mockRejectedValue(new Error(message));
    expect(await new CapacitorVaultAdapter().exists("gone")).toBe(false);
  });
  it("honors an explicit permission code even if the message mentions absence", async () => {
    const error = Object.assign(new Error("File does not exist."), { code: "EACCES" });
    native.stat.mockRejectedValue(error);
    await expect(new CapacitorVaultAdapter().exists("note.md")).rejects.toBe(error);
  });
  it("only suppresses an already-existing directory, never a failed mkdir", async () => {
    const vault = new CapacitorVaultAdapter();
    native.mkdir.mockRejectedValue(failure("OS-PLUG-FILE-0010"));
    await vault.initialize(); await vault.createDir("notes");
    native.mkdir.mockRejectedValue(new Error("Current directory does already exist."));
    await vault.initialize();
    const error = failure("EACCES");
    native.mkdir.mockRejectedValue(error);
    await expect(vault.initialize()).rejects.toBe(error);
    await expect(vault.createDir("notes")).rejects.toBe(error);
  });
});
