import { describe, expect, it } from "vitest";
import { peelBlockquotes, readAtxHeading, readBlockquoteLine } from "../src/markdownBlockLine.js";
import { readFilterComparison } from "../src/vault/filterComparison.js";
import { bumpRootOkfDeclaration, hasOkfVersionKey, readRootOkfDeclaration } from "../src/okf-migration.js";
import { displacedTaskPath, taskNotePath } from "../src/pim/taskNoteIdentity.js";
import { brokenLinkNoteTitle } from "../src/vault/GraphService.js";

/**
 * Line grammars read in linear time (plan Befunde 24.09., E6): Markdown block
 * lines, `.base` comparison filters, the OKF declaration, task note titles and
 * broken link targets. Each hostile case is what an old pattern needed
 * quadratic (the heading: cubic) time for — a long run it could split two
 * ways, then something that made the match fail. The pins are readings of the
 * old patterns, quirks included; the functions' own behaviour tests ran
 * unchanged across the rewrite.
 */
const N = 100_000;
const within = (budgetMs: number, run: () => void) => {
  const start = performance.now();
  run();
  expect(performance.now() - start).toBeLessThan(budgetMs);
};

describe("Markdown block lines", () => {
  it("reads an ATX heading the way the old pattern did", () => {
    expect(readAtxHeading("# Title #")).toEqual({ level: 1, text: "Title" });
    expect(readAtxHeading("### a ## \t")).toEqual({ level: 3, text: "a" });
    expect(readAtxHeading("# a#")).toEqual({ level: 1, text: "a#" });
    // A lone closing run is the text; a line break among the trailing blanks is allowed.
    expect(readAtxHeading("# #")).toEqual({ level: 1, text: "#" });
    expect(readAtxHeading("# Title\r")).toEqual({ level: 1, text: "Title" });
    expect(readAtxHeading("#  ")).toEqual({ level: 1, text: "" });
    expect(readAtxHeading("# a\rb")).toBeNull();
    expect(readAtxHeading("#Title")).toBeNull();
    expect(readAtxHeading("####### x")).toBeNull();
    expect(readAtxHeading("    # x")).toBeNull();
  });

  it("reads a blockquote line the way the old pattern did", () => {
    expect(readBlockquoteLine(">> a")).toEqual({ markers: ">> ", text: "a" });
    expect(readBlockquoteLine(">  a")).toEqual({ markers: "> ", text: " a" });
    expect(readBlockquoteLine("   > a")).toEqual({ markers: "> ", text: "a" });
    // A line break after the markers makes the line no quote (the old `.*$`).
    expect(readBlockquoteLine("> a\r")).toBeNull();
    expect(readBlockquoteLine("    > a")).toBeNull();
  });

  it("both run in one pass over a long run", () => {
    within(1_000, () => expect(readAtxHeading(`#${" ".repeat(N)}x\ry`)).toBeNull());
    within(1_000, () => expect(readAtxHeading(`# a${" ".repeat(N)}#\rb`)).toBeNull());
    within(1_000, () => expect(readBlockquoteLine(`${">".repeat(N)}\r`)).toBeNull());
    within(1_000, () => expect(readBlockquoteLine(`${"> ".repeat(N / 2)}\r`)).toBeNull());
  });

  it("peels nested quote levels like the one-level reader applied again and again", () => {
    const repeated = (line: string) => {
      let depth = 0, text = line;
      for (let quote = readBlockquoteLine(text); quote; quote = readBlockquoteLine(text)) { depth++; text = quote.text; }
      return { depth, text };
    };
    for (const line of ["plain", "> a", ">  >  > # deep", ">  >   > four blanks", ">  > a\r", ">>  >\t> b", "   >  >", ""]) {
      expect(peelBlockquotes(line), line).toEqual(repeated(line));
    }
    within(1_000, () => expect(peelBlockquotes(`${">  ".repeat(N / 3)}x`)).toEqual({ depth: Math.floor(N / 3), text: " x" }));
    within(1_000, () => expect(peelBlockquotes(`${">  ".repeat(N / 3)}x\r`).depth).toBe(0));
  });
});

describe("the comparison filter of a .base", () => {
  it("reads column, operator and escaped value the way the old pattern did", () => {
    expect(readFilterComparison('status == "done"')).toEqual({ column: "status", op: "==", value: "done" });
    expect(readFilterComparison('a >= "1"')).toEqual({ column: "a", op: ">=", value: "1" });
    expect(readFilterComparison('a <"b"')).toEqual({ column: "a", op: "<", value: "b" });
    expect(readFilterComparison(' col  !=  ""')).toEqual({ column: " col", op: "!=", value: "" });
    expect(readFilterComparison('a == "x\\"y"')).toEqual({ column: "a", op: "==", value: 'x\\"y' });
    expect(readFilterComparison('a = "1"')).toBeNull();
    expect(readFilterComparison('a == "x"y"')).toBeNull();
    expect(readFilterComparison('a\nb == "x"')).toBeNull();
  });

  it("runs in one pass over a long run of blanks or operators", () => {
    within(1_000, () => expect(readFilterComparison(`a${" ".repeat(N)}x"`)).toBeNull());
    within(1_000, () => expect(readFilterComparison(`a${"=".repeat(N)}"`)).toBeNull());
    within(1_000, () => expect(readFilterComparison(`a${" ".repeat(N)}== "v"`)?.value).toBe("v"));
  });
});

describe("the OKF declaration", () => {
  it("reads and rewrites the declaration line the way the old pattern did", () => {
    expect(readRootOkfDeclaration('---\nokf_version: "0.1"\n---\n')).toBe("0.1");
    // A quoted value with more after it is read as a plain value.
    expect(readRootOkfDeclaration('---\nokf_version: "0.1" x\n---\n')).toBe('"0.1" x');
    expect(bumpRootOkfDeclaration("---\nokf_version: 0.1   # keep\n---\n", "0.2").content).toBe('---\nokf_version: "0.2" # keep\n---\n');
    expect(bumpRootOkfDeclaration("---\n  okf_version:\t'0.1'\t# c\r\n---\n", "0.2").content).toBe('---\n  okf_version: "0.2" # c\r\n---\n');
  });

  it("finds the key at a line start, like /(^|\\r?\\n)\\s*okf_version\\s*:/", () => {
    expect(hasOkfVersionKey("a: 1\n\n  okf_version :")).toBe(true);
    expect(hasOkfVersionKey("\tokf_version\n:")).toBe(true);
    expect(hasOkfVersionKey("x okf_version:")).toBe(false);
    expect(hasOkfVersionKey("a:1\r okf_version:")).toBe(false);
  });

  it("runs in one pass over a long run", () => {
    const value = `a${" ".repeat(N)}b`;
    within(1_000, () => expect(readRootOkfDeclaration(`---\nokf_version: ${value}\u2028\n---\n`)).toBe(value));
    within(1_000, () => expect(hasOkfVersionKey(`${"\n".repeat(N)}x`)).toBe(false));
  });
});

describe("task note names", () => {
  const task = { uid: "u", list: "l", provider: "p", identity: "i" };
  const anchored = (body: string) => `---\nplainva:\n  pim:\n    kind: task\n    uid: u\n    list: l\n    provider: p\n    identity: i\n---\n${body}`;
  const adapter = { exists: async () => false, readTextFile: async () => "" };

  it("drops trailing dots and blanks from the stem", () => {
    expect(taskNotePath("", "Buy milk. . ", task)).toMatch(/^Buy milk — [0-9a-f]{16}\.md$/);
    expect(taskNotePath("", " . . ", task)).toMatch(/^Task — [0-9a-f]{16}\.md$/);
  });

  it("names a displaced task after its first `#` heading", async () => {
    expect(await displacedTaskPath(adapter, "Tasks/Old.md", anchored("#   Title  \nx"))).toMatch(/^Tasks\/Title — [0-9a-f]{16}\.md$/);
    expect(await displacedTaskPath(adapter, "Tasks/Old.md", anchored("x\n#\n\nTitle"))).toMatch(/^Tasks\/Title — [0-9a-f]{16}\.md$/);
    expect(await displacedTaskPath(adapter, "Tasks/Old.md", anchored("#Title\n"))).toMatch(/^Tasks\/Old — [0-9a-f]{16}\.md$/);
  });

  it("runs in one pass over a long run", async () => {
    within(1_000, () => expect(taskNotePath("", `${". ".repeat(N / 2)}x`, task)).toMatch(/ — [0-9a-f]{16}\.md$/));
    const start = performance.now();
    expect(await displacedTaskPath(adapter, "Tasks/Old.md", anchored(`#${"\n".repeat(N)}`))).toMatch(/^Tasks\/Old — /);
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});

describe("the note a broken link asks for", () => {
  it("takes the last path segment and cuts its anchor, like /#.*$/", () => {
    expect(brokenLinkNoteTitle("Folder/Note#Heading")).toBe("Note");
    expect(brokenLinkNoteTitle("a\\b#h")).toBe("b");
    expect(brokenLinkNoteTitle("#only")).toBe("");
    // The cut falls after the last line break; a `#` before it stays.
    expect(brokenLinkNoteTitle("Note#a\n#b")).toBe("Note#a\n");
  });

  it("runs in one pass over a long run of `#`", () => {
    within(1_000, () => expect(brokenLinkNoteTitle(`${"#".repeat(N)}\n`)).toBe(`${"#".repeat(N)}\n`));
  });
});
