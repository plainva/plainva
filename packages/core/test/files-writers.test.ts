import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every place that writes, moves or removes a row of the index's `files`
 * table, and how it keeps the rule "the reading whose look at the file began
 * later stands" (fourth review of 11.11.). Three reviews in a row found a
 * writer that took no place among the reads, and the full scan wrote an older
 * reading over it, or a moved note back under its old name. So the list is
 * of every writer, with its answer — a writer added later fails here until it
 * says how it keeps the rule.
 */
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const ROOTS = ["packages/core/src", "packages/ui/src", "apps/desktop/src", "apps/mobile/src"];

const WRITERS: Record<string, string> = {
  "packages/core/src/vault/VaultIndexer.ts":
    "the index itself: a reading is written only with its place among the reads (`claimWrite`), a removal or a move takes one (`claimChange`), a row gone since the scan began comes back only after a removal known to be older (`changedBefore`), and the scan's own removals are decided in its last transaction (`stillMine`)",
  "packages/core/src/sync/SyncQueue.ts":
    "the queue's rename moves a row in place (and drops a stale one at the destination) and takes no place: the full scan does not write a row back that is gone since it began unless the indexer knows the removal is older; every other statement sets the sync label of a row, never its path or text",
  "packages/core/src/sync/owedToRemote.ts": "the sync label of a row only",
  "packages/core/src/workspace/state.ts": "the sync label of a row only",
  "packages/core/src/db/Schema.ts": "a migration at open, before any pass runs",
  "packages/core/src/db/pathIdentityMigration.ts": "a migration at open, before any pass runs",
  "packages/core/src/db/wikiLinkReadingMigration.ts": "a migration at open, before any pass runs: it only marks rows to be read again (`mtime_local = 0`)",
  "apps/desktop/src/ai/embeddingTestVault.ts": "a test vault the evidence runs build; no vault of the person, no pass",
};

function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(REPO, dir))) {
      if (name === "node_modules" || name === "dist") continue;
      const rel = `${dir}/${name}`;
      if (statSync(join(REPO, rel)).isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|\.spec\.|\.d\.ts$/.test(name)) out.push(relative(REPO, join(REPO, rel)).replace(/\\/g, "/"));
    }
  };
  for (const root of ROOTS) walk(root);
  return out;
}

const WRITES_FILES = /\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+files\b/;

describe("every writer of the index's `files` rows says how the later reading stands (fourth review of 11.11.)", () => {
  const writing = sources().filter((f) => WRITES_FILES.test(readFileSync(join(REPO, f), "utf8")));

  it("is on the list, with its answer", () => {
    expect(writing.length).toBeGreaterThan(3);
    expect(writing.filter((f) => !(f in WRITERS)), "writes `files` without saying how the later reading stands").toEqual([]);
    expect(Object.keys(WRITERS).filter((f) => !writing.includes(f)), "listed and writes `files` no more").toEqual([]);
    for (const [file, why] of Object.entries(WRITERS)) expect(why.length, file).toBeGreaterThan(20);
  });

  it('the ones that say "sync label only" write nothing else of a row', () => {
    for (const [file, why] of Object.entries(WRITERS)) {
      if (why !== "the sync label of a row only") continue;
      const statements = readFileSync(join(REPO, file), "utf8").match(/\b(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+files\b[^`]*/g) ?? [];
      for (const statement of statements) expect(statement, file).toMatch(/^UPDATE\s+files\s+SET\s+sync_state\s*=\s*'[a-z_]+'\s*(?:\n|\s)*WHERE/);
    }
  });
});
