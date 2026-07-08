import { parseBaseConfig, serializeBaseConfig } from "./baseFormat";
import { parseSourceClause, type SourceClause } from "../components/base/filterExpr";
import { isValidNewPropertyName } from "../components/base/renameProperty";

/**
 * Config side of reverse-relation columns (Gesamtplan Base-Relationen, P6):
 * pure mutators over the in-memory `.base` config shape plus the single
 * cross-file writer used by the "Auf Ziel anzeigen" flow. Everything except
 * writeReverseColumnChange is side-effect free and unit-testable.
 */

export interface BaseFileAdapter {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
}

function clone(config: any): any {
  return config == null ? {} : JSON.parse(JSON.stringify(config));
}

function normPath(p: unknown): string {
  return String(p ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Name of the column in `config` whose reverseOf matches {sourceBasePath, sourceProperty}, or null. */
export function findReverseColumn(config: any, sourceBasePath: string, sourceProperty: string): string | null {
  const cols = config?.columns;
  if (!cols || typeof cols !== "object" || Array.isArray(cols)) return null;
  for (const [name, col] of Object.entries<any>(cols)) {
    const rev = col?.reverseOf;
    if (rev && normPath(rev.base) === normPath(sourceBasePath) && rev.property === sourceProperty) {
      return name;
    }
  }
  return null;
}

/**
 * Adds a reverse column and appends it to every view's explicit `order`.
 * Views without an order stay without one — the always-set query enrichment
 * makes the column show up there automatically.
 */
export function addReverseColumnToConfig(
  config: any,
  opts: { name: string; sourceBasePath: string; sourceProperty: string }
): any {
  const nc = clone(config);
  if (!nc.columns || typeof nc.columns !== "object" || Array.isArray(nc.columns)) nc.columns = {};
  nc.columns[opts.name] = { reverseOf: { base: opts.sourceBasePath, property: opts.sourceProperty } };
  if (Array.isArray(nc.views)) {
    for (const v of nc.views) {
      if (v && typeof v === "object" && Array.isArray(v.order) && v.order.length > 0 && !v.order.includes(opts.name)) {
        v.order.push(opts.name);
      }
    }
  }
  return nc;
}

/**
 * Sets an Obsidian `displayName` for a column (stored on `_obsidian.properties`,
 * round-tripped by serializeBaseConfig and honored by columnLabel). Lets an
 * auto-created column keep a stable, portable frontmatter key while showing a
 * localized header. No-op for an empty label.
 */
export function setColumnDisplayName(config: any, columnKey: string, displayName: string): any {
  const nc = clone(config);
  if (!displayName || !displayName.trim()) return nc;
  if (!nc._obsidian || typeof nc._obsidian !== "object" || Array.isArray(nc._obsidian)) nc._obsidian = {};
  if (!nc._obsidian.properties || typeof nc._obsidian.properties !== "object" || Array.isArray(nc._obsidian.properties)) {
    nc._obsidian.properties = {};
  }
  const id = `note.${columnKey}`;
  const entry =
    nc._obsidian.properties[id] && typeof nc._obsidian.properties[id] === "object"
      ? nc._obsidian.properties[id]
      : {};
  entry.displayName = displayName;
  nc._obsidian.properties[id] = entry;
  return nc;
}

/**
 * One-click sub-items setup: reuse an existing self-relation column as the
 * parent property, or create one (stable key `parent`, limit 1), and ensure the
 * computed reverse column exists. Auto-created columns keep stable, portable
 * frontmatter keys (`parent` / `subitems`) and carry a localized, paired
 * `displayName` (label.parentItem / label.subItems) instead of a raw key in the
 * header. Pure — the caller sets `views[i].subItemsProperty` and saves.
 */
export function enableSubItemsConfig(
  config: any,
  selfBasePath: string,
  labels: { parentItem: string; subItems: string }
): { config: any; parentProperty: string } {
  let nc = clone(config);
  if (!nc.columns || typeof nc.columns !== "object" || Array.isArray(nc.columns)) nc.columns = {};
  let parentCol = Object.entries<any>(nc.columns).find(
    ([, c]) =>
      c && typeof c === "object" && c.input === "relation" && normPath(c.relationBase) === normPath(selfBasePath) && !c.reverseOf
  )?.[0];
  if (!parentCol) {
    parentCol = "parent";
    let n = 2;
    while (nc.columns[parentCol] !== undefined) parentCol = `parent${n++}`;
    nc.columns[parentCol] = { input: "relation", relationBase: selfBasePath, relationLimit: "one" };
    nc = setColumnDisplayName(nc, parentCol, labels.parentItem);
  }
  if (!findReverseColumn(nc, selfBasePath, parentCol)) {
    let revName = "subitems";
    let n = 2;
    while (nc.columns[revName] !== undefined) revName = `subitems${n++}`;
    nc = addReverseColumnToConfig(nc, { name: revName, sourceBasePath: selfBasePath, sourceProperty: parentCol });
    nc = setColumnDisplayName(nc, revName, labels.subItems);
  }
  return { config: nc, parentProperty: parentCol };
}

/** Removes a reverse column and strips it from every view's order/sort/widths. */
export function removeReverseColumnFromConfig(config: any, name: string): any {
  const nc = clone(config);
  if (nc.columns && typeof nc.columns === "object" && !Array.isArray(nc.columns)) {
    delete nc.columns[name];
  }
  // Also scrub the raw _obsidian property entry: serializeBaseConfig merges it
  // back verbatim, and a stale plainva block would resurrect the column as a
  // ghost on the next parse (same trap renamePropertyInConfig guards against).
  const rawProps = nc._obsidian?.properties;
  if (rawProps && typeof rawProps === "object" && !Array.isArray(rawProps)) {
    const id = `note.${name}`;
    const entry = rawProps[id];
    if (entry && typeof entry === "object") {
      delete entry.plainva;
      if (Object.keys(entry).length === 0) delete rawProps[id];
    }
  }
  if (Array.isArray(nc.views)) {
    for (const v of nc.views) {
      if (!v || typeof v !== "object") continue;
      if (Array.isArray(v.order)) v.order = v.order.filter((c: any) => c !== name);
      if (Array.isArray(v.sort)) {
        v.sort = v.sort.filter((s: any) => !(s && typeof s === "object" && (s.property ?? s.field) === name));
      }
      if (v.widths && typeof v.widths === "object" && name in v.widths) delete v.widths[name];
    }
  }
  return nc;
}

/**
 * Repairs reverseOf pointers after the owning property was renamed in the
 * source base. Returns the patched config, or null when nothing pointed at
 * {sourceBasePath, oldProperty} (no write needed).
 */
export function retargetReverseColumns(
  config: any,
  sourceBasePath: string,
  oldProperty: string,
  newProperty: string
): any | null {
  const nc = clone(config);
  const cols = nc.columns;
  let hit = false;
  if (cols && typeof cols === "object" && !Array.isArray(cols)) {
    for (const col of Object.values<any>(cols)) {
      const rev = col?.reverseOf;
      if (rev && normPath(rev.base) === normPath(sourceBasePath) && rev.property === oldProperty) {
        rev.property = newProperty;
        hit = true;
      }
    }
  }
  return hit ? nc : null;
}

/** True when `name` is usable as a fresh reverse-column name in the target config. */
export function isValidReverseColumnName(name: string, targetConfig: any): boolean {
  const cols = targetConfig?.columns;
  const existing = cols && typeof cols === "object" && !Array.isArray(cols) ? Object.keys(cols) : [];
  return isValidNewPropertyName(name, existing, "");
}

function firstSource(config: any, type: "folder" | "tag"): string | null {
  for (const list of [config?.filters?.and, config?.filters?.or]) {
    if (!Array.isArray(list)) continue;
    for (const f of list) {
      const clause = parseSourceClause(f);
      if (clause && clause.type === type) return clause.value;
    }
  }
  return null;
}

/** First folder source condition of the config ("where do this base's notes live"). */
export function sourceFolderOfConfig(config: any): string | null {
  return firstSource(config, "folder");
}

/** First tag source condition of the config. */
export function sourceTagOfConfig(config: any): string | null {
  return firstSource(config, "tag");
}

export interface NewItemTarget {
  /** Resolved storage folder for new items, or null when a dialog must decide. */
  folder: string | null;
  /** Distinct folder source values (and-list first, then or-list). */
  folderSources: string[];
  /** Tags a new item must carry to become a member: every and-tag; when the
   * base has neither folder sources nor and-tags, the first or-tag. */
  inheritTags: string[];
  /** Why `folder` is null: "setup" = no folder source exists yet, "choice" =
   * several folder sources and no (valid) persisted preference. */
  pending: "setup" | "choice" | null;
}

/**
 * Where a NEW item of this base is stored and what it inherits to become a
 * member (plan Base-Neu P2). Resolution order: the persisted `newItemFolder`
 * (when the base has no folder sources, e.g. tag-only, any folder is valid;
 * otherwise it must still be one of them), else the single folder source,
 * else a pending dialog. Shared by the header's "Neu" button and the relation
 * picker's inline "Neue Notiz anlegen".
 */
export function resolveNewItemTarget(config: any): NewItemTarget {
  const clausesOf = (list: any): SourceClause[] =>
    (Array.isArray(list) ? list : [])
      .map(parseSourceClause)
      .filter((c): c is SourceClause => c != null);
  const and = clausesOf(config?.filters?.and);
  const or = clausesOf(config?.filters?.or);

  const folderSources: string[] = [];
  for (const c of [...and, ...or]) {
    if (c.type === "folder" && !folderSources.includes(c.value)) folderSources.push(c.value);
  }
  const andTags = and.filter((c) => c.type === "tag").map((c) => c.value);
  const orTags = or.filter((c) => c.type === "tag").map((c) => c.value);
  const inheritTags =
    andTags.length > 0 ? andTags : folderSources.length === 0 && orTags.length > 0 ? [orTags[0]] : [];

  const preferred =
    typeof config?.newItemFolder === "string" && config.newItemFolder.trim() ? config.newItemFolder : null;
  let folder: string | null = null;
  let pending: "setup" | "choice" | null = null;
  if (preferred && (folderSources.length === 0 || folderSources.includes(preferred))) folder = preferred;
  else if (folderSources.length === 1) folder = folderSources[0];
  else if (folderSources.length === 0) pending = "setup";
  else pending = "choice";
  return { folder, folderSources, inheritTags, pending };
}

/**
 * The only cross-file `.base` writer: read → parse → mutate → serialize →
 * write, then notify any open viewer of that file via the same
 * `plainva-external-update` event the sync/watcher path dispatches.
 * A mutate returning null/undefined skips the write entirely (no-op repair).
 * Returns true when the file was written.
 */
export async function writeReverseColumnChange(
  adapter: BaseFileAdapter,
  targetBasePath: string,
  mutate: (cfg: any) => any
): Promise<boolean> {
  const text = await adapter.readTextFile(targetBasePath);
  const next = mutate(parseBaseConfig(text));
  if (next == null) return false;
  await adapter.writeTextFile(targetBasePath, serializeBaseConfig(next));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("plainva-external-update", { detail: { path: targetBasePath } }));
  }
  return true;
}
