import { applyTextShape, editorTextOf, readTextShape, updateVaultText, type TextFileUpdate, type TextUpdateFiles } from "@plainva/core";
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
 * the file's current config.
 *
 * The rules:
 * - Where nobody else changed the file, the text written is
 *   `serializeBaseConfig(next)`, byte for byte — found by comparing texts
 *   first, before anything is parsed.
 * - Objects merge key by key. A single value both sides changed differently
 *   is the screen's: the user's own action wins.
 * - A list of distinct entries (columns in `order`, the cards of a pinboard,
 *   the options of a select property, filter conditions) merges entry by
 *   entry: what the other side added stays added, what it removed stays
 *   removed, what the screen added or removed likewise; the order is the
 *   screen's, an entry only the other side has stands after the entry it
 *   follows there. Any other list (a sort) is one value.
 * - A view of `shown` is found in the file by being EQUAL to one there (the
 *   other side did not touch it; its name aside where the screen never named
 *   it), then by its name where that name is unique on both sides, then — a
 *   view only renamed elsewhere — by being equal but for the name. A name is
 *   compared as text: a view called `2024` or `true` is the same view however
 *   YAML reads the name. A view is never found by its position, and never
 *   guessed: a view the screen changed, removed or moved that cannot be found
 *   with certainty refuses the change (`BaseConfigChangeRefusedError`), and
 *   nothing is written — `viewGone` where the file holds no view left to be
 *   it, `viewUnclear` where it holds views that might be.
 * - A view the screen removed goes, even where the other side changed it: the
 *   user's own action wins. Where both sides removed views until none would
 *   be left, the user's own stay: a database keeps a view.
 * - Which of the screen's views a view of `next` is, is told by the screen's
 *   objects (an untouched view is the same object or equal data, a changed
 *   one keeps its name, a renamed one its data). Both shells save one action
 *   at a time; a view renamed AND changed in one save counts as removed and
 *   added.
 * - At a database with an open conflict the vault's chain applies the change
 *   to the file and to the user's own version, each as it lies there (as for
 *   a cell, Sammelplan § 3.87); the screen goes on with the file's.
 */

export type BaseConfigRefusal = "viewGone" | "viewUnclear";

/** A change to a view that cannot be found in the file with certainty: nothing was written. */
export class BaseConfigChangeRefusedError extends Error {
  constructor(
    readonly reason: BaseConfigRefusal,
    readonly viewName: string,
  ) {
    super(
      reason === "viewGone"
        ? `The view "${viewName}" is no longer in this database; it was removed or renamed elsewhere. The database was not changed.`
        : `The view "${viewName}" cannot be told apart from the other views of this database since it was changed elsewhere. The database was not changed.`,
    );
    this.name = "BaseConfigChangeRefusedError";
  }
}

/** The text each config was read from or written as: the first, cheapest look whether the file is still that text. */
const textOf = new WeakMap<object, string>();

function remember(config: any, text: string): void {
  if (config && typeof config === "object") textOf.set(config, text);
}

/** What both shells make of a `.base` text when they open it. */
export function loadBaseConfigText(text: string): any {
  const config = migrateFiltersToPerView(parseBaseConfig(text));
  // Remembered without its shape (a byte order mark, CRLF): the change compares texts as the serializer writes them.
  remember(config, editorTextOf(text));
  return config;
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

/** Plain data as text, keys sorted and a missing key the same as `undefined` — equal exactly where `same` says so. */
function signature(v: unknown): string {
  if (v === undefined) return "u";
  if (v === null) return "n";
  if (v instanceof Date) return `d${v.getTime()}`;
  if (typeof v === "number") return Number.isNaN(v) ? "NaN" : `#${v}`;
  if (typeof v !== "object") return `${typeof v}:${JSON.stringify(v)}`;
  if (Array.isArray(v)) return `[${v.map(signature).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${signature(o[k])}`).join(",")}}`;
}

/** An entry's identity in a list of distinct entries: a scalar itself, an option its value or label. */
function entryKey(e: unknown): string | null {
  if (typeof e === "string") return `s:${e}`;
  if (typeof e === "number" || typeof e === "boolean") return `${typeof e}:${String(e)}`;
  if (isPlainObject(e)) {
    const k = e.value ?? e.label;
    if (typeof k === "string" || typeof k === "number") return `o:${String(k)}`;
  }
  return null;
}

/** The identities of a list's entries, or `null` where it is no list of distinct entries. */
function entryKeys(list: unknown[]): string[] | null {
  const keys: string[] = [];
  for (const e of list) {
    const k = entryKey(e);
    if (k === null) return null;
    keys.push(k);
  }
  return new Set(keys).size === keys.length ? keys : null;
}

/** A list of distinct entries, merged entry by entry (see the rules above). */
function mergeList(base: unknown[], ours: unknown[], theirs: unknown[]): unknown[] {
  const kb = entryKeys(base);
  const ko = entryKeys(ours);
  const kt = entryKeys(theirs);
  if (!kb || !ko || !kt) return ours;
  const inBase = new Map(kb.map((k, i) => [k, base[i]]));
  const inTheirs = new Map(kt.map((k, i) => [k, theirs[i]]));
  const out: unknown[] = [];
  const outKeys: string[] = [];
  ko.forEach((k, i) => {
    const o = ours[i];
    // Removed there and left as it was here: the removal stands.
    if (inBase.has(k) && !inTheirs.has(k) && same(o, inBase.get(k))) return;
    out.push(inTheirs.has(k) ? merge3(inBase.get(k), o, inTheirs.get(k)) : o);
    outKeys.push(k);
  });
  kt.forEach((k, i) => {
    // Added there (not known here before, not added here too).
    if (inBase.has(k) || outKeys.includes(k) || ko.includes(k)) return;
    let at = 0;
    for (let p = i - 1; p >= 0; p--) {
      const idx = outKeys.indexOf(kt[p]);
      if (idx >= 0) { at = idx + 1; break; }
    }
    out.splice(at, 0, theirs[i]);
    outKeys.splice(at, 0, k);
  });
  return out;
}

/**
 * Three-way merge of plain data: what `ours` changed against `base` is set on
 * `theirs`; the rest stays as `theirs` has it. Objects merge key by key (in
 * `ours`' key order, keys only `theirs` has after them); lists of distinct
 * entries entry by entry; other lists and scalars are whole values — `ours`
 * wins where it changed one.
 */
function merge3(base: any, ours: any, theirs: any): any {
  if (same(ours, base)) return theirs;
  if (same(theirs, base)) return ours;
  if (Array.isArray(ours) && Array.isArray(theirs)) return mergeList(Array.isArray(base) ? base : [], ours, theirs);
  if (!isPlainObject(ours) || !isPlainObject(theirs)) return ours;
  const b = isPlainObject(base) ? base : {};
  const out: Record<string, any> = {};
  for (const k of Object.keys(ours)) {
    if (k in theirs) {
      out[k] = merge3(b[k], ours[k], theirs[k]);
      continue;
    }
    // Removed there and left as it was here: the removal stands.
    if (ours[k] === undefined || (k in b && same(ours[k], b[k]))) continue;
    out[k] = ours[k];
  }
  for (const k of Object.keys(theirs)) {
    if (k in out) continue;
    // Removed here (it was in `base`, `ours` dropped it): stays removed — the user's own action.
    if (k in b && !(k in ours)) continue;
    out[k] = theirs[k];
  }
  return out;
}

function viewName(v: any): string | null {
  return isPlainObject(v) && v.name != null && String(v.name) !== "" ? String(v.name) : null;
}

/** The file-wide options the serializer moves to whichever view comes first: no part of a view's own identity. */
const FILE_WIDE_ON_VIEW = ["fileIconColor", "newItemFolder", "newItemTemplate", "taskList", "contextFilters"];

/** A view as compared for identity: without its name, and without what the file keeps on its first view for the whole file. */
function comparable(v: any): any {
  if (!isPlainObject(v)) return v;
  const c: Record<string, any> = { ...v };
  delete c.name;
  if (isPlainObject(c._obsidian)) {
    const raw: Record<string, any> = { ...c._obsidian };
    delete raw.name;
    if (isPlainObject(raw.plainva)) {
      const pv = { ...raw.plainva };
      for (const k of FILE_WIDE_ON_VIEW) delete pv[k];
      raw.plainva = pv;
    }
    c._obsidian = raw;
  }
  return c;
}

/**
 * Which of `shown`'s views each of `next`'s views is (`-1`: added here). The
 * screens keep an unchanged view as the same object, or deep-clone the whole
 * config: so an untouched view is found by reference, then by equal data
 * (its own place first); a changed one by its name, where that is unique
 * among the views left; a renamed one by being equal but for its name. What
 * is left is added (in `next`) or removed (in `shown`) — never paired by its
 * place: a view added and another renamed in one change are no edit of each
 * other.
 */
function pairViews(shown: any[], next: any[]): number[] {
  const pair = new Array<number>(next.length).fill(-1);
  const taken = new Set<number>();
  const take = (j: number, i: number) => { pair[j] = i; taken.add(i); };
  next.forEach((n, j) => {
    const i = shown.findIndex((s, k) => !taken.has(k) && s === n);
    if (i >= 0) take(j, i);
  });
  next.forEach((n, j) => {
    if (pair[j] >= 0) return;
    const i = j < shown.length && !taken.has(j) && same(shown[j], n) ? j : shown.findIndex((s, k) => !taken.has(k) && same(s, n));
    if (i >= 0) take(j, i);
  });
  const leftShown = () => shown.map((_, i) => i).filter((i) => !taken.has(i));
  const leftNext = () => next.map((_, j) => j).filter((j) => pair[j] < 0);
  for (const j of leftNext()) {
    const name = viewName(next[j]);
    if (name === null) continue;
    const named = leftShown().filter((i) => viewName(shown[i]) === name);
    const alike = leftNext().filter((k) => viewName(next[k]) === name);
    if (named.length === 1 && alike.length === 1) take(j, named[0]);
  }
  for (const j of leftNext()) {
    const alike = leftShown().filter((i) => same(comparable(shown[i]), comparable(next[j])));
    if (alike.length === 1) take(j, alike[0]);
  }
  return pair;
}

/**
 * The file's view each of `shown`'s views is now (`-1`: not found with
 * certainty). `named` are the views as the screen holds them (their own names,
 * none where the screen never gave one); `read` the same views read back
 * through the serializer, comparable with the file's.
 */
function findInFile(named: any[], read: any[], current: any[]): number[] {
  const found = new Array<number>(read.length).fill(-1);
  const taken = new Set<number>();
  const take = (i: number, k: number) => { found[i] = k; taken.add(k); };
  // Each view's identity once, as text: a file of hundreds of views is not compared view by view by view.
  const readSig = read.map((v) => signature(comparable(v)));
  const currentSig = current.map((v) => signature(comparable(v)));
  const equal = (i: number, k: number) => readSig[i] === currentSig[k];
  // 1. Equal to a view of the file: untouched there. Its own place first among equals.
  read.forEach((_, i) => {
    const name = viewName(named[i]);
    const fits = (k: number) => !taken.has(k) && (name === null || viewName(current[k]) === name) && equal(i, k);
    if (i < current.length && fits(i)) return take(i, i);
    const k = current.findIndex((_, k) => fits(k));
    if (k >= 0) take(i, k);
  });
  // 2. By a name that is unique on both sides.
  const count = (list: any[], name: string) => list.filter((v) => viewName(v) === name).length;
  read.forEach((_, i) => {
    if (found[i] >= 0) return;
    const name = viewName(named[i]);
    if (name === null || count(named, name) !== 1 || count(current, name) !== 1) return;
    const k = current.findIndex((v) => viewName(v) === name);
    if (!taken.has(k)) take(i, k);
  });
  // 3. Renamed elsewhere and nothing else: equal but for the name, and only one such.
  read.forEach((_, i) => {
    if (found[i] >= 0) return;
    const ks = current.map((_, k) => k).filter((k) => !taken.has(k) && equal(i, k));
    if (ks.length === 1) take(i, ks[0]);
  });
  return found;
}

interface ViewsMerged {
  views: any[];
  /** Where each of `next`'s views stands in `views` (`-1`: not there). */
  placeOf: number[];
}

/** The views of the file now, with the screen's change to its views applied. */
function mergeViews(shownNamed: any[], shownRead: any[], nextNamed: any[], nextRead: any[], current: any[]): ViewsMerged {
  const pair = pairViews(shownNamed, nextNamed);
  const inFile = findInFile(shownNamed, shownRead, current);
  const known = new Set(inFile.filter((c) => c >= 0));
  /** Views of the file that none of `shown`'s was found as: one of them may be a view not found. */
  const unclaimed = current.some((_, c) => !known.has(c));
  const nameOf = (i: number) => viewName(shownNamed[i]) ?? viewName(shownRead[i]) ?? "";
  const refuse = (i: number): never => {
    throw new BaseConfigChangeRefusedError(unclaimed ? "viewUnclear" : "viewGone", nameOf(i));
  };

  // Moved here (the screen's views stand in another order than it found them),
  // counted among the views the file still has: a move of one it no longer has moves nothing.
  const movedAmong = (order: number[]) => order.some((i, k) => k > 0 && i < order[k - 1]);
  const reordered = movedAmong(pair.filter((i) => i >= 0 && inFile[i] >= 0));
  /** Moved among all its views: a moved view the file holds no certain match for refuses where it might be one there. */
  const movedAtAll = movedAmong(pair.filter((i) => i >= 0));

  // What each of `next`'s views becomes; `null` where it is not written.
  const made: Array<{ view: any; at: number } | null> = nextRead.map((n, j) => {
    const i = pair[j];
    if (i < 0) return { view: n, at: -1 };
    const c = inFile[i];
    if (c < 0) {
      // Not found: left alone here, nothing to do; changed or moved here, nothing to land on with certainty.
      if (same(n, shownRead[i]) && !(movedAtAll && unclaimed)) return null;
      return refuse(i);
    }
    return { view: merge3(shownRead[i], n, current[c]), at: c };
  });
  // Removed here: goes from the file, where it is found; one that cannot be found refuses where it might be one there.
  const removed = new Set<number>();
  shownRead.forEach((_, i) => {
    if (pair.includes(i)) return;
    if (inFile[i] >= 0) removed.add(inFile[i]);
    else if (unclaimed) refuse(i);
  });

  const out: any[] = [];
  if (reordered) {
    // The screen's order; views only the file has (added elsewhere) after them, in the file's order.
    for (const m of made) if (m) out.push(m.view);
    current.forEach((c, ci) => { if (!known.has(ci)) out.push(c); });
  } else {
    // The file's order: its views, each as changed here; a view removed here is left out.
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
  }
  // Both sides removed views until none is left: a database keeps one (the
  // screens never remove the last), so the user's own stay — the ones the
  // file no longer has.
  if (out.length === 0) {
    nextRead.forEach((n, j) => {
      const i = pair[j];
      if (i >= 0 && inFile[i] < 0) {
        made[j] = { view: n, at: -1 };
        out.push(n);
      }
    });
  }
  return { views: out, placeOf: made.map((m) => (m ? out.indexOf(m.view) : -1)) };
}

const viewsOf = (cfg: any): any[] => (isPlainObject(cfg) && Array.isArray(cfg.views) ? cfg.views : []);
const unchangedPlaces = (cfg: any): number[] => viewsOf(cfg).map((_, j) => j);

/** A database change applied to a file's text. */
export interface BaseConfigRebased {
  config: any;
  text: string;
  /** Where each view of `next` stands in `config` (`-1`: not there) — the screen's active view follows its view. */
  placeOf: number[];
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
export function rebaseBaseConfigText(shown: any, next: any, currentText: string): BaseConfigRebased {
  const unchanged = (): BaseConfigRebased => {
    const text = serializeBaseConfig(next);
    remember(next, text);
    return { config: next, text, placeOf: unchangedPlaces(next) };
  };
  // Texts first: nothing is parsed where the file is the text the screen loaded or wrote.
  const known = isPlainObject(shown) ? textOf.get(shown) : undefined;
  if (known !== undefined && known === currentText) return unchanged();
  const shownText = serializeBaseConfig(shown);
  if (shownText === currentText) return unchanged();
  const current = loadBaseConfigText(currentText);
  if (same(current, shown)) return unchanged();

  const shownRead = loadBaseConfigText(shownText);
  const nextRead = loadBaseConfigText(serializeBaseConfig(next));
  const s = isPlainObject(shownRead) ? shownRead : {};
  const n = isPlainObject(nextRead) ? nextRead : {};
  const c = isPlainObject(current) ? current : {};
  const strip = (cfg: Record<string, any>) => {
    const { views: _views, ...rest } = cfg;
    return rest;
  };
  const rest = merge3(strip(s), strip(n), strip(c));
  // Which view is which is told by the screen's own objects (an untouched view
  // is the same object, or equal data), where reading back kept their number.
  const sameCount = viewsOf(shown).length === viewsOf(s).length && viewsOf(next).length === viewsOf(n).length;
  const merged: ViewsMerged = same(viewsOf(n), viewsOf(s))
    ? { views: viewsOf(c), placeOf: findInFile(sameCount ? viewsOf(shown) : viewsOf(s), viewsOf(s), viewsOf(c)) }
    : mergeViews(sameCount ? viewsOf(shown) : viewsOf(s), viewsOf(s), sameCount ? viewsOf(next) : viewsOf(n), viewsOf(n), viewsOf(c));
  const config: Record<string, any> = {};
  let placed = false;
  for (const k of Object.keys(n)) {
    if (k === "views") { config.views = merged.views; placed = true; }
    else if (k in rest) config[k] = rest[k];
  }
  for (const k of Object.keys(rest)) if (!(k in config)) config[k] = rest[k];
  if (!placed) config.views = merged.views;
  const text = serializeBaseConfig(config);
  remember(config, text);
  return { config, text, placeOf: merged.placeOf };
}

/** The config writes in flight, per storage and path: one after the other. */
const inFlight = new WeakMap<object, Map<string, Promise<unknown>>>();

/** What a database change did: the config the FILE now holds, where `next`'s views stand in it, and the write. */
export interface BaseConfigWritten {
  config: any;
  placeOf: number[];
  update: TextFileUpdate;
}

/**
 * Writes a database config change through the vault's chain, read and
 * written in one step (`updateVaultText`). Answers the config the file now
 * holds — at an open conflict the file's, not the user's own version's — and
 * what the write did. Throws `BaseConfigChangeRefusedError` (nothing written)
 * where the change has nothing to land on with certainty.
 *
 * Changes to one file go one after the other: a screen makes its next change
 * from the config it shows, which already holds the change before, so the
 * next one must read the file only once that one is written — or it would
 * take the change before for one undone elsewhere.
 */
export function writeBaseConfigChange(files: TextUpdateFiles, path: string, shown: any, next: any): Promise<BaseConfigWritten> {
  let byPath = inFlight.get(files);
  if (!byPath) inFlight.set(files, (byPath = new Map()));
  const before = byPath.get(path) ?? Promise.resolve();
  const run = before.catch(() => {}).then(async () => {
    // The chain hands the change the file's text and, at an open conflict, the user's own version's: each answered here.
    // Each in its own shape: a byte order mark and CRLF line ends stay as the file has them.
    const made = new Map<string, BaseConfigRebased>();
    const update = await updateVaultText(files, path, (text) => {
      const { text: plain, shape } = readTextShape(text);
      const m = made.get(text) ?? rebaseBaseConfigText(shown, next, plain);
      made.set(text, m);
      return m.text === plain ? text : applyTextShape(m.text, shape);
    });
    const ofFile = made.get(update.before);
    const config = ofFile ? ofFile.config : next;
    // What the file now is, without its shape: the next change's first look.
    remember(config, editorTextOf(update.text));
    return { config, placeOf: ofFile ? ofFile.placeOf : unchangedPlaces(next), update };
  });
  byPath.set(path, run);
  const done = () => { if (byPath.get(path) === run) byPath.delete(path); };
  run.then(done, done);
  return run;
}
