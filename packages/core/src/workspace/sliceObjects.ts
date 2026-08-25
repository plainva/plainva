import type { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";
import type { WorkspaceSliceObject } from "./slices.js";

/**
 * Every workspace object with the tags and properties a dynamic slice rule can ask about.
 *
 * This lives in core because BOTH shells need the exact same answer, and a rule that reads
 * tags on one shell and not on the other is worse than a rule that reads nothing anywhere:
 * re-materializing a tag slice against objects with no tags would empty its list and take
 * the access with it. The desktop and the phone therefore ask the same question here.
 */
export async function loadWorkspaceSliceObjects(
  objects: readonly WorkspaceSliceObject[],
  db: IDatabaseAdapter | null
): Promise<WorkspaceSliceObject[]> {
  if (!db) return objects.map((object) => ({ ...object, tags: [], properties: {} }));
  const tagRows = await db.query<{ path: string; tag: string }>(
    `SELECT f.path AS path, t.tag AS tag FROM tags t JOIN files f ON f.id = t.file_id`
  );
  const propertyRows = await db.query<{ path: string; key: string; value: string; type: string }>(
    `SELECT f.path AS path, p.key AS key, p.value AS value, p.type AS type FROM properties p JOIN files f ON f.id = p.file_id`
  );
  const tags = new Map<string, string[]>();
  for (const row of tagRows) tags.set(row.path, [...(tags.get(row.path) ?? []), row.tag]);
  const properties = new Map<string, Record<string, string | number | boolean | null>>();
  for (const row of propertyRows) {
    const values = properties.get(row.path) ?? {};
    values[row.key] = row.type === "number" ? Number(row.value) : row.type === "boolean" ? row.value === "true" : row.value;
    properties.set(row.path, values);
  }
  return objects.map((object) => ({ ...object, tags: tags.get(object.path) ?? [], properties: properties.get(object.path) ?? {} }));
}
