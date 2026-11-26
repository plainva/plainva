/**
 * What of a set of withheld values a result still carries — a database row, a
 * tool's answer, a request a model is sent — looked for where values are, not
 * in the result's whole text.
 *
 * A test that held `JSON.stringify(row)` against `/9000/` failed for nothing
 * when the row's own `file.mtime` was 1795690009735.9272 (Sammelplan § 3.189
 * Nr. 20): a timestamp, a size, a hash or a random id holds any four digits
 * sooner or later. Here every text of the result (keys too) is searched for
 * each withheld word, and for each withheld number as a number of its own —
 * not as digits inside a longer number, a hash or an id — and every number of
 * the result is compared with each withheld number. Nothing is left out by
 * its name: a withheld value in any field, at any depth, is found.
 *
 * Returns where each one was found ("hours: 9003", "tasks[1]: Salary"), empty
 * when nothing was.
 */
export function leaksOf(value: unknown, withheld: { words?: readonly string[]; numbers?: readonly number[] }): string[] {
  const words = withheld.words ?? [];
  const numbers = withheld.numbers ?? [];
  // A number of its own: no letter, digit, underscore or hyphen next to it (the
  // parts of an id), and not the whole part of a decimal or the tail of one
  // ("0.9000" is not 9000).
  const standalone = numbers.map((n) => ({
    n,
    pattern: new RegExp(`(?<![\\p{L}\\p{N}_-]|\\p{N}[.,])${String(n).replace(/[.]/g, "\\.")}(?![\\p{L}\\p{N}_-]|[.,]\\p{N})`, "u"),
  }));
  const found: string[] = [];
  const text = (where: string, s: string) => {
    for (const word of words) if (s.includes(word)) found.push(`${where}: ${word}`);
    for (const { n, pattern } of standalone) if (pattern.test(s)) found.push(`${where}: ${n}`);
  };
  const walk = (where: string, v: unknown, seen: Set<unknown>) => {
    if (typeof v === "string") return text(where, v);
    if (typeof v === "number" || typeof v === "bigint") {
      for (const n of numbers) if (Number(v) === n) found.push(`${where}: ${n}`);
      return;
    }
    if (v === null || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    const entries: [string, unknown][] = v instanceof Map ? [...v.entries()].map(([k, x]) => [String(k), x]) : v instanceof Set ? [...v].map((x, i) => [String(i), x]) : Object.entries(v);
    for (const [key, child] of entries) {
      const at = Array.isArray(v) ? `${where}[${key}]` : where ? `${where}.${key}` : key;
      if (!Array.isArray(v)) text(`${at} (key)`, key);
      walk(at, child, seen);
    }
  };
  walk("", value, new Set());
  return found;
}
