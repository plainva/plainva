import { describe, it, expect } from "vitest";
import { ROLLUP_FNS, SUMMARY_NAMES } from "@plainva/core";
import { BASE_VIEW_TYPES, PALETTE_NAMES } from "@plainva/ui";
import { sourceFile } from "./test-sourceTree";

/**
 * The database reference of the user guide (docs/user/<lang>/Base_Reference.md)
 * promises to list everything a `.base` file can hold in Plainva. That promise
 * breaks silently the day a new view type, summary, rollup function, field type
 * or `plainva` key lands in the code without a line in the reference — nothing
 * else would notice, because the reference is prose.
 *
 * So this guard derives each list from the code and asks the ENGLISH page to
 * name every entry as inline code (`name`). The other nine languages follow
 * through docsStructure.test.ts (same headings, rows and items per page) and
 * docsParity.test.ts (same file names); the code identifiers stay untranslated.
 *
 * Where the code keeps a list in a constant, the constant is imported. Where it
 * does not — the `plainva` keys of a view and of a column, the field-type
 * spellings, the file fields a query fills in, the operators — the list is read
 * from the source of the one module that parses or fills it, so a key added
 * there is a key this guard sees. Each of those readings also has to find a
 * plausible number of entries: a regex that stops matching after a refactor
 * must fail here, not pass with an empty list.
 *
 * Not derived: the filter function forms (`contains(…)`, `.isEmpty()`,
 * `file.hasTag(…)`) — the evaluator recognises them with anchored regexes, not
 * a registry, and reading names back out of those regexes would be the fragile
 * kind of guard. They change rarely and the reference lists them by hand.
 */

const REFERENCE = "docs/user/en/Base_Reference.md";

const page = sourceFile(REFERENCE);

/** The entries of `names` the reference does not mention as inline code. */
function missing(names: Iterable<string>): string[] {
  return [...new Set(names)].filter((name) => !page.includes("`" + name + "`")).sort();
}

/** Every distinct first capture of `re` in `text`. */
function captures(text: string, re: RegExp): string[] {
  return [...new Set([...text.matchAll(re)].map((m) => m[1]))];
}

/** The body of a top-level function: from its signature up to the closing brace at column 0. */
function functionBody(text: string, signature: string): string {
  const start = text.indexOf(signature);
  if (start < 0) throw new Error(`"${signature}" not found — the guard needs updating`);
  const end = text.indexOf("\n}\n", start);
  return text.slice(start, end < 0 ? undefined : end);
}

/** The string entries of `const NAME … = [ … ]` in a source file. */
function constList(text: string, name: string): string[] {
  const m = text.match(new RegExp(`const ${name}\\b[^=]*=\\s*\\[([^\\]]*)\\]`));
  if (!m) throw new Error(`const ${name} not found — the guard needs updating`);
  return captures(m[1], /"([^"]+)"/g);
}

const baseFormat = sourceFile("packages/ui/src/base/baseFormat.ts");

describe("database reference (Base_Reference.md)", () => {
  it("names every view type", () => {
    expect(missing(BASE_VIEW_TYPES.map((v) => v.type))).toEqual([]);
  });

  it("names every built-in summary", () => {
    expect(missing(SUMMARY_NAMES)).toEqual([]);
  });

  it("names every rollup function and every rollup condition operator", () => {
    expect(missing(ROLLUP_FNS)).toEqual([]);
    const ops = constList(sourceFile("packages/core/src/vault/rollup.ts"), "WHERE_OPS");
    expect(ops.length).toBeGreaterThanOrEqual(8);
    expect(missing(ops)).toEqual([]);
  });

  it("names every option colour", () => {
    expect(missing(PALETTE_NAMES)).toEqual([]);
  });

  it("names every field type spelling the parser accepts", () => {
    const body = functionBody(sourceFile("packages/ui/src/base/propertyModel.ts"), "export function baseInputToType");
    const inputs = captures(body, /case "([^"]+)":/g);
    expect(inputs.length).toBeGreaterThanOrEqual(15);
    expect(missing(inputs)).toEqual([]);
  });

  it("names every key of a column's plainva block", () => {
    const keys = captures(functionBody(baseFormat, "function normalizeColumn"), /\bsrc\.(\w+)/g);
    expect(keys.length).toBeGreaterThanOrEqual(8);
    expect(missing(keys)).toEqual([]);
  });

  it("names every key of a view's plainva block, the file-wide ones included", () => {
    const keys = captures(baseFormat, /\bpv\.(\w+)/g);
    expect(keys.length).toBeGreaterThanOrEqual(20);
    expect(missing(keys)).toEqual([]);
  });

  it("names every file field a database query fills in or reads", () => {
    const fields = captures(sourceFile("packages/core/src/vault/VaultQueryService.ts"), /["'](file\.\w+)["']/g);
    expect(fields.length).toBeGreaterThanOrEqual(8);
    expect(missing(fields)).toEqual([]);
  });

  it("names every comparison operator of a filter", () => {
    const ops = constList(sourceFile("packages/core/src/vault/filterComparison.ts"), "OPERATORS");
    expect(ops.length).toBe(6);
    expect(missing(ops)).toEqual([]);
  });

  it("is honest about `this`", () => {
    // The maintainer's condition for the reference (plan E25): until `this` is
    // evaluated, the page says so instead of leaving it out.
    expect(page).toContain("**`this` is not supported yet.**");
  });
});
