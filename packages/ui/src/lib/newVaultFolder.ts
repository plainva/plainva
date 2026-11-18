/**
 * What `writeNewVault` needs from the disk and from the app's own records.
 * None of it is recursive, on purpose: a take-back that can only remove ONE
 * file or ONE empty folder at a time cannot remove anything it did not make.
 */
export interface NewVaultFolderPorts {
  /** Makes ONE folder; rejects when anything is at that path already, and never makes a parent. */
  makeDir(path: string): Promise<void>;
  /** Reads one file as text — to see that it still holds what the attempt wrote. */
  readText(path: string): Promise<string>;
  /** Removes one file. */
  removeFile(path: string): Promise<void>;
  /** Removes one folder, and only an empty one: rejects when anything is in it. */
  removeEmptyDir(path: string): Promise<void>;
  /** Forgets the per-vault app data a half-made vault may have left. */
  forget(path: string): Promise<void>;
}

/** The writes of a vault adapter the take-back follows (what the scaffolder uses). */
export interface NewVaultWrites {
  writeTextFile(path: string, content: string): Promise<void>;
  createDir(path: string): Promise<void>;
}

/** Hands the write a vault adapter whose writes are recorded. */
export type TrackWrites = <A extends NewVaultWrites>(adapter: A) => A;

/**
 * Writes a new vault into `folder`, and takes back what this attempt wrote
 * when the writing fails (second and third review of O8, 2026-11-17).
 *
 * A tour that failed halfway used to leave its half folder behind, and the
 * next click put "Plainva Tour 2" beside it. Taking the folder back with a
 * recursive delete was worse: whether this attempt had made it was guessed
 * from a look before the writing, and a look can be wrong — `exists` answers
 * "no" on any error, and a cloud client (OneDrive restoring "Documents") can
 * put a folder there between the look and the writing. The delete then took
 * the person's notes with it, and the cloud would have mirrored that.
 *
 * So nothing is guessed:
 * - "made here" comes from the making itself. With `makeFolder`, the vault
 *   folder is made with a mkdir that fails at a folder that is there; every
 *   folder inside it is made the same way, one by one, before the file that
 *   needs it is written. A mkdir that fails means "not ours".
 * - The take-back removes exactly the files this attempt wrote, then the
 *   folders it made, deepest first, each with a delete that fails at a folder
 *   that is not empty. Anything else that is in one of them stays, and with it
 *   the folder. A file of the attempt that no longer holds what it wrote — a
 *   sync client or an editor changed it meanwhile — is not the attempt's any
 *   more and stays too (fourth review of O8).
 * - When the scaffolder refuses a folder that is not empty, nothing was
 *   written, and nothing is removed.
 *
 * The app data is forgotten only when the vault folder itself was made here
 * and has gone again. The first error is the one that is thrown; a take-back
 * that fails as well is logged, never in its place.
 */
export async function writeNewVault(
  folder: string,
  ports: NewVaultFolderPorts,
  write: (track: TrackWrites) => Promise<void>,
  options: {
    makeFolder?: boolean;
    /** After a failure: whether everything the attempt wrote is gone again. */
    onTakenBack?: (complete: boolean) => void;
  } = {},
): Promise<void> {
  const root = trimSlashes(folder, false);
  const at = (rel: string) => (root ? `${root}/${rel}` : rel);
  const files: Array<{ path: string; content: string }> = [];
  const dirs: string[] = [];
  // Folders already decided on: made here, or found there.
  const known = new Set<string>([""]);

  let rootMade = false;
  if (options.makeFolder) {
    try {
      await ports.makeDir(root);
      rootMade = true;
    } catch {
      /* silent: there already, or not to be made — not ours either way; the write says which */
    }
  }

  const ensureDir = async (rel: string) => {
    if (known.has(rel)) return;
    const parent = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    await ensureDir(parent);
    known.add(rel);
    try {
      await ports.makeDir(at(rel));
      dirs.push(rel);
    } catch {
      /* silent: there already — not ours, so never taken back */
    }
  };
  const parentOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
  const clean = (rel: string) => trimSlashes(rel.split("\\").join("/"), true);

  const track: TrackWrites = (adapter) =>
    new Proxy(adapter, {
      get(target, key, receiver) {
        if (key === "writeTextFile") {
          return async (path: string, content: string) => {
            const rel = clean(path);
            await ensureDir(parentOf(rel));
            await target.writeTextFile(path, content);
            files.push({ path: rel, content });
          };
        }
        if (key === "createDir") {
          return async (path: string) => {
            await ensureDir(clean(path));
            await target.createDir(path);
          };
        }
        const value = Reflect.get(target, key, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

  try {
    await write(track);
  } catch (e) {
    const complete = await takeBack(root, ports, files.map((f) => ({ path: at(f.path), content: f.content })), dirs.map(at), rootMade);
    options.onTakenBack?.(complete);
    throw e;
  }
}

/** `path` without the separators at its end (and, with `leading`, at its start) — no pattern, so no backtracking. */
function trimSlashes(path: string, leading: boolean): string {
  const sep = (c: string) => c === "/" || c === "\\";
  let start = 0;
  let end = path.length;
  if (leading) while (start < end && sep(path.charAt(start))) start++;
  while (end > start && sep(path.charAt(end - 1))) end--;
  return path.slice(start, end);
}

/** Removes what one attempt wrote, file by file and empty folder by empty folder; true when nothing of it is left. */
async function takeBack(
  root: string,
  ports: NewVaultFolderPorts,
  files: Array<{ path: string; content: string }>,
  dirs: string[],
  rootMade: boolean,
): Promise<boolean> {
  let complete = true;
  // Written twice (a file written again in one attempt): the last text counts.
  const last = new Map<string, string>();
  for (const f of files) last.set(f.path, f.content);
  for (const [file, content] of [...last].reverse()) {
    let now: string;
    try {
      now = await ports.readText(file);
    } catch (e) {
      // silent: gone already, or not readable — either way it is not removed blind; a file left is a file, never a loss.
      console.warn("[newVaultFolder] a file of the failed attempt could not be read back; it stays:", file, e);
      complete = false;
      continue;
    }
    if (now !== content) {
      // silent: changed since the attempt wrote it — no longer the attempt's, so it stays (named in the log).
      console.warn("[newVaultFolder] a file of the failed attempt was changed meanwhile; it stays:", file);
      complete = false;
      continue;
    }
    try {
      await ports.removeFile(file);
    } catch (e) {
      // silent: logged only — the attempt's own error is the one the person sees; a file left is a file, never a loss.
      console.error("[newVaultFolder] a file of the failed attempt could not be removed:", file, e);
      complete = false;
    }
  }
  // Made top-down, removed bottom-up: a folder's own folders go before it.
  const kept: string[] = [];
  for (const dir of [...dirs].reverse()) {
    try {
      await ports.removeEmptyDir(dir);
    } catch {
      // silent: not empty — something that is not ours is in it, so it stays (named below).
      kept.push(dir);
    }
  }
  if (rootMade) {
    try {
      await ports.removeEmptyDir(root);
    } catch {
      // silent: not empty — something that is not ours is in it, so it stays (named below).
      kept.push(root);
    }
  }
  if (kept.length) {
    console.warn("[newVaultFolder] kept folders that are not empty:", kept);
    complete = false;
  }
  if (rootMade && !kept.includes(root)) {
    try {
      await ports.forget(root);
    } catch (e) {
      // silent: logged only — the attempt's own error is the one the person sees; the next vault at this path overwrites the data.
      console.error("[newVaultFolder] the half-made vault's app data could not be forgotten:", root, e);
    }
  }
  return complete;
}
