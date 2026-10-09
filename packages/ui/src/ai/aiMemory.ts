import {
  MEMORY_LIMITS,
  activeMemoryBudget,
  memoryFileOf,
  parseMemory,
  type InstructionIO,
  type MemoryEntry,
  type MemoryPlace,
} from "@plainva/core";
import type { AiFileStore } from "./aiStores";

/**
 * The vault's memory on this device (plan KI-Harness P6, ADR 0027): how a
 * shell reads and writes the two memory files, and the one choice that is
 * this device's own — whether the memory is used here at all.
 *
 * The files are the vault's: they sync with it, and a write goes through the
 * vault's adapters like every other, so the file that was there is backed up
 * before it is replaced. The switch is not the vault's: it lies beside the
 * conversations in the app's data, like every approval.
 */

export interface MemoryFileRead {
  /** The file's text; null where there is none. */
  text: string | null;
  /** The file is larger than a memory file may be: it is not read, and the view says so. */
  tooLarge: boolean;
}

export interface MemoryPrefs {
  /** Off: nothing of the memory goes to any model from this device, and no tool reads or proposes into it. */
  on: boolean;
}

export const DEFAULT_MEMORY_PREFS: MemoryPrefs = { on: true };

export interface AiMemoryHost {
  read(place: MemoryPlace): Promise<MemoryFileRead>;
  /** Replaces a memory file as a whole. Absent where the shell cannot write: the memory is then read only. */
  write?(place: MemoryPlace, text: string): Promise<void>;
  prefs: { load(): Promise<MemoryPrefs>; save(prefs: MemoryPrefs): Promise<void> };
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function createMemoryPrefStore(files: AiFileStore, vaultKey: string): AiMemoryHost["prefs"] {
  if (!SAFE_ID.test(vaultKey)) throw new Error("invalid vault key");
  const path = `${vaultKey}/memory.json`;
  return {
    async load() {
      const raw = await files.read(path).catch(() => null);
      if (raw === null) return DEFAULT_MEMORY_PREFS;
      try {
        const value = JSON.parse(raw) as { version?: number; on?: unknown };
        // A file that cannot be read switches nothing on that was off: only an explicit "on" or no file at all is on.
        return value.version === 1 && typeof value.on === "boolean" ? { on: value.on } : { on: false };
      } catch {
        return { on: false };
      }
    },
    save: (prefs) => files.write(path, JSON.stringify({ version: 1, on: prefs.on })),
  };
}

/** The memory host of a shell: the files through the vault's own reader and writer, the switch in the app's data. */
export function createMemoryHost(io: InstructionIO, writer: { write(path: string, bytes: Uint8Array): Promise<void> } | undefined, prefs: AiMemoryHost["prefs"]): AiMemoryHost {
  return {
    async read(place) {
      const bytes = await io.read(memoryFileOf(place));
      if (bytes === null) return { text: null, tooLarge: false };
      if (bytes.byteLength > MEMORY_LIMITS.fileBytes) return { text: null, tooLarge: true };
      return { text: new TextDecoder("utf-8").decode(bytes), tooLarge: false };
    },
    ...(writer ? { write: (place: MemoryPlace, text: string) => writer.write(memoryFileOf(place), new TextEncoder().encode(text)) } : {}),
    prefs,
  };
}

/** The memory as a view holds it. */
export interface AiMemoryState {
  /** Read at least once for the open vault. */
  loaded: boolean;
  /** The shell reaches the memory files. */
  available: boolean;
  /** It can write them: entries can be added, changed and removed here. */
  writable: boolean;
  /** This device's switch. */
  on: boolean;
  active: MemoryEntry[];
  long: MemoryEntry[];
  /** How much of "always with it" is used, and which of its entries no longer fit. */
  budget: { used: number; limit: number; over: string[] };
  /** The places whose file is too large to be read, or holds more entries than are read. */
  cut: MemoryPlace[];
  /** The places whose file is there: only such a file can be opened in the editor. */
  files: MemoryPlace[];
}

export const EMPTY_MEMORY_STATE: AiMemoryState = {
  loaded: false,
  available: false,
  writable: false,
  on: true,
  active: [],
  long: [],
  // Nothing was read yet, so no budget is known: the limit comes with the first read (`activeMemoryBudget`).
  budget: { used: 0, limit: 0, over: [] },
  cut: [],
  files: [],
};

/** Both files, read and parsed: what the view shows and what a conversation starts from. */
export async function readMemory(host: AiMemoryHost): Promise<Pick<AiMemoryState, "active" | "long" | "budget" | "cut" | "files"> & { texts: Record<MemoryPlace, string | null> }> {
  const [active, long] = await Promise.all([host.read("active"), host.read("long")]);
  const parsedActive = parseMemory(active.text, "active");
  const parsedLong = parseMemory(long.text, "long");
  const cut: MemoryPlace[] = [];
  if (active.tooLarge || parsedActive.more) cut.push("active");
  if (long.tooLarge || parsedLong.more) cut.push("long");
  const files: MemoryPlace[] = [];
  // A file that is too large to be read is there all the same.
  if (active.text !== null || active.tooLarge) files.push("active");
  if (long.text !== null || long.tooLarge) files.push("long");
  return { active: parsedActive.entries, long: parsedLong.entries, budget: activeMemoryBudget(parsedActive.entries), cut, files, texts: { active: active.text, long: long.text } };
}
