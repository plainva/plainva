import { afterAll, describe, expect, it } from "vitest";
import { DESKTOP_NOTE_BUDGET, encodeMarkdownLinkPath, NOTE_BUDGET, readAsTextParts, readNoteLinks, setNoteBudget, VaultIndexer, VaultQueryService } from "@plainva/core";
import { renameFileWithLinkUpdates } from "@plainva/ui";
import { realSqlite } from "../../../packages/core/test/helpers/realSqlite";
import { MemoryVaultAdapter } from "../../../packages/core/test/helpers/memoryVault";

/**
 * A rename and a part the parse budget leaves unread (review of L14,
 * 2026-11-26): such a part gives the index no link, and a rename planned from
 * the backlinks alone never opened a note whose only link to the renamed note
 * stood there — the link was left behind without a word. A rename now also
 * reads the notes that may name the old file in such a part (one full-text
 * query, `notesThatMayNameUnread`), leaves that part as it is and says that
 * links were left. Both shells rename through the one function, each with its
 * own budget.
 */

afterAll(() => setNoteBudget(NOTE_BUDGET));

/** A quote of one paragraph, too heavy for a piece and not cut: not read, on either shell. */
const quoteList = (lines: number) => Array.from({ length: lines }, (_, i) => `> quoted ${i} [[Other ${i % 7}]] words`).join("\n");

for (const [shell, budget] of [["phone", NOTE_BUDGET], ["desktop", DESKTOP_NOTE_BUDGET]] as const) {
  describe(`a rename on the ${shell}`, () => {
    it("says it left a link that stands only in a part not read, and writes nothing there", async () => {
      expect.hasAssertions();
      setNoteBudget(budget);
      let lines = 2_000;
      const noteOf = (n: number) => `# Big\n\nintro\n\n${quoteList(n).replace("quoted 7 ", "quoted 7 [[Zork Note]] ")}\n`;
      while (readAsTextParts(noteOf(lines)).unread.length === 0) lines *= 2;
      const big = noteOf(lines);
      const at = big.indexOf("[[Zork Note]]");
      expect(readAsTextParts(big).unread.some((range) => range.from <= at && at < range.to), "the link stands in a part not read").toBe(true);
      const files = new MemoryVaultAdapter(1_000);
      await files.writeTextFile("Big.md", big);
      await files.writeTextFile("Zork Note.md", "# Zork\n");
      await files.writeTextFile("Small.md", "mentions Zork Note, links [[Zork Note]]\n");
      const db = await realSqlite();
      await new VaultIndexer(files, db).indexVaultFull();
      const queryService = new VaultQueryService(db);
      // The index holds no link of the part not read: the backlinks name the small note alone.
      expect((await queryService.getBacklinks("Zork Note.md")).map((link) => link.source_path)).toEqual(["Small.md"]);
      const result = await renameFileWithLinkUpdates({ adapter: files, queryService, oldPath: "Zork Note.md", newPath: "Renamed.md" });
      expect(result.renamedLinks).toBe(1);
      expect(result.linkUpdateFailed, "the rename says a link was left").toBe(true);
      expect(await files.readTextFile("Big.md")).toBe(big);
      expect(await files.readTextFile("Small.md")).toBe("mentions Zork Note, links [[Renamed]]\n");
    }, 300_000);

    it("says nothing where no part is unread", async () => {
      expect.hasAssertions();
      setNoteBudget(budget);
      const files = new MemoryVaultAdapter(1_000);
      const long = `# Long\n\n${Array.from({ length: 400 }, (_, i) => `Line ${i} mentions Zork Note in passing.`).join("\n\n")}\n`;
      await files.writeTextFile("Long.md", long);
      await files.writeTextFile("Zork Note.md", "# Zork\n");
      await files.writeTextFile("Small.md", "links [[Zork Note]]\n");
      const db = await realSqlite();
      await new VaultIndexer(files, db).indexVaultFull();
      const result = await renameFileWithLinkUpdates({ adapter: files, queryService: new VaultQueryService(db), oldPath: "Zork Note.md", newPath: "Renamed.md" });
      expect(result).toMatchObject({ renamedLinks: 1, linkUpdateFailed: false });
      expect(await files.readTextFile("Long.md")).toBe(long);
    }, 300_000);
  });
}

/**
 * Where the search does not find a name for sure (review of L14, 2026-11-26,
 * round two): a Markdown link writes a name's `ö` as `%C3%B6`, a name of an
 * emoji alone gives the search no word, a note not yet in the full-text index
 * is found by no phrase — each left a link in a part not read without a word.
 * And the name as a word of the text alone is no link: renaming `a.md` said
 * links had been left in every large note that held the word "a".
 */
describe("a rename and the notes the search may not find", () => {
  const quote = (lines: number, link: string) => Array.from({ length: lines }, (_, i) => `> quoted ${i} ${i === 7 ? link : ""} [[Other ${i % 7}]] words`).join("\n");
  const bigNote = (link: string) => {
    let lines = 2_000;
    const noteOf = (n: number) => `# Big\n\nintro\n\n${quote(n, link)}\n`;
    while (readAsTextParts(noteOf(lines)).unread.length === 0) lines *= 2;
    return noteOf(lines);
  };
  const cases: Array<[string, string, string, boolean]> = [
    // [label, old path, the link in the part not read, whether the note's row in the full-text index is gone]
    ["a name a Markdown link encodes", "Größe.md", "[t](Gr%C3%B6%C3%9Fe.md)", false],
    ["a name without a letter or a digit", "🚀.md", "[[🚀]]", false],
    ["a note without its row in the full-text index", "Zork Note.md", "[[Zork Note]]", true],
  ];
  for (const [label, oldPath, link, unfiled] of cases) {
    it(`says it left a link: ${label}`, async () => {
      expect.hasAssertions();
      setNoteBudget(NOTE_BUDGET);
      const big = bigNote(link);
      const files = new MemoryVaultAdapter(1_000);
      await files.writeTextFile("Big.md", big);
      await files.writeTextFile(oldPath, "# target\n");
      const db = await realSqlite();
      await new VaultIndexer(files, db).indexVaultFull();
      if (unfiled) await db.execute("DELETE FROM fts_notes WHERE path = ?", ["Big.md"]);
      const result = await renameFileWithLinkUpdates({ adapter: files, queryService: new VaultQueryService(db), oldPath, newPath: "Renamed.md" });
      expect(result.linkUpdateFailed, "the rename says a link was left").toBe(true);
      expect(await files.readTextFile("Big.md")).toBe(big);
    }, 300_000);
  }

  it("says nothing where the old name stands in large notes as a word, never where a link can name it", async () => {
    expect.hasAssertions();
    setNoteBudget(NOTE_BUDGET);
    let lines = 2_000;
    const noteOf = (n: number) => `# Big\n\nintro\n\n${Array.from({ length: n }, (_, i) => `> a line ${i} with a word and [[Other ${i % 7}]]`).join("\n")}\n`;
    while (readAsTextParts(noteOf(lines)).unread.length === 0) lines *= 2;
    const files = new MemoryVaultAdapter(1_000);
    for (let i = 0; i < 3; i++) await files.writeTextFile(`Big${i}.md`, noteOf(lines));
    await files.writeTextFile("a.md", "# a\n");
    const db = await realSqlite();
    await new VaultIndexer(files, db).indexVaultFull();
    const result = await renameFileWithLinkUpdates({ adapter: files, queryService: new VaultQueryService(db), oldPath: "a.md", newPath: "b.md" });
    expect(result.linkUpdateFailed).toBe(false);
  }, 300_000);
});

/**
 * No link is left without a word (review of L14, round three). After a rename,
 * every link the note read whole resolves to the old note is rewritten, or the
 * rename says links were left — on every way, with the same names. The links
 * are written in every form the index's resolver takes for the old note: drawn
 * from candidates and kept where the index of a note holding nothing else
 * lists it as a link to it. Each stands in a part read, a part not read (a
 * quote too heavy for a piece) or a place a definition elsewhere may change
 * (`definitionReach.ts`), with and without a link read beside it, so that the
 * note is a source the rename plans and one it only reads.
 */
describe("a rename leaves no link to the renamed note without a word", () => {
  const OLD = "Ordner/Größe x.md";
  const BASE = "Größe x";
  const encoded = encodeMarkdownLinkPath(OLD);
  const candidates = [
    `[[${BASE}]]`,
    `[[Ordner/${BASE}]]`,
    `[[${BASE.toUpperCase()}]]`,
    `[[${BASE}#Head]]`,
    `[[${BASE}|alias]]`,
    `![[${BASE}]]`,
    `[[${BASE.normalize("NFD")}]]`,
    `[t](${encoded})`,
    `[t](${encoded.toLowerCase().replace("ordner", "Ordner")})`,
    `[t](<${OLD}>)`,
    `[t](Ordner/Gr%C3%B6%C3%9Fe%20x.md#Head)`,
    `[t](Ordner/Größe%20x.md)`,
    `[t](Ordner/Gr%C3%B6ße%20x.md)`,
    `[t](./Ordner/${encodeMarkdownLinkPath("Größe x.md")})`,
  ];
  const read = (lines: number, link: string) => Array.from({ length: lines }, (_, i) => `> quoted ${i} ${i === 7 ? link : ""} [[Other ${i % 7}]] words [d]: x.md`).join("\n");
  const PLACES = ["read", "not read", "open"] as const;

  it("rewrites or names every form the resolver takes, wherever it stands", async () => {
    expect.hasAssertions();
    setNoteBudget(NOTE_BUDGET);
    // The forms the index takes for a link to the old note, each in a note of its own.
    const forms: string[] = [];
    for (const link of candidates) {
      const files = new MemoryVaultAdapter(1_000);
      await files.writeTextFile(OLD, "# Head\n");
      await files.writeTextFile("Small.md", `${link}\n`);
      const db = await realSqlite();
      await new VaultIndexer(files, db).indexVaultFull();
      if ((await new VaultQueryService(db).getBacklinks(OLD)).some((row) => row.source_path === "Small.md")) forms.push(link);
    }
    expect(forms.length, "forms the resolver takes").toBeGreaterThan(8);
    let lines = 2_000;
    while (readAsTextParts(`# Big\n\n${read(lines, "")}\n`).unread.length === 0) lines *= 2;
    const left: string[] = [];
    for (const link of forms) {
      for (const place of PLACES) {
        // A link read beside it by its name, or by its path: the rename counts with every name, not with the read one's.
        for (const beside of [null, `[[${BASE}]]`, `[[Ordner/${BASE}]]`]) {
          const parts = ["# Big", beside ? `read ${beside} here` : "intro", read(lines, place === "not read" ? link : "")];
          if (place === "read") parts.push(`plain ${link} here`);
          if (place === "open") parts.push(`see [x [b]] ${link} here`);
          const big = `${parts.join("\n\n")}\n`;
          if (place === "open") {
            // The place is one a definition elsewhere may change: not read for links.
            const at = big.lastIndexOf(link);
            expect(readNoteLinks(big).unread.some((range) => range.from <= at && at < range.to), `${link}: open`).toBe(true);
          }
          const files = new MemoryVaultAdapter(1_000);
          await files.writeTextFile("Big.md", big);
          await files.writeTextFile(OLD, "# Head\n");
          const db = await realSqlite();
          await new VaultIndexer(files, db).indexVaultFull();
          const result = await renameFileWithLinkUpdates({ adapter: files, queryService: new VaultQueryService(db), oldPath: OLD, newPath: "Ordner/Renamed.md" });
          const after = await files.readTextFile("Big.md");
          const remains = after.split(link).length - 1;
          if (remains > 0 && !result.linkUpdateFailed) left.push(`${link} ${place}${beside ? `, ${beside} read beside it` : ""}`);
          if (place === "read") expect(remains, `${link}: read and rewritten`).toBe(0);
        }
      }
    }
    expect(left, "links left without a word").toEqual([]);
  }, 600_000);

  it("names a link over two lines of a quote, in a part not read", async () => {
    expect.hasAssertions();
    setNoteBudget(NOTE_BUDGET);
    const link = `[t](\n> ${encodeMarkdownLinkPath(OLD)})`;
    let lines = 2_000;
    while (readAsTextParts(`# Big\n\n${read(lines, "")}\n`).unread.length === 0) lines *= 2;
    const big = `# Big\n\nintro\n\n${read(lines, link)}\n`;
    const files = new MemoryVaultAdapter(1_000);
    await files.writeTextFile("Big.md", big);
    await files.writeTextFile(OLD, "# Head\n");
    const db = await realSqlite();
    await new VaultIndexer(files, db).indexVaultFull();
    const result = await renameFileWithLinkUpdates({ adapter: files, queryService: new VaultQueryService(db), oldPath: OLD, newPath: "Ordner/Renamed.md" });
    expect(result.linkUpdateFailed).toBe(true);
    expect(await files.readTextFile("Big.md")).toBe(big);
  }, 300_000);
});
