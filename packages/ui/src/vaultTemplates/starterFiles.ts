import { format } from "date-fns";
import { isPlainvaManagedIndex, starterHash, type VaultFileInfo } from "@plainva/core";
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
