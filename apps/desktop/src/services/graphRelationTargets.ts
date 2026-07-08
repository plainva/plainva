import { upsertFrontmatterKeys, wikiTargetForPath, type IVaultAdapter, type VaultQueryService } from "@plainva/core";
import { parseBaseConfig } from "./baseFormat";
import { requestSaveFlush } from "./saveFlush";

/**
 * Relation options for the connect gesture (P6): dragging note A onto note B
 * offers — besides a plain text link — every `.base` relation property whose
 * database contains A as a row (folder source) and whose target base contains
 * B. Best effort: tag sources and filters are ignored for the offer; writing
 * always goes through frontmatter surgery.
 */

export interface RelationOption {
  propertyKey: string;
  /** Display name of the defining database (base file name). */
  baseName: string;
  limitOne: boolean;
}

interface ParsedBaseLite {
  path: string;
  folderSources: string[];
  relations: { key: string; relationBase: string | null; limitOne: boolean }[];
}

function folderSourcesOf(config: any): string[] {
  const out: string[] = [];
  const list: unknown[] = Array.isArray(config?.filters?.and) ? config.filters.and : [];
  for (const f of list) {
    if (typeof f !== "string") continue;
    const m = f.match(/file\.folder\s*==\s*"([^"]+)"/);
    if (m) out.push(m[1] === "/" ? "" : m[1].replace(/\/$/, ""));
  }
  return out;
}

/** Loads and reduces every `.base` in the vault (errors skip the file). */
export async function loadRelationCatalog(
  adapter: IVaultAdapter,
  queryService: VaultQueryService
): Promise<ParsedBaseLite[]> {
  const paths = await queryService.listBaseFilePaths();
  const out: ParsedBaseLite[] = [];
  for (const path of paths) {
    try {
      const config = parseBaseConfig(await adapter.readTextFile(path));
      const relations: ParsedBaseLite["relations"] = [];
      for (const [key, col] of Object.entries((config?.columns ?? {}) as Record<string, any>)) {
        if (!col || typeof col !== "object") continue;
        if (col.input !== "relation" && !col.relationBase) continue;
        relations.push({
          key,
          relationBase: typeof col.relationBase === "string" ? col.relationBase : null,
          limitOne: col.relationLimit === "one",
        });
      }
      out.push({ path, folderSources: folderSourcesOf(config), relations });
    } catch {
      /* unparseable base: no offers from it */
    }
  }
  return out;
}

function underFolder(path: string, folder: string): boolean {
  if (folder === "") return true;
  return path.startsWith(`${folder}/`);
}

/**
 * Relation properties applicable to source -> target. The source must be a
 * row of the defining base (folder source); the target must be a row of the
 * relation's target base ("self" targets check the same base).
 */
export function findRelationOptions(catalog: ParsedBaseLite[], sourcePath: string, targetPath: string): RelationOption[] {
  const baseByName = new Map<string, ParsedBaseLite>();
  for (const b of catalog) {
    const name = b.path.split(/[/\\]/).pop()!.replace(/\.base$/i, "");
    baseByName.set(name.toLowerCase(), b);
    baseByName.set(b.path.toLowerCase(), b);
  }
  const out: RelationOption[] = [];
  for (const base of catalog) {
    if (base.folderSources.length === 0) continue;
    if (!base.folderSources.some((f) => underFolder(sourcePath, f))) continue;
    for (const rel of base.relations) {
      const targetBase = rel.relationBase ? (baseByName.get(rel.relationBase.toLowerCase()) ?? null) : base;
      if (!targetBase || targetBase.folderSources.length === 0) continue;
      if (!targetBase.folderSources.some((f) => underFolder(targetPath, f))) continue;
      out.push({
        propertyKey: rel.key,
        baseName: base.path.split(/[/\\]/).pop()!.replace(/\.base$/i, ""),
        limitOne: rel.limitOne,
      });
    }
  }
  return out;
}

/**
 * Removes every value of `propertyKey` in `sourcePath` that resolves to
 * `targetPath` (edge context menu "remove relation"). Returns the number of
 * removed values; the key itself is kept (empty list) so the schema stays.
 */
export async function removeRelationLink(
  adapter: IVaultAdapter,
  queryService: VaultQueryService,
  sourcePath: string,
  targetPath: string,
  propertyKey: string
): Promise<number> {
  const notes = await queryService.listNotes();
  const allPaths = notes.map((n) => n.path);
  const { resolveLinkTarget } = await import("@plainva/core");
  const props = await queryService.getFileProperties(sourcePath);
  const raw = props[propertyKey];
  const list = Array.isArray(raw) ? raw.map((v) => String(v)) : raw != null ? [String(raw)] : [];
  const resolves = (value: string): boolean => {
    const m = value.match(/\[\[([^\]|#]+)/);
    const target = (m ? m[1] : value).trim();
    return !!target && resolveLinkTarget(sourcePath, target, allPaths) === targetPath;
  };
  const kept = list.filter((v) => !resolves(v));
  const removed = list.length - kept.length;
  if (removed === 0) return 0;

  await requestSaveFlush(sourcePath);
  const content = await adapter.readTextFile(sourcePath);
  const value = Array.isArray(raw) ? kept : (kept[0] ?? "");
  await adapter.writeTextFile(sourcePath, upsertFrontmatterKeys(content, { [propertyKey]: value }));
  return removed;
}

/**
 * Writes the relation into the source note's frontmatter (surgical): a
 * limit-one relation replaces the value, an unlimited one appends to the
 * list (deduped). Returns the written wiki-link text.
 */
export async function writeRelationLink(
  adapter: IVaultAdapter,
  queryService: VaultQueryService,
  sourcePath: string,
  targetPath: string,
  propertyKey: string,
  limitOne: boolean
): Promise<string> {
  const notes = await queryService.listNotes();
  const allPaths = notes.map((n) => n.path);
  const link = `[[${wikiTargetForPath(targetPath, allPaths)}]]`;

  await requestSaveFlush(sourcePath);
  const content = await adapter.readTextFile(sourcePath);
  let value: unknown = link;
  if (!limitOne) {
    const existing = await queryService.getFileProperties(sourcePath);
    const raw = existing[propertyKey];
    const list = Array.isArray(raw) ? raw.map((v) => String(v)) : raw ? [String(raw)] : [];
    if (!list.includes(link)) list.push(link);
    value = list;
  }
  await adapter.writeTextFile(sourcePath, upsertFrontmatterKeys(content, { [propertyKey]: value }));
  return link;
}
