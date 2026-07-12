import {
  deleteFrontmatterPath,
  extractFrontmatter,
  parseMarkdownAst,
  renameFrontmatterKey,
  updateFrontmatterString,
  OKF_VERSION,
} from "@plainva/core";
import {
  applyTemplatePlaceholders,
  baseStemOf,
  buildSourceClause,
  buildUIFilterModel,
  combineFilters,
  deletePropertyFromConfig,
  migrateFiltersToPerView,
  nextItemName,
  parseBaseConfig,
  renamePropertyInConfig,
  resolveNewItemTarget,
  serializeBaseConfig,
} from "@plainva/ui";
import { vaultOps, type MobileVault } from "./vaultService";
import { syncSoon } from "./syncService";

/**
 * Mobile .base IO (R4): every read/write goes through the SHARED contract —
 * parseBaseConfig/serializeBaseConfig from @plainva/ui (never hand-written
 * YAML, so the Obsidian rules always hold) and the conflict-aware adapter
 * chain (writes sync like any other file).
 */

export interface LoadedBase {
  /** In-memory config (baseFormat shape: columns/views/filters/newItem*). */
  config: any;
  stem: string;
}

export async function loadBase(v: MobileVault, path: string): Promise<LoadedBase> {
  const raw = await vaultOps.read(v, path);
  // Same load-time migration the desktop runs: global property filters move
  // into every view (idempotent), persisted on the next save.
  const config = migrateFiltersToPerView(parseBaseConfig(raw));
  return { config, stem: baseStemOf(path) };
}

/** Desktop queryForActiveView: sources AND the active view's own filters. */
export async function queryView(v: MobileVault, config: any, viewIndex: number): Promise<any[]> {
  if (!v.queryService) return [];
  const views = Array.isArray(config?.views) ? config.views : [];
  const active = views[viewIndex] || views[0] || {};
  const merged = { ...config, filters: combineFilters(config?.filters, active?.filters), views: [active] };
  return v.queryService.queryDatabaseFiles(merged);
}

/** Serializes and writes the config through the sync chain, then re-indexes. */
export async function saveBaseConfig(v: MobileVault, path: string, config: any): Promise<void> {
  const text = serializeBaseConfig(config);
  await v.files.writeTextFile(path, text);
  if (v.indexer) {
    try {
      await v.indexer.indexFile(await v.adapter.getFileInfo(path));
    } catch {
      /* next full pass repairs it */
    }
  }
  syncSoon();
}

/**
 * Writes one property of a row's note (desktop commitCellValue contract):
 * full frontmatter rewrite via the core updater; empty deletes the key.
 */
export async function commitCellValue(
  v: MobileVault,
  notePath: string,
  col: string,
  value: unknown,
): Promise<void> {
  const text = await vaultOps.read(v, notePath);
  const fmResult = extractFrontmatter(parseMarkdownAst(text));
  const props: Record<string, unknown> = {
    ...((fmResult.success && fmResult.data ? fmResult.data : {}) as Record<string, unknown>),
  };
  const empty =
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0);
  if (empty) delete props[col];
  else props[col] = value;
  const newText = updateFrontmatterString(text, props);
  await vaultOps.save(v, notePath, newText);
  syncSoon();
}

/** Candidate rows of a relation's target base (desktop picker contract). */
export async function relationCandidates(
  v: MobileVault,
  relationBase: string | undefined,
): Promise<Array<{ path: string; title: string }>> {
  if (!v.queryService) return [];
  if (!relationBase) return v.queryService.listNotes(300);
  try {
    const raw = await vaultOps.read(v, relationBase);
    const rows = await v.queryService.queryDatabaseFiles(parseBaseConfig(raw));
    return rows
      .map((r: any) => ({ path: String(r["file.path"] ?? ""), title: String(r["file.name"] ?? "") }))
      .filter((r: { path: string }) => !!r.path);
  } catch {
    return v.queryService.listNotes(300);
  }
}

/**
 * Renames a property in the config (shared renamePropertyInConfig) and moves
 * the frontmatter key in every source note (desktop rename contract).
 * Returns the number of rewritten notes.
 */
export async function renameBaseProperty(
  v: MobileVault,
  basePath: string,
  config: any,
  oldName: string,
  newName: string,
  rowPaths: string[],
): Promise<number> {
  const nc = renamePropertyInConfig(config, oldName, newName);
  await saveBaseConfig(v, basePath, nc);
  let changed = 0;
  for (const p of rowPaths) {
    try {
      const text = await vaultOps.read(v, p);
      const next = renameFrontmatterKey(text, oldName, newName);
      if (next !== text) {
        await vaultOps.save(v, p, next);
        changed++;
      }
    } catch {
      /* note lacks the key or already carries the new one — skip */
    }
  }
  if (changed > 0) syncSoon();
  return changed;
}

/**
 * Deletes a property from the config (shared deletePropertyFromConfig) and
 * optionally removes the frontmatter key from the source notes.
 */
export async function deleteBaseProperty(
  v: MobileVault,
  basePath: string,
  config: any,
  name: string,
  rowPaths: string[],
  cleanNotes: boolean,
): Promise<void> {
  const nc = deletePropertyFromConfig(config, name);
  await saveBaseConfig(v, basePath, nc);
  if (cleanNotes) {
    for (const p of rowPaths) {
      try {
        const text = await vaultOps.read(v, p);
        const next = deleteFrontmatterPath(text, [name]);
        if (next !== text) await vaultOps.save(v, p, next);
      } catch {
        /* skip unreadable notes; the column is gone either way */
      }
    }
  }
  syncSoon();
}

/**
 * Frontmatter prefill for a fresh base item (desktop parity): the simple
 * `==` rules of the active view when the top logic is ALL.
 */
export function newItemPrefill(config: any, viewIndex: number): Record<string, unknown> {
  const prefill: Record<string, unknown> = {};
  const views = Array.isArray(config?.views) ? config.views : [];
  const active = views[viewIndex] ?? views[0];
  if (!active) return prefill;
  const model = buildUIFilterModel(active);
  if (model.topLogic !== "all") return prefill;
  for (const e of model.entries) {
    if (e.kind === "rule" && e.rule.op === "==" && e.rule.value !== "") {
      prefill[e.rule.column.replace(/^note\./, "")] = e.rule.value;
    }
  }
  return prefill;
}

/**
 * Creates a new item for the base ({stem}_{n} naming, OKF frontmatter,
 * inherited tags from tag sources; E3: the base's newItemTemplate seeds the
 * body and simple == filters of the active view prefill the frontmatter).
 * Returns the new note's path, or null when the base has no folder source.
 */
export async function createBaseItem(
  v: MobileVault,
  basePath: string,
  config: any,
  rowCount: number,
  viewIndex = 0,
): Promise<string | null> {
  const target = resolveNewItemTarget(config);
  const folder = target.folder ?? target.folderSources[0];
  if (!folder) return null;
  const stem = baseStemOf(basePath);
  const name = await nextItemName(stem, rowCount, (n) => v.files.exists(`${folder}/${n}.md`));
  const path = `${folder}/${name}.md`;

  // Body: the base's template (interpolated, OKF-secured) or the skeleton.
  let content: string | null = null;
  const tplPath = typeof config?.newItemTemplate === "string" ? config.newItemTemplate : "";
  if (tplPath) {
    try {
      const interpolated = applyTemplatePlaceholders(await vaultOps.read(v, tplPath), name);
      content = /^---\r?\n/.test(interpolated)
        ? interpolated
        : `---\ntype: Note\nokf_version: "${OKF_VERSION}"\n---\n\n${interpolated.replace(/^\n+/, "")}`;
    } catch {
      content = null; // missing template falls back to the skeleton
    }
  }
  if (content === null) content = `---\ntype: Note\nokf_version: "${OKF_VERSION}"\n---\n\n# ${name}\n`;

  // Frontmatter prefill: inherited tags + the active view's == filters.
  const prefill = newItemPrefill(config, viewIndex);
  if (target.inheritTags.length > 0) prefill.tags = target.inheritTags;
  if (Object.keys(prefill).length > 0) {
    const fmResult = extractFrontmatter(parseMarkdownAst(content));
    const props: Record<string, unknown> = {
      ...((fmResult.success && fmResult.data ? fmResult.data : {}) as Record<string, unknown>),
      ...prefill,
    };
    content = updateFrontmatterString(content, props);
  }

  await vaultOps.save(v, path, content);
  syncSoon();
  return path;
}

/**
 * Creates a fresh .base in `folder` with one table view sourced on that
 * folder — through serializeBaseConfig, so the Obsidian rules (view name,
 * single-rooted filters) hold from the first byte.
 */
export async function createDatabase(
  v: MobileVault,
  folder: string,
  name: string,
  tableLabel: string,
): Promise<string> {
  const path = folder ? `${folder}/${name}.base` : `${name}.base`;
  const config = {
    filters: { and: folder ? [buildSourceClause("folder", folder)] : [], or: [] },
    columns: {},
    views: [{ type: "table", name: tableLabel, order: ["file.name"] }],
  };
  await v.files.writeTextFile(path, serializeBaseConfig(config));
  if (v.indexer) {
    try {
      await v.indexer.indexFile(await v.adapter.getFileInfo(path));
    } catch {
      /* next full pass repairs it */
    }
  }
  window.dispatchEvent(new CustomEvent("m-vault-changed"));
  syncSoon();
  return path;
}
