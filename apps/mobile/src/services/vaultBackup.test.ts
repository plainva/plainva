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
  enabled: true,
  /** The length of every part the archive was written in, as base64. */
  messages: [] as number[],
  /** A file written in more than one part: its parts, in order. */
  pieces: new Map<string, Uint8Array[]>(),
  /** Files outside Documents, keyed `<directory>:<path>`: the try's mark, the export's file. */
  other: new Map<string, string>(),
  /** A file outside Documents written in more than one part (the archive being made, F56): its parts. */
  otherPieces: new Map<string, Uint8Array[]>(),
}));
const decode = (data: string) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
/** What lies at `<directory>:<path>` outside Documents, as bytes. */
function otherBytes(key: string): Uint8Array | undefined {
  const pieces = boundary.otherPieces.get(key);
  if (pieces) {
    const whole = new Uint8Array(pieces.reduce((n, piece) => n + piece.length, 0));
    let at = 0;
    for (const piece of pieces) { whole.set(piece, at); at += piece.length; }
    return whole;
  }
  const data = boundary.other.get(key);
  return data === undefined ? undefined : decode(data);
}
/** What lies at a path in Documents, as bytes. */
function bytesAt(path: string): Uint8Array | undefined {
  const pieces = boundary.pieces.get(path);
  if (pieces) {
    const whole = new Uint8Array(pieces.reduce((n, piece) => n + piece.length, 0));
    let at = 0;
    for (const piece of pieces) { whole.set(piece, at); at += piece.length; }
    return whole;
  }
  const data = boundary.documents.get(path);
  return data === undefined ? undefined : Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}
// The system's hash of the file where it lies (F51): taken here from the stored bytes.
vi.mock("../platform/atomicFile", async (importOriginal) => ({
  ...await importOriginal<typeof import("../platform/atomicFile")>(),
  // Android writes the archive's parts natively into Documents, with no media scan per part (F56).
  // Kept as the Filesystem plugin's write and append are kept below: the first part whole, the rest as pieces.
  appendDocumentPart: vi.fn(async (path: string, bytes: Uint8Array, first: boolean) => {
    boundary.messages.push(Math.ceil(bytes.length / 3) * 4);
    if (first) {
      let binary = "";
      for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
      boundary.pieces.delete(path);
      boundary.documents.set(path, btoa(binary));
      return;
    }
    if (bytes.length === 0) return;
    const pieces = boundary.pieces.get(path) ?? [Uint8Array.from(atob(boundary.documents.get(path) ?? ""), (c) => c.charCodeAt(0))];
    pieces.push(bytes.slice());
    boundary.pieces.set(path, pieces);
    boundary.documents.set(path, "");
  }),
  scanDocumentFiles: vi.fn(async () => {}),
  nativeFileDigest: vi.fn(async (path: string, directory?: string) => {
    const bytes = directory === "CACHE" ? otherBytes(`CACHE:${path}`) : bytesAt(path);
    if (bytes === undefined) throw Object.assign(new Error("missing"), { code: "OS-PLUG-FILE-0008" });
    const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return { sha256: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""), size: bytes.length };
  }),
}));
const missing = () => Object.assign(new Error("missing"), { code: "ENOENT" });
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "android", isNativePlatform: () => false },
  registerPlugin: () => ({}),
}));
vi.mock("@capacitor/share", () => ({ Share: { share: vi.fn() } }));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA", Documents: "DOCS", Cache: "CACHE", Library: "LIBRARY" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    checkPermissions: vi.fn(async () => ({ publicStorage: "granted" })),
    requestPermissions: vi.fn(async () => ({ publicStorage: "granted" })),
    mkdir: vi.fn(async () => {}),
    getUri: vi.fn(async ({ path }: { path: string }) => ({ uri: path })),
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
      if (directory !== "DOCS" && boundary.other.has(`${directory}:${path}`)) return { data: boundary.other.get(`${directory}:${path}`)! };
      if (directory === "DATA" && path.startsWith("backup/")) throw missing();
      if (directory === "DOCS") {
        const data = boundary.documents.get(path);
        if (data === undefined) throw missing();
        return { data };
      }
      const bytes = await boundary.raw.readBinaryFile(path.replace(/^vault\/?/, ""));
      let binary = "";
      for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
      return { data: btoa(binary) };
    }),
    writeFile: vi.fn(async ({ path, data, directory }: { path: string; data: string; directory: string }) => {
      // The app's own folders (the try's mark, the export's file) are kept apart from Documents.
      boundary.messages.push(data.length);
      if (directory !== "DOCS") { boundary.other.set(`${directory}:${path}`, data); boundary.otherPieces.delete(`${directory}:${path}`); return; }
      boundary.documents.set(path, data);
    }),
    // The archive is written in parts (F51): each part is appended as base64, kept as bytes.
    appendFile: vi.fn(async ({ path, data, directory }: { path: string; data: string; directory: string }) => {
      boundary.messages.push(data.length);
      if (directory !== "DOCS") {
        const key = `${directory}:${path}`;
        const pieces = boundary.otherPieces.get(key) ?? [decode(boundary.other.get(key) ?? "")];
        pieces.push(decode(data));
        boundary.otherPieces.set(key, pieces);
        boundary.other.set(key, "");
        return;
      }
      const pieces = boundary.pieces.get(path) ?? [Uint8Array.from(atob(boundary.documents.get(path) ?? ""), (c) => c.charCodeAt(0))];
      pieces.push(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
      boundary.pieces.set(path, pieces);
      boundary.documents.set(path, "");
    }),
    deleteFile: vi.fn(async ({ path, directory }: { path: string; directory: string }) => {
      if (directory !== "DOCS") { boundary.otherPieces.delete(`${directory}:${path}`); if (!boundary.other.delete(`${directory}:${path}`)) throw missing(); return; }
      boundary.documents.delete(path);
    }),
    // The finished archive into Documents (F56): one native call, no part over the bridge.
    copy: vi.fn(async ({ from, to, directory, toDirectory }: { from: string; to: string; directory: string; toDirectory: string }) => {
      const bytes = otherBytes(`${directory}:${from}`);
      if (bytes === undefined) throw missing();
      if (toDirectory !== "DOCS") throw new Error("only into Documents here");
      let binary = "";
      for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
      boundary.documents.set(to, btoa(binary));
      boundary.pieces.delete(to);
    }),
    rename: vi.fn(async ({ from, to, directory }: { from: string; to: string; directory: string }) => {
      if (directory !== "DOCS") {
        const data = boundary.other.get(`${directory}:${from}`);
        if (data === undefined) throw missing();
        boundary.other.set(`${directory}:${to}`, data);
        boundary.other.delete(`${directory}:${from}`);
        const pieces = boundary.otherPieces.get(`${directory}:${from}`);
        if (pieces) { boundary.otherPieces.set(`${directory}:${to}`, pieces); boundary.otherPieces.delete(`${directory}:${from}`); }
        return;
      }
      if (!boundary.documents.has(from)) throw missing();
      if (boundary.documents.has(to)) throw new Error("destination exists");
      boundary.documents.set(to, boundary.documents.get(from)!);
      boundary.documents.delete(from);
      const pieces = boundary.pieces.get(from);
      if (pieces) { boundary.pieces.set(to, pieces); boundary.pieces.delete(from); }
    }),
  },
}));
vi.mock("@plainva/ui", async () => ({
  ...await import("../../../../packages/ui/src/lib/zipBackup"),
  toast: { warning: vi.fn(), info: vi.fn() },
  reportingTo: () => () => {},
}));
vi.mock("@plainva/ui/i18n", () => ({ default: { t: (key: string, values: { name?: string }) => key + ":" + values.name } }));
vi.mock("./mobileSettings", () => ({ getMobileSettings: () => ({ backupZipEnabled: boundary.enabled, backupZipKeep: boundary.keep }) }));
import { Directory, Filesystem } from "@capacitor/filesystem";
import { toast } from "@plainva/ui";
import { buildZipFileName } from "../../../../packages/ui/src/lib/zipBackup";
import { buildVaultZipBytes } from "./vaultExport";
import { backupIfDue, backupState, backupVaultNow, loadBackupAttempt, readBackupAttempt, runVaultBackup } from "./vaultBackup";
import { appendDocumentPart, nativeFileDigest, scanDocumentFiles } from "../platform/atomicFile";

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
  boundary.enabled = true;
  boundary.messages.length = 0;
  boundary.pieces.clear();
  boundary.otherPieces.clear();
  boundary.other.clear();
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
    if (stage === "write") {
      // The archive's first part fails (written natively on Android, F56); the try's mark is written as always.
      vi.mocked(appendDocumentPart).mockImplementationOnce(async (path) => {
        boundary.documents.set(path, btoa("partial"));
        throw new Error("archive write failed");
      });
    }
    if (stage === "verify") {
      // The system finds a shorter file than was written: a truncated archive.
      vi.mocked(nativeFileDigest).mockResolvedValueOnce({ sha256: "0".repeat(64), size: 3 });
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
    expect(vi.mocked(Filesystem.writeFile).mock.calls.filter(([opts]) => opts.directory === Directory.Documents)).toEqual([]);
    expect([...boundary.documents.keys()]).toEqual([oldName]);
  });

  it("reports an automatic failure with its vault name, and tries again only after the wait (F51)", async () => {
    vi.spyOn(raw, "readBinaryFile").mockRejectedValueOnce(new Error("unreadable"));
    await backupIfDue(vault, "Vault");
    expect(toast.warning).toHaveBeenCalledWith("mobile.backupZipFailed:Vault");
    expect(backupState(vault.vaultId)).toMatchObject({ lastRun: 0, lastFailed: true });
    // The next start, at once: no new try.
    const list = vi.spyOn(adapter, "listDirForBackup");
    await backupIfDue(vault, "Vault");
    expect(list).not.toHaveBeenCalled();
    // A day later it is due again, and a good archive clears the mark.
    vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 + 1000);
    await backupIfDue(vault, "Vault");
    expect(backupState(vault.vaultId)).toMatchObject({ lastRun: Date.now(), lastFailed: false });
  });
});

describe("an archive that never crosses the bridge whole (F51)", () => {
  /** Bytes that do not compress, so the archive is as large as the vault. */
  const noise = (size: number, seed: number) => {
    const bytes = new Uint8Array(size);
    let x = seed * 2654435761 >>> 0;
    for (let i = 0; i < size; i += 1) { x = (x ^ (x << 13)) >>> 0; x = (x ^ (x >>> 17)) >>> 0; x = (x ^ (x << 5)) >>> 0; bytes[i] = x & 0xff; }
    return bytes;
  };

  it("writes a 90 MB archive in parts of at most 512 KB, checks it and publishes it whole", async () => {
    boundary.documents.clear();
    for (let i = 0; i < 30; i += 1) await raw.writeBinaryFile(`Bilder/shot-${i}.png`, noise(3 * 1024 * 1024, i + 1));
    const name = await runVaultBackup(vault, "Vault");
    expect(name).toBeTruthy();
    expect(Math.max(...boundary.messages)).toBeLessThanOrEqual(512 * 1024);
    const saved = bytesAt("Plainva Backups/Vault/" + name)!;
    expect(saved.length).toBeGreaterThan(90 * 1024 * 1024);
    const files = readZip(saved);
    expect(Object.keys(files)).toHaveLength(31);
    expect(files["Bilder/shot-7.png"]).toEqual(noise(3 * 1024 * 1024, 8));
  }, 120_000);

  it("writes the archive's parts into Documents with no media scan each, and indexes it once (F56)", async () => {
    for (let i = 0; i < 4; i += 1) await raw.writeBinaryFile(`Bilder/shot-${i}.png`, noise(512 * 1024, i + 1));
    vi.mocked(Filesystem.writeFile).mockClear();
    vi.mocked(Filesystem.appendFile).mockClear();
    vi.mocked(appendDocumentPart).mockClear();
    vi.mocked(scanDocumentFiles).mockClear();
    const name = await runVaultBackup(vault, "Vault");
    // Every Filesystem write into public Documents is a media scan on Android: none for the archive.
    const intoDocuments = [...vi.mocked(Filesystem.writeFile).mock.calls, ...vi.mocked(Filesystem.appendFile).mock.calls]
      .filter(([opts]) => opts.directory === Directory.Documents);
    expect(intoDocuments.map(([opts]) => opts.path)).toEqual([]);
    const parts = vi.mocked(appendDocumentPart).mock.calls;
    expect(parts.length).toBeGreaterThan(4);
    // Written where it will lie (no copy: the room is taken once); the first part starts the file, only the last syncs.
    expect(parts.every(([path]) => path.startsWith("Plainva Backups/Vault/") && path.endsWith(".part"))).toBe(true);
    expect(parts.map(([, , first]) => first)).toEqual([true, ...parts.slice(1).map(() => false)]);
    expect(parts.map(([, , , last]) => last)).toEqual([...parts.slice(1).map(() => false), true]);
    expect(vi.mocked(Filesystem.copy)).not.toHaveBeenCalled();
    expect(vi.mocked(scanDocumentFiles).mock.calls).toEqual([[["Plainva Backups/Vault/" + name, parts[0]![0]]]]);
    expect(Object.keys(readZip(bytesAt("Plainva Backups/Vault/" + name)!))).toHaveLength(5);
    expect([...boundary.documents.keys()].filter((key) => key.endsWith(".part"))).toEqual([]);
  });

  it("syncs the last part on a thread of its own, not on the plugin thread every call waits on", async () => {
    const { readFileSync } = await import("node:fs");
    const java = readFileSync("android/app/src/main/java/com/plainva/app/AtomicFilePlugin.java", "utf8");
    const method = java.slice(java.indexOf("public void appendDocument("), java.indexOf("public void scanDocuments("));
    expect(method).toMatch(/documentSync\.execute\(\(\) -> \{[\s\S]*getFD\(\)\.sync\(\)/);
    // Outside that thread, no sync at all.
    expect(method.slice(0, method.indexOf("documentSync.execute("))).not.toMatch(/\.sync\(\)/);
  });

  it("on iOS writes as before, through the Filesystem plugin (F56 is Android's)", async () => {
    const { Capacitor } = await import("@capacitor/core");
    const platform = vi.spyOn(Capacitor, "getPlatform").mockReturnValue("ios");
    vi.mocked(appendDocumentPart).mockClear();
    const name = await runVaultBackup(vault, "Vault");
    expect(vi.mocked(appendDocumentPart)).not.toHaveBeenCalled();
    expect(vi.mocked(scanDocumentFiles)).not.toHaveBeenCalled();
    expect(Object.keys(readZip(bytesAt("Plainva Backups/Vault/" + name)!))).toEqual(["Note.md"]);
    platform.mockRestore();
  });

  it("marks the try before it begins, so one that ends the app counts as failed", async () => {
    let seen: ReturnType<typeof readBackupAttempt> = null;
    const read = raw.readBinaryFile.bind(raw);
    vi.spyOn(raw, "readBinaryFile").mockImplementation(async (path) => {
      seen ??= readBackupAttempt(vault.vaultId);
      return read(path);
    });
    await runVaultBackup(vault, "Vault");
    expect(seen).toMatchObject({ failures: 0, inProgress: true });
    // A try ends in a written state, a success too.
    expect(readBackupAttempt(vault.vaultId)).toMatchObject({ failures: 0 });
    expect(readBackupAttempt(vault.vaultId)?.inProgress).toBeUndefined();
  });

  it("stops when it is switched off while it runs, and the part file goes", async () => {
    await raw.writeTextFile("B.md", "second");
    const read = raw.readBinaryFile.bind(raw);
    vi.spyOn(raw, "readBinaryFile").mockImplementation(async (path) => {
      // The person switches the backup off while the first file is read.
      boundary.enabled = false;
      return read(path);
    });
    await backupIfDue(vault, "Vault");
    expect(toast.warning).not.toHaveBeenCalled();
    expect([...boundary.documents.keys()].filter((key) => key.endsWith(".part"))).toEqual([]);
    expect([...boundary.documents.keys()]).toEqual([oldName]);
    expect(backupState(vault.vaultId).lastFailed).toBe(false);
  });

  it("removes a part file an earlier try left, and never counts it as an archive", async () => {
    boundary.documents.set("Plainva Backups/Vault/Vault_2026-09-08_10-00-00.zip.1234.part", btoa("half an archive"));
    const name = await runVaultBackup(vault, "Vault");
    expect(name).toBeTruthy();
    expect([...boundary.documents.keys()].filter((key) => key.endsWith(".part"))).toEqual([]);
    const { listBackups } = await import("./vaultBackup");
    boundary.documents.set("Plainva Backups/Vault/Vault_2026-09-09_09-00-00.zip.5678.part", btoa("another half"));
    expect((await listBackups("Vault", Date.now())).archives.every((entry) => entry.endsWith(".zip"))).toBe(true);
  });

  it("a try that ended the app is not repeated at the next start", async () => {
    // What a killed try leaves: the mark, and no archive.
    localStorage.setItem(`m-backup-zip-attempt-${vault.vaultId}`, JSON.stringify({ at: Date.now(), failures: 1 }));
    const list = vi.spyOn(adapter, "listDirForBackup");
    await backupIfDue(vault, "Vault");
    expect(list).not.toHaveBeenCalled();
    expect(backupState(vault.vaultId).lastFailed).toBe(true);
  });

  it("holds no more than one file's worth, whatever the vault's size: 500 MB through the test adapter", async () => {
    // 125 files of 4 MB each, handed out by the adapter; the archive goes to a counting sink.
    // What is measured is what the page holds between reads: everything the
    // archive made of the files read so far has gone to the sink before the
    // next one is read - so at the last read, all but one file is written out.
    const { streamVaultZip } = await import("./vaultExport");
    const file = noise(4 * 1024 * 1024, 3);
    let written = 0;
    const heldAtRead: number[] = [];
    let read = 0;
    const big = {
      listDirForBackup: async () => Array.from({ length: 125 }, (_, i) => ({ path: `f-${i}.bin`, isDirectory: false })),
      readBinaryFile: async () => {
        // Bytes read so far minus bytes written so far: what is still in the page.
        heldAtRead.push(read * file.length - written);
        read += 1;
        return file.slice();
      },
    };
    await streamVaultZip({ ...vault, adapter: big } as unknown as MobileVault, { write: async (chunk) => { written += chunk.length; } });
    expect(written).toBeGreaterThan(500 * 1024 * 1024);
    // Never more than about one file in the page, at any read: not the 500 MB.
    expect(Math.max(...heldAtRead)).toBeLessThanOrEqual(file.length);
  }, 300_000);
});

describe("the third review: manual runs, states, vanished files, one export at a time", () => {
  it("'back up now' runs when the scheduled backup is switched off", async () => {
    boundary.enabled = false;
    const { backupVaultNow } = await import("./vaultBackup");
    await backupVaultNow(vault, "Vault");
    expect(toast.warning).not.toHaveBeenCalled();
    expect([...boundary.documents.keys()].filter((key) => key.endsWith(".zip") && key !== oldName)).toHaveLength(1);
  });

  it("a file that vanishes during the run is left out, and the run succeeds", async () => {
    await raw.writeTextFile("Gone.md", "soon deleted");
    const read = raw.readBinaryFile.bind(raw);
    vi.spyOn(raw, "readBinaryFile").mockImplementation(async (path) => {
      if (path === "Gone.md") { await raw.deleteItem("Gone.md"); }
      return read(path);
    });
    const name = await runVaultBackup(vault, "Vault");
    expect(name).toBeTruthy();
    expect(Object.keys(archive(boundary.documents.get("Plainva Backups/Vault/" + name)!))).toEqual(["Note.md"]);
    expect(backupState(vault.vaultId).lastFailed).toBe(false);
  });

  it("says the right thing in each of the five states", async () => {
    // never
    expect(backupState(vault.vaultId)).toMatchObject({ lastRun: 0, running: false, lastFailed: false });
    // running - the first try is no failure while it runs
    const read = raw.readBinaryFile.bind(raw);
    let during: ReturnType<typeof backupState> | null = null;
    vi.spyOn(raw, "readBinaryFile").mockImplementation(async (path) => { during ??= backupState(vault.vaultId); return read(path); });
    await runVaultBackup(vault, "Vault");
    expect(during).toMatchObject({ running: true, lastFailed: false });
    // succeeded
    expect(backupState(vault.vaultId)).toMatchObject({ running: false, lastFailed: false, lastRun: Date.now() });
    // failed
    vi.mocked(raw.readBinaryFile).mockRejectedValueOnce(new Error("unreadable"));
    await expect(runVaultBackup(vault, "Vault")).rejects.toThrow("unreadable");
    expect(backupState(vault.vaultId)).toMatchObject({ running: false, lastFailed: true });
    // off
    boundary.enabled = false;
    expect(backupState(vault.vaultId).enabled).toBe(false);
  });

  it("a try found running at the next start ended the app: it counts as failed, durably", async () => {
    // What a killed try leaves: its mark, written with fsync, still running.
    boundary.other.set(`DATA:backup/attempt-${encodeURIComponent(vault.vaultId)}.json`, JSON.stringify({ at: Date.now(), failures: 0, inProgress: true }));
    const list = vi.spyOn(adapter, "listDirForBackup");
    await backupIfDue(vault, "Vault");
    expect(list).not.toHaveBeenCalled();
    expect(backupState(vault.vaultId).lastFailed).toBe(true);
  });

  it("two taps on 'export' share one checked archive", async () => {
    const { exportVault } = await import("./vaultExport");
    const { Share } = await import("@capacitor/share");
    await Promise.all([exportVault(vault, "Vault"), exportVault(vault, "Vault")]);
    expect(Share.share).toHaveBeenCalledTimes(1);
    const files = [...boundary.other.keys()].filter((key) => key.startsWith("CACHE:exports/"));
    expect(files).toHaveLength(1);
    expect(files[0].endsWith(".zip")).toBe(true);
    expect(Object.keys(readZip(Uint8Array.from(atob(boundary.other.get(files[0])!), (c) => c.charCodeAt(0))))).toEqual(["Note.md"]);
  });
});

describe("the third review: one try per vault, the mark is the truth, the export lock", () => {
  const zipsIn = (folder = "Plainva Backups/Vault/") => [...boundary.documents.keys()].filter((key) => key.startsWith(folder) && key.endsWith(".zip") && key !== oldName);

  it("two calls at the same moment make one try and one archive, and neither fails", async () => {
    const [a, b] = await Promise.all([runVaultBackup(vault, "Vault"), runVaultBackup(vault, "Vault")]);
    expect(a).toBeTruthy();
    expect(b).toBe(a);
    expect(zipsIn()).toHaveLength(1);
    expect(backupState(vault.vaultId)).toMatchObject({ running: false, lastFailed: false });
  });

  it("'back up now' beside the automatic try joins it and reports its archive", async () => {
    await Promise.all([backupIfDue(vault, "Vault"), backupVaultNow(vault, "Vault")]);
    expect(toast.warning).not.toHaveBeenCalled();
    expect(vi.mocked(toast.info).mock.calls.map(([text]) => String(text))).toEqual([expect.stringMatching(/^mobile\.backupZipDone/)]);
    expect(zipsIn()).toHaveLength(1);
  });

  it("a read of the mark that answers after the try never puts back 'running'", async () => {
    const read = originalRead;
    let release!: () => void;
    const late = new Promise<void>((resume) => { release = resume; });
    let lateRead: Promise<unknown> | null = null;
    vi.spyOn(Filesystem, "readFile").mockImplementation(async (opts) => {
      const answer = read(opts);
      // The screen asks for the mark while the try runs; its answer comes after the try ended.
      if (opts.path.startsWith("backup/") && boundary.other.has(`DATA:${opts.path}`) && !lateRead) {
        const seen = await answer;
        lateRead = late.then(() => seen);
        return lateRead as never;
      }
      return answer;
    });
    const readVault = raw.readBinaryFile.bind(raw);
    let screen: Promise<unknown> | null = null;
    vi.spyOn(raw, "readBinaryFile").mockImplementation(async (path) => { screen ??= loadBackupAttempt(vault.vaultId); return readVault(path); });
    await runVaultBackup(vault, "Vault");
    release();
    await screen;
    expect(backupState(vault.vaultId)).toMatchObject({ lastFailed: false });
    resetFilesystem();
    // The next start reads the file: a written success, no failure.
    expect((await loadBackupAttempt(vault.vaultId))?.failures).toBe(0);
    expect((await loadBackupAttempt(vault.vaultId))?.inProgress).toBeUndefined();
  });

  it("a try whose mark cannot be written does not start", async () => {
    const write = originalWrite;
    vi.spyOn(Filesystem, "writeFile").mockImplementation(async (opts) => {
      if (opts.path.startsWith("backup/")) throw new Error("disk full");
      return write(opts);
    });
    await expect(runVaultBackup(vault, "Vault")).rejects.toThrow("disk full");
    expect(zipsIn()).toEqual([]);
  });

  it("each vault has its own state: B's failure shows while A backs up", async () => {
    const other = { ...vault, vaultId: `${vault.vaultId}-B` } as MobileVault;
    const read = raw.readBinaryFile.bind(raw);
    vi.spyOn(raw, "readBinaryFile").mockRejectedValueOnce(new Error("unreadable"));
    await expect(runVaultBackup(other, "Vault B")).rejects.toThrow("unreadable");
    let during: ReturnType<typeof backupState> | null = null;
    vi.mocked(raw.readBinaryFile).mockImplementation(async (path) => { during ??= backupState(other.vaultId); return read(path); });
    await runVaultBackup(vault, "Vault");
    expect(during).toMatchObject({ running: false, lastFailed: true });
  });

  it("the export lock is free once the file is made, even if the share sheet never returns", async () => {
    const { exportVault } = await import("./vaultExport");
    const { Share } = await import("@capacitor/share");
    vi.mocked(Share.share).mockImplementationOnce(() => new Promise(() => {}));
    void exportVault(vault, "Vault");
    await vi.waitFor(() => expect(Share.share).toHaveBeenCalledTimes(1));
    await exportVault(vault, "Vault");
    expect(Share.share).toHaveBeenCalledTimes(2);
  });

  it("an export of another vault meanwhile runs after the first, and both share their own", async () => {
    const { exportVault } = await import("./vaultExport");
    const { Share } = await import("@capacitor/share");
    const other = { ...vault, vaultId: `${vault.vaultId}-B` } as MobileVault;
    await Promise.all([exportVault(vault, "Vault"), exportVault(other, "Other")]);
    const titles = vi.mocked(Share.share).mock.calls.map(([opts]) => (opts as { title: string }).title).sort();
    expect(titles).toHaveLength(2);
    expect(titles[0].startsWith("Other")).toBe(true);
    expect(titles[1].startsWith("Vault")).toBe(true);
  });

  it("an export that failed does not hold the next one", async () => {
    const { exportVault } = await import("./vaultExport");
    const { Share } = await import("@capacitor/share");
    vi.mocked(nativeFileDigest).mockResolvedValueOnce({ sha256: "0".repeat(64), size: 1 });
    await expect(exportVault(vault, "Vault")).rejects.toThrow("Export verification failed");
    await exportVault(vault, "Vault");
    expect(Share.share).toHaveBeenCalledTimes(1);
  });
});

