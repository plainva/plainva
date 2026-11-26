import { afterAll, describe, expect, it } from "vitest";
import { DESKTOP_NOTE_BUDGET, NOTE_BUDGET, readAsTextParts, setNoteBudget, VaultIndexer, VaultQueryService } from "@plainva/core";
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
