import { Filesystem } from "@capacitor/filesystem";
import type { IDatabaseAdapter } from "@plainva/core";
import { INTERNAL_FOLDERS, internalPlace } from "../platform/internalFiles";

/**
 * How large what the app reads at start is (release list F51): the folders of
 * its own files (drafts, journals, AI conversations), the open vault's index
 * database and its largest tables. Numbers and the schema's own table names
 * only - never a file name, a path or anything a file holds.
 */

const MAX_ENTRIES = 5000;
const MAX_DEPTH = 5;
const TOP_TABLES = 8;

/** One line of the export: what was measured, and the number. */
export type SizeLine = [label: string, value: string];

async function folderSize(folder: string): Promise<{ files: number; bytes: number; largest: number } | null> {
  const place = await internalPlace(folder);
  let files = 0;
  let bytes = 0;
  let largest = 0;
  let seen = 0;
  const walk = async (path: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || seen > MAX_ENTRIES) return;
    const { files: entries } = await Filesystem.readdir({ path, directory: place.directory });
    for (const entry of entries) {
      seen += 1;
      if (entry.type === "directory") await walk(`${path}/${entry.name}`, depth + 1);
      else {
        files += 1;
        bytes += entry.size ?? 0;
        largest = Math.max(largest, entry.size ?? 0);
      }
    }
  };
  try {
    await walk(place.path, 0);
  } catch {
    return files > 0 ? { files, bytes, largest } : null;
  }
  return { files, bytes, largest };
}

/** The sizes for the export; what cannot be measured is left out. */
export async function storageSizes(db: IDatabaseAdapter | null): Promise<SizeLine[]> {
  const lines: SizeLine[] = [];
  for (const folder of INTERNAL_FOLDERS) {
    const size = await folderSize(folder).catch(() => null);
    if (size) lines.push([`app files ${folder}`, `${size.files} files, ${size.bytes} bytes, largest ${size.largest} bytes`]);
  }
  if (!db) return lines;
  try {
    const pages = await db.queryOne<{ page_count: number }>("PRAGMA page_count");
    const pageSize = await db.queryOne<{ page_size: number }>("PRAGMA page_size");
    if (pages && pageSize) lines.push(["index database", `${Number(pages.page_count) * Number(pageSize.page_size)} bytes`]);
    const tables = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND sql NOT LIKE 'CREATE VIRTUAL%'",
    );
    const counts: Array<[string, number]> = [];
    for (const { name } of tables) {
      // A schema name, quoted as an identifier: it is the app's own, never the person's.
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
      const row = await db.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM "${name}"`).catch(() => null);
      if (row) counts.push([name, Number(row.n)]);
    }
    counts.sort((a, b) => b[1] - a[1]);
    for (const [name, n] of counts.slice(0, TOP_TABLES)) lines.push([`table ${name}`, `${n} rows`]);
  } catch {
    // silent: an index that cannot be asked leaves its lines out; the export is still made.
  }
  return lines;
}
