import type { PickFolderResult, VaultFolderAccess, VaultFolderEntry, VaultFolderNative } from "../platform/vaultFolder";

/**
 * A fake of the native VaultFolder plugin, for tests: a folder the user picked,
 * held as a flat map of paths to what lies there — a string, or the bytes
 * themselves where a test is about bytes. Like the plugin it speaks base64 on
 * the bridge and nothing else, so what a test reads from the map afterwards is
 * what would lie in the folder.
 *
 * A folder exists where it was made (`dirs`) or where a file lies below it. A
 * write moves the file's time on, as a file system does; putting something
 * into the map directly is another program writing the file.
 */
export function fakeVaultFolder(files: Map<string, string | Uint8Array>, access: VaultFolderAccess = { state: "ok", label: "Notes" }) {
  const dirs = new Set<string>([""]);
  const enc = new TextEncoder();
  const asBytes = (v: string | Uint8Array) => (typeof v === "string" ? enc.encode(v) : v);
  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
  const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
  const mtimes = new Map<string, number>();
  let clock = 1000;
  const folders = (): Set<string> => {
    const all = new Set(dirs);
    for (const file of files.keys()) for (let dir = parentOf(file); dir !== ""; dir = parentOf(dir)) all.add(dir);
    return all;
  };
  const entryOf = (path: string): VaultFolderEntry | null => {
    if (path !== "" && folders().has(path)) return { name: path.split("/").pop()!, isDirectory: true, size: 0, mtime: 0 };
    const v = files.get(path);
    if (v === undefined) return null;
    return { name: path.split("/").pop()!, isDirectory: false, size: asBytes(v).length, mtime: mtimes.get(path) ?? 1000 };
  };
  const calls: string[] = [];
  const plugin: VaultFolderNative = {
    async pickFolder(): Promise<PickFolderResult> { return { picked: false, reason: "cancelled" }; },
    async resolve() { calls.push("resolve"); return access; },
    async release() { calls.push("release"); },
    async list({ path }) {
      calls.push(`list:${path}`);
      const entries: VaultFolderEntry[] = [];
      for (const d of folders()) if (d !== "" && parentOf(d) === path) entries.push(entryOf(d)!);
      for (const f of files.keys()) if (parentOf(f) === path) entries.push(entryOf(f)!);
      return { entries };
    },
    async stat({ path }) { return { entry: entryOf(path) }; },
    async read({ path }) {
      const v = files.get(path);
      if (v === undefined) throw new Error("ENOENT");
      return { dataBase64: b64(asBytes(v)) };
    },
    async write({ path, dataBase64 }) { files.set(path, unb64(dataBase64)); mtimes.set(path, ++clock); },
    async delete({ path, recursive }) {
      if (folders().has(path)) {
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

/** What lies at `path` in the fake's map, as bytes. */
export function folderBytes(files: Map<string, string | Uint8Array>, path: string): number[] {
  const v = files.get(path);
  if (v === undefined) throw new Error(`nothing lies at ${path}`);
  return [...(typeof v === "string" ? new TextEncoder().encode(v) : v)];
}
