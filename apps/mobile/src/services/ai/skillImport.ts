import { isTextEntry, readSkillImport, utf8Encode, type ImportedFile, type SkillImport } from "@plainva/core";
import { extractArchive } from "../importArchive";
import { pickDeviceFiles } from "../pickFiles";

/**
 * Picks a skill archive (`.zip`, `.skill`) with the system document picker
 * and reads it with the importers' unpacker — nothing is written yet (plan
 * KI-Harness P3-5). Any entry the unpacker refused blocks the import rather
 * than importing a part. Null when nothing was picked.
 */
export async function pickSkillArchive(): Promise<{ label: string; imported: SkillImport } | null> {
  const [file] = await pickDeviceFiles("files");
  if (!file) return null;
  const archive = await extractArchive(new Uint8Array(await file.arrayBuffer()));
  if (archive.skipped.length) {
    const unsafe = archive.skipped.some((s) => /path|link/i.test(s.reason));
    return { label: file.name, imported: { ...readSkillImport([]), blocked: unsafe ? "unsafe-path" : "too-large" } };
  }
  const entries: ImportedFile[] = [];
  for (const entry of archive.files) {
    if (isTextEntry(entry)) entries.push({ path: entry.relativePath, bytes: utf8Encode(entry.content) });
    else if (entry.bytes) entries.push({ path: entry.relativePath, bytes: entry.bytes });
    else if (entry.readBytes) entries.push({ path: entry.relativePath, bytes: await entry.readBytes() });
  }
  return { label: file.name, imported: readSkillImport(entries) };
}
