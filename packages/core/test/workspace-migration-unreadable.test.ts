import { describe, expect, it } from "vitest";
import {
  EncryptedWorkspaceWorker,
  FakeWorkspaceObjectStore,
  MemoryWorkspaceStateStore,
  createPersonalWorkspaceBootstrap,
  initializePersonalWorkspaceMigration,
  personalWorkspaceRuntime,
  type IVaultAdapter,
} from "../src/index.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";

/**
 * A folder the walk could not read is no deletion at the start of the app
 * (issue #125).
 *
 * At every open the start-up reconcile of an encrypted workspace compares the
 * vault with the objects it holds, and queues a deletion for every object
 * whose file it does not find. Its inventory was the plain listing — and a
 * listing leaves out what it could not read: a link to a network drive that is
 * not mounted, a folder without access. The desktop's walk names such an entry
 * since #72 and the iPhone's since #125, but the plain listing hands over the
 * files only, so every note under the unreachable folder went out as a
 * deletion, to every device of the workspace. The index has kept what lies
 * under a named path for as long as it has had the names; now the reconcile
 * does too.
 */

const AT = "2026-10-12T08:00:00.000Z";

async function workspaceWith(files: Record<string, string>) {
  const runtime = personalWorkspaceRuntime(await createPersonalWorkspaceBootstrap({ ownerDisplayName: "Owner", deviceDisplayName: "Desktop", platform: "desktop", minimumClientVersion: "0.8.0", now: AT }));
  const store = new FakeWorkspaceObjectStore();
  const state = new MemoryWorkspaceStateStore();
  const vault = new MemoryVaultAdapter() as MemoryVaultAdapter & { listDirReport?: IVaultAdapter["listDirReport"] };
  for (const [path, text] of Object.entries(files)) await vault.writeTextFile(path, text);
  await initializePersonalWorkspaceMigration({ store, state, vault, runtime, recoveryConfirmedAt: AT });
  await new EncryptedWorkspaceWorker(store, state, vault, runtime).runCycle();
  const reconcile = () => initializePersonalWorkspaceMigration({ store, state, vault, runtime, recoveryConfirmedAt: AT });
  const queued = async () => (await state.listQueue()).map((item) => `${item.operation} ${item.path}`).sort();
  return { vault, reconcile, queued };
}

/** The folder behind a link is not reachable: the walk names it and lists nothing under it. */
function unreachable(vault: MemoryVaultAdapter & { listDirReport?: IVaultAdapter["listDirReport"] }, folder: string): void {
  const listDir = vault.listDir.bind(vault);
  vault.listDirReport = async (path = "", recursive = false) => ({
    files: (await listDir(path, recursive)).filter((f) => f.path !== folder && !f.path.startsWith(`${folder}/`)),
    skipped: [{ path: folder, reason: "unreadable" }],
  });
  // What the plain listing of both shells hands over: the files, not the names.
  vault.listDir = async (path = "", recursive = false) => (await vault.listDirReport!(path, recursive)).files;
}

describe("the start-up reconcile of an encrypted workspace", () => {
  it("queues no deletion for what lies under a folder the walk could not read", async () => {
    const { vault, reconcile, queued } = await workspaceWith({ "note.md": "note", "Shared/a.md": "a", "Shared/Deep/b.md": "b" });
    expect(await queued()).toEqual([]);
    unreachable(vault, "Shared");
    await reconcile();
    expect(await queued()).toEqual([]);
  });

  it("…and still queues one for a file that is gone", async () => {
    const { vault, reconcile, queued } = await workspaceWith({ "note.md": "note", "Shared/a.md": "a" });
    unreachable(vault, "Shared");
    await vault.deleteItem("note.md");
    await reconcile();
    expect(await queued()).toEqual(["delete note.md"]);
  });
});
