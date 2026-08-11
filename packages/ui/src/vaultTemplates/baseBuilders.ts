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

import { serializeRollup, type RollupSpec, type SummaryName } from "@plainva/core";
import { setColumnDisplayName } from "../base/baseRelations";
import type { VaultTemplateBase } from "./types";

/** Plainva palette names (see propertyModel.PALETTE_NAMES) — an option without
 * one gets a deterministic colour derived from its value. */
export type OptionColor = "gray" | "teal" | "blue" | "green" | "amber" | "coral" | "purple" | "pink";

/** A curated select/status/multiselect value, optionally with a palette colour. */
export type OptionSpec = string | { value: string; color?: OptionColor };

export interface ColumnSpec {
  /** Bare frontmatter key (translated per language, kept ASCII/umlaut-free). */
  key: string;
  /** Plainva input type; omit for a computed reverse-relation column. */
  input?: "text" | "number" | "checkbox" | "date" | "datetime" | "select" | "status" | "multiselect" | "list" | "tags" | "url" | "email" | "phone" | "relation";
  /** Curated values for select/status/multiselect columns (translated). */
  options?: OptionSpec[];
  /** Localized header for a column whose KEY must stay stable/portable
   * (`parent`/`subitems`). Written as Obsidian's native `displayName`. */
  displayName?: string;
  /** Relation target `.base` path (for input: "relation"). */
  relationBase?: string;
  /** Cardinality "one" = single link; omit for unlimited. */
  relationLimit?: "one";
  /** Computed reverse column: values come from the owning base's `property`. */
  reverseOf?: { base: string; property: string };
  /** Computed rollup column: aggregates a property of the linked notes. */
  rollup?: RollupSpec;
}

export interface ViewSpec {
  /** Localized, non-empty view name (Obsidian requires it). */
  name: string;
  /** Render type. Everything but `table` is a Plainva render mode: on disk the
   * view degrades to `type: table` plus `plainva.render`, so Obsidian shows a
   * plain table instead of rejecting the file. */
  type: "table" | "board" | "calendar" | "timeline" | "list" | "gallery" | "pinboard";
  /** Board grouping column (bare key). */
  groupBy?: string;
  /** Board tinting: "column" tints the whole column, default only the chip. */
  boardColorMode?: "column";
  /** Calendar/timeline start column (bare key). */
  dateField?: string;
  /** Timeline end column (bare key). */
  endField?: string;
  /** Gallery cover column (bare key holding the image path/URL). */
  coverImage?: string;
  /** Self-relation column that turns this view into a sub-items tree. */
  subItemsProperty?: string;
  /** Pinboard: pinned cards (vault-relative note paths); the list order IS the
   * pinned section's order. */
  pinboardPinned?: string[];
  /** Pinboard: manual order of the unpinned cards (vault-relative paths). */
  pinboardOrder?: string[];
  /** Pinboard: label-chip source; omit for the `tags` default. */
  pinboardFilterBy?: string;
  /** Multi-level sort (bare keys). */
  sort?: { property: string; direction: "ASC" | "DESC" }[];
  /** Column footers, Obsidian's own feature: bare key -> summary name. */
  summaries?: Record<string, SummaryName>;
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
  /** Where the "Neu" button files new entries; defaults to `sourceFolder`
   * (which resolves without a dialog anyway) — set it only to override. */
  newItemFolder?: string;
}

function optionConfig(o: OptionSpec): Record<string, unknown> {
  if (typeof o === "string") return { value: o };
  return o.color ? { value: o.value, color: o.color } : { value: o.value };
}

function columnConfig(c: ColumnSpec): Record<string, unknown> {
  const col: Record<string, unknown> = {};
  if (c.reverseOf) {
    col.reverseOf = { base: c.reverseOf.base, property: c.reverseOf.property };
    return col;
  }
  if (c.rollup) {
    // A rollup carries no `input`: the value is computed, and an input type
    // would offer an editor for a cell that refuses to be edited.
    col.rollup = serializeRollup(c.rollup);
    return col;
  }
  if (c.input) col.input = c.input;
  if (c.options) col.options = c.options.map(optionConfig);
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
    if (v.boardColorMode === "column") view.boardColorMode = "column";
    if (v.dateField) view.dateField = v.dateField;
    if (v.endField) view.endField = v.endField;
    if (v.coverImage) view.coverImage = v.coverImage;
    if (v.subItemsProperty) view.subItemsProperty = v.subItemsProperty;
    if (v.pinboardPinned?.length) view.pinboardPinned = [...v.pinboardPinned];
    if (v.pinboardOrder?.length) view.pinboardOrder = [...v.pinboardOrder];
    if (v.pinboardFilterBy) view.pinboardFilterBy = v.pinboardFilterBy;
    if (v.sort) view.sort = v.sort.map((s) => ({ property: s.property, direction: s.direction }));
    if (v.summaries) view.summaries = { ...v.summaries };
    return view;
  });

  // A single folder source — valid in both Plainva and Obsidian Bases. The
  // folder's managed index.md is NOT excluded via a filter: Obsidian's Bases has
  // no global `contains()` function (a filter like `!contains(file.path, ...)`
  // makes Obsidian reject the whole base), so the exclusion lives in Plainva's
  // query layer instead (VaultQueryService drops OKF reserved names from every
  // base view). In Obsidian the index row shows harmlessly (Plainva-first).
  let config: Record<string, unknown> = {
    filters: { and: [`file.folder == "${spec.sourceFolder}"`] },
    columns,
    views,
  };
  if (spec.newItemTemplate) config.newItemTemplate = spec.newItemTemplate;
  if (spec.newItemFolder) config.newItemFolder = spec.newItemFolder;

  // Localized headers for stable keys (`parent`/`subitems`) go through the same
  // helper the in-app sub-items setup uses, so they land on Obsidian's native
  // `displayName` via `_obsidian` and survive every round-trip.
  for (const c of spec.columns) {
    if (c.displayName) config = setColumnDisplayName(config, c.key, c.displayName);
  }

  return { path: spec.path, config };
}
