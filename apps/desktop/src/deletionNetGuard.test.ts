import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every deletion goes through the one place that knows its net (D1 of the
 * data-safety plan of 2026-11-06).
 *
 * The rule — a deletion that could not be undone is not carried out without
 * the person's "Delete anyway" — lives once, in `BackupVaultAdapter.deleteItem`
 * (core). It holds only as long as nothing deletes past it, and as long as a
 * deletion a person asked for puts the question where the rule refuses. So:
 *
 * 1. Every call of `.deleteItem(` in the app's source is listed below, with
 *    the reason it is safe. A new one fails here until it is classified.
 * 2. A deletion a person confirmed (`{ confirmed: true }`) in either shell or
 *    the shared UI goes through `deleteWithNet`/`settleWithNet` (or the
 *    phone's `vaultOps.remove`, which does), never straight to the chain —
 *    except a sweep nobody watches, listed as `background`.
 * 3. The raw storages of both shells sit under `BackupVaultAdapter`: the
 *    chain, the sync worker and the version history are built on it.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const SOURCES = ["apps/desktop/src", "apps/mobile/src", "packages/ui/src", "packages/core/src"];

type Kind =
  /** A link of the chain, handing the call to the one below. */
  | "chain"
  /** The place that asks, or the net rule itself. */
  | "asks"
  /** Only the app's own files under `.plainva` (never versioned, never asked about). */
  | "internal"
  /** Nobody to ask: through the chain, so without a net it is refused and tried again or kept. */
  | "background"
  /** What goes lies, checked, in another file (`withoutSnapshot`), or it goes through the chain with its rule. */
  | "covered";

const CALLS: Record<string, { count: number; kind: Kind; why: string }> = {
  "packages/core/src/vault/BackupVaultAdapter.ts": { count: 6, kind: "asks", why: "the net rule itself, and the rotation of its own snapshots under .plainva" },
  "packages/core/src/vault/ConflictAwareVaultAdapter.ts": { count: 6, kind: "chain", why: "top of the chain; a conflict copy goes below with withoutSnapshot only where its text was kept or the person said so" },
  "packages/core/src/vault/QueueingVaultAdapter.ts": { count: 1, kind: "chain", why: "hands the deletion down, then queues it" },
  "packages/core/src/workspace/authorization.ts": { count: 1, kind: "chain", why: "checks the right, hands the deletion down" },
  "packages/core/src/workspace/queueingVaultAdapter.ts": { count: 1, kind: "chain", why: "hands the deletion down, then queues it" },
  "apps/desktop/src/services/ownerBus.ts": { count: 1, kind: "chain", why: "another window's deletion, carried out in the chain; a refusal goes back as data (windowBus noNet)" },
  "packages/core/src/vault/conflictSession.ts": { count: 4, kind: "covered", why: "a working copy set aside or taken into the note goes withoutSnapshot; a discarded one only with the person's answer" },
  "packages/core/src/vault/conflictCopy.ts": { count: 4, kind: "covered", why: "the fallback without the chain's gate, with the same withoutSnapshot rule" },
  "packages/core/src/pim/taskNoteIdentity.ts": { count: 1, kind: "covered", why: "the copy's text lies in its own task note first" },
  "packages/core/src/vault/ConflictFileStore.ts": { count: 2, kind: "internal", why: "conflict session records under .plainva" },
  "packages/core/src/vault/VersionHistoryService.ts": { count: 1, kind: "internal", why: "pruning snapshots under .plainva/backups" },
  "packages/core/src/settingsSync/SettingsSyncStep.ts": { count: 1, kind: "internal", why: "the profile file under .plainva/sync" },
  "packages/core/src/comments/CommentsSyncStep.ts": { count: 2, kind: "internal", why: "comment bundles under .plainva, the first after a verified recovery copy" },
  "packages/ui/src/lib/bookmarksFile.ts": { count: 1, kind: "internal", why: ".plainva/bookmarks.json" },
  "packages/ui/src/lib/encryptedRemoteGate.ts": { count: 1, kind: "internal", why: ".plainva/encrypted-remote.json, the encrypted-workspace fact of the vault (R8)" },
  "packages/ui/src/lib/okfConversion.ts": { count: 1, kind: "internal", why: "its own batch backup under .plainva/backups" },
  "packages/ui/src/lib/deletionNet.ts": { count: 1, kind: "asks", why: "deleteWithNet: the one way a person's deletion is put" },
  "packages/core/src/sync/SyncWorker.ts": { count: 1, kind: "background", why: "mirrors another device's deletion through the backup adapter; refused without a net, the file stays and the next cycle tries again" },
  "packages/core/src/sync/nameTwins.ts": { count: 1, kind: "background", why: "a twin spelling, through the backup adapter; refused without a net, the resolution step fails and says so" },
  "packages/core/src/workspace/worker.ts": { count: 2, kind: "background", why: "applies the workspace's deletions through the chain; refused without a net, the entry stays" },
  "apps/desktop/src/contexts/VaultContext.tsx": { count: 1, kind: "background", why: "a task the provider deleted, through the chain; refused without a net, the note stays" },
  "apps/mobile/src/services/pim/taskSyncRuntime.ts": { count: 1, kind: "background", why: "the same, on the phone" },
  "apps/desktop/src/services/pinboardDrafts.ts": { count: 1, kind: "background", why: "the sweep of empty drafts at the vault's opening; a draft it cannot delete with a net stays remembered" },
  "apps/mobile/src/services/vaultService.ts": { count: 2, kind: "asks", why: "vaultOps.remove/removeFolder: a confirmed deletion goes through deleteWithNet, an unconfirmed one through the chain's rule" },
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "node_modules" || name === "__tests__" || name === "test") continue;
      out.push(...sourceFiles(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.(ts|tsx)$/.test(name) && !/Harness\.ts$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(path);
    }
  }
  return out;
}

/** Source without its comments, so a sentence about a call is no call. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const files = SOURCES.flatMap((dir) => sourceFiles(join(root, dir))).map((path) => ({
  rel: relative(root, path).replace(/\\/g, "/"),
  text: code(readFileSync(path, "utf8")),
}));

describe("every deletion goes through its net (D1)", () => {
  it("every call of .deleteItem( is one of the listed, with its reason", () => {
    const found: Record<string, number> = {};
    for (const file of files) {
      const count = (file.text.match(/\.deleteItem\(/g) ?? []).length;
      if (count > 0) found[file.rel] = count;
    }
    const expected = Object.fromEntries(Object.entries(CALLS).map(([rel, entry]) => [rel, entry.count]));
    // A new call: classify it above. A deletion a person asked for goes
    // through deleteWithNet (packages/ui) instead of calling the chain.
    expect(found).toEqual(expected);
  });

  it("a deletion a person confirmed is put through deleteWithNet, never straight to the chain", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (!file.rel.startsWith("apps/") && !file.rel.startsWith("packages/ui/")) continue;
      const lines = file.text.split("\n");
      lines.forEach((line, i) => {
        if (!/\.deleteItem\([^)]*confirmed: true/.test(line)) return;
        if (CALLS[file.rel]?.kind === "background") return;
        offenders.push(`${file.rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the places that ask go through the one helper", () => {
    for (const rel of [
      "apps/desktop/src/components/FileTree.tsx",
      "apps/desktop/src/services/cascadeDelete.ts",
      "apps/desktop/src/components/CascadeDeleteHost.tsx",
      "apps/desktop/src/components/tasks/TaskDuplicatesNotice.tsx",
      "apps/desktop/src/services/pinboardDrafts.ts",
      "packages/ui/src/ai/aiVaultHost.ts",
    ]) expect(asking(rel), rel).toMatch(/deleteWithNet\(/);
    // Both comparisons: every exit of a conflict copy, through the same question.
    for (const rel of ["apps/desktop/src/components/CompareModal.tsx", "apps/mobile/src/components/ConflictCompareSheet.tsx"]) {
      const text = asking(rel);
      expect((text.match(/await settleConflict(Text|Copy)\(/g) ?? []).length, rel).toBe(0);
      expect((text.match(/settleWithNet\(\(noNet\) => settleConflict(Text|Copy)\(/g) ?? []).length, rel).toBe(6);
    }
    // The phone's one way to delete a file or folder asks where the person confirmed it.
    const ops = asking("apps/mobile/src/services/vaultService.ts");
    expect((ops.match(/confirmation\?\.confirmed[^\n]*\n\s*if \(!\(await deleteWithNet\(v\.files, path/g) ?? []).length).toBe(2);
  });

  it("both shells register the question at start", () => {
    expect(asking("apps/desktop/src/main.tsx")).toMatch(/installDeletionNetQuestion\(\);/);
    expect(asking("apps/mobile/src/main.tsx")).toMatch(/installDeletionNetQuestion\(\);/);
  });

  it("the raw storages sit under BackupVaultAdapter in both shells", () => {
    // Both shells build their chain with the one factory (stability plan R2), which puts the versions layer
    // directly over the storage — `vault-chain.test.ts` in the core shows a deletion take its version first.
    const factory = asking("packages/core/src/vault/vaultChain.ts");
    expect(factory).toMatch(/const versions = new BackupVaultAdapter\(ports\.storage,/);
    expect(factory).toMatch(/new PermissionedVaultAdapter\(versions,/);
    expect(factory).toMatch(/new QueueingVaultAdapter\(versions,/);
    expect(factory).toMatch(/new ConflictAwareVaultAdapter\(versions,/);
    const desktop = asking("apps/desktop/src/contexts/VaultContext.tsx");
    expect(desktop).toMatch(/buildVaultChain\(\{\s*storage: tauriVaultAdapter,/);
    expect(desktop).toMatch(/const backupVaultAdapter = chain\.belowChain;/);
    expect(desktop).toMatch(/new SyncWorker\(engine, target, syncRepo, backupVaultAdapter,/);
    expect(desktop).not.toMatch(/tauriVaultAdapter\.deleteItem/);

    const phone = asking("apps/mobile/src/services/vaultService.ts");
    expect((phone.match(/buildVaultChain\(\{\s*storage: adapter,/g) ?? []).length).toBe(2);
    expect((phone.match(/backup = chain\.belowChain;/g) ?? []).length).toBe(2);
    expect(phone).toMatch(/^\s*belowChain: BackupVaultAdapter;$/m);
    expect(asking("apps/mobile/src/services/syncService.ts")).toMatch(/new SyncWorker\(engine, target, v\.syncRepo!, v\.belowChain,/);
    // Nothing on the phone deletes on the raw storage.
    for (const file of files.filter((f) => f.rel.startsWith("apps/mobile/"))) {
      expect(file.text, file.rel).not.toMatch(/\b(v|vault)\.adapter\.deleteItem\(/);
    }
  });
});

function asking(rel: string): string {
  const file = files.find((f) => f.rel === rel);
  if (!file) throw new Error(`no source ${rel}`);
  return file.text;
}
