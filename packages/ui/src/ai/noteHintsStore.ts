import type { AiFileStore } from "./aiStores";

/**
 * What this device keeps about the calm hints at the open note (plan
 * KI-Harness P8-3): whether they rest in this vault, the notes they rest for,
 * and the hints that were hidden with "Don't show again". In the app's data
 * for the vault, never in the vault — another device decides for itself.
 * Each list is capped: what was hidden longest ago goes first.
 */
export interface NoteHintsPrefs {
  vaultPaused: boolean;
  pausedNotes: string[];
  dismissed: string[];
}

export const EMPTY_NOTE_HINTS_PREFS: NoteHintsPrefs = { vaultPaused: false, pausedNotes: [], dismissed: [] };

/** More than this of each list is not kept. */
export const NOTE_HINTS_KEPT = 500;

export interface NoteHintsStore {
  load(): Promise<NoteHintsPrefs>;
  save(prefs: NoteHintsPrefs): Promise<void>;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0 && entry.length <= 2000) : []);

/** The prefs as they were stored; a file that is missing or damaged hides and pauses nothing. */
export function readNoteHintsPrefs(raw: string | null): NoteHintsPrefs {
  if (raw === null) return EMPTY_NOTE_HINTS_PREFS;
  try {
    const value = JSON.parse(raw) as { version?: unknown; vaultPaused?: unknown; pausedNotes?: unknown; dismissed?: unknown };
    if (value.version !== 1) return EMPTY_NOTE_HINTS_PREFS;
    return {
      vaultPaused: value.vaultPaused === true,
      pausedNotes: [...new Set(strings(value.pausedNotes))].slice(-NOTE_HINTS_KEPT),
      dismissed: [...new Set(strings(value.dismissed))].slice(-NOTE_HINTS_KEPT),
    };
  } catch {
    return EMPTY_NOTE_HINTS_PREFS;
  }
}

export function createNoteHintsStore(files: AiFileStore, vaultKey: string): NoteHintsStore {
  if (!SAFE_ID.test(vaultKey)) throw new Error("invalid vault key");
  const path = `${vaultKey}/hints.json`;
  return {
    load: async () => readNoteHintsPrefs(await files.read(path).catch(() => null)),
    save: (prefs) =>
      files.write(
        path,
        JSON.stringify({ version: 1, vaultPaused: prefs.vaultPaused, pausedNotes: prefs.pausedNotes.slice(-NOTE_HINTS_KEPT), dismissed: prefs.dismissed.slice(-NOTE_HINTS_KEPT) }),
      ),
  };
}
