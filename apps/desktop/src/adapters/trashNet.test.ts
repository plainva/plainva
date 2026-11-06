import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackupVaultAdapter, VaultFileNotFoundError, type IVaultAdapter, type VaultFileInfo } from "@plainva/core";
import { deleteWithNet, registerDeletionNetQuestion, toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { TauriVaultAdapter } from "./TauriVaultAdapter";
import { dialogStore, settleDialog } from "../services/appDialogs";
import { installDeletionNetQuestion } from "../services/deletionNetInstall";

/**
 * The desktop's half of D1 (data-safety plan of 2026-11-06): the system's
 * trash is the net of a deletion. Where it refuses an item — a network share —
 * every file that would go is snapshotted first and only then deleted for
 * good; where that fails too, the same question as on the phone is put, with
 * "Cancel" the safe answer, and only "Delete anyway" deletes.
 */

const native = vi.hoisted(() => ({ trash: vi.fn(), exists: vi.fn() }));
const fs = vi.hoisted(() => ({ remove: vi.fn(), exists: vi.fn(), readFile: vi.fn(), stat: vi.fn(), rename: vi.fn(), mkdir: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {},
  invoke: async (command: string, args: unknown) => {
    if (command === "register_write_root") return "root";
    if (command === "checked_path_exists") return native.exists(args);
    if (command === "move_to_trash") return native.trash(args);
    throw new Error(`Unexpected filesystem command ${command}`);
  },
}));
vi.mock("@tauri-apps/plugin-fs", () => fs);
vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("/"), normalize: async (path: string) => path, sep: () => "/",
}));

describe("the desktop's trash, asked first", () => {
  let warned: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.resetAllMocks();
    native.exists.mockResolvedValue(true);
    fs.remove.mockResolvedValue(undefined);
    warned = vi.spyOn(toast, "warning").mockImplementation(() => 0);
  });
  afterEach(() => warned.mockRestore());

  it("a working trash takes the item and says nothing", async () => {
    const vault = new TauriVaultAdapter("/vault");
    native.trash.mockResolvedValue(undefined);
    await expect(vault.moveToTrash("Notes/a.md")).resolves.toBe(true);
    expect(native.trash).toHaveBeenCalledTimes(1);
    expect(fs.remove).not.toHaveBeenCalled();
    expect(warned).not.toHaveBeenCalled();
  });

  it("a refusing trash leaves the item; the deletion that follows removes it for good without asking the trash again, and says so", async () => {
    const vault = new TauriVaultAdapter("/vault");
    native.trash.mockRejectedValue(new Error("the network share has no recycle bin"));
    await expect(vault.moveToTrash("Share/a.md")).resolves.toBe(false);
    expect(fs.remove).not.toHaveBeenCalled();

    await vault.deleteItem("Share/a.md");

    expect(native.trash).toHaveBeenCalledTimes(1);
    expect(fs.remove).toHaveBeenCalledTimes(1);
    expect(warned).toHaveBeenCalledWith(i18n.t("dialogs.trashUnavailableMsg", { name: "a.md" }));
  });

  it("an item that is gone already counts as trashed", async () => {
    const vault = new TauriVaultAdapter("/vault");
    native.exists.mockResolvedValue(false);
    await expect(vault.moveToTrash("gone.md")).resolves.toBe(true);
    expect(native.trash).not.toHaveBeenCalled();
  });
});

/** A storage like the desktop's: a trash that refuses (a network share), files in memory, snapshots that work or fail. */
function shareStorage(snapshotsWork: boolean) {
  const files = new Map<string, Uint8Array>([["Archiv/R-1.pdf", new Uint8Array([1])], ["Archiv/Sub/R-2.pdf", new Uint8Array([2])]]);
  const info = (path: string, isDirectory: boolean): VaultFileInfo => ({ path, name: path.split("/").pop()!, isDirectory, size: 1, mtime: 1 });
  const deleted: string[] = [];
  const storage: IVaultAdapter = {
    initialize: async () => {}, dispose: async () => {},
    moveToTrash: async () => false,
    getFileInfo: async (path) => {
      if (files.has(path)) return info(path, false);
      if ([...files.keys()].some((p) => p.startsWith(path + "/"))) return info(path, true);
      throw new VaultFileNotFoundError(path);
    },
    listDir: async (path = "") => {
      const out = [...files.keys()].filter((p) => p.startsWith(path + "/") && !p.startsWith(".plainva/")).map((p) => info(p, false));
      if (path.startsWith(".plainva/backups")) return [];
      return out;
    },
    readBinaryFile: async (path) => { const bytes = files.get(path); if (!bytes) throw new VaultFileNotFoundError(path); return bytes; },
    readTextFile: async () => "",
    writeTextFile: async (path) => { if (!snapshotsWork) throw new Error("disk full"); files.set(path, new Uint8Array()); },
    writeBinaryFile: async (path, bytes) => { if (!snapshotsWork && path.startsWith(".plainva/backups")) throw new Error("disk full"); files.set(path, bytes); },
    deleteItem: async (path) => {
      deleted.push(path);
      for (const p of [...files.keys()]) if (p === path || p.startsWith(path + "/")) files.delete(p);
    },
    renameItem: async () => {}, exists: async (path) => files.has(path), createDir: async () => {},
  };
  return { storage, files, deleted };
}

describe("a folder on a share without a trash (D1)", () => {
  beforeEach(() => installDeletionNetQuestion());
  afterEach(() => { dialogStore.clearAll(); registerDeletionNetQuestion(null); });

  it("is snapshotted file by file, then deleted for good — nobody is asked", async () => {
    const { storage, files, deleted } = shareStorage(true);
    const chain = new BackupVaultAdapter(storage, { policy: { minSnapshotIntervalSeconds: 0 } });

    await expect(deleteWithNet(chain, "Archiv", true)).resolves.toBe(true);

    expect(dialogStore.get()).toBeNull();
    expect(deleted).toEqual(["Archiv"]);
    expect([...files.keys()].filter((p) => p.startsWith(".plainva/backups/Archiv/")).length).toBe(2);
  });

  it("where the snapshots fail too, asks — \"Cancel\" keeps the folder, \"Delete anyway\" deletes it", async () => {
    const { storage, files, deleted } = shareStorage(false);
    const chain = new BackupVaultAdapter(storage, { policy: { minSnapshotIntervalSeconds: 0 } });

    const kept = deleteWithNet(chain, "Archiv", true);
    await vi.waitFor(() => expect(dialogStore.get()).not.toBeNull());
    const question = dialogStore.get()!;
    expect(question).toMatchObject({ type: "confirm", kind: "danger", title: i18n.t("backup.deleteWithoutSnapshotTitle"), confirmLabel: i18n.t("backup.deleteAnyway") });
    expect(question.message).toContain(i18n.t("backup.deleteWithoutSnapshotTrashFolder", { failed: 2, total: 2 }));
    expect(question.message).toContain("Archiv/Sub/R-2.pdf");
    settleDialog(question.id, false);
    await expect(kept).resolves.toBe(false);
    expect(deleted).toEqual([]);
    expect(files.has("Archiv/R-1.pdf")).toBe(true);

    const anyway = deleteWithNet(chain, "Archiv", true);
    await vi.waitFor(() => expect(dialogStore.get()).not.toBeNull());
    settleDialog(dialogStore.get()!.id, true);
    await expect(anyway).resolves.toBe(true);
    expect(deleted).toEqual(["Archiv"]);
    expect(files.has("Archiv/R-1.pdf")).toBe(false);
  });

  it("without a registered dialog the answer is no: shared code never deletes without a net unasked", async () => {
    registerDeletionNetQuestion(null);
    const { storage, deleted } = shareStorage(false);
    const chain = new BackupVaultAdapter(storage, { policy: { minSnapshotIntervalSeconds: 0 } });
    await expect(deleteWithNet(chain, "Archiv/R-1.pdf", false)).resolves.toBe(false);
    expect(deleted).toEqual([]);
  });
});
