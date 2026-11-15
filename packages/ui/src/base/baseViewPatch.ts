import { parseBaseConfig, serializeBaseConfig } from "./baseFormat";

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
 */
export type BaseViewPatch = Record<string, unknown> | ((view: Record<string, any>) => Record<string, unknown> | null);

/** `config` with `patch` applied to the view at `viewIndex` (a copy), or null where nothing changes. */
export function applyBaseViewPatch(config: unknown, viewIndex: number, patch: BaseViewPatch, fallbackType?: string): any | null {
  const next = JSON.parse(JSON.stringify(config ?? {}));
  if (!Array.isArray(next.views) || next.views.length === 0) {
    if (!fallbackType) return null;
    next.views = [{ type: fallbackType }];
  }
  const view = next.views[Math.min(Math.max(0, viewIndex), next.views.length - 1)];
  if (!view || typeof view !== "object") return null;
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
 * step through the vault's chain. `written` hands out what was written.
 */
export function baseConfigChange(update: (config: any) => any | null, written: (config: any) => void): (text: string) => string | null {
  return (text) => {
    const next = update(parseBaseConfig(text));
    if (!next) return null;
    written(next);
    return serializeBaseConfig(next);
  };
}
