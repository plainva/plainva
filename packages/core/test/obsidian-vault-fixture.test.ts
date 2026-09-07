import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";
import { VaultIndexer } from "../src/vault/VaultIndexer.ts";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.ts";
import { buildLinkTargetIndex, resolveLinkTargetIndexed } from "../src/vault/LinkResolver.ts";
import { OBSIDIAN_FIXTURE, copyObsidianVault } from "./fixtures/obsidianVault.ts";

/**
 * The Obsidian fixture vault is the proof base for the Build-91 feedback round
 * (plan 2026-09-07, P0): every package that fixes an Obsidian-convention bug
 * shows its case here. This file only pins what the fixture GUARANTEES, so a
 * later edit to the checked-in vault cannot silently remove a case.
 */
describe("Obsidian fixture vault", () => {
  let dir: string;
  let vault: LocalVaultAdapter;
  let db: MockDatabaseAdapter;

  beforeEach(async () => {
    dir = await copyObsidianVault();
    vault = new LocalVaultAdapter(dir);
    await vault.initialize();
    db = new MockDatabaseAdapter();
    await db.initialize();
  });

  afterEach(async () => {
    await db.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("carries the three conventions the tester's vault had and ours did not", async () => {
    expect(JSON.parse(await vault.readTextFile(".obsidian/app.json")).attachmentFolderPath).toBe(
      OBSIDIAN_FIXTURE.attachmentFolder,
    );
    expect(JSON.parse(await vault.readTextFile(".obsidian/daily-notes.json"))).toMatchObject({
      folder: OBSIDIAN_FIXTURE.dailyFolder,
      format: OBSIDIAN_FIXTURE.dailyFormat,
    });
    // Bare-basename embed, Obsidian's width suffix, and an embed sharing a
    // line with a Markdown link — the three shapes the image regex has to meet.
    const daily = await vault.readTextFile(OBSIDIAN_FIXTURE.dailyNote);
    expect(daily).toContain("![[foto.png]]");
    expect(daily).toContain("![[foto.png|300]]");
    expect(daily).toMatch(/!\[\[foto\.png\]\] und \[Plainva\]\(https:/);
    // A tag-sourced database without any folder source.
    const base = await vault.readTextFile(OBSIDIAN_FIXTURE.tagBase);
    expect(base).toContain('file.hasTag("zettel")');
    expect(base).not.toContain("file.folder");
    // The conflict sibling already on disk.
    expect(await vault.exists(OBSIDIAN_FIXTURE.inboxConflict)).toBe(true);
  });

  it("indexes like a real vault: .obsidian stays out, the attachment and the conflict copy go in", async () => {
    const newFiles: string[] = [];
    const indexer = new VaultIndexer(vault, db, { onNewLocalFile: (p) => newFiles.push(p) });
    await indexer.indexVaultFull();

    const inserted = db.queries
      .filter((q) => q.query.includes("INSERT INTO files"))
      .map((q) => (q.params as any[])[1] as string);
    expect(inserted.some((p) => p.startsWith(".obsidian/"))).toBe(false);
    expect(inserted).toContain(OBSIDIAN_FIXTURE.dailyNote);
    expect(inserted).toContain(OBSIDIAN_FIXTURE.attachment);
    expect(inserted).toContain(OBSIDIAN_FIXTURE.inboxConflict);
    expect(newFiles).toContain(OBSIDIAN_FIXTURE.attachment);

    const tags = db.queries
      .filter((q) => q.query.includes("INTO tags"))
      .flatMap((q) => q.params as any[])
      .filter((p) => typeof p === "string");
    expect(tags).toContain("zettel");
  });

  it("the core resolver already finds the attachment by bare basename — the rule the image embed lacks", async () => {
    const paths = (await vault.listDir("", true)).filter((e) => !e.isDirectory).map((e) => e.path);
    const index = buildLinkTargetIndex(paths);
    expect(resolveLinkTargetIndexed(OBSIDIAN_FIXTURE.dailyNote, "foto.png", index)).toBe(OBSIDIAN_FIXTURE.attachment);
    expect(resolveLinkTargetIndexed(OBSIDIAN_FIXTURE.dailyNote, "Dashboard", index)).toBe(OBSIDIAN_FIXTURE.dashboard);
  });
});
