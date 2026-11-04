import { open } from "@tauri-apps/plugin-dialog";
import { isTextEntry, readSkillImport, utf8Encode, type ImportedFile, type SkillImport } from "@plainva/core";
import { discardExtractedArchive, extractArchive } from "../importArchive";

/**
 * Picks a skill archive (`.zip`, `.skill`) and reads it through the native
 * extractor the importers use — nothing is written yet (plan KI-Harness
 * P3-5). The extractor already refuses unsafe paths, links and oversized
 * entries; any refusal blocks the import rather than importing a part. Null
 * when the user cancels the picker.
 */
export async function pickSkillArchive(): Promise<{ label: string; imported: SkillImport } | null> {
  const picked = await open({ multiple: false, directory: false, filters: [{ name: "Agent Skills", extensions: ["zip", "skill"] }] });
  if (typeof picked !== "string") return null;
  const label = picked.split(/[\\/]/).pop() ?? picked;
  const archive = await extractArchive(picked);
  try {
    if (archive.skipped.length) {
      const unsafe = archive.skipped.some((s) => /path|link|symlink/i.test(s.reason));
      return { label, imported: { ...readSkillImport([]), blocked: unsafe ? "unsafe-path" : "too-large" } };
    }
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const entries: ImportedFile[] = [];
    for (const file of archive.files) {
      if (isTextEntry(file)) entries.push({ path: file.relativePath, bytes: utf8Encode(file.content) });
      else if (file.sourcePath) entries.push({ path: file.relativePath, bytes: (await archive.readSourceBytes?.(file.sourcePath)) ?? (await readFile(file.sourcePath)) });
    }
    return { label, imported: readSkillImport(entries) };
  } finally {
    await discardExtractedArchive(archive.root).catch(() => undefined);
  }
}
