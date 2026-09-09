import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPersonalWorkspaceBootstrap, personalWorkspaceRuntime, initializePersonalWorkspaceMigration,
  EncryptedWorkspaceWorker, FakeWorkspaceObjectStore, SqlWorkspaceStateStore } from "../../src/index.js";
import { LocalVaultAdapter } from "../../src/vault/LocalVaultAdapter.js";
import { realSqlite } from "./realSqlite.js";

/** Real disk, SQLite and signed worker; only the remote transport is controlled. */
export async function commentShellWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "plainva-shell-workspace-"));
  const raw = new LocalVaultAdapter(root); await raw.initialize(); await raw.writeTextFile("note.md", "Original note.");
  const db = await realSqlite(), state = new SqlWorkspaceStateStore(db);
  const runtime = personalWorkspaceRuntime(await createPersonalWorkspaceBootstrap({ ownerDisplayName: "Owner", deviceDisplayName: "Local", platform: "desktop", minimumClientVersion: "0.8.1" }));
  const remote = new FakeWorkspaceObjectStore();
  await initializePersonalWorkspaceMigration({ store: remote, state, vault: raw, runtime, recoveryConfirmedAt: new Date().toISOString() });
  const worker = new EncryptedWorkspaceWorker(remote, state, raw, runtime); await worker.runCycle();
  return { root, raw, db, state, runtime, remote, worker,
    cleanup: async () => { await worker.stopAndDrain(); await db.close(); await rm(root, { recursive: true, force: true }); },
  };
}
