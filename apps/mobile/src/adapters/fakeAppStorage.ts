/**
 * A fake of the phone's own storage, for tests: the two plugins the container
 * adapter talks to — `Filesystem`, through which it reads, lists and moves, and
 * `AtomicFile`, through which it writes — over one flat map of paths below the
 * app's data directory to what lies there.
 *
 * On a phone that is the file's BYTES, and the fake answers the way the plugin
 * does: base64 for a read without an encoding, and for a read AS TEXT whatever
 * the system's own library makes of the bytes. That last part is what this fake
 * is for, because the two systems differ there (read in the sources, measured
 * on no device):
 *
 * - "ios": IONFilesystemLib reads with `String(contentsOf:encoding:)` (1.1.x,
 *   read on 2026-10-11 and 2026-10-13 with @capacitor/filesystem 8.1.3; 2.0.x,
 *   which 8.1.4 takes, read on 2026-10-20). Foundation's UTF-8 path skips a
 *   leading EF BB BF and gives no string for bytes that are not UTF-8; the
 *   plugin answers that with OS-PLUG-FILE-0013.
 * - "android": ionfilesystem-android 1.1.0 reads through an
 *   `InputStreamReader`, which leaves the mark as the text's first character
 *   and replaces what is not UTF-8 (1.1.1, which 8.1.4 takes, not read again).
 * - "web": the browser build. Its store keeps a file as what it was GIVEN — a
 *   text, base64, a Blob — and hands that back whatever is asked for.
 *
 * A folder exists where it was made or where a file lies below it. A write
 * moves the file's time on, as a file system does; putting something into the
 * map directly is another program, or a build that ran before, writing the
 * file.
 */
export type AppStorageKind = "ios" | "android" | "web";
type Stored = Uint8Array | string | Blob;

/**
 * What lies there, told apart without `instanceof`: under jsdom the bytes a
 * `TextEncoder` makes and the `Uint8Array` a test names come from two realms,
 * and a Blob is jsdom's own.
 */
const isText = (stored: Stored): stored is string => typeof stored === "string";
const isBytes = (stored: Stored): stored is Uint8Array => ArrayBuffer.isView(stored);

const state = {
  kind: "ios" as AppStorageKind,
  files: new Map<string, Stored>(),
  dirs: new Set<string>([""]),
  mtimes: new Map<string, number>(),
  clock: 1000,
  reads: [] as Array<{ path: string; as: "text" | "bytes" }>,
};

/** An empty container of the given kind; what a test gets back is what lies in it and how it was read. */
export function fakeAppStorage(kind: AppStorageKind) {
  Object.assign(state, { kind, files: new Map(), dirs: new Set([""]), mtimes: new Map(), clock: 1000, reads: [] });
  return { files: state.files, reads: state.reads };
}

/** What lies at `path`, as bytes — on a phone the file itself. */
export function appStorageBytes(path: string): number[] {
  const stored = state.files.get(path);
  if (stored === undefined) throw new Error(`nothing lies at ${path}`);
  if (isText(stored)) return [...new TextEncoder().encode(stored)];
  if (isBytes(stored)) return [...stored];
  throw new Error(`${path} was laid down as a Blob; read it through the adapter`);
}

const native = () => state.kind !== "web";
const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const folders = (): Set<string> => {
  const all = new Set(state.dirs);
  for (const file of state.files.keys()) for (let dir = parentOf(file); dir !== ""; dir = parentOf(dir)) all.add(dir);
  return all;
};
const sizeOf = (stored: Stored) => (isText(stored) || isBytes(stored) ? stored.length : stored.size);

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}
const fromBase64 = (data: string) => Uint8Array.from(atob(data), (char) => char.charCodeAt(0));

/** The plugin's own answers: a code on a phone, an exact English sentence in the browser. */
const missing = (method: string, path: string, webMessage = "File does not exist.") =>
  native()
    ? Object.assign(new Error(`'${method}' failed because file at '${path}' does not exist.`), { code: "OS-PLUG-FILE-0008" })
    : new Error(webMessage);

/** What the system's library hands out for a file read as text. */
function systemText(bytes: Uint8Array): string {
  if (state.kind === "android") return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  try {
    // Foundation: a leading mark is no part of the string, and bytes that are not UTF-8 are no string.
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw Object.assign(new Error("'readFile' failed with: The file could not be opened because it is not in the correct format."), { code: "OS-PLUG-FILE-0013" });
  }
}

const entryOf = (path: string) => {
  const stored = state.files.get(path);
  if (stored !== undefined) return { name: path.split("/").pop()!, type: "file" as const, size: sizeOf(stored), mtime: state.mtimes.get(path) ?? 1000, ctime: 1000, uri: path };
  if (folders().has(path)) return { name: path.split("/").pop()!, type: "directory" as const, size: 0, mtime: 1000, ctime: 1000, uri: path };
  return null;
};

const put = (path: string, stored: Stored) => {
  state.files.set(path, stored);
  state.mtimes.set(path, ++state.clock);
};

const Filesystem = {
  async readFile({ path, encoding }: { path: string; encoding?: string }): Promise<{ data: string | Blob }> {
    const stored = state.files.get(path);
    if (stored === undefined) throw missing("readFile", path);
    state.reads.push({ path, as: encoding ? "text" : "bytes" });
    if (!isBytes(stored)) return { data: stored };
    return { data: encoding ? systemText(stored) : toBase64(stored) };
  },
  async writeFile({ path, data, encoding }: { path: string; data: string | Blob; encoding?: string }) {
    // The browser build's write: kept as given. (A phone writes through AtomicFile.)
    put(path, native() && typeof data === "string" ? (encoding ? new TextEncoder().encode(data) : fromBase64(data)) : data);
    return { uri: path };
  },
  async stat({ path }: { path: string }) {
    const entry = entryOf(path);
    if (!entry) throw missing("stat", path, "Entry does not exist.");
    return entry;
  },
  async readdir({ path }: { path: string }) {
    if (!folders().has(path)) throw missing("readdir", path, "Folder does not exist.");
    const names = new Set<string>();
    for (const dir of folders()) if (dir !== "" && parentOf(dir) === path) names.add(dir);
    for (const file of state.files.keys()) if (parentOf(file) === path) names.add(file);
    return { files: [...names].map((child) => entryOf(child)!) };
  },
  async mkdir({ path }: { path: string }) {
    if (folders().has(path)) {
      throw native()
        ? Object.assign(new Error(`Directory at '${path}' already exists, cannot be overwritten.`), { code: "OS-PLUG-FILE-0010" })
        : new Error("Current directory does already exist.");
    }
    state.dirs.add(path);
  },
  async rmdir({ path }: { path: string }) {
    for (const file of [...state.files.keys()]) if (file.startsWith(path + "/")) state.files.delete(file);
    for (const dir of [...state.dirs]) if (dir === path || dir.startsWith(path + "/")) state.dirs.delete(dir);
  },
  async deleteFile({ path }: { path: string }) {
    if (!state.files.delete(path)) throw missing("deleteFile", path);
  },
  async rename({ from, to }: { from: string; to: string }) {
    const moved = [...state.files.keys()].filter((file) => file === from || file.startsWith(from + "/"));
    if (moved.length === 0 && !state.dirs.has(from)) throw missing("rename", from, "Entry does not exist.");
    for (const file of moved) {
      const stored = state.files.get(file)!;
      state.files.delete(file);
      put(to + file.slice(from.length), stored);
    }
    if (state.dirs.delete(from)) state.dirs.add(to);
  },
};

/** The app's own write plugin: the text as UTF-8 bytes, or the bytes it was handed as base64. */
const AtomicFile = {
  async write({ path, data, encoding }: { path: string; data: string; encoding: "utf8" | "base64" }) {
    put(path, encoding === "utf8" ? new TextEncoder().encode(data) : fromBase64(data));
  },
};

/** What a test hands to `vi.mock("@capacitor/filesystem", …)`. */
export const capacitorFilesystem = { Directory: { Data: "DATA" }, Encoding: { UTF8: "utf8" }, Filesystem };

/** What a test hands to `vi.mock("@capacitor/core", …)`. */
export const capacitorCore = {
  Capacitor: { isNativePlatform: () => native(), getPlatform: () => state.kind },
  registerPlugin: (name: string) => (name === "AtomicFile" ? AtomicFile : {}),
};
