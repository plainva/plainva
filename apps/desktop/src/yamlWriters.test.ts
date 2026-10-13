import { describe, expect, it } from "vitest";
import { shippedSources, sourceFile } from "./test-sourceTree";

/**
 * A properties block that was read is never written back through the YAML
 * library (finding 2026-10-11).
 *
 * Every writer of a property ended in one function that printed the document
 * the library had read (`doc.toString()`): the whole block, in the library's
 * form and from the values as it had READ them. `plz: 01067` came back as
 * `1067`, `phone: +4915112345678` without its plus, `id: 12345678901234567890`
 * without its last digits, a long line folded at 80 characters, `[a, b]` as
 * `[ a, b ]`, a list indented — in every note a property was set, removed or
 * renamed in, also in notes nobody had opened.
 *
 * The rule is that a block that is there is changed as TEXT, entry by entry
 * (`packages/core/src/frontmatter-entry.ts`): the library reads it and says
 * where a key and a value stand, and it writes only what is NEW to the note —
 * the lines of a new entry, the characters of a new value.
 *
 * This guard keeps the class closed from two sides. It lists every shipped
 * file that takes more from the library than `parse` — which reads data and
 * can write nothing —, with what it takes and why; a file that starts to, or
 * takes something else, turns it red. And it pins the one place where YAML of
 * a note comes out of the library. It reads the shapes that reach for the
 * library; it cannot know another.
 */

/** Without comments: a file may speak of a function it must not call. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * What a file takes from the YAML library, by name: the names of a named
 * import (a `type` import takes nothing that runs), the members used of a
 * namespace or default import, `*` for an import that is asked for at run
 * time.
 */
function takenFromYaml(text: string): string[] {
  const names = new Set<string>();
  for (const found of text.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']yaml["']/g)) {
    if (found[1]) continue;
    for (const part of found[2].split(",")) {
      const name = part.trim();
      if (name && !/^type\s/.test(name)) names.add(name.split(/\s+as\s+/)[0].trim());
    }
  }
  for (const found of text.matchAll(/import\s+(?:\*\s+as\s+)?(\w+)\s+from\s*["']yaml["']/g)) {
    for (const use of text.matchAll(new RegExp(`\\b${found[1]}\\.(\\w+)`, "g"))) names.add(use[1]);
  }
  if (/(?:import|require)\(\s*["']yaml["']\s*\)/.test(text)) names.add("*");
  return [...names].sort();
}

/** `parse` reads a block as data. Whoever takes only that can write nothing through the library. */
const takesMoreThanData = (text: string) => takenFromYaml(text).some((name) => name !== "parse");

/** The files that take more, each with what it takes and what it does with it. */
const KNOWN = new Map<string, { takes: string[]; why: string }>([
  [
    "packages/core/src/frontmatter-block.ts",
    { takes: ["Document", "isMap", "parseDocument"], why: "reads a note's block as a document in which an entry can be found; it prints none (pinned below)" },
  ],
  [
    "packages/core/src/frontmatter-entry.ts",
    {
      takes: ["Document", "Scalar", "isAlias", "isMap", "isNode", "isScalar", "isSeq", "parse"],
      why: "the one writer of a note's YAML: what is new to the note, in `written()` — a block that was read is changed as text (pinned below)",
    },
  ],
  [
    "packages/core/src/frontmatter-surgical.ts",
    { takes: ["CST", "Scalar", "isAlias", "isMap", "isScalar", "isSeq"], why: "finds the scalars of a block that was read; a link's target changes in the token of its one scalar" },
  ],
  ["packages/core/src/okf-conversion.ts", { takes: ["parse", "parseDocument"], why: "asks whether a block holds anything; it prints nothing" }],
  [
    "packages/core/src/metadata-updater.ts",
    { takes: ["stringify"], why: "YAML from a set of properties for the node of a parsed tree — no caller in either shell: a note is not written back from its tree (`markdownSerializerUse.test.ts`)" },
  ],
  [
    "packages/core/src/workspace/publishedSlices.ts",
    {
      takes: ["parseDocument", "stringify"],
      why: "the COPY of a note that leaves the vault: the properties its allow-list lets through are written anew on purpose — a comment or a line left standing could carry what was withheld. The note itself is not written",
    },
  ],
  ["packages/ui/src/base/baseFormat.ts", { takes: ["parse", "stringify"], why: "a `.base` file: a database's definition, written whole from its model — not a note's properties" }],
  ["packages/ui/src/base/baseExport.ts", { takes: ["stringify"], why: "an exported `.base`: new YAML from data" }],
]);

describe("a properties block that was read is not written back through the YAML library", () => {
  it("knows every shipped file that takes more from the library than `parse`, and what it takes", () => {
    const found = shippedSources()
      .filter(({ text }) => takesMoreThanData(text))
      .map(({ rel, text }) => `${rel} — ${takenFromYaml(text).join(", ")}`);
    const known = [...KNOWN].map(([rel, { takes }]) => `${rel} — ${takes.join(", ")}`);
    expect(
      found.sort(),
      "A shipped file takes something from the YAML library that this guard does not know. To CHANGE a property of a note, " +
        "use setFrontmatterPath(), deleteFrontmatterPath(), renameFrontmatterKey() or upsertFrontmatterKeys() from @plainva/core: " +
        "they change the entry where it stands. A block that was read must not be printed by the library (doc.toString(), stringify()) — " +
        "that writes every value anew from what it was read as. Enter the file in KNOWN only with what it does instead.",
    ).toEqual(known.sort());
  });

  it("no shipped file names the function that printed a note's block", () => {
    const offenders = shippedSources()
      .filter(({ text }) => /\bjoinDocument\b/.test(code(text)))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("the reader of a note's block prints nothing", () => {
    const block = code(sourceFile("packages/core/src/frontmatter-block.ts"));
    expect(block).toMatch(/parseDocument\(span\.yaml/);
    expect(block).not.toMatch(/\.toString\(/);
    expect(block).not.toMatch(/\bstringify\b/);
    // Nor do the writers that are handed its document.
    for (const rel of ["packages/core/src/frontmatter-surgical.ts", "packages/core/src/frontmatter-string-updater.ts"]) {
      const text = code(sourceFile(rel));
      expect(text, rel).not.toMatch(/\.toString\(/);
      expect(text, rel).not.toMatch(/\bstringify\b/);
    }
  });

  it("the library prints in ONE place, and there it is handed a value, not a document that was read", () => {
    const entry = code(sourceFile("packages/core/src/frontmatter-entry.ts"));
    const prints = entry.match(/[^\n]*\.toString\([^\n]*/g) ?? [];
    expect(prints.map((line) => line.trim())).toEqual(["return new Document(value, { aliasDuplicateObjects: false }).toString(options);"]);
    expect(entry).toMatch(/function written\(value: unknown, options: object = WRITE\): string \{/);
    // A line is never folded: the default of the one writer.
    expect(entry).toMatch(/const WRITE = \{ lineWidth: 0 \} as const;/);
    // It reads a note's block through the one reader, and asks the library for no document of its own.
    expect(entry).toMatch(/splitDocument\(content, \{ sourceTokens: true \}\)/);
    expect(entry).not.toMatch(/parseDocument|parseAllDocuments|\bstringify\b/);
  });

  it("the whole-set writer writes its difference through the same entries", () => {
    const updater = code(sourceFile("packages/core/src/frontmatter-string-updater.ts"));
    for (const call of [/renameEntryKey\(next, /, /removeEntry\(next, \[key\]\)/, /setEntry\(next, \[key\], value\)/]) expect(updater).toMatch(call);
  });

  it("every entry of the list still names a file that needs it", () => {
    const sources = new Map(shippedSources().map(({ rel, text }) => [rel, text]));
    for (const rel of KNOWN.keys()) {
      const text = sources.get(rel);
      expect(text, `${rel} is gone — remove it from the list`).toBeDefined();
      expect(takesMoreThanData(text!), `${rel} takes nothing but data any more — remove it from the list`).toBe(true);
    }
  });

  it("recognises what reaches for the library, and leaves reading data alone", () => {
    for (const [copy, takes] of [
      [`import { parseDocument, Document, YAMLMap, isMap } from "yaml";`, ["Document", "YAMLMap", "isMap", "parseDocument"]],
      [`import { stringify as stringifyYaml } from "yaml";`, ["stringify"]],
      [`import { parse as parseYaml, parseDocument } from "yaml";`, ["parse", "parseDocument"]],
      [`import * as yaml from "yaml";\nreturn yaml.stringify(out);`, ["stringify"]],
      [`import YAML from 'yaml';\nconst doc = YAML.parseDocument(text); return doc.toString();`, ["parseDocument"]],
      [`const { parseDocument } = await import("yaml");`, ["*"]],
      [`const yaml = require("yaml");`, ["*"]],
      [`import { CST, Scalar, isAlias, type YAMLMap } from "yaml";`, ["CST", "Scalar", "isAlias"]],
    ] as Array<[string, string[]]>) {
      expect(takenFromYaml(copy), copy).toEqual(takes);
      expect(takesMoreThanData(copy), copy).toBe(true);
    }
    for (const fine of [
      `import { parse as parseYaml } from "yaml";`,
      `import * as yaml from "yaml";\nconst o = yaml.parse(block);`,
      `import type { Document, YAMLMap } from "yaml";`,
      `import { type CST, type Node } from "yaml";`,
      `import { stringify } from "./canonicalJson";\nreturn stringify(value);`,
      `const text = JSON.stringify(value); return value.toString();`,
    ]) {
      expect(takesMoreThanData(fine), fine).toBe(false);
    }
  });
});
