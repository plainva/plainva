import { isPlainvaManagedIndex } from "../okf-index.js";
import { sha256Hex } from "../workspace/encoding.js";

/**
 * The starter content of a fresh vault - a template's notes, databases and
 * pictures, and the listings Plainva generates - is the app's, not the
 * person's (review 2026-10-27). Connected to a cloud folder that already holds
 * someone's notes, it went up into that folder: the phone's starter notes
 * landed in an existing wiki.
 *
 * So the vault remembers what it was given, in a device-local file next to
 * its index: each starter file with the hash it had when it was written. A
 * file that still has those bytes was never touched. The phone's copy of a
 * vault into a new one for a folder that already holds notes leaves such files
 * behind (`planVaultTransfer`'s `keepBack`); the moment the person changes one,
 * it is theirs and goes along. A generated listing (`index.md` with Plainva's
 * marker) stays the app's for as long as it carries the marker: every device
 * generates its own. No upload asks this record (second review 2026-10-27): a
 * vault connected to its own folder - a new, empty one - takes all of it up,
 * its template included.
 *
 * A vault created to go online at once records nothing.
 */
export const STARTER_MANIFEST_PATH = ".plainva/starter-files.json";

export interface StarterManifest {
  version: 1;
  /** Vault path -> sha256 (hex) of the bytes written. */
  files: Record<string, string>;
}

export interface StarterManifestStore {
  exists(path: string): Promise<boolean>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
  createDir?(path: string): Promise<void>;
}

export async function readStarterManifest(vault: Pick<StarterManifestStore, "exists" | "readTextFile">): Promise<StarterManifest | null> {
  try {
    if (!(await vault.exists(STARTER_MANIFEST_PATH))) return null;
    const parsed = JSON.parse(await vault.readTextFile(STARTER_MANIFEST_PATH)) as Partial<StarterManifest>;
    if (parsed.version !== 1 || !parsed.files || typeof parsed.files !== "object") return null;
    const files: Record<string, string> = {};
    for (const [path, hash] of Object.entries(parsed.files)) if (typeof hash === "string") files[path] = hash;
    return { version: 1, files };
  } catch {
    return null;
  }
}

export async function writeStarterManifest(vault: Omit<StarterManifestStore, "readTextFile">, files: Record<string, string>): Promise<void> {
  if (vault.createDir && !(await vault.exists(".plainva"))) await vault.createDir(".plainva");
  await vault.writeTextFile(STARTER_MANIFEST_PATH, JSON.stringify({ version: 1, files } satisfies StarterManifest, null, 2) + "\n");
}

export function starterHash(content: string | Uint8Array): string {
  return sha256Hex(typeof content === "string" ? new TextEncoder().encode(content) : content);
}

/** Whether `bytes` at `path` is starter content the person never touched. */
export function isUntouchedStarter(manifest: StarterManifest | null, path: string, bytes: Uint8Array): boolean {
  const hash = manifest?.files[path];
  if (!hash) return false;
  if (starterHash(bytes) === hash) return true;
  if (!/(^|\/)index\.md$/.test(path)) return false;
  try {
    return isPlainvaManagedIndex(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return false;
  }
}
