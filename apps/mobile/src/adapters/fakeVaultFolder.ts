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
  const b64 = (bytes: Uint8Array) => { let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
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
    // The picked folder itself answers as a folder, as both native plugins do.
    if (path === "") return { name: "", isDirectory: true, size: 0, mtime: 0 };
    if (folders().has(path)) return { name: path.split("/").pop()!, isDirectory: true, size: 0, mtime: 0 };
    const v = files.get(path);
    if (v === undefined) return null;
    return { name: path.split("/").pop()!, isDirectory: false, size: asBytes(v).length, mtime: mtimes.get(path) ?? 1000 };
  };
  const calls: string[] = [];
  /** Bytes of every file part that crossed the bridge, either way (before base64). */
  const sizes: number[] = [];
  const PART = 256 * 1024;
  const reads = new Map<string, Uint8Array>();
  const writes = new Map<string, { path: string; parts: Uint8Array[] }>();
  /** A test's way to make the `n`-th part of a write to `path` fail. */
  let failAppend: ((path: string, n: number) => boolean) | undefined;
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
    async read({ path, maxBytes }) {
      const v = files.get(path);
      if (v === undefined) throw new Error("ENOENT");
      const bytes = asBytes(v);
      calls.push(`read:${path}`);
      // As both native plugins: a file over the limit is not sent; it is read on into a copy -
      // one version, taken now: what the map holds later is another program's write.
      if (bytes.length > (maxBytes ?? PART)) {
        const id = `r${++clock}`;
        reads.set(id, bytes.slice());
        return { tooLarge: true as const, id, size: bytes.length };
      }
      sizes.push(bytes.length);
      return { dataBase64: b64(bytes) };
    },
    async write({ path, dataBase64 }) {
      const bytes = unb64(dataBase64);
      sizes.push(bytes.length);
      files.set(path, bytes);
      mtimes.set(path, ++clock);
    },
    async readPart({ id, offset, length }) {
      const bytes = reads.get(id);
      if (!bytes) throw new Error("no such read");
      const part = bytes.subarray(offset, offset + Math.min(length, PART));
      sizes.push(part.length);
      return { data: b64(part) };
    },
    async closeRead({ id }) { reads.delete(id); },
    async begin({ path }) {
      const id = `w${++clock}`;
      writes.set(id, { path, parts: [] });
      calls.push(`begin:${path}`);
      return { id };
    },
    async append({ id, data }) {
      const write = writes.get(id);
      if (!write) throw new Error("no such write");
      const part = unb64(data);
      sizes.push(part.length);
      if (failAppend?.(write.path, write.parts.length)) throw new Error("append failed");
      write.parts.push(part);
    },
    async commit({ id }) {
      const write = writes.get(id);
      if (!write) throw new Error("no such write");
      writes.delete(id);
      const total = write.parts.reduce((n, p) => n + p.length, 0);
      const bytes = new Uint8Array(total);
      let at = 0;
      for (const part of write.parts) { bytes.set(part, at); at += part.length; }
      files.set(write.path, bytes);
      mtimes.set(write.path, ++clock);
    },
    async abort({ id }) { writes.delete(id); calls.push("abort"); },
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
  // One call at a time, in the order they arrive - as on the plugin's thread (Android) or queue (iOS).
  let queue: Promise<unknown> = Promise.resolve();
  const serial = plugin as unknown as Record<string, (opts: unknown) => Promise<unknown>>;
  for (const name of Object.keys(serial)) {
    const call = serial[name]!;
    serial[name] = (opts: unknown) => {
      const answer = queue.then(() => call(opts));
      queue = answer.catch(() => {});
      return answer;
    };
  }
  return {
    plugin, calls, dirs, sizes,
    openReads: () => reads.size,
    openWrites: () => writes.size,
    failAppendWhen(rule: (path: string, n: number) => boolean) { failAppend = rule; },
  };
}

/** What lies at `path` in the fake's map, as bytes. */
export function folderBytes(files: Map<string, string | Uint8Array>, path: string): number[] {
  const v = files.get(path);
  if (v === undefined) throw new Error(`nothing lies at ${path}`);
  return [...(typeof v === "string" ? new TextEncoder().encode(v) : v)];
}
