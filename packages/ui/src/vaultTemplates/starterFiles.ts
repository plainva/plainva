import { format } from "date-fns";
import { isPlainvaManagedIndex, isUntouchedStarter, readStarterManifest, starterHash, type VaultFileInfo } from "@plainva/core";
import { serializeBaseConfig } from "../base/baseFormat";
import { APP_LANGUAGES } from "../services/languages";
import { getVaultTemplates } from "./registry";
import { buildTemplateNoteContent, interpolateNote, interpolateScaffoldDates } from "./scaffold";

/**
 * The starter content of a vault (see `starterFiles.ts` in the core) for a
 * vault scaffolded before the vault remembered it: recognised by its bytes
 * (review 2026-10-27). A file counts only where it is byte for byte what one
 * of the templates - in any of the app's languages - writes at its path; a
 * template's dates are those of the day it was created, which an untouched
 * file still carries as its modification day. A generated listing counts
 * while it carries Plainva's marker, at the root or in a template's folder.
 */
export interface StarterRecognitionAdapter {
  listDir(path?: string, recursive?: boolean): Promise<VaultFileInfo[]>;
  readBinaryFile(path: string): Promise<Uint8Array>;
}

const isPrivate = (path: string) => [".plainva", ".pvws"].some((root) => path === root || path.startsWith(root + "/"));

/** What a template writes at each path, for the days a file of the vault carries. */
function expectedStarterFiles(days: Date[], present: ReadonlySet<string>): { files: Map<string, Set<string>>; folders: Set<string> } {
  const files = new Map<string, Set<string>>();
  const folders = new Set<string>([""]);
  const expect = (path: string, content: () => string) => {
    if (!present.has(path)) return;
    const hashes = files.get(path) ?? new Set<string>();
    hashes.add(starterHash(content()));
    files.set(path, hashes);
  };
  for (const { code } of APP_LANGUAGES) {
    for (const template of getVaultTemplates(code)) {
      for (const folder of template.folders) folders.add(folder);
      for (const day of days) {
        for (const note of template.notes) {
          if (!present.has(interpolateScaffoldDates(note.path, day))) continue;
          const resolved = interpolateNote(note, day);
          expect(resolved.path, () => buildTemplateNoteContent(resolved));
        }
      }
      for (const base of template.bases ?? []) expect(base.path, () => serializeBaseConfig(base.config));
      for (const file of template.rawFiles ?? []) expect(file.path, () => file.content);
    }
  }
  return { files, folders };
}

export async function recognizeStarterFiles(adapter: StarterRecognitionAdapter): Promise<Record<string, string>> {
  const entries = (await adapter.listDir("", true)).filter((entry) => !entry.isDirectory && !isPrivate(entry.path));
  const present = new Set(entries.map((entry) => entry.path));
  // The days the vault's files were last written, most common first: the day
  // a template was scaffolded is the day its untouched files carry.
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.mtime) continue;
    const day = format(new Date(entry.mtime), "yyyy-MM-dd");
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  const days: Date[] = [];
  for (const [day] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    for (const offset of [-1, 0, 1]) {
      const date = new Date(`${day}T12:00:00`);
      date.setDate(date.getDate() + offset);
      days.push(date);
    }
  }
  const { files: expected, folders } = expectedStarterFiles(days, present);
  const recognized: Record<string, string> = {};
  for (const entry of entries) {
    const index = /(^|\/)index\.md$/.test(entry.path) ? entry.path.slice(0, Math.max(0, entry.path.lastIndexOf("/"))) : null;
    const hashes = expected.get(entry.path);
    if (!hashes && (index === null || !folders.has(index))) continue;
    const bytes = await adapter.readBinaryFile(entry.path);
    const hash = starterHash(bytes);
    if (hashes?.has(hash)) recognized[entry.path] = hash;
    else if (index !== null && folders.has(index)) {
      try {
        if (isPlainvaManagedIndex(new TextDecoder("utf-8", { fatal: true }).decode(bytes))) recognized[entry.path] = hash;
      } catch {
        /* not text: not a listing */
      }
    }
  }
  return recognized;
}

/** Whether a cloud folder's listing holds notes; a listing that failed (`null`) counts as one that does. */
export function folderHoldsNotes(remotePaths: Iterable<string> | null): boolean {
  if (remotePaths === null) return true;
  for (const path of remotePaths) if (!isPrivate(path)) return true;
  return false;
}

export interface StarterSource extends StarterRecognitionAdapter {
  exists(path: string): Promise<boolean>;
  readTextFile(path: string): Promise<string>;
}

/**
 * The one rule for starter content and a cloud folder (third review
 * 2026-10-27), for both shells at the moment a vault meets its folder: the
 * phone's copy into a new vault, the desktop's binding of the open one. Where
 * the folder already holds notes - or its listing could not be read - the
 * starter files nobody changed stay on this device: the vault's record of
 * them, or for a vault from before the record, the files recognised by their
 * bytes. An empty or new folder takes everything. Returns path -> hash of the
 * bytes held back; nothing is written here.
 */
export async function starterFilesToHoldBack(adapter: StarterSource, remotePaths: Iterable<string> | null): Promise<Map<string, string>> {
  const held = new Map<string, string>();
  if (!folderHoldsNotes(remotePaths)) return held;
  const record = await readStarterManifest(adapter);
  const files = record ? record.files : await recognizeStarterFiles(adapter).catch(() => ({} as Record<string, string>));
  const manifest = { version: 1 as const, files };
  for (const path of Object.keys(files)) {
    let bytes: Uint8Array;
    try {
      bytes = await adapter.readBinaryFile(path);
    } catch {
      continue;
    }
    if (isUntouchedStarter(manifest, path, bytes)) held.set(path, starterHash(bytes));
  }
  return held;
}

/**
 * Binding a vault in place (the desktop): the decision waits for the
 * worker's first whole listing - which runs before the vault's first upload -
 * and is stored next to the sync state, where every upload asks it.
 */
export function holdBackStartersAtFirstListing(
  worker: { onFirstListing?: (remotePaths: ReadonlySet<string>) => Promise<void> },
  adapter: StarterSource,
  repo: { holdBackStarters(files: ReadonlyMap<string, string>): Promise<void> },
): void {
  worker.onFirstListing = async (remotePaths) => {
    const held = await starterFilesToHoldBack(adapter, remotePaths);
    if (held.size > 0) await repo.holdBackStarters(held);
  };
}
