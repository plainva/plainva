import {
  deleteFrontmatterPath,
  extractFrontmatter,
  parseMarkdownAst,
  renameFrontmatterKey,
  updateFrontmatterString,
  OKF_VERSION,
} from "@plainva/core";
import { buildMobilePlanDeps } from "./cascadeDelete";
import { getMobileSettings } from "./mobileSettings";
import {
  applyRelationWrite,
  baseStemOf,
  buildContextScopeRelation,
  computeContextScope,
  createMemberLookup,
  detectEmbedScopeRelations,
  getContextFilters,
  loadBaseInfos,
  buildSourceClause,
  buildUIFilterModel,
  captureFileName,
  captureTimestampName,
  combineFilters,
  deletePropertyFromConfig,
  migrateFiltersToPerView,
  nextItemName,
  parseBaseConfig,
  type ReverseIntent,
  renamePropertyInConfig,
  resolveNewItemTarget,
  serializeBaseConfig,
  setPendingTemplateCaret,
} from "@plainva/ui";
import { noteSaver, vaultOps, type MobileVault } from "./vaultService";
import { syncSoon } from "./syncService";
import { buildNewNoteFromTemplate } from "./templateInteractive";
import { getActiveVaultEntry } from "./vaultRegistry";

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
  // The note may be open in the editor — land its pending keystrokes first
  // so the frontmatter rewrite starts from the live text.
  await noteSaver.flush(notePath);
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
 * Writes a relation's schema (S21): target, cardinality and — if wanted — the
 * computed reverse column in the TARGET base.
 *
 * The two-file orchestration is the shared one the desktop uses; only the file
 * access and the "save my own base" step are ours. Getting this wrong writes a
 * `.base` the desktop then reads differently, so it is deliberately not a
 * second implementation.
 */
export async function writeRelationSchema(
  v: MobileVault,
  basePath: string,
  config: any,
  column: string,
  schema: { relationBase?: string; relationLimit?: "one" },
  reverseIntent?: ReverseIntent,
): Promise<boolean> {
  const adapter = {
    readTextFile: (p: string) => vaultOps.read(v, p),
    writeTextFile: async (p: string, text: string) => {
      await v.files.writeTextFile(p, text);
      if (v.indexer) {
        try {
          await v.indexer.indexFile(await v.adapter.getFileInfo(p));
        } catch {
          /* next full pass repairs it */
        }
      }
    },
  };
  return applyRelationWrite(
    adapter,
    { basePath, property: column, relationBase: schema.relationBase, reverseIntent },
    async (foldIntoOwn) => {
      let next = JSON.parse(JSON.stringify(config ?? {}));
      if (!next.columns || Array.isArray(next.columns)) next.columns = {};
      const col = { ...(next.columns[column] ?? {}), input: "relation" } as Record<string, unknown>;
      if (schema.relationBase) col.relationBase = schema.relationBase;
      else delete col.relationBase;
      if (schema.relationLimit === "one") col.relationLimit = "one";
      else delete col.relationLimit;
      next.columns[column] = col;
      if (foldIntoOwn) next = foldIntoOwn(next);
      await saveBaseConfig(v, basePath, next);
    },
  );
}

/** How many rows an embedded database shows before it says "+N". */
export const EMBED_ROWS = 5;

/**
 * The rows an embedded database shows for its HOST note (S23).
 *
 * A database embedded in a note is almost always meant as "the rows that
 * belong to this note" — the project note listing its tasks. The desktop
 * derives that automatically when the two bases are related, plus any explicit
 * "this note" filter; both readings come from the shared embedScope, because
 * this decides which rows a reader sees and the two shells must not disagree.
 *
 * Unscoped embeds simply return everything, exactly as they do on the desktop.
 */
export async function scopedEmbedRows(
  v: MobileVault,
  embeddedBasePath: string,
  hostNotePath: string,
): Promise<Array<{ path: string; title: string }>> {
  const qs = v.queryService;
  if (!qs) return [];
  const cfg = parseBaseConfig(await vaultOps.read(v, embeddedBasePath));
  const rows = await qs.queryDatabaseFiles(cfg);
  const all = rows
    .map((r: any) => ({ path: String(r["file.path"] ?? ""), title: String(r["file.name"] ?? "") }))
    .filter((r: { path: string }) => !!r.path);

  // Which base does the host note belong to? Without one there is no relation
  // to scope through — an embed in a plain note shows the whole database.
  const hostBase = await resolveGoverningBaseOf(v, hostNotePath);
  const relations = hostBase
    ? detectEmbedScopeRelations({
        hostBasePath: hostBase.basePath,
        hostColumns: hostBase.columns,
        embeddedBasePath,
        embeddedColumns: (cfg as any)?.columns ?? {},
        labelOf: (k) => k,
      })
    : [];
  const contextRelations = getContextFilters(cfg).map((prop) =>
    buildContextScopeRelation((cfg as any)?.columns ?? {}, prop, embeddedBasePath, (k) => k),
  );
  const allRelations = [...relations, ...contextRelations];
  if (allRelations.length === 0) return all;

  const scope = await computeContextScope(qs as any, hostNotePath, allRelations, new Set());
  return all.filter((r) => scope.has(r.path));
}

/** The base whose data source contains this note, with its column schema. */
async function resolveGoverningBaseOf(
  v: MobileVault,
  notePath: string,
): Promise<{ basePath: string; columns: Record<string, any> } | null> {
  const deps = buildMobilePlanDeps(v);
  if (!deps) return null;
  const infos = await loadBaseInfos(deps);
  const members = createMemberLookup(deps);
  for (const base of infos) {
    const m = await members(base);
    if (m.set.has(notePath)) return { basePath: base.path, columns: (base.config as any)?.columns ?? {} };
  }
  return null;
}

/** Every `.base` of the vault — the relation target candidates. */
export async function listBasePaths(v: MobileVault): Promise<Array<{ path: string; title: string }>> {
  if (!v.queryService) return [];
  try {
    return await v.queryService.listBases();
  } catch {
    return [];
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

  // Body: the base's own template beats the folder/type rules (whoever set it
  // on the database has already answered the question the rules exist for);
  // otherwise the rules decide, and without either it is the skeleton.
  // Questions are asked in one sheet — cancelling creates nothing (P6).
  const type = getMobileSettings().defaultNoteType;
  const tplPath = typeof config?.newItemTemplate === "string" ? config.newItemTemplate : "";
  const built = await buildNewNoteFromTemplate({
    read: (p) => vaultOps.read(v, p),
    exists: (p) => v.files.exists(p),
    vaultName: (await getActiveVaultEntry()).name || "Plainva",
    folder,
    title: name,
    type,
    explicitTemplate: tplPath,
    fallbackBody: `# ${name}\n`,
  });
  if (!built) return null;
  let content = built.content;

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
  // `{{cursor}}` was measured before the prefill rewrote the frontmatter, so
  // the offset shifts by whatever grew in front of the body.
  if (built.caret !== null) {
    setPendingTemplateCaret({ path, offset: built.caret + (content.length - built.content.length) });
  }
  syncSoon();
  return path;
}

/**
 * Quick capture for the pinboard view (plan Pinboard P4/P6; title popup
 * 2026-07-17): the typed text IS the body — deliberately no template. A typed
 * TITLE becomes the file name and the H1; without one the file gets a
 * timestamp name and the note has no H1. OKF frontmatter + inherited source
 * tags still apply. Returns null when the base has no folder source (caller
 * opens the config).
 */
export async function captureBaseItem(
  v: MobileVault,
  config: any,
  input: { title: string; text: string },
): Promise<string | null> {
  const target = resolveNewItemTarget(config);
  const folder = target.folder ?? target.folderSources[0];
  if (!folder) return null;
  // Title popup semantics (2026-07-17, desktop parity): a typed title becomes
  // the file name AND the H1; without one the file gets a timestamp name and
  // the note has no H1.
  const title = input.title.trim();
  const text = input.text;
  const stem = (title ? captureFileName(title, 80) : null) ?? captureTimestampName(new Date());
  let name = stem;
  for (let n = 2; await v.files.exists(`${folder}/${name}.md`); n++) {
    name = `${stem} ${n}`;
  }
  const path = `${folder}/${name}.md`;
  const body = text.replace(/\s+$/, "");
  const noteBody = title ? `# ${title}\n` + (body ? `\n${body}\n` : "") : body ? `${body}\n` : "";
  let content = `---\ntype: ${getMobileSettings().defaultNoteType}\nokf_version: "${OKF_VERSION}"\n---\n\n${noteBody}`;
  if (target.inheritTags.length > 0) {
    const fmResult = extractFrontmatter(parseMarkdownAst(content));
    const props: Record<string, unknown> = {
      ...((fmResult.success && fmResult.data ? fmResult.data : {}) as Record<string, unknown>),
      tags: target.inheritTags,
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
