/**
 * The storage folder of a database's new items — the ONE question a base
 * without a folder source has to ask (TestFlight feedback Build 91, P2).
 *
 * A tag-sourced base ("Zettel": every note tagged #zettel) has no folder of
 * its own, so the app cannot know where a new entry should be written. The
 * desktop asked ("Wohin sollen neue Einträge?") and remembered the answer in
 * the base; the phone opened the whole configuration sheet in silence and
 * wrote nothing. Both shells now run this one rule: clean the answer, make
 * the folder a source when the base had none, remember it as
 * `newItemFolder`, and carry on with what the user was doing.
 */
import { buildSourceClause } from "./filterExpr";
import { resolveNewItemTarget, type NewItemTarget } from "./baseRelations";
import { baseStemOf } from "./newItemNaming";

export type NewItemFolderMode = "setup" | "choice";

/** Vault-relative, no leading/trailing slashes, trimmed — "" when nothing usable was typed. */
export function cleanNewItemFolder(folder: string): string {
  return folder.replace(/\\/g, "/").trim().replace(/^\/+|\/+$/g, "").trim();
}

/**
 * A clone of `config` with `folder` as the storage folder. In setup mode on a
 * base WITHOUT any source the folder also becomes the source (requirement);
 * a tag-sourced base keeps its membership definition — the folder is only
 * where new items land, the tags make them members. Null when the answer is
 * empty (the vault root is not a storage folder).
 */
export function applyNewItemFolder(config: any, folder: string, mode: NewItemFolderMode): any | null {
  const clean = cleanNewItemFolder(folder);
  if (!clean) return null;
  const nc = JSON.parse(JSON.stringify(config ?? {}));
  const target = resolveNewItemTarget(nc);
  if (mode === "setup" && target.inheritTags.length === 0) {
    if (!nc.filters || typeof nc.filters !== "object") nc.filters = {};
    if (!Array.isArray(nc.filters.and)) nc.filters.and = [];
    const clause = buildSourceClause("folder", clean);
    if (!nc.filters.and.includes(clause)) nc.filters.and.push(clause);
  }
  nc.newItemFolder = clean;
  return nc;
}

/** Which mode the question runs in for this base, or null when no question is needed. */
export function newItemFolderMode(target: NewItemTarget): NewItemFolderMode | null {
  if (target.folder) return null;
  return target.pending === "choice" ? "choice" : "setup";
}

/**
 * The answer to offer before the user types: the persisted folder, the first
 * folder source, else a folder named like the base ("Zettel.base" → "Zettel").
 */
export function suggestNewItemFolder(basePath: string, config: any, target: NewItemTarget = resolveNewItemTarget(config)): string {
  const persisted = typeof config?.newItemFolder === "string" ? cleanNewItemFolder(config.newItemFolder) : "";
  if (persisted) return persisted;
  if (target.folderSources[0]) return cleanNewItemFolder(target.folderSources[0]);
  const dir = basePath.includes("/") ? basePath.slice(0, basePath.lastIndexOf("/")) : "";
  const stem = baseStemOf(basePath);
  return dir ? `${dir}/${stem}` : stem;
}
