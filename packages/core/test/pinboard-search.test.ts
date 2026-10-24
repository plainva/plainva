import { describe, expect, it, vi } from "vitest";
import { realSqlite } from "./helpers/realSqlite.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";

describe("pinboard body search", () => {
  it("searches all selected paths, including the tail, with Unicode folding and bounded reads", async () => {
    const db = await realSqlite();
    try {
      const paths = Array.from({ length: 503 }, (_, i) => `Note-${i}.md`);
      for (const [i, path] of paths.entries()) await db.execute("INSERT INTO fts_notes(path, content) VALUES (?, ?)", [path, i === 502 ? "---\nHidden: secret-value\n---\nMÜLLER finds 100% here." : "Ordinary body"]);
      await db.execute("INSERT INTO fts_notes(path, content) VALUES (?, ?)", ["Outside.md", "MÜLLER finds 100% here."]);
      const query = new VaultQueryService(db);
      const reads = vi.spyOn(db, "query");
      expect(await query.searchCardContent(paths, "müller")).toEqual(["Note-502.md"]);
      expect(reads.mock.calls.every(([, params]) => params!.length <= 200)).toBe(true);
      expect(await query.searchCardContent(paths, "secret-value")).toEqual([]);
      expect(await query.searchCardContent(paths, "100%")).toEqual(["Note-502.md"]);
      expect(await query.searchCardContent(paths, "%' OR 1=1 --")).toEqual([]);
      expect(await query.searchCardContent([], "ordinary")).toEqual([]);
    } finally { await db.close(); }
  });

  it("reads the text behind a block without entries, and no further into a block than it goes", async () => {
    // No database needed for what counts as the body: the rows are handed in.
    const notes: Record<string, string> = {
      // `---` on `---` ran on to the rule in the text; the text before it was "properties".
      "empty.md": "---\n---\nIntro with the needle.\n\n---\n\nRest.\n",
      "empty-crlf.md": "---\r\n---\r\nIntro with the needle.\r\n\r\n---\r\n",
      "hidden.md": "---\nHidden: needle\n---\nBody.\n",
      "hidden-padded.md": "--- \nHidden: needle\n---  \nBody.\n",
      "hidden-bom.md": "\uFEFF---\nHidden: needle\n---\nBody.\n",
      // What merely looks like a block is hidden on a card as well.
      "hidden-document-end.md": "---\nHidden: needle\n...\nBody.\n",
      "behind.md": "---\nHidden: other\n---\nThe needle is in the text.\n",
    };
    const db = { query: async (_sql: string, paths: string[]) => paths.map((path) => ({ path, content: notes[path] ?? null })) };
    const query = new VaultQueryService(db as unknown as ConstructorParameters<typeof VaultQueryService>[0]);
    expect(await query.searchCardContent(Object.keys(notes), "needle")).toEqual(["empty.md", "empty-crlf.md", "behind.md"]);
  });
});
