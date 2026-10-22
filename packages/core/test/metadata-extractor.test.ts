import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { extractFrontmatter } from "../src/metadata-extractor.js";
import { parseMarkdownAst } from "../src/markdown-parser.js";
import { FrontmatterSurgicalError } from "../src/frontmatter-block.js";
import { frontmatterValueSchema, nonEmptyStringSchema, readableFrontmatterSchema } from "../src/metadata.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("Frontmatter Extractor", () => {
  it("should extract valid frontmatter", async () => {
    const content = await fs.readFile(
      path.join(__dirname, "fixtures/frontmatter.md"),
      "utf-8"
    );
    const ast = parseMarkdownAst(content);
    const result = extractFrontmatter(ast);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        title: "Roundtrip Fixture",
        tags: ["plainva", "roundtrip"]
      });
    }
  });

  it("should return null data for documents without frontmatter", async () => {
    const content = await fs.readFile(
      path.join(__dirname, "fixtures/plain-note.md"),
      "utf-8"
    );
    const ast = parseMarkdownAst(content);
    const result = extractFrontmatter(ast);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it("should gracefully fail with invalid yaml syntax", () => {
    const content = "---\ntitle: [invalid\n---\n# Note";
    const ast = parseMarkdownAst(content);
    const result = extractFrontmatter(ast);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.name).toBe("YAMLParseError");
    }
  });

  it("should return fallback data for empty frontmatter block", () => {
    const content = "---\n---\n# Empty Frontmatter Note";
    const ast = parseMarkdownAst(content);
    const result = extractFrontmatter(ast);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({});
    }
  });

  it("reads a block whose lines end in a carriage return of its own", () => {
    // The Markdown parser ends a line there and hands the block out with the
    // carriage returns in it; the YAML library takes one for part of a line.
    // Two entries were a syntax error, a list was one string, and a comment
    // swallowed the line behind it.
    const read = (note: string) => extractFrontmatter(parseMarkdownAst(note));
    expect(read("---\rtitle: Old Mac\rtags:\r  - a\r  - b\r---\r# Body\r")).toEqual({ success: true, data: { title: "Old Mac", tags: ["a", "b"] } });
    expect(read("---\r# a comment\rtitle: Old Mac\r---\r# Body\r")).toEqual({ success: true, data: { title: "Old Mac" } });
    expect(read("---\rtitle: Old Mac\r\r---\r# Body\r")).toEqual({ success: true, data: { title: "Old Mac" } });
    // A stray one in a block with other line ends is a line break as well.
    expect(read("---\ntitle: Stray\rtags: [a]\n---\n# Body\n")).toEqual({ success: true, data: { title: "Stray", tags: ["a"] } });
    expect(read("---\r\ntitle: Windows\r\ntags: [a]\r\n---\r\n# Body\r\n")).toEqual({ success: true, data: { title: "Windows", tags: ["a"] } });
    // `\r\r\n` on every line — line ends from Windows, converted twice. Each
    // value came back with a carriage return at its end, a number as a string.
    expect(read("---\r\r\ntitle: Twice\r\r\ncount: 3\r\r\n---\r\r\n# Body\r\r\n")).toEqual({ success: true, data: { title: "Twice", count: 3 } });
  });
});

/**
 * The reader as it stood until 2026-10-22: the YAML, checked against a schema
 * that refused the WHOLE block when one value did not fit the form of its
 * field. Kept here as the measure: for every block it took, the reader answers
 * the same, value for value and in the same order.
 */
const oldList = z.preprocess(
  (value) => (typeof value === "string" ? value.split(",").map((part) => part.trim()).filter(Boolean) : value),
  z.array(nonEmptyStringSchema).optional()
);
const OLD_SCHEMA = z
  .object({
    type: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    resource: z.string().url().optional(),
    tags: oldList,
    aliases: oldList,
    timestamp: z.string().datetime({ offset: true }).optional(),
    okf_version: z.preprocess((value) => (typeof value === "number" && Number.isFinite(value) ? String(value) : value), nonEmptyStringSchema).optional(),
    generated: frontmatterValueSchema.optional(),
    verified: frontmatterValueSchema.optional(),
    sources: frontmatterValueSchema.optional(),
    usage_window: frontmatterValueSchema.optional(),
    stale_after: frontmatterValueSchema.optional(),
    status: frontmatterValueSchema.optional(),
  })
  .catchall(frontmatterValueSchema);

function oldReader(yaml: string): { success: true; data: unknown } | { success: false } {
  let parsed: unknown;
  try {
    parsed = parseYaml(yaml, { logLevel: "error" });
  } catch {
    return { success: false };
  }
  if (typeof parsed !== "object" || parsed === null) parsed = {};
  const result = OLD_SCHEMA.safeParse(parsed);
  return result.success ? { success: true, data: result.data } : { success: false };
}

const readBlock = (yaml: string) => extractFrontmatter(parseMarkdownAst(`---\n${yaml}\n---\nText\n`));
const dataOf = (yaml: string) => {
  const result = readBlock(yaml);
  if (!result.success) throw new Error(`not read: ${yaml}`);
  return result.data as Record<string, unknown>;
};

/** Each form the old schema refused the whole block over, with what the reader answers now. */
const FORMS: Array<[string, string, Record<string, unknown>]> = [
  ["an empty tags key", "tags:\nstatus: open\nowner: Anna", { tags: [], status: "open", owner: "Anna" }],
  ["tags spelt out as nothing", "tags: ~\nowner: Anna", { tags: [], owner: "Anna" }],
  ["a year among the tags", "tags:\n  - 2024\n  - journal\nowner: Anna", { tags: ["2024", "journal"], owner: "Anna" }],
  ["numbers among the tags, as they are written", "tags: [1.10, 007, 0x1F, 1e3, +49]", { tags: ["1.10", "007", "0x1F", "1e3", "+49"] }],
  ["a truth value among the tags", "tags: [true, a]", { tags: ["true", "a"] }],
  ["empty entries among the tags", "tags:\n  - a\n  -\n  - ''\n  - b", { tags: ["a", "b"] }],
  ["a number for the tags", "tags: 2024", { tags: ["2024"] }],
  ["a list as an entry of the tags", "tags: [[a, b], c]", { tags: ["[a, b]", "c"] }],
  ["a template's placeholder under aliases, a map to YAML", "aliases:\n  - {{title}}\nstatus: draft", { aliases: ["{{title}}"], status: "draft" }],
  ["placeholders between brackets", "aliases: [{{recipe_title}}, {{recipe_alias}}]", { aliases: ["{{recipe_title}}", "{{recipe_alias}}"] }],
  ["an empty aliases key", "aliases:\ntype: Note", { type: "Note", aliases: [] }],
  ["a key alone, after a question mark", "? tags\nowner: Anna", { tags: [], owner: "Anna" }],
  ["a key alone in a map between braces", "{tags, owner: Anna}", { tags: [], owner: "Anna" }],
  ["a number as title", "title: 2024\nowner: Anna", { title: "2024", owner: "Anna" }],
  ["a number as title, under a key that is an alias", "x: &k title\n*k : 2024", { title: "2024", x: "title" }],
  ["a title that is a decimal", "title: 2024.10", { title: "2024.10" }],
  ["a title with a leading zero", "title: 007", { title: "007" }],
  ["an empty title", "title:\nowner: Anna", { title: null, owner: "Anna" }],
  ["a list as title", "title: [a, b]", { title: "[a, b]" }],
  ["a placeholder as title", "title: {{title}}", { title: "{{title}}" }],
  ["a truth value as description", "description: true", { description: "true" }],
  ["a list as description", "description:\n  - a\n  - b", { description: "- a - b" }],
  ["a number as type", "type: 5", { type: "5" }],
  ["an empty type", "type:\ntitle: T", { type: null, title: "T" }],
  ["a resource that is no URL", "resource: see the book", { resource: "see the book" }],
  ["a resource that is a number", "resource: 5", { resource: 5 }],
  ["a timestamp that is a date", "timestamp: 2026-06-22\ntype: Referenz", { type: "Referenz", timestamp: "2026-06-22" }],
  ["a timestamp without a time zone", "timestamp: 2026-06-23T10:00:00", { timestamp: "2026-06-23T10:00:00" }],
  ["an empty timestamp", "timestamp:", { timestamp: null }],
  ["a truth value as okf_version", "okf_version: true", { okf_version: "true" }],
  ["an empty okf_version", "okf_version:", { okf_version: null }],
  ["values the index cannot hold", "a: .inf\nb: .nan\nc: [1, .inf]\nd: !!binary aGVsbG8=\ne: !!set {x, y}", { a: ".inf", b: ".nan", c: "[1, .inf]", d: "aGVsbG8=", e: "{x, y}" }],
];

describe("a block is read field by field (ADR 0009, addendum 2026-10-22)", () => {
  it.each(FORMS)("%s: the old schema refused the whole block", (_label, yaml) => {
    expect(oldReader(yaml).success).toBe(false);
  });

  it.each(FORMS)("%s: read, with every other property of the block", (_label, yaml, expected) => {
    const data = dataOf(yaml);
    expect(data).toEqual(expected);
    expect(readableFrontmatterSchema.safeParse(data).success, "the answer is what the schema describes").toBe(true);
  });

  it("reads a value that refers to itself as the text it is written with — the old reader answered with one no index can hold", () => {
    const old = oldReader("a: &x [*x]\nb: 1");
    expect(old.success).toBe(true);
    expect(() => JSON.stringify(old.success ? old.data : null)).toThrow(TypeError);
    expect(dataOf("a: &x [*x]\nb: 1")).toEqual({ a: "[*x]", b: 1 });
  });

  it("answers as the old schema did where YAML names a key in another way, or holds one it never handed out", () => {
    // A key that is an alias names what it stands for; `__proto__` was never handed out, at no depth;
    // a set, an ordered map or a date at the top of the block names no property.
    const same: Array<[string, unknown]> = [
      ["x: &k tags\n*k : foo", { tags: ["foo"], x: "tags" }],
      ["a:\n  __proto__: x\n  b: 1\nc: [{__proto__: y, d: 2}]", { a: { b: 1 }, c: [{ d: 2 }] }],
      ["!!set {title, x}", {}],
      ["!!omap [title: 1, x: 2]", {}],
      ["!!timestamp 2026-01-01", {}],
    ];
    for (const [yaml, expected] of same) {
      const old = oldReader(yaml);
      expect(old.success, yaml).toBe(true);
      expect(JSON.stringify(dataOf(yaml)), yaml).toBe(JSON.stringify(old.success ? old.data : null));
      expect(dataOf(yaml), yaml).toEqual(expected);
    }
  });

  it("names the fields with a meaning first, in the order the panel has always shown them in, then the note's own", () => {
    expect(Object.keys(dataOf("owner: A\nstatus: open\ntitle: T\nzeta: 1\ntags: [x]\ntype: Note\nalpha: 2"))).toEqual([
      "type", "title", "tags", "status", "owner", "zeta", "alpha",
    ]);
  });

  it("still does not read YAML that does not parse, nor a block that is a list", () => {
    const broken = readBlock("title: [unclosed\nowner: Anna");
    expect(broken.success).toBe(false);
    if (!broken.success) expect(broken.error.name).toBe("YAMLParseError");
    expect(readBlock("a: 1\na: 2").success).toBe(false);
    const list = readBlock("- a\n- b");
    expect(list.success).toBe(false);
    if (!list.success) {
      expect(list.error).toBeInstanceOf(FrontmatterSurgicalError);
      expect(list.error.message).toBe("Frontmatter is not a YAML map");
    }
  });

  it("reads a block that holds only a text or a number as one without properties, as before", () => {
    for (const yaml of ["just some words", "42", "null", "# a comment"]) expect(dataOf(yaml)).toEqual({});
  });

  it("reads a number under okf_version as it is written — the one answer that is not the old one", () => {
    expect(dataOf("okf_version: 1.0")).toEqual({ okf_version: "1.0" });
    expect(oldReader("okf_version: 1.0")).toEqual({ success: true, data: { okf_version: "1" } });
    expect(dataOf("okf_version: 0.1")).toEqual({ okf_version: "0.1" });
    expect(dataOf("okf_version: 1")).toEqual({ okf_version: "1" });
  });
});

/** Blocks of every kind, the same ones on every run. */
function generatedBlocks(count: number, { numberedVersion }: { numberedVersion: boolean }): string[] {
  let seed = 20261022;
  const next = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)];
  const KEYS = ["type", "title", "description", "resource", "tags", "aliases", "timestamp", "okf_version", "status", "stale_after", "generated", "verified", "sources", "owner", "due", "Frist", "2024", "true", "plainva", "x-y", "über", "a b", "__proto__"];
  const SCALARS = [
    "Note", "a, b", "2024", "007", "1.10", "true", "null", "~", "", "\"quoted\"", "'single'", "2026-06-23",
    "2026-06-23T10:00:00+02:00", "https://example.org/a", "\"[[Link]]\"", "\"[[Link|alias]]\"", ".inf", "0x1F", "1e3",
    "-5", "\"text with: colon\"", "\"a # b\"", "ünï", "{{title}}", "''", "'  '",
  ];
  const value = (depth: number, key: string): string => {
    const roll = next();
    const scalars = !numberedVersion && key === "okf_version" ? SCALARS.filter((s) => !/^[-+.0-9]/.test(s)) : SCALARS;
    if (depth > 1 || roll < 0.5) return pick(scalars);
    if (roll < 0.65) return `[${Array.from({ length: Math.floor(next() * 4) }, () => pick(scalars.filter((s) => s !== "" && s !== "{{title}}"))).join(", ")}]`;
    if (roll < 0.85) return `\n${Array.from({ length: 1 + Math.floor(next() * 3) }, () => `  - ${pick(scalars)}`).join("\n")}`;
    return `\n${Array.from({ length: 1 + Math.floor(next() * 3) }, (_, i) => `  k${i}: ${pick(scalars)}`).join("\n")}`;
  };
  const blocks: string[] = [];
  for (let i = 0; i < count; i++) {
    const keys = new Set<string>();
    const size = 1 + Math.floor(next() * 7);
    while (keys.size < size) keys.add(pick(KEYS));
    blocks.push([...keys].map((key) => {
      const v = value(0, key);
      return v.startsWith("\n") ? `${key}:${v}` : `${key}: ${v}`;
    }).join("\n"));
  }
  return blocks;
}

describe("the reader against the old schema, on generated blocks", () => {
  const json = (value: unknown) => JSON.stringify(value);

  it("answers as before for every block the old schema took, value for value and in the same order", () => {
    let taken = 0;
    for (const yaml of generatedBlocks(4000, { numberedVersion: false })) {
      const old = oldReader(yaml);
      if (!old.success) continue;
      taken++;
      expect(json(dataOf(yaml)), yaml).toBe(json(old.data));
    }
    expect(taken).toBeGreaterThan(500);
  });

  it("answers for every YAML map, names every key of it, and says what the schema describes", () => {
    let maps = 0;
    for (const yaml of generatedBlocks(4000, { numberedVersion: true })) {
      let parsed: unknown;
      try {
        parsed = parseYaml(yaml, { logLevel: "error" });
      } catch {
        continue;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
      maps++;
      const data = dataOf(yaml);
      expect(Object.keys(data).sort(), yaml).toEqual(Object.keys(parsed).filter((key) => key !== "__proto__").sort());
      expect(readableFrontmatterSchema.safeParse(data).success, yaml).toBe(true);
    }
    expect(maps).toBeGreaterThan(2000);
  });
});
