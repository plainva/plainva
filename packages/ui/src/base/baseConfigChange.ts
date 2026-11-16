import { updateVaultText, type TextFileUpdate, type TextUpdateFiles } from "@plainva/core";
import { parseBaseConfig, serializeBaseConfig } from "./baseFormat";
import { migrateFiltersToPerView } from "./filterExpr";

/**
 * A change to a database's config (a view's columns, sort, filters,
 * pinboard, board; a view added, renamed, moved or removed; a property's
 * settings) applied to the `.base` file AS IT LIES THERE (finding B20 of the
 * 0.9.0 defect list).
 *
 * A database screen holds the config it loaded (`shown`) and makes the new
 * one (`next`) from it. Writing `next` as it is would put the loaded copy of
 * the WHOLE file back — and with it undo whatever another device, window or
 * sync pull wrote to the file since it was loaded. Instead, what the screen
 * changed is found by comparing `next` with `shown`, and only that is set on
 * the file's current config: key by key, views by their identity (their name,
 * as text: a view called `2024` or `true` is the same view, however YAML reads
 * the name), never by their position.
 *
 * Where nobody else changed the file, the current config IS `shown`, and the
 * text written is `serializeBaseConfig(next)`, byte for byte.
 *
 * A change that has nothing left to land on — the view it changes was
 * deleted or renamed meanwhile — is refused (`BaseConfigChangeRefusedError`)
 * and nothing is written: the screen shows its usual failure and reloads.
 */

/** The view a database change was made to is no longer in the file. */
export class BaseConfigChangeRefusedError extends Error {
  constructor(readonly viewName: string) {
    super(`The view "${viewName}" is no longer in this database; it was changed or removed elsewhere. The database was not changed.`);
    this.name = "BaseConfigChangeRefusedError";
  }
}

/** What both shells make of a `.base` text when they open it. */
export function loadBaseConfigText(text: string): any {
  return migrateFiltersToPerView(parseBaseConfig(text));
}

function isPlainObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

/** Same data, as the serializer would see it (`undefined` and a missing key are one). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i])) return false;
    return true;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (!same(a[k], b[k])) return false;
    return true;
  }
  return Number.isNaN(a) && Number.isNaN(b);
}

/**
 * Three-way merge of plain data: what `ours` changed against `base` is set on
 * `theirs`; the rest stays as `theirs` has it. Objects merge key by key (in
 * `ours`' key order, keys only `theirs` has after them); lists and scalars
 * are whole values — `ours` wins where it changed one.
 */
function merge3(base: any, ours: any, theirs: any): any {
  if (same(ours, base)) return theirs;
  if (same(theirs, base)) return ours;
  if (!isPlainObject(base) || !isPlainObject(ours) || !isPlainObject(theirs)) return ours;
  const out: Record<string, any> = {};
  for (const k of Object.keys(ours)) {
    if (ours[k] === undefined && !(k in theirs)) continue;
    const merged = !(k in base) ? (k in theirs ? merge3(undefined, ours[k], theirs[k]) : ours[k]) : merge3(base[k], ours[k], theirs[k]);
    if (merged !== undefined || k in ours) out[k] = merged;
  }
  for (const k of Object.keys(theirs)) {
    if (k in out) continue;
    // Removed here (it was in `base`, `ours` dropped it): stays removed, unless `theirs` changed it.
    if (k in base && !(k in ours) && same(base[k], theirs[k])) continue;
    out[k] = theirs[k];
  }
  return out;
}

/** A view's identity: its name as text, and which of the views with that name it is. */
function viewKeys(views: any[]): string[] {
  const seen = new Map<string, number>();
  return views.map((v) => {
    const name = isPlainObject(v) && v.name != null ? String(v.name) : "";
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    return `${n}\u0000${name}`;
  });
}

function viewName(v: any): string {
  return isPlainObject(v) && v.name != null ? String(v.name) : "";
}

/**
 * Which of `shown`'s views each of `next`'s views is (`-1`: added here). The
 * screens keep an unchanged view as the same object, or deep-clone the whole
 * config: so an untouched view is found by reference, then by equal data; the
 * views left over are the changed ones — in order where as many are left on
 * both sides (an edit, a rename), by name otherwise.
 */
function pairViews(shown: any[], next: any[]): number[] {
  const pair = new Array<number>(next.length).fill(-1);
  const taken = new Set<number>();
  next.forEach((n, j) => {
    const i = shown.findIndex((s, k) => !taken.has(k) && s === n);
    if (i >= 0) { pair[j] = i; taken.add(i); }
  });
  next.forEach((n, j) => {
    if (pair[j] >= 0) return;
    // At its own place first: a view changed to look like another is not taken for that one.
    const i = j < shown.length && !taken.has(j) && same(shown[j], n) ? j : shown.findIndex((s, k) => !taken.has(k) && same(s, n));
    if (i >= 0) { pair[j] = i; taken.add(i); }
  });
  const leftShown = shown.map((_, i) => i).filter((i) => !taken.has(i));
  const leftNext = next.map((_, j) => j).filter((j) => pair[j] < 0);
  if (leftShown.length === leftNext.length) {
    leftNext.forEach((j, k) => { pair[j] = leftShown[k]; });
    return pair;
  }
  for (const j of leftNext) {
    const i = leftShown.find((k) => !taken.has(k) && viewName(shown[k]) === viewName(next[j]));
    if (i !== undefined) { pair[j] = i; taken.add(i); }
  }
  return pair;
}

/** The views of the file now, with the screen's change to its views applied. */
function mergeViews(shown: any[], next: any[], current: any[], paired?: number[]): any[] {
  const pair = paired ?? pairViews(shown, next);
  const shownKeys = viewKeys(shown);
  const currentKeys = viewKeys(current);
  /** The file's view each of `shown`'s views is now (`-1`: gone). */
  const inCurrent = shownKeys.map((k) => currentKeys.indexOf(k));
  const known = new Set(inCurrent.filter((c) => c >= 0));

  // What each of `next`'s views becomes; `null` where it is not written.
  const made: Array<{ view: any; at: number } | null> = next.map((n, j) => {
    const i = pair[j];
    if (i < 0) return { view: n, at: -1 };
    const c = inCurrent[i];
    if (c < 0) {
      // Gone from the file: left alone here, nothing to do; changed here, nothing to land on.
      if (same(n, shown[i])) return null;
      throw new BaseConfigChangeRefusedError(viewName(shown[i]));
    }
    return { view: merge3(shown[i], n, current[c]), at: c };
  });

  // Moved here (the screen's views stand in another order than it found them): its order;
  // otherwise the file's, so a move made elsewhere stays.
  const pairedOrder = pair.filter((i) => i >= 0);
  const reordered = pairedOrder.some((i, k) => k > 0 && i < pairedOrder[k - 1]);

  const out: any[] = [];
  if (reordered) {
    for (const m of made) if (m) out.push(m.view);
    // Views only the file has (added elsewhere) after them, in the file's order.
    current.forEach((c, ci) => { if (!known.has(ci)) out.push(c); });
    return out;
  }
  // The file's order: its views, each as changed here; a view removed here is left out.
  const removed = new Set(inCurrent.filter((c, i) => c >= 0 && !pair.includes(i)));
  const byCurrent = new Map<number, any>();
  for (const m of made) if (m && m.at >= 0) byCurrent.set(m.at, m.view);
  current.forEach((c, ci) => {
    if (removed.has(ci)) return;
    out.push(byCurrent.has(ci) ? byCurrent.get(ci) : c);
  });
  // Views added here, after the view they follow in `next`.
  made.forEach((m, j) => {
    if (!m || m.at >= 0) return;
    let at = 0;
    for (let p = j - 1; p >= 0; p--) {
      const prev = made[p];
      const idx = prev ? out.indexOf(prev.view) : -1;
      if (idx >= 0) { at = idx + 1; break; }
    }
    out.splice(at, 0, m.view);
  });
  return out;
}

/**
 * The config to write: `next`'s change against `shown`, applied to `current`
 * (all three in-memory configs as `loadBaseConfigText` makes them).
 */
export function rebaseBaseConfig(shown: any, next: any, current: any, pairedViews?: number[]): any {
  if (same(current, shown)) return next;
  const s = isPlainObject(shown) ? shown : {};
  const n = isPlainObject(next) ? next : {};
  const c = isPlainObject(current) ? current : {};
  const strip = (cfg: Record<string, any>) => {
    const { views: _views, ...rest } = cfg;
    return rest;
  };
  const rest = merge3(strip(s), strip(n), strip(c));
  const list = (cfg: Record<string, any>) => (Array.isArray(cfg.views) ? cfg.views : []);
  const views = same(list(n), list(s)) ? c.views : mergeViews(list(s), list(n), list(c), pairedViews);
  const out: Record<string, any> = {};
  let placed = false;
  for (const k of Object.keys(n)) {
    if (k === "views") { out.views = views; placed = true; }
    else if (k in rest) out[k] = rest[k];
  }
  for (const k of Object.keys(rest)) if (!(k in out)) out[k] = rest[k];
  if (!placed && views !== undefined) out.views = views;
  return out;
}

/**
 * The text of the file once the change is applied to `currentText`.
 *
 * Compared as the file reads: a screen keeps the config it saved, not what
 * the file reads back as (a view without a name is written with one, an old
 * spelling is written anew) — so `shown` and `next` are read back through the
 * serializer before they are compared with the file. Where the file is what
 * the screen loaded or last wrote, `next` is written as it is.
 */
export function rebaseBaseConfigText(shown: any, next: any, currentText: string): { config: any; text: string } {
  const shownText = serializeBaseConfig(shown);
  const current = loadBaseConfigText(currentText);
  if (currentText === shownText || same(current, shown)) return { config: next, text: serializeBaseConfig(next) };
  const shownRead = loadBaseConfigText(shownText);
  const nextRead = loadBaseConfigText(serializeBaseConfig(next));
  // Which view is which is told by the screen's own objects (an untouched view
  // is the same object, or equal data); read back, the file-wide options move
  // to whichever view comes first and would make a moved view look changed.
  const views = (cfg: any): any[] => (Array.isArray(cfg?.views) ? cfg.views : []);
  const paired =
    views(shown).length === views(shownRead).length && views(next).length === views(nextRead).length
      ? pairViews(views(shown), views(next))
      : undefined;
  const config = rebaseBaseConfig(shownRead, nextRead, current, paired);
  return { config, text: serializeBaseConfig(config) };
}

/** The config writes in flight, per storage and path: one after the other. */
const inFlight = new WeakMap<object, Map<string, Promise<unknown>>>();

/**
 * Writes a database config change through the vault's chain, read and
 * written in one step (`updateVaultText`). Answers the config the file now
 * holds and what the write did. Throws `BaseConfigChangeRefusedError` (nothing
 * written) where the change has nothing left to land on.
 *
 * Changes to one file go one after the other: a screen makes its next change
 * from the config it shows, which already holds the change before, so the
 * next one must read the file only once that one is written — or it would
 * take the change before for one undone elsewhere.
 */
export function writeBaseConfigChange(
  files: TextUpdateFiles,
  path: string,
  shown: any,
  next: any,
): Promise<{ config: any; update: TextFileUpdate }> {
  let byPath = inFlight.get(files);
  if (!byPath) inFlight.set(files, (byPath = new Map()));
  const before = byPath.get(path) ?? Promise.resolve();
  const run = before.catch(() => {}).then(async () => {
    let config: any = next;
    const update = await updateVaultText(files, path, (text) => {
      const made = rebaseBaseConfigText(shown, next, text);
      config = made.config;
      return made.text;
    });
    return { config, update };
  });
  byPath.set(path, run);
  const done = () => { if (byPath.get(path) === run) byPath.delete(path); };
  run.then(done, done);
  return run;
}
