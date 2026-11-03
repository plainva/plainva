import { describe, expect, it } from "vitest";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import { realSqlite } from "./helpers/realSqlite.js";

/**
 * The links that name a file by its NAME, wherever they lead now
 * (`linksNamingFile`, Sammelplan § 3.135 Nr. 6). An adoption that makes a note
 * a folder's `index.md` can take over every link that names an overview only
 * as `index`; to say which, it asks for all of them - the candidates
 * `getBacklinks` resolves for one file, asked for a name.
 */
describe("linksNamingFile", () => {
  it("lists every link that ends in the name, in any spelling, and no other", async () => {
    const db = await realSqlite();
    const vault = new MemoryVaultAdapter(1_000);
    await vault.writeTextFile("Other/index.md", "# Other\n");
    await vault.writeTextFile("Projects/Plan.md", "See [[index]], [[Other/INDEX#Part|there]], [x](index.md), [[Indexes]] and [[Alpha]].\n");
    await vault.writeTextFile("Projects/Task.md", "---\nup: \"[[index]]\"\n---\nText.\n");
    await vault.writeTextFile("Projects/Alpha.md", "No links.\n");
    await new VaultIndexer(vault, db).indexVaultFull();

    const rows = await new VaultQueryService(db).linksNamingFile("index.md");
    expect(rows.map((row) => [row.source_path, row.target_path, row.link_type, row.property_key ?? null])).toEqual([
      ["Projects/Plan.md", "index", "wikilink", null],
      ["Projects/Plan.md", "Other/INDEX", "wikilink", null],
      ["Projects/Plan.md", "index.md", "markdown-link", null],
      ["Projects/Task.md", "index", "wikilink", "up"],
    ]);
    await db.close();
  });
});
