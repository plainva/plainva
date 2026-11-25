import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The sync's own removals that a runtime left unrecorded (a crash, a close
 * between the removal and its record) stay the sync's in the next runtime:
 * both shells take the notes over (`adoptOwnRemovals`) into the register
 * BEFORE their index looks at the vault — read the other way round, the
 * index reports the vanished file first and it is queued as the person's
 * deletion. And the workspace worker of both shells marks its incoming
 * deletions in the same register as the plain sync. The behaviour itself is
 * tested in the core (test/sync/half-states.test.ts,
 * test/workspace-half-states.test.ts).
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("the notes of the sync's own removals are taken over before the index looks", () => {
  for (const file of ["apps/desktop/src/contexts/VaultContext.tsx", "apps/mobile/src/services/vaultService.ts"]) {
    it(file, () => {
      const source = read(file);
      // The register's class may come from the sync's own module, loaded with the vault (performance plan L5).
      const register = Math.max(source.indexOf("const ownDeletions = new OwnDeletionRegister();"), source.indexOf("const ownDeletions = new sync.OwnDeletionRegister();"));
      const adopt = source.indexOf("await adoptOwnRemovals(", register);
      const indexer = source.indexOf("new VaultIndexer(", register);
      expect(register).toBeGreaterThan(-1);
      expect(adopt, "taken over").toBeGreaterThan(register);
      expect(adopt, "before the index looks").toBeLessThan(indexer);
    });
  }

  it("and the workspace worker of both shells marks into the same register", () => {
    const desktop = read("apps/desktop/src/contexts/VaultContext.tsx");
    const at = desktop.indexOf("new workspace.EncryptedWorkspaceWorker(");
    expect(desktop.slice(at, at + 300)).toContain("ownDeletions,");
    const phone = read("apps/mobile/src/services/syncService.ts");
    const there = phone.indexOf("new workspace.EncryptedWorkspaceWorker(");
    expect(phone.slice(there, there + 300)).toContain("ownDeletions: v.ownDeletions,");
  });
});
