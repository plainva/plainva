import { describe, expect, it } from "vitest";
import { type EgressRecipient } from "@plainva/core";
import { createVaultPolicy } from "@plainva/ui";
import { buildContextPackage } from "../../../../packages/core/src/ai/context/package";
import { resetGistStores, GistStore } from "../../../../packages/core/src/ai/context/gistStore";
import { areaGistKey, GistReader, VAULT_GIST_KEY } from "../../../../packages/core/src/ai/context/gistWriter";
import { MemoryVaultAdapter } from "../../../../packages/core/test/helpers/memoryVault";
import { VaultIndexer } from "../../../../packages/core/src/vault/VaultIndexer";
import { VaultQueryService } from "../../../../packages/core/src/vault/VaultQueryService";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";

/**
 * A verdict on an area's short summary, kept over messages, is decided by names as fresh as its stamp (review of R19,
 * wave 2). The real vault policy both shells build — its names kept for a few seconds, on a clock the test moves —,
 * the real index and the real reader of the summaries: a note kept from the cloud appears that a link of the area
 * could mean. The index has it at once, and so does the stamp; the names the policy keeps do not yet. A "may go"
 * decided on those names was kept under the new stamp, and the summary went on going once the names were fresh.
 */
const cloud: EgressRecipient = { kind: "cloud", provider: "p", model: "m" };
const situation = { now: "2026-11-13 10:00", weekday: "Friday", calendarDay: "2026-11-13", journalDay: "2026-11-13", active: null, tabs: [], tasks: [], events: [], dailyNote: null };

describe("a verdict on an area's summary, kept over messages", () => {
  it("is decided by the names as they are now: a note kept back that a link of the area could mean takes the summary back at once", async () => {
    resetGistStores();
    const vault = new MemoryVaultAdapter(1_000);
    for (let i = 0; i < 40; i++) await vault.writeTextFile(`Projects/n${i}.md`, `---\nowner: "[[Projects/n${(i * 7) % 40}]]"\n---\n# n${i}\nOffer ${i}, see [[Projects/n${(i * 13) % 40}]].\n`);
    await vault.writeTextFile("Projects/Kowalski.md", "# K\nfine\n");
    await vault.writeTextFile("Projects/m0.md", "# m0\nSee [[Kowalski]].\n");
    const db = await realSqlite();
    const indexer = new VaultIndexer(vault, db);
    await indexer.indexVaultFull();
    const query = new VaultQueryService(db as never);
    const store = new GistStore(db);
    const later = Date.now() + 365 * 864e5;
    await store.put({ key: areaGistKey("Projects"), level: "folder", source: areaGistKey("Projects"), text: "Offers of the studio.", ok: true, createdAt: later }, "local/m");
    await store.put({ key: VAULT_GIST_KEY, level: "vault", source: VAULT_GIST_KEY, text: "Notes of a small studio.", ok: true, createdAt: later }, "local/m");
    let clock = 1_000_000;
    const policy = createVaultPolicy({
      readFile: (path) => vault.readTextFile(path).catch(() => null),
      resolveLink: (target, from) => query.resolveNotePath(target, from),
      fileNames: () => query.linkTargets(),
      encrypted: () => false,
      now: () => clock,
    });
    // The host as the shells hand it to the package (`aiSession`).
    const host = {
      policyOf: policy.policyOf,
      resolveLink: policy.resolveLink,
      linkCandidates: policy.linkCandidates,
      rulesStamp: () => policy.rulesStamp!(),
      ...(policy.linkSnapshot ? { linkSnapshot: () => policy.linkSnapshot!() } : {}),
      readNote: async (path: string) => {
        const text = await vault.readTextFile(path).catch(() => null);
        return text === null ? null : { title: path.replace(/^.*\//, "").replace(/\.md$/, ""), text };
      },
    };
    const sent = async () => {
      const pack = await buildContextPackage(
        { question: "What is the offer?", recipient: cloud, situation, candidates: [[{ path: "Projects/n1.md", title: "n1", signals: { lexical: 1 } }]], pins: [] },
        { ...host, gists: new GistReader(db, "local/m") },
      );
      return pack.part.text.includes("Offers of the studio.");
    };
    expect(await sent()).toBe(true);
    expect(await sent()).toBe(true);
    // The names the policy keeps are read now, without the note to come.
    clock += 4_000;
    expect(await sent()).toBe(true);
    await vault.writeTextFile("Private/Kowalski.md", "---\nplainva:\n  ai:\n    cloud: deny\n---\n# s\n");
    await indexer.indexPath("Private/Kowalski.md");
    // A second later: the index has the note, the names the policy keeps do not.
    clock += 1_000;
    expect(await sent()).toBe(false);
    // Once those names are fresh too, nothing kept says otherwise.
    clock += 10_000;
    expect(await sent()).toBe(false);
    await db.close();
  });

  /**
   * What a verdict reads besides the index is asked again before a kept "may go" is taken (review of R19, wave 2): a
   * note a link could mean that denies itself in its file, and a file the shell's resolver finds on disk before the
   * index has read it — the phone's resolver looks at the files on disk (`vaultService.resolveWikiTarget`). In the same
   * moment, a host that keeps no verdict holds the summary back; the kept verdict must not let it go.
   */
  for (const phone of [false, true]) {
    it(`never lets through what a verdict decided in the same moment holds back: a note that denies itself on disk, a file the index has not read (${phone ? "the phone's resolver" : "the desktop's resolver"})`, async () => {
      resetGistStores();
      const vault = new MemoryVaultAdapter(1_000);
      for (let i = 0; i < 20; i++) await vault.writeTextFile(`Projects/n${i}.md`, `# n${i}\nOffer ${i}, see [[Projects/n${(i * 13) % 20}]].\n`);
      await vault.writeTextFile("Projects/Kowalski.md", "# K\nfine\n");
      await vault.writeTextFile("Projects/m0.md", "# m0\nSee [[Kowalski]].\n");
      await vault.writeTextFile("Projects/m1.md", "# m1\nSee [[Zed]].\n");
      const db = await realSqlite();
      const indexer = new VaultIndexer(vault, db);
      await indexer.indexVaultFull();
      const query = new VaultQueryService(db as never);
      const store = new GistStore(db);
      const later = Date.now() + 365 * 864e5;
      await store.put({ key: areaGistKey("Projects"), level: "folder", source: areaGistKey("Projects"), text: "Offers of the studio.", ok: true, createdAt: later }, "local/m");
      await store.put({ key: VAULT_GIST_KEY, level: "vault", source: VAULT_GIST_KEY, text: "Notes of a small studio.", ok: true, createdAt: later }, "local/m");
      let clock = 1_000_000;
      // The phone's resolver: the index, then the files on disk.
      const resolveLink = async (target: string, from: string) => {
        const viaIndex = await query.resolveNotePath(target, from);
        if (viaIndex || !phone) return viaIndex;
        const name = target.replace(/\|.*$/, "").replace(/#.*$/, "").trim().toLowerCase();
        const listed = (await vault.listDir("", true)).filter((entry) => !entry.isDirectory).map((entry) => entry.path);
        return listed.find((path) => path.replace(/^.*\//, "").replace(/\.md$/i, "").toLowerCase() === name) ?? null;
      };
      const policy = createVaultPolicy({ readFile: (path) => vault.readTextFile(path).catch(() => null), resolveLink, fileNames: () => query.linkTargets(), encrypted: () => false, now: () => clock });
      const readNote = async (path: string) => {
        const text = await vault.readTextFile(path).catch(() => null);
        return text === null ? null : { title: path.replace(/^.*\//, "").replace(/\.md$/, ""), text };
      };
      const kept = { policyOf: policy.policyOf, resolveLink: policy.resolveLink, linkCandidates: policy.linkCandidates, rulesStamp: () => policy.rulesStamp!(), linkSnapshot: () => policy.linkSnapshot!(), readNote };
      // A host that keeps no verdict: it decides every message anew (no `linkSnapshot`).
      const deciding = { policyOf: policy.policyOf, resolveLink: policy.resolveLink, linkCandidates: policy.linkCandidates, rulesStamp: () => policy.rulesStamp!(), readNote };
      const sent = async (host: typeof deciding) => {
        const pack = await buildContextPackage(
          { question: "What is the offer?", recipient: cloud, situation, candidates: [[{ path: "Projects/n1.md", title: "n1", signals: { lexical: 1 } }]], pins: [] },
          { ...host, gists: new GistReader(db, "local/m") },
        );
        return pack.part.text.includes("Offers of the studio.");
      };
      const alike = async () => {
        const now = await sent(deciding);
        expect(await sent(kept)).toBe(now);
        return now;
      };
      expect(await alike()).toBe(true);
      expect(await alike()).toBe(true);
      // The note `[[Kowalski]]` means denies itself in its file; the index has not read it again.
      await vault.writeTextFile("Projects/Kowalski.md", "---\nplainva:\n  ai:\n    cloud: deny\n---\n# K\n");
      clock += 1_000;
      expect(await alike()).toBe(false);
      // The note is fine again, and the index reads it: a kept "may not go" lasts no longer than the state it was
      // decided in (it never lets more through than a verdict decided now — at most it holds back until the index
      // has read the change).
      await vault.writeTextFile("Projects/Kowalski.md", "# K\nfine again\n");
      await indexer.indexPath("Projects/Kowalski.md");
      clock += 1_000;
      expect(await alike()).toBe(true);
      // A file `[[Zed]]` could mean appears on disk, kept from the cloud; the index has not read it.
      await vault.writeTextFile("Private/Zed.md", "---\nplainva:\n  ai:\n    cloud: deny\n---\n# z\n");
      clock += 1_000;
      expect(await alike()).toBe(!phone);
      await indexer.indexPath("Private/Zed.md");
      clock += 1_000;
      expect(await alike()).toBe(false);
      await db.close();
    });
  }
});
