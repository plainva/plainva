import { afterAll, describe, expect, it } from "vitest";
import { realSqlite } from "./helpers/realSqlite.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import { DESKTOP_NOTE_BUDGET, NOTE_BUDGET, overBudgetInlineRanges, readAsTextParts, setNoteBudget } from "../src/inlineParseBudget.js";
import { renameNoteLinks } from "../src/linkRewrite.js";
import { GraphService } from "../src/vault/GraphService.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";

/**
 * What the two notices of a very large note say (`editor.readAsTextInfo`,
 * `editor.readAsTextUnreadInfo`, and the handbook's "Very large notes"), held
 * claim by claim through the index as the app builds it — search, backlinks,
 * the graph, tags, tasks — and a rename, with the budget of each shell: the
 * phone's and the desktop's, which reads four times as much formatted.
 *
 * A part read as text in pieces: search finds it, its links are in the
 * backlinks and the graph, its tags and tasks are found, a rename rewrites its
 * links — behind an unclosed `---` in the first line as well. A part not read
 * even in pieces — a paragraph too large for a piece, a quote of a list too
 * heavy for one, such a paragraph behind an unclosed `---` —: its links are
 * missing from the backlinks and the graph, a rename leaves its links (and
 * counts them as links it could not rewrite), search finds it, its tasks are
 * found; a paragraph's tags are found, a block's not (no tag rather than a
 * wrong one). Split into smaller notes it is read again — a paragraph or a
 * quote also with blank lines, a list under one item with its items a level
 * up.
 */

const SECONDS = 1000;
const SHELLS = [
  ["phone", NOTE_BUDGET],
  ["desktop", DESKTOP_NOTE_BUDGET],
] as const;

afterAll(() => setNoteBudget(NOTE_BUDGET));


/** The fewest units `make` needs for `holds`, found by doubling and halving back (to within an eighth). */
function fewest(make: (n: number) => string, holds: (text: string) => boolean, from = 256): number {
  let n = from;
  while (!holds(make(n))) n *= 2;
  for (let step = n / 4; step >= n / 16; step /= 2) if (holds(make(n - step))) n -= step;
  return Math.ceil(n);
}

/** The vault of `notes` beside the notes they link to, indexed; its query service, graph and the rename of one target. */
async function indexed(notes: Record<string, string>) {
  const db = await realSqlite();
  const files = new MemoryVaultAdapter(1_000);
  for (const [path, text] of Object.entries(notes)) await files.writeTextFile(path, text);
  for (const target of ["Target", "Hidden target"]) await files.writeTextFile(`${target}.md`, `# ${target}\n`);
  await new VaultIndexer(files, db).indexVaultFull();
  const query = new VaultQueryService(db);
  const graph = await new GraphService(db).loadGraph({});
  return {
    search: async (word: string) => (await query.searchFullText(word)).map((row) => row.path).sort(),
    backlinks: async (target: string) => (await query.getBacklinks(`${target}.md`)).map((link) => link.source_path),
    edge: (source: string, target: string) => graph.edges.some((edge) => edge.source === source && edge.target === `${target}.md`),
    tags: async () => (await query.getAllTags()).map((tag) => tag.tag),
    tasks: async (path: string) => (await query.listTasks()).filter((task) => task.path === path).map((task) => task.text),
  };
}

/** The part of every unread form that only it holds: a link, a tag, a word, a task. */
const MARKS = "[[Hidden target]] #onlyunread quokka";

for (const [shell, budget] of SHELLS) {
  describe(`what the notices say holds on the ${shell}`, () => {
    it("a part read as text in pieces: search, backlinks, graph, tags and tasks find it, and a rename rewrites its links", async () => {
      expect.hasAssertions();
      setNoteBudget(budget);
      const list = (n: number) => `# Big\n\n${Array.from({ length: n }, (_, i) => `- item ${i} [[Target]] #piece${i % 7} zebra${i}\n- [ ] task ${i}`).join("\n")}\n`;
      const n = Math.ceil(fewest(list, (text) => readAsTextParts(text).pieces.length > 0) * 1.5);
      const text = list(n);
      const parts = readAsTextParts(text);
      expect(parts.pieces.length, "read in pieces").toBeGreaterThan(1);
      expect(parts.unread).toEqual([]);
      const vault = await indexed({ "Big.md": text });
      expect(await vault.search(`zebra${n - 1}`)).toEqual(["Big.md"]);
      expect(await vault.backlinks("Target")).toHaveLength(n);
      expect(vault.edge("Big.md", "Target")).toBe(true);
      expect(await vault.tags()).toEqual(expect.arrayContaining(["piece0", "piece6"]));
      expect(await vault.tasks("Big.md")).toHaveLength(n);
      const renamed = renameNoteLinks(text, new Map([["Target", "Renamed"]]));
      expect(renamed).toEqual({ content: text.split("[[Target]]").join("[[Renamed]]"), renamed: n, unplaced: 0 });
    }, 300 * SECONDS);

    // Each form of a part not read even in pieces, its marks in the unread part, and how it is read again.
    const paragraph = (n: number, gap = "\n") => Array.from({ length: n }, (_, i) => `line ${i} [[Target]] see words ${i}${i === n - 2 ? ` ${MARKS}` : ""}`).join(gap);
    const quoted = (n: number, gap = "\n") => `${Array.from({ length: n }, (_, i) => `> quoted ${i} [[Target]] words${i === n - 2 ? ` ${MARKS}` : ""}`).join(gap)}\n>\n> - [ ] task in the unread part`;
    const nested = (n: number) => Array.from({ length: n }, (_, i) => `  - sub ${i} [[Target]] words${i === n - 2 ? ` ${MARKS}` : ""}`).join("\n");
    // `tags`: whether its tags are found — a paragraph over the inline budget gives them from the note's tree, as on
    // `main` and as the note read whole does; a block not read gives none (no tag rather than a wrong one).
    const forms: Array<{ name: string; make: (n: number) => string; again: (n: number) => string; how: string; tasks: boolean; tags: boolean }> = [
      // One paragraph too large for a piece.
      { name: "a paragraph too large for a piece", make: (n) => `# Big\n\n${paragraph(n)}\n`, again: (n) => `# Big\n\n${paragraph(n, "\n\n")}\n`, how: "split with blank lines", tasks: false, tags: true },
      // A quote of one paragraph: a block that is not cut.
      { name: "a quote of one paragraph too heavy for a piece", make: (n) => `# Big\n\n${quoted(n)}\n`, again: (n) => `# Big\n\n${quoted(n, "\n\n")}\n`, how: "split with blank lines", tasks: true, tags: true },
      // A list under one item: cut at the items of its outermost list only, which has one.
      { name: "a list under one item too heavy for a piece", make: (n) => `# Big\n\n- outer\n${nested(n)}\n- [ ] task in the unread part\n`, again: (n) => `# Big\n\n- outer\n${nested(n).replace(/^  - /gm, "- ")}\n- [ ] task in the unread part\n`, how: "its items moved up a level", tasks: true, tags: false },
      // Behind an unclosed `---` in the first line no line opens a list: such a paragraph is not cut either.
      { name: "such a paragraph behind an unclosed `---`", make: (n) => `---\n${paragraph(n)}\n- [ ] task in the unread part\n`, again: (n) => `---\n${paragraph(n, "\n\n")}\n- [ ] task in the unread part\n`, how: "split with blank lines", tasks: true, tags: true },
    ];

    for (const form of forms) {
      it(`${form.name}: its links are missing from backlinks and the graph, a rename leaves them; search, tasks and the tags of a paragraph find it`, async () => {
        expect.hasAssertions();
        setNoteBudget(budget);
        const n = Math.ceil(fewest(form.make, (text) => readAsTextParts(text).unread.length > 0) * 1.1);
        const text = form.make(n);
        const parts = readAsTextParts(text);
        expect(parts.unread.length, "a part is not read").toBeGreaterThan(0);
        const hidden = text.indexOf("[[Hidden target]]");
        expect(parts.unread.some((range) => range.from <= hidden && hidden < range.to), "the marks lie in the part not read").toBe(true);
        const vault = await indexed({ "Big.md": text });
        expect(await vault.backlinks("Hidden target")).toEqual([]);
        expect(vault.edge("Big.md", "Hidden target")).toBe(false);
        const renamed = renameNoteLinks(text, new Map([["Hidden target", "Renamed"]]));
        expect(renamed.content).toBe(text);
        expect(renamed.renamed).toBe(0);
        expect(renamed.unplaced, "a rename says it left links").toBeGreaterThan(0);
        expect(await vault.search("quokka")).toEqual(["Big.md"]);
        // A paragraph over the inline budget keeps its tags, as on `main`; a block not read gives none: no tag rather than a
        // wrong one (the tag rule over unread characters read tags out of code).
        if (form.tags) expect(await vault.tags()).toContain("onlyunread");
        else expect(await vault.tags()).not.toContain("onlyunread");
        if (form.tasks) expect(await vault.tasks("Big.md")).toContain("task in the unread part");
      }, 300 * SECONDS);

      it(`${form.name}: split into smaller notes, it is read again`, async () => {
        expect.hasAssertions();
        setNoteBudget(budget);
        const n = Math.ceil(fewest(form.make, (text) => readAsTextParts(text).unread.length > 0) * 1.1);
        const lines = form.make(n).split("\n");
        // The note cut at its lines into notes small enough to be read formatted, each with the first line of the note.
        let count = 2;
        const notesOf = (k: number) => Array.from({ length: k }, (_, i) => [lines[0], ...lines.slice(1 + Math.floor(((lines.length - 1) * i) / k), 1 + Math.floor(((lines.length - 1) * (i + 1)) / k))].join("\n") + "\n");
        while (notesOf(count).some((note) => overBudgetInlineRanges(note).length > 0)) count *= 2;
        const notes = notesOf(count);
        for (const note of notes) expect(readAsTextParts(note).unread).toEqual([]);
        const vault = await indexed(Object.fromEntries(notes.map((note, i) => [`Part ${i}.md`, note])));
        expect(await vault.backlinks("Hidden target")).toHaveLength(1);
        expect((await vault.backlinks("Target")).length).toBe(n);
      }, 300 * SECONDS);
    }

    for (const form of forms) {
      it(`${form.name}: ${form.how}, it is read again`, async () => {
        expect.hasAssertions();
        setNoteBudget(budget);
        const n = Math.ceil(fewest(form.make, (text) => readAsTextParts(text).unread.length > 0) * 1.1);
        const text = form.again(n);
        expect(readAsTextParts(text).unread).toEqual([]);
        const vault = await indexed({ "Big.md": text });
        expect(await vault.backlinks("Hidden target")).toEqual(["Big.md"]);
        expect(await vault.backlinks("Target")).toHaveLength(n);
        expect(await vault.tags()).toContain("onlyunread");
      }, 300 * SECONDS);
    }

    it("a list behind an unclosed `---`, read as text, is read in pieces as in the note", async () => {
      expect.hasAssertions();
      setNoteBudget(budget);
      const note = (n: number) => `---\n${Array.from({ length: n }, (_, i) => `- item ${i} [[Target]] #behind words ${i}`).join("\n\n")}\n`;
      const n = Math.ceil(fewest(note, (text) => readAsTextParts(text).pieces.length > 0) * 1.5);
      const parts = readAsTextParts(note(n));
      expect(parts.pieces.length).toBeGreaterThan(0);
      expect(parts.unread).toEqual([]);
      const vault = await indexed({ "Big.md": note(n) });
      expect(await vault.backlinks("Target")).toHaveLength(n);
      expect(await vault.tags()).toContain("behind");
    }, 300 * SECONDS);
  });
}
