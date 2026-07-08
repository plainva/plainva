/**
 * Inline `.base` helpers (#8). Creating an inline database from the editor writes
 * a real `.base` file in the same folder as the current note (so it round-trips
 * through Obsidian and the rest of Plainva) and the editor then embeds it with
 * `![[path]]`, which NoteEmbedPlugin renders as an inline BaseViewer.
 */
import type { IVaultAdapter } from "@plainva/core";
import { serializeBaseConfig } from "./baseFormat";

/** Vault-relative folder of a path ("" for a root-level file). Forward slashes. */
export function folderOf(path: string): string {
  const norm = path.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(0, idx) : "";
}

/** The embed snippet for a `.base` at a vault-relative path. */
export function baseEmbedText(path: string): string {
  return `![[${path.replace(/\\/g, "/")}]]`;
}

/**
 * Create a new, empty (single table view) `.base` in `folder`, picking a unique
 * filename derived from `label`. Returns the new vault-relative path. The caller
 * is responsible for re-indexing and embedding it. `viewName` names the initial
 * view (Obsidian requires one; serializeBaseConfig falls back to "Table").
 */
export async function createInlineBase(adapter: IVaultAdapter, folder: string, label: string, viewName?: string): Promise<string> {
  const safe = label.replace(/[\\/]/g, "").trim() || "Database";
  const full = (name: string) => (folder ? `${folder}/${name}` : name);
  let name = `${safe}.base`;
  let n = 1;
  // Avoid clobbering an existing file.
  while (await adapter.exists(full(name))) {
    name = `${safe}-${n}.base`;
    n++;
  }
  const path = full(name);
  await adapter.writeTextFile(path, serializeBaseConfig({ views: [{ type: "table", name: viewName || "Table" }] }));
  return path;
}
