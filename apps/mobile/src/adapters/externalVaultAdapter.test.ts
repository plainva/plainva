// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { VaultFileExistsError, VaultFileNotFoundError } from "@plainva/core";
import { ExternalVaultAdapter } from "./ExternalVaultAdapter";
import type { PickFolderResult, VaultFolderAccess, VaultFolderEntry, VaultFolderNative } from "../platform/vaultFolder";

/**
 * The external-folder adapter against a fake of the native plugin (external
 * vault folder plan, P4). The fake keeps a flat map of paths — enough to pin
 * the contract the chains above rely on: shared errors, dot-children filtered,
 * base64 on the bridge only, and the access state the vault detail shows.
 */
function fakePlugin(files: Map<string, string | Uint8Array>, access: VaultFolderAccess = { state: "ok", label: "Notes" }) {
  const dirs = new Set<string>([""]);
  const enc = new TextEncoder();
  const asBytes = (v: string | Uint8Array) => (typeof v === "string" ? enc.encode(v) : v);
  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const entryOf = (path: string): VaultFolderEntry | null => {
    if (dirs.has(path) && path !== "") return { name: path.split("/").pop()!, isDirectory: true, size: 0, mtime: 0 };
    const v = files.get(path);
    if (v === undefined) return null;
    return { name: path.split("/").pop()!, isDirectory: false, size: asBytes(v).length, mtime: 1000 };
  };
  const calls: string[] = [];
  const plugin: VaultFolderNative = {
    async pickFolder(): Promise<PickFolderResult> { return { picked: false, reason: "cancelled" }; },
    async resolve() { calls.push("resolve"); return access; },
    async release() { calls.push("release"); },
    async list({ path }) {
      calls.push(`list:${path}`);
      const entries: VaultFolderEntry[] = [];
      for (const d of dirs) if (d !== "" && parentOf(d) === path) entries.push(entryOf(d)!);
      for (const f of files.keys()) if (parentOf(f) === path) entries.push(entryOf(f)!);
      return { entries };
    },
    async stat({ path }) { return { entry: entryOf(path) }; },
    async read({ path }) {
      const v = files.get(path);
      if (v === undefined) throw new Error("ENOENT");
      return { dataBase64: b64(asBytes(v)) };
    },
    async write({ path, dataBase64 }) { files.set(path, unb64(dataBase64)); },
    async delete({ path, recursive }) {
      if (dirs.has(path)) {
        const inside = [...files.keys()].filter((f) => f.startsWith(path + "/"));
        if (inside.length && !recursive) throw new Error("ENOTEMPTY");
        for (const f of inside) files.delete(f);
        dirs.delete(path);
        return;
      }
      files.delete(path);
    },
    async rename({ from, to }) {
      const v = files.get(from);
      if (v === undefined) throw new Error("ENOENT");
      files.delete(from);
      files.set(to, v);
    },
    async mkdir({ path }) { dirs.add(path); },
  };
  return { plugin, calls, dirs };
}

const text = (a: Uint8Array | string) => (typeof a === "string" ? a : new TextDecoder().decode(a));

describe("ExternalVaultAdapter", () => {
  it("lists a folder without its dot-children and reads what it wrote", async () => {
    const files = new Map<string, string | Uint8Array>([
      ["Welcome.md", "# Hi"],
      [".obsidian/app.json", "{}"],
      [".stfolder", ""],
      ["Projects/Plan.md", "plan"],
    ]);
    const { plugin, dirs } = fakePlugin(files);
    dirs.add(".obsidian");
    dirs.add("Projects");
    const a = new ExternalVaultAdapter(plugin, "h1");
    await a.initialize();
    expect(a.accessState).toEqual({ state: "ok", label: "Notes" });
    const top = await a.listDir("");
    expect(top.map((f) => f.path).sort()).toEqual(["Projects", "Welcome.md"]);
    const all = await a.listDir("", true);
    expect(all.map((f) => f.path).sort()).toEqual(["Projects", "Projects/Plan.md", "Welcome.md"]);
    await a.writeTextFile("Notes/Ünïcode.md", "ä ö ü — 日本");
    expect(await a.readTextFile("Notes/Ünïcode.md")).toBe("ä ö ü — 日本");
    const bytes = new Uint8Array([0, 255, 128, 7]);
    await a.writeBinaryFile("img.bin", bytes);
    expect([...(await a.readBinaryFile("img.bin"))]).toEqual([0, 255, 128, 7]);
    expect(text(files.get("Notes/Ünïcode.md")!)).toBe("ä ö ü — 日本");
  });

  it("speaks the shared adapter errors", async () => {
    const files = new Map<string, string | Uint8Array>([["a.md", "a"], ["b.md", "b"]]);
    const { plugin } = fakePlugin(files);
    const a = new ExternalVaultAdapter(plugin, "h1");
    await expect(a.readTextFile("missing.md")).rejects.toBeInstanceOf(VaultFileNotFoundError);
    await expect(a.getFileInfo("missing.md")).rejects.toBeInstanceOf(VaultFileNotFoundError);
    await expect(a.deleteItem("missing.md")).rejects.toBeInstanceOf(VaultFileNotFoundError);
    await expect(a.renameItem("a.md", "b.md")).rejects.toBeInstanceOf(VaultFileExistsError);
    await expect(a.renameItem("missing.md", "c.md")).rejects.toBeInstanceOf(VaultFileNotFoundError);
    await a.renameItem("a.md", "Sub/a.md");
    expect(await a.exists("a.md")).toBe(false);
    expect(await a.exists("Sub/a.md")).toBe(true);
    const info = await a.getFileInfo("Sub/a.md");
    expect(info).toMatchObject({ path: "Sub/a.md", name: "a.md", isDirectory: false, size: 1 });
  });

  it("reports an expired grant instead of failing, and releases on dispose", async () => {
    const { plugin, calls } = fakePlugin(new Map(), { state: "expired", label: "Old" });
    const a = new ExternalVaultAdapter(plugin, "h1");
    await a.initialize();
    expect(a.accessState).toEqual({ state: "expired", label: "Old" });
    await a.dispose();
    expect(calls).toEqual(["resolve", "release"]);
    expect(a.sandboxRoot).toBeUndefined();
  });

  it("normalizes paths the way the container adapter does", async () => {
    const files = new Map<string, string | Uint8Array>();
    const { plugin } = fakePlugin(files);
    const a = new ExternalVaultAdapter(plugin, "h1");
    await a.writeTextFile("/Folder\\Note.md/", "x");
    expect([...files.keys()]).toEqual(["Folder/Note.md"]);
    await a.createDir("/New/");
    expect(await a.exists("New")).toBe(true);
  });
});
