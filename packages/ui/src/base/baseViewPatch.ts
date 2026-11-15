import { parseBaseConfig, serializeBaseConfig } from "./baseFormat";
import { migrateFiltersToPerView } from "./filterExpr";

/**
 * A change of a database's view, applied to the file as it is when it is
 * written (review of the pinboard fix, 15.11.): an open database never writes
 * back the whole configuration it read when it opened. A delete in the app
 * takes the deleted notes out of every pinboard's lists on disk
 * (`dropPinboardRefs`), a move retargets them (`sweepPinboardRefs`), another
 * device or program changes the file — and the next pin, drag or column order
 * of the open board wrote its old copy back over all of it: the deleted path
 * came back, and a new note of that name took its place.
 *
 * A patch is the keys of the view to set (`undefined` takes one out), or a
 * function of the view as the file holds it now — a pin or a drag computes its
 * lists from the stored ones, never from a copy on screen. Null: nothing to
 * write.
 *
 * The view is the one the screen shows, found by what it is — its name —, not
 * by where it stood: a view another device removed or inserted before it moved
 * the others, and a pin landed in a table that was not on screen. Not found:
 * refused (`BaseViewGoneError`), nothing written. The file is read the way a
 * database is opened (`readBaseConfig`: legacy file-level filters in their
 * views), so what is written and what the screen shows after is what the
 * screen would show after opening it again.
 */
export type BaseViewPatch = Record<string, unknown> | ((view: Record<string, any>) => Record<string, unknown> | null);

/** The view a patch is for, as the screen knows it: its place, its name, and the type it is shown as. */
export interface BaseViewTarget {
  index: number;
  /** `views[i].name` as the screen read it; absent for a view without a name. */
  name?: string | null;
  /** A file with no views shows one of this type; the patch then makes it the file's first. */
  fallbackType?: string;
}

/** The view a patch was for is no longer in the file: renamed or removed elsewhere. Nothing was written. */
export class BaseViewGoneError extends Error {
  readonly code = "BASE_VIEW_GONE";
  constructor(readonly viewName: string | null) {
    super(`The view${viewName ? ` "${viewName}"` : ""} is no longer in the database file: nothing was changed`);
    this.name = "BaseViewGoneError";
  }
}

/** The database file holds no configuration (empty, only comments, a single value): nothing is laid over it. */
export class BaseFileNotConfigError extends Error {
  readonly code = "BASE_FILE_NOT_CONFIG";
  constructor() {
    super("The database file holds no configuration: nothing was changed");
    this.name = "BaseFileNotConfigError";
  }
}

/** A `.base` text as a database opens it: parsed, legacy file-level filters moved into the views. */
export function readBaseConfig(text: string): any {
  return migrateFiltersToPerView(parseBaseConfig(text));
}

/** The index of the view `target` names in `views`, or -1. */
export function findBaseView(views: unknown, target: BaseViewTarget): number {
  if (!Array.isArray(views)) return -1;
  const name = target.name ?? null;
  const nameOf = (v: unknown) => (v && typeof v === "object" && typeof (v as { name?: unknown }).name === "string" ? (v as { name: string }).name : null);
  const named = views.map((v, i) => (nameOf(v) === name ? i : -1)).filter((i) => i >= 0);
  if (named.length === 1) return named[0]!;
  // Several of that name (or none named): only where the screen's place still holds one.
  if (named.includes(target.index)) return target.index;
  return -1;
}

/** `config` with `patch` applied to the view `target` names (a copy), or null where nothing changes. */
export function applyBaseViewPatch(config: unknown, target: BaseViewTarget, patch: BaseViewPatch): any | null {
  const next = JSON.parse(JSON.stringify(config ?? {}));
  const created = !Array.isArray(next.views) || next.views.length === 0;
  if (created) {
    if (!target.fallbackType) throw new BaseViewGoneError(target.name ?? null);
    next.views = [{ type: target.fallbackType }];
  }
  const at = created ? 0 : findBaseView(next.views, target);
  const view = at >= 0 ? next.views[at] : null;
  if (!view || typeof view !== "object") throw new BaseViewGoneError(target.name ?? null);
  const changes = typeof patch === "function" ? patch(view) : patch;
  if (!changes) return null;
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) delete view[key];
    else view[key] = value;
  }
  return next;
}

/**
 * The text of a `.base` file with `update` applied to its configuration as
 * the text holds it — for `updateVaultText`, which reads and writes in one
 * step through the vault's chain. A text that holds no configuration (empty,
 * only comments, a single value) is refused, as one that is no YAML is.
 */
export function baseConfigChange(update: (config: any) => any | null): (text: string) => string | null {
  return (text) => {
    const parsed = readBaseConfig(text);
    if (!parsed || typeof parsed !== "object" || Object.keys(parsed._obsidian ?? {}).length === 0) throw new BaseFileNotConfigError();
    const next = update(parsed);
    return next ? serializeBaseConfig(next) : null;
  };
}

/**
 * Changes of a view that found their file gone (issue 110, E9): kept as what
 * they are — functions of the stored configuration — and applied to the file
 * once it is found, never as the copy the screen held then.
 */
export class ParkedBaseChanges {
  private updates: Array<(config: any) => any | null> = [];
  get waiting(): boolean { return this.updates.length > 0; }
  park(update: (config: any) => any | null): void { this.updates.push(update); }
  /** All of them, in order, as one update of the configuration. */
  composed(): (config: any) => any | null {
    const updates = [...this.updates];
    return (config) => {
      let now = config;
      let any = false;
      for (const update of updates) {
        const next = update(now);
        if (next) { now = next; any = true; }
      }
      return any ? now : null;
    };
  }
  clear(): void { this.updates = []; }
}
