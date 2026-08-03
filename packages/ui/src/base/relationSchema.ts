import {
  addReverseColumnToConfig,
  findReverseColumn,
  removeReverseColumnFromConfig,
  writeReverseColumnChange,
  type BaseFileAdapter,
} from "./baseRelations";

/**
 * Writing a relation, in ONE place (S21).
 *
 * A relation is the only schema edit that touches TWO files: the owning `.base`
 * gets `relationBase`/`relationLimit`, and — if the reverse column is wanted —
 * the TARGET base gets a computed column pointing back. Which file is written,
 * in which order, and what happens when the target IS the owning base was 40
 * lines of orchestration inside the desktop viewer.
 *
 * That is precisely the kind of decision that must not differ between shells:
 * a reverse column written differently on the phone produces a `.base` the
 * desktop reads differently, and Obsidian reads a third way. So the phone does
 * not get its own version of it — both shells call this.
 *
 * What stays shell-specific is the file access itself (`BaseFileAdapter`) and
 * how the owning base is saved, because a rename has to run through the shell's
 * own rename path first.
 */

export interface ReverseIntent {
  action: "create" | "remove";
  /** Column name in the target base. */
  name: string;
}

/** What the editor decided about a relation, ready to be written. */
export interface RelationSchemaWrite {
  /** The owning base. */
  basePath: string;
  /** Property key in the owning base (the NEW name when it was renamed). */
  property: string;
  /** Target `.base` — absent for "any note" relations. */
  relationBase?: string;
  reverseIntent?: ReverseIntent;
}

/**
 * Applies the reverse-column half of a relation edit.
 *
 * `saveOwn` writes the owning base and must already contain the column schema;
 * it is passed in because a rename saves through a different path than a plain
 * schema change. When the target is the owning base itself, the reverse column
 * has to be folded into THAT save — writing it twice would either lose the
 * schema change or race with it.
 *
 * Returns false when the target base could not be written; the owning base is
 * saved either way, so a failure leaves a relation without its reverse column
 * rather than a half-written pair.
 */
export async function applyRelationWrite(
  adapter: BaseFileAdapter,
  write: RelationSchemaWrite,
  saveOwn: (foldIntoOwn: ((cfg: any) => any) | null) => Promise<void>,
): Promise<boolean> {
  const { basePath, property, relationBase, reverseIntent } = write;
  if (!reverseIntent || !relationBase) {
    await saveOwn(null);
    return true;
  }
  const mutate = (cfg: any) =>
    reverseIntent.action === "create"
      ? addReverseColumnToConfig(cfg, { name: reverseIntent.name, sourceBasePath: basePath, sourceProperty: property })
      : removeReverseColumnFromConfig(cfg, reverseIntent.name);

  if (relationBase === basePath) {
    // Self-relation: one file, one write.
    await saveOwn(mutate);
    return true;
  }
  await saveOwn(null);
  try {
    return await writeReverseColumnChange(adapter, relationBase, mutate);
  } catch {
    return false;
  }
}

/**
 * What the editor should offer for a relation, given the target's config.
 *
 * The reverse column either exists already (then the checkbox is on and the
 * name is fixed — renaming it belongs to ITS own column editor, in the other
 * base) or it does not (then a free name is needed). Deriving both from the
 * target config in one place keeps the two shells from disagreeing about when
 * a name counts as taken.
 */
export function reverseColumnState(
  targetConfig: any,
  owningBasePath: string,
  owningProperty: string,
): { existing: string | null } {
  return { existing: findReverseColumn(targetConfig, owningBasePath, owningProperty) };
}

/** The intent implied by toggling "show on target" — null when nothing changes. */
export function reverseIntentFor(
  wanted: boolean,
  existing: string | null,
  name: string,
): ReverseIntent | undefined {
  if (wanted && existing == null) return { action: "create", name: name.trim() };
  if (!wanted && existing != null) return { action: "remove", name: existing };
  return undefined;
}
