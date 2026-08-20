import {
  generateIndexContent,
  isExcludedFromOkfScan,
  isReservedOkfName,
  type VaultQueryService,
} from "@plainva/core";

/**
 * Shared generation of the spec-shaped OKF index.md for a folder.
 *
 * Lifted out of the desktop service (2026-08-20) so the phone can offer the
 * same "generate this folder's overview" action instead of only ever reading
 * one the desktop wrote. The rules themselves — which files are listed, which
 * subfolders get a link, where the backup copy goes — are identical for both
 * shells; only the entry points differ.
 *
 * NOT lifted: adopting an existing note AS the index. That one retargets every
 * incoming link through the desktop rename path and is a separate decision.
 */

/** The slice of a vault adapter this generator needs. */
export interface IndexGenAdapter {
  exists(path: string): Promise<boolean>;
  createDir(path: string): Promise<void>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
}

/** Every indexed markdown path, normalised and minus the excluded areas. */
export async function listMarkdownPaths(queryService: VaultQueryService): Promise<string[]> {
  const rows = await queryService.db.query<{ path: string }>(
    `SELECT path FROM files WHERE mode != 'attachment'`,
  );
  return rows
    .map((r) => r.path.replace(/\\/g, "/"))
    .filter((p) => p.toLowerCase().endsWith(".md") && !isExcludedFromOkfScan(p));
}

/** Creates every missing segment of a directory path, parents first. */
export async function ensureDirs(adapter: IndexGenAdapter, dirPath: string): Promise<void> {
  const parts = dirPath.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!(await adapter.exists(current))) await adapter.createDir(current);
  }
}

/** Snapshots a file under `.plainva/backups/index-md-<stamp>/` before it is replaced. */
export async function backupIndexFile(
  adapter: IndexGenAdapter,
  path: string,
  content: string,
): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `.plainva/backups/index-md-${stamp}/${path}`;
  await ensureDirs(adapter, backupPath.split("/").slice(0, -1).join("/"));
  await adapter.writeTextFile(backupPath, content);
  return backupPath;
}

/**
 * Generates (or regenerates) the spec-shaped index.md for a folder. An
 * existing index.md is backed up first — the caller confirms the overwrite.
 * The vault-root listing declares `okf_version` (SPEC §11).
 */
export async function generateIndexForFolder(opts: {
  adapter: IndexGenAdapter;
  queryService: VaultQueryService;
  folder: string;
  heading: string;
  subfoldersHeading: string;
  /** Auto-updates skip the backup copy (they would flood .plainva/backups). */
  skipBackup?: boolean;
}): Promise<{ indexPath: string; entries: number; overwrote: boolean }> {
  const { adapter, queryService, folder } = opts;
  const paths = await listMarkdownPaths(queryService);
  const lowerPaths = new Set(paths.map((p) => p.toLowerCase()));

  const prefix = folder ? `${folder}/` : "";
  const directFiles = paths.filter(
    (p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/") && !isReservedOkfName(p),
  );

  const titleRows = await queryService.db.query<{ path: string; title: string }>(
    `SELECT path, title FROM files WHERE mode != 'attachment'`,
  );
  const titleMap = new Map(titleRows.map((r) => [r.path.replace(/\\/g, "/"), r.title]));
  const descRows = await queryService.db.query<{ path: string; value: string }>(
    `SELECT f.path AS path, p.value AS value
     FROM properties p JOIN files f ON f.id = p.file_id
     WHERE p.key = 'description'`,
  );
  const descMap = new Map(
    descRows.map((r) => [String(r.path).replace(/\\/g, "/"), String(r.value ?? "")]),
  );

  const subfolders = new Set<string>();
  for (const p of paths) {
    if (!p.startsWith(prefix) || p === prefix) continue;
    const rest = p.slice(prefix.length);
    if (rest.includes("/")) subfolders.add(rest.split("/")[0]);
  }

  const content = generateIndexContent({
    folder,
    heading: opts.heading,
    files: directFiles.map((p) => ({
      path: p,
      title: titleMap.get(p) || undefined,
      description: descMap.get(p) || undefined,
    })),
    subfolders: [...subfolders].map((name) => ({
      name,
      // Only link a subfolder whose own index.md exists (Issue #9): the entry
      // then opens that note in both Plainva and Obsidian.
      hasIndex: lowerPaths.has(`${prefix}${name}/index.md`.toLowerCase()),
    })),
    subfoldersHeading: opts.subfoldersHeading,
    bundleRoot: folder === "",
    managedMarker: true,
  });

  const indexPath = folder ? `${folder}/index.md` : "index.md";
  const overwrote = await adapter.exists(indexPath);
  if (overwrote) {
    const existing = await adapter.readTextFile(indexPath);
    if (!opts.skipBackup) await backupIndexFile(adapter, indexPath, existing);
  }
  await adapter.writeTextFile(indexPath, content);
  return { indexPath, entries: directFiles.length + subfolders.size, overwrote };
}
