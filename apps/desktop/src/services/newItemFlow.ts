import { getSettingsStore } from "./settingsStore";
import { wikiTargetForPath } from "@plainva/core";
import { templateFolderKey } from "../contexts/VaultContext";
import { parsePropertyFilter } from "@plainva/ui";

/**
 * New-item flow of the `.base` viewer (plan Base-Neu P4/P5): naming, template
 * placeholder interpolation, filter pre-fills and the content assembly for a
 * freshly created item. Everything except the template listing is pure and
 * unit-testable; the storage-folder resolution lives in
 * baseRelations.resolveNewItemTarget (shared with the relation picker).
 */

// Item naming moved to @plainva/ui (R4), template listing/placeholders in
// R3 — both shared with the mobile shell. The database-scope helpers (plan
// Vorlagen-Datenbank-Zuordnung) live there too so both shells filter alike.
export {
  baseStemOf,
  nextItemName,
  applyTemplatePlaceholders,
  listTemplates,
  listTemplatesScoped,
  groupTemplatesForBase,
  templateMatchesBase,
} from "@plainva/ui";
export type { TemplateItem, ScopedTemplateItem } from "@plainva/ui";

/**
 * Pre-fill values from the base's simple AND-filters so a new item is not
 * immediately filtered out of the view (maintainer decision: yes, but never
 * for relation-ish columns). Covered: `==` rules (typed per column input) and
 * `contains` on multiselect columns.
 */
export function collectPrefillValues(
  config: any,
  getInput: (col: string) => string | undefined
): Record<string, any> {
  const out: Record<string, any> = {};
  const list = Array.isArray(config?.filters?.and) ? config.filters.and : [];
  for (const f of list) {
    if (typeof f !== "string") continue;
    const rule = parsePropertyFilter(f);
    if (!rule || !rule.value) continue;
    const col = rule.column.replace(/^note\./, "");
    if (col.startsWith("file.") || col.startsWith("formula.")) continue;
    const input = getInput(col);
    if (input === "relation" || input === "link") continue;
    if (rule.op === "==") {
      out[col] =
        input === "number" && !Number.isNaN(Number(rule.value)) ? Number(rule.value)
          : input === "checkbox" ? rule.value === "true"
            : input === "multiselect" ? [rule.value]
              : rule.value;
    } else if (rule.op === "contains" && input === "multiselect") {
      out[col] = [rule.value];
    }
  }
  return out;
}

/**
 * Relation pre-fill for a new item created inside an auto-scoped embedded base
 * (embedScope "down" direction): the new item links back to the host element
 * so it immediately belongs to the scoped view. The link uses the collision-
 * safe wiki target, matching how the scope query resolves links. Limit-one ->
 * scalar value, unlimited -> single-item list.
 */
export function relationPrefill(
  hostPath: string,
  allPaths: string[],
  relation: { column: string; limitOne: boolean }
): Record<string, any> {
  const link = `[[${wikiTargetForPath(hostPath, allPaths)}]]`;
  return { [relation.column]: relation.limitOne ? link : [link] };
}

// The content builders moved to @plainva/ui (S23) so the phone assembles a
// new note exactly the same way; re-exported here so every import path keeps
// working.
export { buildNewItemContent, buildCaptureContent } from "@plainva/ui";

/** Per-vault configured template folder (same setting the editor's template
 * picker reads; fallback "Templates"). */
export async function getTemplateFolder(vaultPath: string): Promise<string> {
  const store = await getSettingsStore();
  const value = await store.get<string>(templateFolderKey(vaultPath));
  return value?.trim() || "Templates";
}

