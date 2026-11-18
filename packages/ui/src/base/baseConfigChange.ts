import { applyTextShape, editorTextOf, readTextShape, updateVaultText, type TextFileUpdate, type TextUpdateFiles } from "@plainva/core";
import { fromPropId, parseBaseConfig, serializeBaseConfig, toPropId } from "./baseFormat";
import { migrateFiltersToPerView } from "./filterExpr";
import { fittingLineage, type ViewLineage } from "./viewLineage";
// Which view is which, as the screens say it: part of this building block's interface.
export * from "./viewLineage";

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
 *   the options of a select property) merges entry by entry: what the other
 *   side added stays added, what it removed stays removed, what the screen
 *   added or removed likewise; the order is the screen's, an entry only the
 *   other side has stands after the entry it follows there. Any other list (a
 *   sort) is one value.
 * - A filter both sides changed is one value, the screen's: rules merged from
 *   two edits make a filter neither side wrote.
 * - A container the screen emptied (the last summary, the cover that was a
 *   view's last `plainva` key, the last pinned card, the last property) keeps
 *   what the other side added to it meanwhile. An entry the screen removed —
 *   a property, a formula, a summary, a width — goes whole, whatever the other
 *   side set on it; a property goes from `properties` and `columns` alike.
 * - A view of `shown` is found in the file by being EQUAL to one there (the
 *   other side did not touch it) under its name — a view the screen never
 *   named under none, or the one the serializer gave it —, then by its name
 *   where that name is unique on both sides and no unclaimed view of the file
 *   is equal to it under another, then — a view only renamed elsewhere — by
 *   being equal but for the name, as the only such. A view never named is
 *   also found under the name the serializer gives it, or as the only view
 *   without a name left on both sides; a database of one view on both sides
 *   holds the same view. A name is
 *   compared as text: a view called `2024` or `true` is the same view however
 *   YAML reads the name. A view is never found by its position, and never
 *   guessed: a view the screen changed, removed or moved that cannot be found
 *   with certainty refuses the change (`BaseConfigChangeRefusedError`), and
 *   nothing is written — `viewGone` where the file holds no view left to be
 *   it, `viewUnclear` where it holds views that might be.
 * - A view the screen removed goes, even where the other side changed it: the
 *   user's own action wins. Where both sides removed views until none would
 *   be left, the user's own stay: a database keeps a view.
 * - Which of the screen's views a view of `next` is, the screen says where
 *   it knows (`lineage`, `viewLineage.ts`): what it added, removed and moved,
 *   over every change that waits for a moved file. A view removed here and a
 *   new one added under its name are two views — removed AND added — never
 *   the old one changed. Where the screen does not say, it is told by the
 *   screen's objects (an untouched view is the same object or equal data, a
 *   changed one keeps its name, a renamed one its data). Both shells save one
 *   action at a time; a view renamed AND changed in one save counts as
 *   removed and added.
 * - At a database with an open conflict the vault's chain applies the change
 *   to the file and to the user's own version, each as it lies there (as for
 *   a cell, Sammelplan § 3.87); the screen goes on with the file's.
 */

export type BaseConfigRefusal = "viewGone" | "viewUnclear" | "fileChanging";

/** A change to a view that cannot be found in the file with certainty: nothing was written. */
export class BaseConfigChangeRefusedError extends Error {
  constructor(
    readonly reason: BaseConfigRefusal,
    readonly viewName: string,
  ) {
    super(
      reason === "viewGone"
        ? `The view "${viewName}" is no longer in this database; it was removed or renamed elsewhere. The database was not changed.`
        : reason === "viewUnclear"
          ? `The view "${viewName}" cannot be told apart from the other views of this database since it was changed elsewhere. The database was not changed.`
          : "The file of this database is being written elsewhere right now. The database was not changed.",
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
 * Where a value stands in a config or a view (`a/b` from the config's or the
 * view's top; `null` inside a list entry). Rules hang on places, not on key
 * names: a property may be called `filters` or `widths`.
 */
type Place = string | null;
const below = (place: Place, key: string): Place => (place === null ? null : place === "" ? key : `${place}/${key}`);

/** The maps whose entries are things of their own (a property, a formula, a column's summary or width): one the user removed goes whole. */
const ENTITY_PLACES = new Set([
  "properties", "columns", "formulas", "summaries", "widths",
  "_obsidian/properties", "_obsidian/formulas", "_obsidian/summaries", "_obsidian/plainva/widths",
]);
/** The filter of the file and of each view: one value — a filter both sides changed is the user's (a rule merged from two edits means what neither wrote). */
const WHOLE_PLACES = new Set(["filters", "_obsidian/filters"]);

/** The empty container of a value's kind (`undefined` for a scalar): what a container the user emptied reads as. */
function emptyOf(v: unknown): unknown {
  if (Array.isArray(v)) return [];
  if (isPlainObject(v)) return {};
  return undefined;
}

function isEmptyContainer(v: unknown): boolean {
  return (Array.isArray(v) && v.length === 0) || (isPlainObject(v) && Object.keys(v).every((k) => v[k] === undefined));
}

/**
 * Three-way merge of plain data: what `ours` changed against `base` is set on
 * `theirs`; the rest stays as `theirs` has it. Objects merge key by key (in
 * `ours`' key order, keys only `theirs` has after them); lists of distinct
 * entries entry by entry; other lists, filters and scalars are whole values —
 * `ours` wins where it changed one. `place` is where the value stands in a
 * config or a view ("" at its top).
 *
 * A key `ours` no longer has (it was in `base`) is the user's removal: a
 * scalar, a filter, or an entry of an ENTITY_PLACES map (a property deleted)
 * goes whole, whatever `theirs` did to it. Any other container — the
 * serializer drops one the user emptied (the last summary, the cover that was
 * a view's last `plainva` key, the last property) — reads as emptied: what was
 * in it goes, what `theirs` added to it since stays.
 */
function merge3(base: any, ours: any, theirs: any, place: Place = null): any {
  if (same(ours, base)) return theirs;
  if (same(theirs, base)) return ours;
  if (place !== null && WHOLE_PLACES.has(place)) return ours;
  if (Array.isArray(ours) && Array.isArray(theirs)) return mergeList(Array.isArray(base) ? base : [], ours, theirs);
  if (!isPlainObject(ours) || !isPlainObject(theirs)) return ours;
  const b = isPlainObject(base) ? base : {};
  const entities = place !== null && ENTITY_PLACES.has(place);
  const out: Record<string, any> = {};
  const has = (o: Record<string, any>, k: string) => o[k] !== undefined;
  const keys = [...Object.keys(ours), ...Object.keys(theirs).filter((k) => !(k in ours))];
  for (const k of keys) {
    if (has(ours, k) && has(theirs, k)) { out[k] = merge3(b[k], ours[k], theirs[k], below(place, k)); continue; }
    if (has(ours, k)) {
      // Removed there and left as it was here: the removal stands.
      if (has(b, k) && same(ours[k], b[k])) continue;
      out[k] = ours[k];
      continue;
    }
    if (!has(theirs, k)) continue;
    if (!has(b, k)) { out[k] = theirs[k]; continue; } // added there
    // Removed here (the user's own action).
    const at = below(place, k);
    const emptied = entities || (at !== null && WHOLE_PLACES.has(at)) ? undefined : emptyOf(b[k]);
    if (emptied === undefined) continue;
    const kept = merge3(b[k], emptied, theirs[k], at);
    if (!isEmptyContainer(kept)) out[k] = kept;
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
 * among the views left (a view never named by the name the serializer gives
 * it); a renamed one by being equal but for its name. Where as many views
 * are left on both sides, one action changed them in place (a property
 * deleted from every view showing it): they pair in their order, each under
 * the name it had. Otherwise
 * what is left is added (in `next`) or removed (in `shown`): a view added and
 * another renamed in one change are no edit of each other.
 */
function pairViews(shown: any[], next: any[], shownRead: any[], nextRead: any[]): number[] {
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
  // A view the screen never named goes by the name the serializer gives it:
  // the same where the change made to it added, removed or moved no view.
  const shownName = (i: number) => viewName(shown[i]) ?? viewName(shownRead[i]);
  const nextName = (j: number) => viewName(next[j]) ?? viewName(nextRead[j]);
  for (const j of leftNext()) {
    const name = nextName(j);
    if (name === null) continue;
    const named = leftShown().filter((i) => shownName(i) === name);
    const alike = leftNext().filter((k) => nextName(k) === name);
    if (named.length === 1 && alike.length === 1) take(j, named[0]);
  }
  for (const j of leftNext()) {
    const alike = leftShown().filter((i) => same(comparable(shown[i]), comparable(next[j])));
    if (alike.length === 1) take(j, alike[0]);
  }
  // One action changed several views alike (a property deleted or renamed
  // reaches every view that shows it), and none was added, removed or moved:
  // as many views are left on both sides, and they are the same views in the
  // same order. Where the numbers differ, what is left is added or removed.
  const restShown = leftShown();
  const restNext = leftNext();
  if (restShown.length === restNext.length && restNext.length > 0 && restNext.every((j, k) => nextName(j) === shownName(restShown[k]))) {
    restNext.forEach((j, k) => take(j, restShown[k]));
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
  // 1. Equal to a view of the file: untouched there. A view the screen never
  // named fits one the file holds without a name, or under the name the
  // serializer gave it when the screen wrote it — never one of another name
  // (its own duplicate "Table Kopie" is equal but for the name). Its own place
  // first among equals; equals of different names are no certain match.
  read.forEach((_, i) => {
    const own = viewName(named[i]);
    const written = viewName(read[i]);
    const nameFits = (k: number) => {
      const there = viewName(current[k]);
      return own !== null ? there === own : there === null || there === written;
    };
    const fits = current.map((_, k) => k).filter((k) => !taken.has(k) && nameFits(k) && equal(i, k));
    if (fits.length === 0) return;
    if (new Set(fits.map((k) => viewName(current[k]))).size > 1) return;
    take(i, fits.includes(i) ? i : fits[0]);
  });
  // 2. By a name that is unique on both sides — unless a view the file holds
  // under another name, claimed by none, is equal to it: then the file may
  // have renamed it and given its name to another, and neither is certain.
  const count = (list: any[], name: string) => list.filter((v) => viewName(v) === name).length;
  const unclear = new Set<number>();
  const certain = (i: number, k: number) => {
    if (current.some((_, o) => o !== k && !taken.has(o) && equal(i, o))) { unclear.add(i); return; }
    take(i, k);
  };
  read.forEach((_, i) => {
    if (found[i] >= 0) return;
    const name = viewName(named[i]);
    if (name === null || count(named, name) !== 1 || count(current, name) !== 1) return;
    const k = current.findIndex((v) => viewName(v) === name);
    if (!taken.has(k)) certain(i, k);
  });
  // 2b. A view the screen never named: under the name the serializer gives it,
  // where the file holds exactly one view of that name and the screen names
  // none so; or as the only view without a name left on both sides.
  const unnamedLeft = () => read.map((_, i) => i).filter((i) => found[i] < 0 && !unclear.has(i) && viewName(named[i]) === null);
  for (const i of unnamedLeft()) {
    const written = viewName(read[i]);
    if (written === null || count(named, written) !== 0 || count(current, written) !== 1) continue;
    const k = current.findIndex((v) => viewName(v) === written);
    if (!taken.has(k)) certain(i, k);
  }
  const left = unnamedLeft();
  const fileUnnamed = current.map((_, k) => k).filter((k) => !taken.has(k) && viewName(current[k]) === null);
  if (left.length === 1 && fileUnnamed.length === 1) certain(left[0], fileUnnamed[0]);
  // 3. Renamed elsewhere and nothing else: equal but for the name, and only one such.
  read.forEach((_, i) => {
    if (found[i] >= 0 || unclear.has(i)) return;
    const ks = current.map((_, k) => k).filter((k) => !taken.has(k) && equal(i, k));
    if (ks.length === 1) take(i, ks[0]);
  });
  // 4. A database of one view on both sides, which kept its name or its type:
  // the same view, though each side changed it (renamed and changed
  // elsewhere, changed here). Where both differ, the other side may have put
  // another view in its place: nothing certain.
  if (read.length === 1 && current.length === 1 && found[0] < 0) {
    const name = viewName(named[0]) ?? viewName(read[0]);
    const sameName = name !== null && name === viewName(current[0]);
    const sameType = isPlainObject(read[0]) && isPlainObject(current[0]) && read[0].type === current[0].type;
    if (sameName || sameType) take(0, 0);
  }
  return found;
}

/**
 * A view the screen never named, as changed here: under the name it read back
 * with before. The serializer names an unnamed view by its type and place
 * ("Gallery", "Gallery 2"), so a move here hands it another name nobody gave
 * it — no rename to set on the file.
 */
function keepUnnamed(shownNamed: any, shownRead: any, nextNamed: any, nextRead: any): any {
  if (viewName(shownNamed) !== null || viewName(nextNamed) !== null || !isPlainObject(nextRead) || !isPlainObject(shownRead)) return nextRead;
  const out: Record<string, any> = { ...nextRead, name: shownRead.name };
  if (isPlainObject(nextRead._obsidian)) out._obsidian = { ...nextRead._obsidian, name: isPlainObject(shownRead._obsidian) ? shownRead._obsidian.name : shownRead.name };
  return out;
}

interface ViewsMerged {
  views: any[];
  /** Where each of `next`'s views stands in `views` (`-1`: not there). */
  placeOf: number[];
}

/** The views of the file now, with the screen's change to its views applied. */
function mergeViews(shownNamed: any[], shownRead: any[], nextNamed: any[], nextRead: any[], current: any[], lineage?: number[]): ViewsMerged {
  // The screen said which view is which (a view deleted here and one added
  // under its name are two views): taken as it says. Otherwise judged from the views.
  const pair = lineage ?? pairViews(shownNamed, nextNamed, shownRead, nextRead);
  const inFile = findInFile(shownNamed, shownRead, current);
  const known = new Set(inFile.filter((c) => c >= 0));
  /** Views of the file that none of `shown`'s was found as: one of them may be a view not found. */
  const unclaimed = current.some((_, c) => !known.has(c));
  const nameOf = (i: number) => viewName(shownNamed[i]) ?? viewName(shownRead[i]) ?? "";
  const refuse = (i: number): never => {
    throw new BaseConfigChangeRefusedError(unclaimed ? "viewUnclear" : "viewGone", nameOf(i));
  };

  // The file holds the views as the screen found them, each in its place:
  // the screen's views stand as it made them, as a whole save writes them.
  if (current.length === shownRead.length && current.every((c, k) => same(c, shownRead[k]))) {
    return { views: nextRead.slice(), placeOf: nextRead.map((_, j) => j) };
  }
  // Views added or removed here AND one changed here in the same save (a
  // change parked for a moved file gathers several): which view is which
  // rests on names the serializer gives anew after the add or the removal,
  // and the file changed its views too — nothing certain to land on.
  const added = pair.some((i) => i < 0);
  const gone = shownRead.findIndex((_, i) => !pair.includes(i));
  if (added || gone >= 0) {
    const edited = pair.findIndex((i, j) => i >= 0 && !same(comparable(nextRead[j]), comparable(shownRead[i])));
    if (edited >= 0) throw new BaseConfigChangeRefusedError("viewUnclear", nameOf(pair[edited]));
    // A view gone here while another came: one action does not do both (a
    // view changed and duplicated, or removed while another was added, reads
    // so) — which of them is which is not certain.
    if (added && gone >= 0) throw new BaseConfigChangeRefusedError("viewUnclear", nameOf(gone));
    // A view added under the name of one the screen kept (a duplicate that
    // kept its name): which of the two is the one the file knows is not certain.
    const nameIn = (j: number) => viewName(nextNamed[j]) ?? viewName(nextRead[j]);
    const kept = new Set(pair.map((i, j) => (i >= 0 ? nameIn(j) : null)).filter((x): x is string => x !== null));
    // So for a view added without a name of its own beside one kept without
    // one: the serializer names both by their places, nothing tells them apart
    // (no action of the screens adds a view without a name).
    const keptUnnamed = pair.some((i, j) => i >= 0 && viewName(nextNamed[j]) === null);
    const twin = pair.findIndex((i, j) => {
      if (i >= 0) return false;
      const name = nameIn(j);
      return (name !== null && kept.has(name)) || (keptUnnamed && viewName(nextNamed[j]) === null);
    });
    if (twin >= 0) throw new BaseConfigChangeRefusedError("viewUnclear", nameIn(twin) ?? "");
  }

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
    return { view: merge3(shownRead[i], keepUnnamed(shownNamed[i], shownRead[i], nextNamed[j], n), current[c], ""), at: c };
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
    // Views added here, after the view they follow in `next`; where that one
    // has no certain place in the file, at the end — never first, where it
    // would become the view the database opens with.
    made.forEach((m, j) => {
      if (!m || m.at >= 0) return;
      let at = j === 0 ? 0 : out.length;
      if (j > 0) {
        const prev = made[j - 1];
        const idx = prev ? out.indexOf(prev.view) : -1;
        if (idx >= 0) at = idx + 1;
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

/** The properties a config knows, by bare name: each is an entry under `properties` and, with settings, one under `columns`. */
function propertiesOf(cfg: any): Set<string> {
  const ids = (m: unknown) => (isPlainObject(m) ? Object.keys(m) : []);
  return new Set([
    ...ids(cfg?.properties).map(fromPropId),
    ...ids(cfg?._obsidian?.properties).map(fromPropId),
    ...ids(cfg?.columns),
  ]);
}

/**
 * A property is one thing in two places (its entry under `properties`, its
 * settings under `columns`): one the user deleted or renamed away goes from
 * both, whatever the other side set on it meanwhile — it does not come back
 * half.
 */
function withoutRemovedProperties(rest: Record<string, any>, shownRead: any, nextRead: any): Record<string, any> {
  const kept = propertiesOf(nextRead);
  const gone = [...propertiesOf(shownRead)].filter((p) => !kept.has(p));
  if (gone.length === 0) return rest;
  const drop = (m: unknown, key: (p: string) => string) => {
    if (!isPlainObject(m)) return m;
    const out = { ...m };
    for (const p of gone) delete out[key(p)];
    return out;
  };
  const out = { ...rest };
  if ("columns" in out) out.columns = drop(out.columns, (p) => p);
  if ("properties" in out) out.properties = drop(out.properties, toPropId);
  if (isPlainObject(out._obsidian) && "properties" in out._obsidian) out._obsidian = { ...out._obsidian, properties: drop(out._obsidian.properties, toPropId) };
  return out;
}

const viewsOf = (cfg: any): any[] => (isPlainObject(cfg) && Array.isArray(cfg.views) ? cfg.views : []);
const unchangedPlaces = (cfg: any): number[] => viewsOf(cfg).map((_, j) => j);

/** What the screen says about its change beside the configs. */
export interface BaseConfigChangeOptions {
  /** Which of `next`'s views is which of `shown`'s (`viewLineage.ts`); without it, judged from the views. */
  lineage?: ViewLineage;
}

/** A database change applied to a file's text. */
export interface BaseConfigRebased {
  config: any;
  text: string;
  /** Whether the change was merged with what the file holds (it was not the text the screen loaded or wrote). */
  merged: boolean;
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
export function rebaseBaseConfigText(shownGiven: any, next: any, currentText: string, { lineage }: BaseConfigChangeOptions = {}): BaseConfigRebased {
  // A screen that never had a config (an empty `.base`) showed a database without views.
  const shown = isPlainObject(shownGiven) ? shownGiven : loadBaseConfigText("");
  const unchanged = (): BaseConfigRebased => {
    const text = serializeBaseConfig(next);
    remember(next, text);
    return { config: next, text, placeOf: unchangedPlaces(next), merged: false };
  };
  // Texts first: nothing is parsed where the file is the text the screen loaded or wrote.
  const known = isPlainObject(shown) ? textOf.get(shown) : undefined;
  if (known !== undefined && known === currentText) return unchanged();
  const shownText = serializeBaseConfig(shown);
  if (shownText === currentText) return unchanged();
  const current = loadBaseConfigText(currentText);
  if (same(current, shown)) return unchanged();

  const shownRead = loadBaseConfigText(shownText);
  // The serializer writes a default view for a config without one; the screen showed none.
  if (viewsOf(shown).length === 0 && isPlainObject(shownRead)) shownRead.views = [];
  const nextRead = loadBaseConfigText(serializeBaseConfig(next));
  const s = isPlainObject(shownRead) ? shownRead : {};
  const n = isPlainObject(nextRead) ? nextRead : {};
  const c = isPlainObject(current) ? current : {};
  const strip = (cfg: Record<string, any>) => {
    const { views: _views, ...rest } = cfg;
    return rest;
  };
  const rest = withoutRemovedProperties(merge3(strip(s), strip(n), strip(c), ""), s, n);
  // Which view is which is told by the screen's own objects (an untouched view
  // is the same object, or equal data), where reading back kept their number.
  const sameCount = viewsOf(shown).length === viewsOf(s).length && viewsOf(next).length === viewsOf(n).length;
  const told = sameCount ? fittingLineage(lineage, viewsOf(s).length, viewsOf(n).length) : undefined;
  const merged: ViewsMerged = same(viewsOf(n), viewsOf(s))
    ? { views: viewsOf(c), placeOf: findInFile(sameCount ? viewsOf(shown) : viewsOf(s), viewsOf(s), viewsOf(c)) }
    : mergeViews(sameCount ? viewsOf(shown) : viewsOf(s), viewsOf(s), sameCount ? viewsOf(next) : viewsOf(n), viewsOf(n), viewsOf(c), told);
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
  return { config, text, placeOf: merged.placeOf, merged: true };
}

/** The config writes in flight, per storage and path: one after the other. */
const inFlight = new WeakMap<object, Map<string, Promise<unknown>>>();

/** What a database change did: the config the FILE now holds, where `next`'s views stand in it, and the write. */
export interface BaseConfigWritten {
  config: any;
  placeOf: number[];
  update: TextFileUpdate;
}

/** How often a change reads the file anew before it gives up on a file that does not hold still. */
const SETTLE_ATTEMPTS = 5;
/** How long a change waits before it reads again a file that is not the text the screen knows. */
const SETTLE_MS = 150;

class FileUnsettled extends Error {}

const settle = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Whether a config holds anything a file could have lost: a view, or any key. */
function holdsAnything(cfg: any): boolean {
  if (!isPlainObject(cfg)) return false;
  return viewsOf(cfg).length > 0 || Object.keys(isPlainObject(cfg._obsidian) ? cfg._obsidian : {}).some((k) => k !== "views");
}

/**
 * Writes a database config change through the vault's chain. Answers the
 * config the file now holds — at an open conflict the file's, not the user's
 * own version's — and what the write did. Throws
 * `BaseConfigChangeRefusedError` (nothing written) where the change has
 * nothing to land on with certainty.
 *
 * Decided on the text, never on what a reading seems to lack. Where the file
 * is the text the screen loaded or last wrote, nothing is parsed and nothing
 * waited for: `next` is written as a whole save writes it. Any other reading
 * may be a file another writer — a sync client, a text editor, a network
 * drive, none of which writes atomically — has written only in part: it
 * counts only once a second reading after a moment is the same text, and it
 * is written only while the file still is that text. Each text the change is
 * handed for the file is checked so; one that is not the settled reading
 * starts over. A settled reading that is empty, or no longer reads, while the
 * screen showed a database is no change of the other side either: refused
 * (`fileChanging`). So is a file that never holds still.
 *
 * Changes to one file go one after the other: a screen makes its next change
 * from the config it shows, which already holds the change before, so the
 * next one must read the file only once that one is written — or it would
 * take the change before for one undone elsewhere.
 */
export function writeBaseConfigChange(files: TextUpdateFiles, path: string, shown: any, next: any, options: BaseConfigChangeOptions = {}): Promise<BaseConfigWritten> {
  let byPath = inFlight.get(files);
  if (!byPath) inFlight.set(files, (byPath = new Map()));
  const before = byPath.get(path) ?? Promise.resolve();
  const run = before.catch(() => {}).then(async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await writeOnce(files, path, shown, next, options);
      } catch (e) {
        if (!(e instanceof FileUnsettled)) throw e;
        if (attempt >= SETTLE_ATTEMPTS) throw new BaseConfigChangeRefusedError("fileChanging", "");
      }
    }
  });
  byPath.set(path, run);
  const done = () => { if (byPath.get(path) === run) byPath.delete(path); };
  run.then(done, done);
  return run;
}

async function writeOnce(files: TextUpdateFiles, path: string, shown: any, next: any, options: BaseConfigChangeOptions): Promise<BaseConfigWritten> {
  // The text the screen knows: the one it loaded or last wrote.
  let knownText: string | undefined;
  const known = () => (knownText ??= (isPlainObject(shown) ? textOf.get(shown) : undefined) ?? serializeBaseConfig(isPlainObject(shown) ? shown : loadBaseConfigText("")));
  const halves = files.readTextFileState && files.writeTextFileChange ? { read: files.readTextFileState.bind(files), write: files.writeTextFileChange.bind(files) } : null;
  const readFile = async () => (halves ? (await halves.read(path)).text : files.readTextFile(path));

  /** The reading the change may rely on: the known text at once; any other once it holds still. */
  let settled: string | null = null;
  const settleOn = async (text: string): Promise<void> => {
    const plain = readTextShape(text).text;
    if (plain === known()) { settled = text; return; }
    await settle(SETTLE_MS);
    if ((await readFile()) !== text) throw new FileUnsettled();
    // Held still, and holds nothing where the screen showed a database: no change anybody made.
    let reads = true;
    try { loadBaseConfigText(plain); } catch { reads = false; }
    if ((plain.trim() === "" || !reads) && holdsAnything(shown)) throw new BaseConfigChangeRefusedError("fileChanging", "");
    settled = text;
  };

  // Each text of the file the change is handed: the settled reading, or start over.
  const made = new Map<string, BaseConfigRebased>();
  const ofFile = (text: string): string => {
    if (text !== settled) throw new FileUnsettled();
    return answer(text);
  };
  const answer = (text: string): string => {
    const { text: plain, shape } = readTextShape(text);
    let m = made.get(text);
    if (!m) {
      m = plain === known() && text === settled
        ? (() => { const t = serializeBaseConfig(next); remember(next, t); return { config: next, text: t, placeOf: unchangedPlaces(next), merged: false }; })()
        : rebaseBaseConfigText(shown, next, plain, options);
      made.set(text, m);
    }
    return m.text === plain ? text : applyTextShape(m.text, shape);
  };

  let update: TextFileUpdate;
  if (halves) {
    // The chain's two halves (the owner's, over the bus from a second window):
    // what the file and the user's own version are, then the texts made of
    // them — written only if the file still is what was read.
    const state = await halves.read(path);
    await settleOn(state.text);
    const text = ofFile(state.text);
    let workingCopy: string | null = null;
    // The user's own version takes the change where it fits; where not, it is left as it is.
    if (state.workingCopy !== null) { try { workingCopy = answer(state.workingCopy); } catch { workingCopy = null; } }
    const written = await halves.write(path, state, { text, workingCopy });
    if (!written) throw new FileUnsettled();
    update = written;
  } else {
    // A storage with no chain above it: one reading, settled, then the change of exactly that text.
    await settleOn(await files.readTextFile(path));
    update = await updateVaultText(files, path, ofFile);
  }
  const mine = made.get(update.before);
  const config = mine ? mine.config : next;
  // What the file now is, without its shape: the next change's first look.
  remember(config, editorTextOf(update.text));
  return { config, placeOf: mine ? mine.placeOf : unchangedPlaces(next), update };
}
