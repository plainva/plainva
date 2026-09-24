import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { sameStoredValue, storedJson } from "@plainva/core";

/**
 * No equality check over JSON TEXT (finding 2026-09-24).
 *
 * `JSON.stringify(await store.get(key)) !== JSON.stringify(written)` looks like
 * a content check and is an ordering check. The desktop settings store lives in
 * Rust, where `serde_json` keeps object keys sorted — so every read-back check
 * of that shape failed on the desktop: each new mail account ended in
 * "storageFailed", the rollback (the same comparison) never recognised its own
 * write, and files + calendar bindings failed alike. The in-memory test stores
 * kept the insertion order, which is why no test noticed for twelve days.
 *
 * `sameStoredValue` / `storedJson` from @plainva/core compare content. This
 * scan keeps the text comparison out of every shipped source file of both
 * shells and both shared packages, one call site at a time being exactly how
 * the class spread.
 */

const REPO = resolve(__dirname, "../../..");
const ROOTS = ["apps/desktop/src", "apps/mobile/src", "packages/ui/src", "packages/core/src"];

/**
 * The only comparisons allowed to stay, each with the reason it cannot meet a
 * store. A stale entry fails too, so the list can only shrink.
 */
const ALLOWED: Record<string, string> = {
  // Two table models built by the same parser in the same process, compared on
  // every editor update — a hot path with no store in between.
  "packages/ui/src/components/LivePreviewPlugin.ts": "in-memory widget identity",
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Index of the `)` closing the call whose `(` ends right before `start`. */
function closingParen(text: string, start: number): number {
  let depth = 1;
  let quote: string | null = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}

const CALL = "JSON.stringify(";

/** Every `JSON.stringify(…)` that is an operand of `===` / `!==`. */
function textComparisons(source: string): string[] {
  // Comments may quote the pattern (storedValue.ts does); strip them first.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const found: string[] = [];
  for (let at = code.indexOf(CALL); at >= 0; at = code.indexOf(CALL, at + CALL.length)) {
    const end = closingParen(code, at + CALL.length);
    if (end < 0) continue;
    const before = code.slice(0, at).trimEnd();
    const after = code.slice(end + 1).trimStart();
    if (/(===|!==)$/.test(before) || /^(===|!==)/.test(after)) {
      const lineStart = code.lastIndexOf("\n", at) + 1;
      const lineEnd = code.indexOf("\n", end);
      found.push(code.slice(lineStart, lineEnd < 0 ? undefined : lineEnd).trim());
    }
  }
  return found;
}

describe("comparing stored values", () => {
  it("never compares JSON text in shipped code", () => {
    const findings: string[] = [];
    const allowedHit = new Set<string>();
    for (const root of ROOTS) {
      for (const file of sourceFiles(join(REPO, root))) {
        const rel = relative(REPO, file).replace(/\\/g, "/");
        const hits = textComparisons(readFileSync(file, "utf8"));
        if (hits.length === 0) continue;
        if (ALLOWED[rel]) {
          allowedHit.add(rel);
          continue;
        }
        for (const hit of hits) findings.push(`${rel}: ${hit}`);
      }
    }
    expect(
      findings,
      "JSON text depends on key order, and the desktop store returns keys sorted. " +
        "Compare with sameStoredValue(a, b) (or storedJson for a snapshot) from @plainva/core.\n  " +
        findings.join("\n  "),
    ).toEqual([]);
    expect(Object.keys(ALLOWED).filter((rel) => !allowedHit.has(rel)), "stale entries in ALLOWED").toEqual([]);
  });

  it("the scan sees the shapes that shipped, and nothing else", () => {
    expect(textComparisons("if (JSON.stringify(await list(v)) !== JSON.stringify(next)) throw e;")).toHaveLength(2);
    expect(textComparisons("if (a && JSON.stringify(x.services) === JSON.stringify(y.services)) ok();")).toHaveLength(2);
    expect(textComparisons("const same =\n  JSON.stringify({ a: 1 })\n  === JSON.stringify({ a: 1 });")).toHaveLength(2);
    // An argument that itself contains `!==` is not a comparison OF the text.
    expect(textComparisons("write({ contents: JSON.stringify({ e: list.filter((d) => d !== id) }) });")).toEqual([]);
    expect(textComparisons("// JSON.stringify(a) === JSON.stringify(b)\nconst ok = 1;")).toEqual([]);
  });
});

describe("sameStoredValue", () => {
  /** The desktop store's answer: keys sorted at every level, like serde_json. */
  const serde = (value: unknown): unknown => JSON.parse(storedJson(value));

  it("treats a value and its serde round trip as the same document", () => {
    const account = { id: "a1", label: "Mailbox", host: "imap.example.invalid", port: 993, user: "me@example.invalid", smtpHost: undefined };
    const back = serde([account]);
    expect(JSON.stringify(back)).not.toBe(JSON.stringify([account]));
    expect(sameStoredValue(back, [account])).toBe(true);
    expect(sameStoredValue({ files: { provider: "drive" }, calendar: { pimAccountId: "p" } }, { calendar: { pimAccountId: "p" }, files: { provider: "drive" } })).toBe(true);
  });

  it("still sees every real difference", () => {
    expect(sameStoredValue({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameStoredValue([1, 2], [2, 1])).toBe(false);
    expect(sameStoredValue({ a: 1 }, { a: 1, b: null })).toBe(false);
    expect(sameStoredValue(null, undefined)).toBe(false);
    expect(sameStoredValue(undefined, undefined)).toBe(true);
    expect(sameStoredValue({ a: undefined }, {})).toBe(true);
  });
});
