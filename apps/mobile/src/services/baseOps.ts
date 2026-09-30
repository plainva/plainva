import { Capacitor } from "@capacitor/core";
import {
  deleteFrontmatterPath,
  renameFrontmatterKey,
} from "@plainva/core";
import { buildMobilePlanDeps } from "./cascadeDelete";
import { getMobileSettings } from "./mobileSettings";
import {
  applyRelationWrite,
  assertFileStillThere,
  baseStemOf,
  buildContextScopeRelation,
  computeContextScope,
  createMemberLookup,
  detectEmbedScopeRelations,
  getContextFilters,
  loadBaseInfos,
  buildSourceClause,
  combineFilters,
  discardPinboardEntry,
  finalizeItemContent,
  finalizePinboardEntry,
  notifyFileOps,
  pinboardDraftLedger,
  planPinboardEntry,
  sweepPinboardDrafts,
  deletePropertyFromConfig,
  migrateFiltersToPerView,
  nextItemName,
  parseBaseConfig,
  type ReverseIntent,
  renamePropertyInConfig,
  resolveNewItemTarget,
  serializeBaseConfig,
  setPendingTemplateCaret,
  viewPrefill,
  writeNoteProperty,
  type PinboardDraft,
  type PinboardDraftLedger,
  type PinboardDraftSweep,
  type PinboardEntryChip,
  type PinboardEntryFiles,
  type PinboardEntryPlan,
  type PinboardEntryResult,
} from "@plainva/ui";
import { noteSaver, vaultOps, type MobileVault } from "./vaultService";
import { syncSoon } from "./syncService";
import { answerTemplateFile, buildNewNoteFromTemplate } from "./templateInteractive";
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

/**
 * Serializes and writes the config through the sync chain, then re-indexes.
 *
 * Only over the file that is there (issue 110, E9): a database moved or
 * deleted outside Plainva while it was open must not come back at its old
 * place — a duplicate of the moved file, or a deletion undone, which sync
 * would carry on. The write throws `VaultFileNotFoundError` then, and the
 * screen looks for the file. `recreate` is the reader's own "Save here again".
 */
export async function saveBaseConfig(v: MobileVault, path: string, config: any, { recreate = false }: { recreate?: boolean } = {}): Promise<void> {
  const text = serializeBaseConfig(config);
  if (!recreate) await assertFileStillThere(v.files, path);
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
 * Writes one property of a row's note through the SHARED write (S1).
 *
 * This used to set `props[col]` directly, and that is wrong in exactly one
 * case: a note may carry the property under a different CASING than the column
 * key ("Frist:" edited through a column `frist`, because the panel capitalizes
 * bare keys for display). The naive write then added a SECOND key next to the
 * first — and clearing the cell deleted a key that was never there, so the old
 * value stayed on screen. The desktop has resolved this since 2026-07-17;
 * `writeNoteProperty` is that resolution, not a second copy of it.
 */
export async function commitCellValue(
  v: MobileVault,
  notePath: string,
  col: string,
  value: unknown,
): Promise<void> {
  // The note may be open in the editor — land its pending keystrokes first
  // so the frontmatter rewrite starts from the live text.
  await noteSaver.flush(notePath, v);
  await writeNoteProperty(
    {
      readTextFile: (p) => vaultOps.read(v, p),
      // vaultOps.save is the conflict-aware adapter chain — snapshot, sync
      // queue, index — so the shared write keeps every guarantee a mobile
      // write has.
      writeTextFile: (p, text) => vaultOps.save(v, p, text),
    },
    notePath,
    col,
    value,
  );
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
/**
 * The `.base` that governs a note - its columns are the alias trail for a
 * renamed property (E2). Exported because the note screen needs it to keep a
 * property comment on the row it belongs to after a column was renamed.
 */
export async function resolveGoverningBaseOf(
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
 * Frontmatter prefill for a fresh base item: what the active view filters on,
 * read by the SHARED rule both shells use (`viewPrefill`, plan Befunde
 * 2026-09-24, E16) — `==` rules typed by the column, `contains` on a list.
 */
export function newItemPrefill(config: any, viewIndex: number): Record<string, unknown> {
  return { ...viewPrefill(config, viewIndex).props };
}

/**
 * What "Entry" made: the new note, the storage-folder question first (no
 * folder decided, or several sources), or nothing because the template's
 * questions were cancelled. Two different nulls used to be one: cancelling
 * the questions sent the person into the folder question.
 */
export type BaseItemResult = { status: "created"; path: string } | { status: "ask-folder" } | { status: "cancelled" };

/**
 * Creates a new item for the base ({stem}_{n} naming, OKF frontmatter,
 * inherited tags from tag sources; E3: the base's newItemTemplate seeds the
 * body). What the item inherits is assembled exactly as on the desktop
 * (`finalizeItemContent`, plan Befunde 2026-09-24, E16): the view's filters
 * pre-fill only keys the template leaves unset, and the source and view tags
 * join the template's tags instead of replacing them — the phone used to
 * overwrite both.
 */
export async function createBaseItem(
  v: MobileVault,
  basePath: string,
  config: any,
  rowCount: number,
  viewIndex = 0,
  /** The folder just answered in the storage-folder question (P2), when the config has not caught up yet. */
  folderOverride?: string,
): Promise<BaseItemResult> {
  const target = resolveNewItemTarget(config);
  // Several folder sources are a QUESTION (plan Befunde 2026-09-24, E16): the
  // phone used to take the first one without saying so. The storage-folder
  // question knows both cases.
  const folder = folderOverride ?? target.folder;
  if (!folder) return { status: "ask-folder" };
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
  if (!built) return { status: "cancelled" };

  // Inherited tags + what the active view filters on, by the shared rule.
  const inherited = viewPrefill(config, viewIndex);
  const tags = [...target.inheritTags];
  for (const tag of inherited.tags) if (!tags.includes(tag)) tags.push(tag);
  const content = finalizeItemContent(built.content, type, tags, inherited.props);

  await vaultOps.save(v, path, content);
  // `{{cursor}}` was measured before the prefill rewrote the frontmatter, so
  // the offset shifts by whatever grew in front of the body.
  if (built.caret !== null) {
    setPendingTemplateCaret({ path, offset: built.caret + (content.length - built.content.length) });
  }
  syncSoon();
  return { status: "created", path };
}

/**
 * A new pinboard entry on the phone (plan Befunde 2026-09-24, E14–E17): the
 * SHARED core (`planPinboardEntry` / `finalizePinboardEntry`) over this shell's
 * normal file paths — the conflict-aware save, the link-safe rename (a move on
 * every other device), the ordinary delete. It replaces `captureBaseItem`,
 * which had drifted from the desktop: its own frontmatter literal, no default
 * template, the ACTIVE labels dropped (a note captured under a label filter
 * vanished from the board it was captured on) and, with several folder
 * sources, silently the first one.
 */
export function pinboardEntryFiles(v: MobileVault): PinboardEntryFiles {
  return {
    exists: (p) => v.files.exists(p),
    // The editor's pending keystrokes land before anything is decided.
    read: async (p) => {
      await noteSaver.flush(p, v);
      return vaultOps.read(v, p);
    },
    write: (p, text) => vaultOps.save(v, p, text),
    rename: (p, stem) => vaultOps.rename(v, p, stem),
    // The person's own draft with nothing in it, a confirmed discard, or what
    // an app that went away during an entry left behind unchanged.
    remove: (p) => vaultOps.remove(v, p, { confirmed: true }),
    // The file's bytes, exactly, on a phone. The web build's Filesystem keeps a
    // text file as the text it was given and hands that back even when bytes
    // are asked for, so there the text IS the file.
    readBytes: async (p) =>
      Capacitor.isNativePlatform() ? v.files.readBinaryFile(p) : new TextEncoder().encode(await v.files.readTextFile(p)),
  };
}

/**
 * This device's record of the drafts it created and has not ended (plan
 * Befunde 2026-09-24, E15) — per vault, in the device's own storage.
 */
export function mobileDraftLedger(v: MobileVault): PinboardDraftLedger {
  return pinboardDraftLedger(v.vaultId);
}

/**
 * What an app that was closed or killed during a pinboard entry left behind,
 * finished when the vault is opened (`usePinboardDraftSweep`): an empty draft
 * goes the way closing its page would have taken it, anything that changed
 * since stays. The same rule the next entry's plan applies first.
 */
export async function sweepMobilePinboardDrafts(v: MobileVault): Promise<PinboardDraftSweep> {
  const swept = await sweepPinboardDrafts(pinboardEntryFiles(v), mobileDraftLedger(v));
  if (swept.removed.length > 0) syncSoon();
  return swept;
}

/**
 * Creates the draft of a new entry in the board's folder. `ask-folder` means
 * the storage-folder question comes first (none decided, or several sources);
 * the caller asks and calls again with the answer.
 */
export async function planMobilePinboardEntry(
  v: MobileVault,
  config: any,
  opts: { viewIndex: number; activeLabels: readonly string[]; labelProperty: string | null; folder?: string },
): Promise<PinboardEntryPlan> {
  const template = typeof config?.newItemTemplate === "string" ? config.newItemTemplate.trim() : "";
  const plan = await planPinboardEntry(pinboardEntryFiles(v), {
    config,
    viewIndex: opts.viewIndex,
    activeLabels: opts.activeLabels,
    labelProperty: opts.labelProperty,
    folder: opts.folder,
    noteType: getMobileSettings().defaultNoteType,
    now: new Date(),
    ledger: mobileDraftLedger(v),
    // The base's default template fills the body; its questions come first.
    template: template
      ? async ({ title, folder }) => {
          const answered = await answerTemplateFile({
            read: (p) => vaultOps.read(v, p),
            exists: (p) => v.files.exists(p),
            vaultName: (await getActiveVaultEntry()).name || "Plainva",
            folder,
            title,
            template,
          });
          return answered === undefined ? undefined : answered === null ? null : { text: answered.text, caret: answered.cursor };
        }
      : undefined,
  });
  if (plan.status === "ready") {
    notifyFileOps([{ type: "create", path: plan.draft.path }]);
    if (plan.draft.caret !== null) setPendingTemplateCaret({ path: plan.draft.path, offset: plan.draft.caret });
    syncSoon();
  }
  return plan;
}

/** Ends an entry — see `finalizePinboardEntry`. Pending keystrokes land first. */
export async function finalizeMobilePinboardEntry(
  v: MobileVault,
  draft: PinboardDraft,
  opts: { title: string; removedChips: readonly PinboardEntryChip[]; intent: "save" | "close" },
): Promise<PinboardEntryResult> {
  await noteSaver.flush(draft.path, v);
  const result = await finalizePinboardEntry(pinboardEntryFiles(v), { draft, ...opts, ledger: mobileDraftLedger(v) });
  syncSoon();
  return result;
}

/** "Discard": an empty entry goes without a question, one with content after `confirm`. */
export async function discardMobilePinboardEntry(
  v: MobileVault,
  draft: PinboardDraft,
  opts: { title: string; confirm: () => Promise<boolean> },
): Promise<"removed" | "kept"> {
  await noteSaver.flush(draft.path, v);
  const outcome = await discardPinboardEntry(pinboardEntryFiles(v), { draft, ...opts, ledger: mobileDraftLedger(v) });
  if (outcome === "removed") syncSoon();
  return outcome;
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
