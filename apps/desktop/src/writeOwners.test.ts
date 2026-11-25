import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Whose writes are whose (review 2026-11-18). The way out says at the next
 * start that Plainva went before everything was written only for the
 * person's writes (`inflightWrites.ts`): "background" is only work the next
 * start does again by itself — the sync and its settings, the index, the
 * task and entry sync, the deletion journal, clearing out old snapshots.
 * Everything else is the person's, whichever link of the chain it writes
 * through.
 *
 * Every line of the vault context that hands on a link of the chain is named
 * here with its owner, so a new one cannot count as background in silence:
 * a line not in this list fails, and so does one that went.
 */

type Owner = "person" | "background" | "read" | "chain";

const HANDOFFS: Record<string, Owner> = {
  'const tauriVaultAdapter = countWrites(new TauriVaultAdapter(path), "background");': "chain",
  // The sync's own removals left unrecorded by a runtime that ended: only asks whether a file is still there.
  'await adoptOwnRemovals(dbAdapter, ownDeletions, { vaultIsThere: () => vaultFolderIsThere(tauriVaultAdapter).then((there) => there === true), exists: (p) => tauriVaultAdapter.exists(p) }).catch(reportingTo("sync:own-removals"));': "read",
  'await perfMeasure("vault open: native filesystem", () => tauriVaultAdapter.initialize());': "chain",
  'await tauriVaultAdapter.createDir(".plainva");': "chain",
  "storage: tauriVaultAdapter,": "chain",
  "const backupVaultAdapter = chain.belowChain;": "chain",
  "const vaultAdapter = chain.files;": "chain",
  'const personVaultAdapter = countWrites(vaultAdapter, "person");': "person",
  'const personBelowChain = countWrites(backupVaultAdapter, "person");': "person",
  "vaultIsThere: () => vaultFolderIsThere(vaultAdapter).then((there) => there === true),": "read",
  "stillGone: async (p: string) => !(await vaultAdapter.exists(p)),": "read",
  "const indexer = new VaultIndexer(vaultAdapter, dbAdapter, {": "background",
  "isOwnWrite: (path, sha256) => vaultAdapter.wasWrittenByUs(path, sha256),": "read",
  "exists: (p) => tauriVaultAdapter.exists(p),": "read",
  // The accounts of a rebuilt index database: it only reads the settings profile's copy in the vault.
  'await restoreDesktopAccountsAfterRebuild(path, dbAdapter, tauriVaultAdapter).catch(reportingTo("accounts:restore-after-rebuild"));': "read",
  "const deletionJournal = new (await syncModules()).DeletionJournal(backupVaultAdapter, await getDeviceId());": "background",
  // The task sync: the next start runs it again.
  "readTextFile: (p) => vaultAdapter.readTextFile(p),": "background",
  "writeTextFile: (p, c) => vaultAdapter.writeTextFile(p, c),": "background",
  "updateTextFile: (p, change) => updateVaultText(vaultAdapter, p, change),": "background",
  "exists: (p) => vaultAdapter.exists(p),": "background",
  "createDir: (p) => vaultAdapter.createDir(p),": "background",
  "deleteFile: (p) => vaultAdapter.deleteItem(p),": "background",
  // The entry sync (S19).
  "adapter: vaultAdapter,": "background",
  // "Undo" of a task deleted elsewhere.
  "writeTextFile: (p, c) => personVaultAdapter.writeTextFile(p, c),": "person",
  // The encrypted workspace's sync, settings sync and reconcile at opening.
  "const remotePorts = encryptedRemoteFilePorts(backupVaultAdapter);": "background",
  "const runner = await buildSettingsSyncStep(path, { pimRuntime, rawVault: backupVaultAdapter, ...(workspaceRuntime ? { memberId: workspaceRuntime.memberId } : {}) });": "background",
  "const settingsOnly = new (await syncModules()).SettingsOnlySync(runner, target, backupVaultAdapter, intervalMs, undefined, sessionCheck, () => {": "background",
  "vault: backupVaultAdapter,": "background",
  "const sideband = (await buildSettingsSyncStep(path, { pimRuntime, rawVault: backupVaultAdapter, memberId: runtime.memberId })) ?? undefined;": "background",
  "const worker = new (await workspaceModule()).EncryptedWorkspaceWorker(objectStore, workspaceStateStore, backupVaultAdapter, runtime, {": "background",
  "sideband: sideband ? () => sideband.run(target!, backupVaultAdapter) : undefined,": "background",
  // The file sync.
  "vaultAdapter,": "background",
  "createContentRefResolver(path, tauriVaultAdapter),": "read",
  "const settingsSync = (await buildSettingsSyncStep(path, { pimRuntime, rawVault: backupVaultAdapter })) ?? undefined;": "background",
  "const fileWorker = new (await syncModules()).SyncWorker(engine, target, syncRepo, backupVaultAdapter, syncQueue, intervalMs, { settingsSync, deletionJournal, ownDeletions, workspaceListed });": "background",
  "if (!(await syncRepo.hasConfirmedRemoteFiles().catch(() => true))) holdBackStartersAtFirstListing(fileWorker, backupVaultAdapter, syncRepo);": "background",
  // What the surfaces, the owner bus and every other window get.
  "vaultAdapter: personVaultAdapter,": "person",
  "backupAdapter: personBelowChain,": "person",
  "belowChainAdapter: personBelowChain,": "person",
  "buildSettingsSyncStep(state.vaultPath, { pimRuntime: state.pimRuntime, rawVault: uncounted(state.belowChainAdapter), memberId: workspaceRuntimeRef.current?.memberId ?? null })": "background",
  // Clearing out old snapshots (`backupScheduler.ts`).
  "const stop = startBackupScheduler({ vaultPath: state.vaultPath, adapter: uncounted(state.vaultAdapter) });": "background",
};

const source = readFileSync(fileURLToPath(new URL("./contexts/VaultContext.tsx", import.meta.url)), "utf8");
const LINK = /(?<![.\w])(vaultAdapter|backupVaultAdapter|tauriVaultAdapter|personVaultAdapter|personBelowChain)\b(?!\s*:)|uncounted\(/;

function handoffs(): string[] {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !line.startsWith("//") && !line.startsWith("*") && !line.startsWith("import "))
    .filter((line) => LINK.test(line) && !line.includes("state.vaultAdapter;") && !/^if \(!vaultAdapter\)|markdown: await vaultAdapter\.readTextFile/.test(line));
}

describe("whose writes are whose in the vault context", () => {
  it("names every handoff of a link of the chain with its owner", () => {
    const found = [...new Set(handoffs())].sort();
    expect(found).toEqual(Object.keys(HANDOFFS).sort());
  });

  it("gives the surfaces, the owner bus and the person's lower-link writers counted adapters", () => {
    expect(source).toMatch(/const personVaultAdapter = countWrites\(vaultAdapter, "person"\);/);
    expect(source).toMatch(/const personBelowChain = countWrites\(backupVaultAdapter, "person"\);/);
    expect(source).toMatch(/installOwnerBus\(\{[^}]*?\n\s+vaultAdapter: state\.vaultAdapter,/);
  });
});
