import { isSystemJunkName } from "../../vault/systemJunk.js";

/**
 * What the scan of the vault's own instructions reads with — skills, scripts,
 * `AGENTS.md` (ADR 0020): a folder's entries and a file's bytes, nothing
 * written.
 */
export interface InstructionIO {
  /** Entries directly inside a vault folder; empty when it does not exist. */
  list(folder: string): Promise<{ name: string; folder: boolean }[]>;
  /** A file's bytes; null when it does not exist. */
  read(path: string): Promise<Uint8Array | null>;
}

/**
 * What of a skill's folder is NOT the skill: the operating system's
 * bookkeeping, and every hidden entry — a name that starts with a dot.
 *
 * The rule is the core's because the shells list a folder differently: the
 * phone's listing leaves dot-names out, the desktop's shows them. A skill that
 * carried a `.gitignore` therefore hashed to different files on the two, and
 * an import that brought one could never be confirmed on the phone — the
 * scan after the write did not find what had just been written (finding
 * 2026-10-06). One rule for the scan and the import closes that: the user
 * approves what the dialog can show, and a temp file an interrupted write
 * left behind does not lift an approval. A script's folder is read by the
 * same rule.
 */
export function isSkillEntryLeftOut(name: string): boolean {
  return name.startsWith(".") || isSystemJunkName(name);
}

/**
 * Every file below a folder, relative to it, in the order the listing gives.
 * False when the folder goes deeper than `maxDepth` or holds more than
 * `maxFiles` files — it is then not read at all.
 */
export async function walkInstructionFolder(io: InstructionIO, folder: string, limits: { maxDepth: number; maxFiles: number }, into: string[], prefix = "", depth = 1): Promise<boolean> {
  for (const entry of await io.list(folder)) {
    if (isSkillEntryLeftOut(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.folder) {
      if (depth >= limits.maxDepth) return false;
      if (!(await walkInstructionFolder(io, `${folder}/${entry.name}`, limits, into, rel, depth + 1))) return false;
    } else {
      into.push(rel);
      if (into.length > limits.maxFiles) return false;
    }
  }
  return true;
}
