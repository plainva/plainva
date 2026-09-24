import { stableStringify } from "./settingsSync/profileFile.js";

/**
 * Comparing a value with what a store gave back (finding 2026-09-24).
 *
 * Every "did it really land?" check after a save used to compare two JSON
 * TEXTS: `JSON.stringify(await store.get(key)) === JSON.stringify(written)`.
 * That holds only while the store hands the object back in the order it was
 * written. The desktop settings store does not: it lives in Rust, and
 * `serde_json` without `preserve_order` keeps object keys in a sorted map, so
 * `{ id, label, host }` comes back as `{ host, id, label }`. The check then
 * failed on every new mail account, the rollback — built on the same
 * comparison — never recognised its own write, and each attempt left a mail
 * account without a password behind. The test stores were JavaScript maps,
 * which keep the order, so no test saw it.
 *
 * The comparison therefore goes over CONTENT: both sides are normalised the
 * way JSON storage normalises them (keys dropped when `undefined`, `undefined`
 * inside arrays becomes `null`, `toJSON` applied) and printed with recursively
 * sorted keys. Array order is content and stays significant.
 *
 * `apps/desktop/src/storedValueCompare.test.ts` forbids the text comparison
 * outside tests, so the class cannot come back one call site at a time.
 */

/**
 * The canonical text of a value as a JSON store holds it. Two values that a
 * store would treat as the same document print identically, whatever their key
 * order. `undefined` (which no JSON store can hold) stays `undefined`, exactly
 * like `JSON.stringify` — so a missing entry never equals a stored `null`.
 */
export function storedJson(value: unknown): string {
  const json = JSON.stringify(value) as string | undefined;
  return (json === undefined ? undefined : stableStringify(JSON.parse(json))) as string;
}

/** True when a store would hold `a` and `b` as the same document. */
export function sameStoredValue(a: unknown, b: unknown): boolean {
  return storedJson(a) === storedJson(b);
}
