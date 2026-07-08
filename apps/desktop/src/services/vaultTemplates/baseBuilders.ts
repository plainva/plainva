/**
 * Compact builders for the `.base` databases that ship with some vault
 * templates (Gesamtplan Vault-Template-Datenbanken 2026-07-04). The STRUCTURE —
 * the source filter incl. the index.md exclusion, the column schema shape, the
 * view `order` arrays and the relation/reverse wiring — is assembled here ONCE.
 * Each localized template module only passes translated strings (folder names,
 * property keys, option values, view names, `.base` file names), so the ten
 * language modules cannot structurally drift from one another and the
 * cross-language integrity tests only have to check the strings line up.
 *
 * The returned objects are the IN-MEMORY `.base` config shape the app uses
 * everywhere (`config.columns[bareKey]`, `config.views[i]`, `config.filters`);
 * the scaffolder serializes them to Obsidian-native YAML via
 * `serializeBaseConfig`, so on disk they are byte-identical to an app save.
 */

import type { VaultTemplateBase } from "./types";

export interface ColumnSpec {
  /** Bare frontmatter key (translated per language, kept ASCII/umlaut-free). */
  key: string;
  /** Plainva input type; omit for a computed reverse-relation column. */
  input?: "text" | "number" | "checkbox" | "date" | "datetime" | "select" | "status" | "multiselect" | "list" | "tags" | "url" | "email" | "phone" | "relation";
  /** Curated values for select/status/multiselect columns (translated). */
  options?: string[];
  /** Relation target `.base` path (for input: "relation"). */
  relationBase?: string;
  /** Cardinality "one" = single link; omit for unlimited. */
  relationLimit?: "one";
  /** Computed reverse column: values come from the owning base's `property`. */
  reverseOf?: { base: string; property: string };
}

export interface ViewSpec {
  /** Localized, non-empty view name (Obsidian requires it). */
  name: string;
  type: "table" | "board" | "calendar" | "timeline" | "list" | "gallery";
  /** Board grouping column (bare key). */
  groupBy?: string;
  /** Calendar/timeline start column (bare key). */
  dateField?: string;
  /** Timeline end column (bare key). */
  endField?: string;
  /** Multi-level sort (bare keys). */
  sort?: { property: string; direction: "ASC" | "DESC" }[];
}

export interface BaseSpec {
  /** Vault-relative `.base` path (translated file name, usually at the root). */
  path: string;
  /** The single folder whose notes this database collects. */
  sourceFolder: string;
  columns: ColumnSpec[];
  /** Views; the first one's `order` = `file.name` + every column key. */
  views: ViewSpec[];
  /** Default note template for the "Neu" button (vault-relative .md path). */
  newItemTemplate?: string;
}

function columnConfig(c: ColumnSpec): Record<string, unknown> {
  const col: Record<string, unknown> = {};
  if (c.reverseOf) {
    col.reverseOf = { base: c.reverseOf.base, property: c.reverseOf.property };
    return col;
  }
  if (c.input) col.input = c.input;
  if (c.options) col.options = c.options.map((value) => ({ value }));
  if (c.relationBase) col.relationBase = c.relationBase;
  if (c.relationLimit === "one") col.relationLimit = "one";
  return col;
}

/**
 * Assemble one template database. The first view lists `file.name` followed by
 * every column (in declaration order); further views inherit the query columns
 * automatically, so only the first carries an explicit `order`.
 */
export function defineBase(spec: BaseSpec): VaultTemplateBase {
  const columns: Record<string, unknown> = {};
  for (const c of spec.columns) columns[c.key] = columnConfig(c);

  const order = ["file.name", ...spec.columns.map((c) => c.key)];
  const views = spec.views.map((v, i) => {
    const view: Record<string, unknown> = { type: v.type, name: v.name };
    if (i === 0) view.order = order;
    if (v.groupBy) view.groupBy = v.groupBy;
    if (v.dateField) view.dateField = v.dateField;
    if (v.endField) view.endField = v.endField;
    if (v.sort) view.sort = v.sort.map((s) => ({ property: s.property, direction: s.direction }));
    return view;
  });

  // A single folder source — valid in both Plainva and Obsidian Bases. The
  // folder's managed index.md is NOT excluded via a filter: Obsidian's Bases has
  // no global `contains()` function (a filter like `!contains(file.path, ...)`
  // makes Obsidian reject the whole base), so the exclusion lives in Plainva's
  // query layer instead (VaultQueryService drops OKF reserved names from every
  // base view). In Obsidian the index row shows harmlessly (Plainva-first).
  const config: Record<string, unknown> = {
    filters: { and: [`file.folder == "${spec.sourceFolder}"`] },
    columns,
    views,
  };
  if (spec.newItemTemplate) config.newItemTemplate = spec.newItemTemplate;

  return { path: spec.path, config };
}
