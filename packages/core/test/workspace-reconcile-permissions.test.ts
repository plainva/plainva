import { describe, expect, it } from "vitest";
import {
  evaluateWorkspaceAccess,
  PermissionedVaultAdapter,
  workspaceDeniedFork,
  workspaceSliceIdsForObject,
  type PersonalWorkspaceRuntime,
  type WorkspaceMutationAuthorizationRequest,
  type WorkspacePolicyPayload,
  type WorkspaceStateStore,
} from "../src/index.js";
import { live, queued, synced, type MemoryVault } from "./helpers/workspaceReconcile.ts";

/**
 * The start-up reconcile of an encrypted workspace asks the permission check
 * (release 0.9.0 A3). What changed while the app was closed went into the
 * queue without the check a change from outside gets while the app runs; a
 * change the member may not make failed only at its push, at every cycle,
 * instead of staying a local fork.
 */

/** The vault's chain check for a change from outside, judged in `payload` (the shells' `workspaceWriteAuthorizer`, path-based). */
function permissionsFor(vault: MemoryVault, state: WorkspaceStateStore, runtime: PersonalWorkspaceRuntime, payload: WorkspacePolicyPayload) {
  const authorize = async (request: WorkspaceMutationAuthorizationRequest) => {
    const existing = await state.getObjectByPath(request.path);
    const objectId = existing?.objectId ?? "91".repeat(16);
    return evaluateWorkspaceAccess(payload, { memberId: runtime.memberId, deviceId: runtime.device.publicIdentity.deviceId, capability: request.capability, objectId, sliceIds: workspaceSliceIdsForObject(payload, { objectId, path: request.path }) });
  };
  return new PermissionedVaultAdapter(vault, state, authorize, workspaceDeniedFork(vault, state));
}

function readerPolicy(runtime: PersonalWorkspaceRuntime): WorkspacePolicyPayload {
  const payload: WorkspacePolicyPayload = structuredClone(runtime.policy.payload);
  payload.assignments[0].role = "Reader";
  payload.assignments[0].capabilities = ["comment.read", "content.read", "history.read"];
  return payload;
}

describe("A3: the start-up reconcile asks the permission check", () => {
  it("a Reader's offline edit stays a local fork, once — not a queue entry that fails at every push", async () => {
    const { runtime, state, vault, reconcile } = await synced(["Note.md", "Other.md"]);
    await vault.writeTextFile("Note.md", "# changed while closed\n");
    const reader = permissionsFor(vault, state, runtime, readerPolicy(runtime));

    await reconcile(reader);
    expect(await queued(state)).toEqual([]);
    const forks = await state.listLocalForks();
    expect(forks.map((fork) => [fork.originalPath, fork.reason])).toEqual([["Note.md", "permission-denied"]]);
    expect(await vault.readTextFile(forks[0].forkPath)).toBe("# changed while closed\n");

    // The next start meets the same refused change: no second copy of it.
    await reconcile(reader);
    expect(await queued(state)).toEqual([]);
    expect(await state.listLocalForks()).toHaveLength(1);

    // Changed again: that is a new refusal, with its own copy.
    await vault.writeTextFile("Note.md", "# changed again\n");
    await reconcile(reader);
    expect(await state.listLocalForks()).toHaveLength(2);
  });

  it("a Reader's offline deletion is not queued either, and is recorded once", async () => {
    const { runtime, state, vault, reconcile } = await synced(["Note.md", "Other.md"]);
    await vault.deleteItem("Other.md");
    const reader = permissionsFor(vault, state, runtime, readerPolicy(runtime));
    await reconcile(reader);
    await reconcile(reader);
    expect(await queued(state)).toEqual([]);
    expect((await state.listLocalForks()).map((fork) => fork.originalPath)).toEqual(["Other.md"]);
    expect(await live(state, "Other.md")).toBe(true);
  });

  it("what the member may do goes into the queue as before", async () => {
    const { runtime, state, vault, reconcile } = await synced(["Note.md", "Other.md"]);
    await vault.writeTextFile("Note.md", "# owner edit\n");
    await vault.writeTextFile("New.md", "# new\n");
    await vault.deleteItem("Other.md");
    await reconcile(permissionsFor(vault, state, runtime, runtime.policy.payload));
    expect((await queued(state)).sort()).toEqual(["delete Other.md", "write New.md", "write Note.md"]);
    expect(await state.listLocalForks()).toEqual([]);
  });

  it("a folder made by a Reader while closed is refused without a copy, and once", async () => {
    const { runtime, state, vault, reconcile } = await synced(["Note.md"]);
    await vault.createDir("Folder");
    const reader = permissionsFor(vault, state, runtime, readerPolicy(runtime));
    await reconcile(reader);
    await reconcile(reader);
    expect(await queued(state)).toEqual([]);
    expect((await state.listLocalForks()).map((fork) => fork.originalPath)).toEqual(["Folder"]);
  });
});

