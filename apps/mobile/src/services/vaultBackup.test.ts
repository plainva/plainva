// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Unzip, UnzipInflate, strFromU8 } from "fflate";
import type { IVaultAdapter } from "@plainva/core";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { CapacitorVaultAdapter } from "../adapters/CapacitorVaultAdapter";
import type { MobileVault } from "./vaultService";

const boundary = vi.hoisted(() => ({
  raw: null as unknown as IVaultAdapter,
  documents: new Map<string, string>(),
  keep: 1,
}));
const missing = () => Object.assign(new Error("missing"), { code: "ENOENT" });
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "android", isNativePlatform: () => false },
  registerPlugin: () => ({}),
}));
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn() } }));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA", Documents: "DOCS", Cache: "CACHE" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    mkdir: vi.fn(async () => {}),
    readdir: vi.fn(async ({ directory, path }: { directory: string; path: string }) => {
      if (directory === "DOCS") return {
        files: [...boundary.documents.keys()].filter((p) => p.startsWith(path + "/")).map((p) => ({ name: p.slice(path.length + 1), type: "file" })),
      };
      const rel = path.replace(/^vault\/?/, "");
      return { files: (await boundary.raw.listDir(rel)).map((e) => ({ ...e, type: e.isDirectory ? "directory" : "file" })) };
    }),
    stat: vi.fn(async ({ path }: { path: string }) => {
      if (boundary.documents.has(path)) return { type: "file", size: atob(boundary.documents.get(path)!).length };
      if ([...boundary.documents.keys()].some((p) => p.startsWith(path + "/"))) return { type: "directory", size: 0 };
      throw missing();
    }),
    readFile: vi.fn(async ({ path, directory }: { path: string; directory: string }) => {
      if (directory === "DOCS") {
        const data = boundary.documents.get(path);
        if (data === undefined) throw missing();
        return { data };
      }
      const bytes = await boundary.raw.readBinaryFile(path.replace(/^vault\/?/, ""));
      return { data: btoa(String.fromCharCode(...bytes)) };
    }),
    writeFile: vi.fn(async ({ path, data }: { path: string; data: string }) => { boundary.documents.set(path, data); }),
    deleteFile: vi.fn(async ({ path }: { path: string }) => { boundary.documents.delete(path); }),
    rename: vi.fn(async ({ from, to }: { from: string; to: string }) => {
      if (!boundary.documents.has(from)) throw missing();
      if (boundary.documents.has(to)) throw new Error("destination exists");
      boundary.documents.set(to, boundary.documents.get(from)!);
      boundary.documents.delete(from);
    }),
  },
}));
vi.mock("@plainva/ui", async () => ({
  ...await import("../../../../packages/ui/src/lib/zipBackup"),
  toast: { warning: vi.fn() },
}));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (key: string, values: { name?: string }) => key + ":" + values.name } }));
vi.mock("./mobileSettings", () => ({ getMobileSettings: () => ({ backupZipEnabled: true, backupZipKeep: boundary.keep }) }));
import { Directory, Filesystem } from "@capacitor/filesystem";
import { toast } from "@plainva/ui";
import { buildZipFileName } from "../../../../packages/ui/src/lib/zipBackup";
import { buildVaultZipBytes } from "./vaultExport";
import { backupIfDue, backupState, runVaultBackup } from "./vaultBackup";

const originalRead = vi.mocked(Filesystem.readFile).getMockImplementation()!;
const originalList = vi.mocked(Filesystem.readdir).getMockImplementation()!;
const originalWrite = vi.mocked(Filesystem.writeFile).getMockImplementation()!;
const originalStat = vi.mocked(Filesystem.stat).getMockImplementation()!;
const originalRename = vi.mocked(Filesystem.rename).getMockImplementation()!;
function resetFilesystem() {
  vi.mocked(Filesystem.readFile).mockReset().mockImplementation(originalRead);
  vi.mocked(Filesystem.readdir).mockReset().mockImplementation(originalList);
  vi.mocked(Filesystem.writeFile).mockReset().mockImplementation(originalWrite);
  vi.mocked(Filesystem.stat).mockReset().mockImplementation(originalStat);
  vi.mocked(Filesystem.rename).mockReset().mockImplementation(originalRename);
}
function readZip(bytes: Uint8Array): Record<string, Uint8Array> {
  const result: Record<string, Uint8Array> = Object.create(null);
  const reader = new Unzip((file) => {
    const chunks: Uint8Array[] = [];
    file.ondata = (error, data, final) => {
      if (error) throw error;
      chunks.push(data);
      if (final) {
        const value = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
        let offset = 0;
        for (const chunk of chunks) { value.set(chunk, offset); offset += chunk.length; }
        result[file.name] = value;
      }
    };
    file.start();
  });
  reader.register(UnzipInflate);
  reader.push(bytes, true);
  return result;
}
let root: string, raw: LocalVaultAdapter, adapter: CapacitorVaultAdapter, vault: MobileVault;
const oldName = "Plainva Backups/Vault/Vault_2026-09-01_10-00-00.zip";
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 9, 15, 0, 0));
  vi.clearAllMocks();
  resetFilesystem();
  localStorage.clear();
  boundary.documents.clear();
  boundary.keep = 1;
  root = await mkdtemp(join(tmpdir(), "plainva-mobile-backup-"));
  raw = new LocalVaultAdapter(root);
  await raw.initialize();
  boundary.raw = raw;
  await raw.writeTextFile("Note.md", "body");
  adapter = new CapacitorVaultAdapter("vault");
  vault = { vaultId: root, adapter } as unknown as MobileVault;
  boundary.documents.set(oldName, btoa("previous complete backup"));
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});
const archive = (data: string) => readZip(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));

describe("complete mobile backup inventory", () => {
  it.each(["mobile", "local"] as const)("includes hidden configuration and prunes excluded directories at every depth (%s)", async (kind) => {
    await raw.writeTextFile(".obsidian/app.json", "{}");
    await raw.writeTextFile(".hidden.md", "hidden");
    await raw.writeTextFile("deep/.obsidian/settings.json", "settings");
    await raw.writeTextFile("deep/.git/config", "exclude git");
    await raw.writeTextFile("deep/node_modules/module.js", "exclude modules");
    await raw.writeTextFile(".plainva/index.db", "exclude index");
    await raw.writeTextFile("__proto__", "ordinary file");
    const result = readZip(await buildVaultZipBytes({ ...vault, adapter: kind === "mobile" ? adapter : raw }));
    expect(Object.keys(result).sort()).toEqual([".hidden.md", ".obsidian/app.json", "Note.md", "__proto__", "deep/.obsidian/settings.json"].sort());
    expect(strFromU8(result[".obsidian/app.json"])).toBe("{}");
    const listingPaths = vi.mocked(Filesystem.readdir).mock.calls.map(([args]) => args.path);
    expect(listingPaths).not.toContain("vault/deep/.git");
    expect(listingPaths).not.toContain("vault/deep/node_modules");
    expect(listingPaths).not.toContain("vault/.plainva");
  });

  it("rejects an adapter that offers only a filtered UI listing", async () => {
    const filtered = { listDir: async () => [] } as unknown as IVaultAdapter;
    await expect(buildVaultZipBytes({ ...vault, adapter: filtered })).rejects.toThrow("Complete backup listing");
  });

  it("does not turn a failed nested directory listing into a partial ZIP", async () => {
    await raw.writeTextFile("deep/file.md", "nested");
    const read = originalList;
    vi.spyOn(Filesystem, "readdir").mockImplementation(async (opts) => {
      if (opts.path === "vault/deep") throw new Error("folder access denied");
      return read(opts);
    });
    await expect(runVaultBackup(vault, "Vault")).rejects.toThrow("folder access denied");
    expect([...boundary.documents.keys()]).toEqual([oldName]);
    expect(backupState(vault.vaultId).lastRun).toBe(0);
  });

  it("keeps prior archives and the previous timestamp when a selected file cannot be read", async () => {
    vi.spyOn(raw, "readBinaryFile").mockRejectedValueOnce(new Error("note unreadable"));
    await expect(runVaultBackup(vault, "Vault")).rejects.toThrow("note unreadable");
    expect([...boundary.documents.keys()]).toEqual([oldName]);
    expect(Filesystem.deleteFile).not.toHaveBeenCalled();
    expect(backupState(vault.vaultId).lastRun).toBe(0);
  });

  it("propagates metadata errors from the strict local backup walker", async () => {
    vi.spyOn(raw, "getFileInfo").mockRejectedValueOnce(new Error("metadata unavailable"));
    await expect(buildVaultZipBytes({ ...vault, adapter: raw })).rejects.toThrow("metadata unavailable");
  });
});

describe("mobile archive publication and retry", () => {
  it.each(["write", "verify", "rename"] as const)("does not rotate or advance lastRun after a %s failure", async (stage) => {
    if (stage === "write") vi.spyOn(Filesystem, "writeFile").mockImplementationOnce(async (opts) => {
      boundary.documents.set(opts.path, btoa("partial"));
      throw new Error("archive write failed");
    });
    if (stage === "verify") {
      const read = originalRead;
      vi.spyOn(Filesystem, "readFile").mockImplementation(async (opts) =>
        opts.directory === Directory.Documents ? { data: btoa("truncated") } : read(opts));
    }
    if (stage === "rename") vi.spyOn(Filesystem, "rename").mockRejectedValueOnce(new Error("rename failed"));
    await expect(runVaultBackup(vault, "Vault")).rejects.toThrow();
    expect([...boundary.documents.keys()]).toEqual([oldName]);
    expect(backupState(vault.vaultId).lastRun).toBe(0);
    vi.restoreAllMocks();
    resetFilesystem();
    const name = await runVaultBackup(vault, "Vault");
    expect(name).toBeTruthy();
    expect(boundary.documents.has(oldName)).toBe(false); // retention only follows the complete retry
    const saved = boundary.documents.get("Plainva Backups/Vault/" + name)!;
    expect(strFromU8(archive(saved)["Note.md"])).toBe("body");
    expect(backupState(vault.vaultId).lastRun).toBe(Date.now());
  });

  it("preserves an existing archive with the same timestamp", async () => {
    boundary.documents.clear();
    boundary.keep = 2;
    const name = buildZipFileName("Vault", new Date());
    const existing = "Plainva Backups/Vault/" + name;
    boundary.documents.set(existing, btoa("earlier archive"));
    const created = await runVaultBackup(vault, "Vault");
    expect(created).toBe(name.slice(0, -4) + "_001.zip");
    expect(boundary.documents.get(existing)).toBe(btoa("earlier archive"));
    expect(boundary.documents.size).toBe(2);
  });

  it("does not interpret a denied destination stat as a free filename", async () => {
    vi.spyOn(Filesystem, "stat").mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "EACCES" }));
    await expect(runVaultBackup(vault, "Vault")).rejects.toThrow("denied");
    expect(Filesystem.writeFile).not.toHaveBeenCalled();
    expect([...boundary.documents.keys()]).toEqual([oldName]);
  });

  it("reports an automatic failure with its vault name and remains due for retry", async () => {
    vi.spyOn(raw, "readBinaryFile").mockRejectedValueOnce(new Error("unreadable"));
    await backupIfDue(vault, "Vault");
    expect(toast.warning).toHaveBeenCalledWith("mobile.backupZipFailed:Vault");
    expect(backupState(vault.vaultId).lastRun).toBe(0);
    await backupIfDue(vault, "Vault");
    expect(backupState(vault.vaultId).lastRun).toBe(Date.now());
  });
});
