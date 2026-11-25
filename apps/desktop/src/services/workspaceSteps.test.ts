// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { encryptedRemoteFilePorts, markEncryptedRemoteDeparted } from "@plainva/ui";
import { createVaultCallOff } from "@plainva/core";
import { leaveWorkspace, lockWorkspaceStep, withSyncStopped, type StepPorts } from "./workspaceSteps";

/**
 * The steps on a workspace that stop the sync first, over "renewed": the step
 * had to leave the vault, its old runtime is called off and refuses every
 * write. Every handle of the step comes from the new runtime, and the hold of
 * the sync ends on every way out — the vault never stays without its sync.
 */

type Files = Map<string, string>;
function memVault(files: Files = new Map()) {
  return {
    files,
    exists: async (p: string) => files.has(p),
    readTextFile: async (p: string) => { const v = files.get(p); if (v === undefined) throw new Error("not found"); return v; },
    writeTextFile: async (p: string, v: string) => { files.set(p, v); },
    deleteItem: async (p: string) => { files.delete(p); },
  };
}
type Runtime = { belowChain: ReturnType<typeof memVault> | null; name: string };

/** A vault on screen whose step's stop renews it: the old runtime is called off, the new one's sync held. */
function renewing() {
  const fence = createVaultCallOff();
  const oldFiles: Files = new Map();
  const old: Runtime = { name: "old", belowChain: fence.storage(memVault(oldFiles) as never) as unknown as ReturnType<typeof memVault> };
  const fresh: Runtime = { name: "new", belowChain: memVault() };
  const world = { now: old, sync: "running" as "running" | "held" | "stopped", oldFiles, fresh };
  const ports: StepPorts<Runtime> = {
    stopSync: async () => {
      fence.callOff();
      world.now = fresh;
      world.sync = "held";
      return "renewed";
    },
    runtime: () => world.now,
    endHold: () => { if (world.sync === "held") world.sync = "running"; },
  };
  const reopen = async () => { world.sync = "running"; };
  return { world, ports, reopen };
}

describe("leaving the workspace after the step had to leave the vault", () => {
  for (const step of ["decommission", "lift the encryption"] as const) {
    it(`${step}: notes the departure through the new runtime, and the vault syncs again`, async () => {
      expect.hasAssertions();
      const { world, ports, reopen } = renewing();
      let reopenedWith: string | null = null;
      await leaveWorkspace(ports, {
        tearDown: async () => {},
        markDeparted: (belowChain) => markEncryptedRemoteDeparted(encryptedRemoteFilePorts(belowChain), { workspace: "ws-1", sole: true }),
        reopen: async () => { reopenedWith = world.now.name; await reopen(); },
      });
      // THE DEFECT: the note went through the old, called-off runtime's adapter and was silently not written.
      expect([...world.fresh.belowChain!.files.keys()]).toEqual([".plainva/encrypted-remote.json"]);
      expect(world.fresh.belowChain!.files.get(".plainva/encrypted-remote.json")).toContain("released");
      expect([...world.oldFiles.keys()]).toEqual([]);
      expect(reopenedWith).toBe("new");
      expect(world.sync).toBe("running");
    });
  }

  it("a teardown that fails still ends the hold: the vault syncs again", async () => {
    expect.hasAssertions();
    const { world, ports, reopen } = renewing();
    await expect(leaveWorkspace(ports, { tearDown: async () => { throw new Error("keychain"); }, markDeparted: async () => {}, reopen })).rejects.toThrow("keychain");
    expect(world.sync).toBe("running");
  });
});

describe("locking the workspace after the step had to leave the vault", () => {
  it("locks on the new runtime and the vault syncs again", async () => {
    expect.hasAssertions();
    const { world, ports, reopen } = renewing();
    let lockedOn: string | null = null;
    await lockWorkspaceStep(ports, { begin: () => ({ undo: () => {} }), lock: async (on) => { lockedOn = on.name; }, reopen });
    expect(lockedOn).toBe("new");
    expect(world.sync).toBe("running");
  });

  it("a lock that fails ends the hold all the same", async () => {
    expect.hasAssertions();
    const { world, ports, reopen } = renewing();
    await expect(lockWorkspaceStep(ports, { begin: () => ({ undo: () => {} }), lock: async () => { throw new Error("store"); }, reopen })).rejects.toThrow("store");
    expect(world.sync).toBe("running");
  });

  it("undoes the lock where the sync could not be stopped", async () => {
    expect.hasAssertions();
    const { ports, reopen } = renewing();
    let undone = false;
    await expect(lockWorkspaceStep({ ...ports, stopSync: async () => { throw new Error("drain"); } }, { begin: () => ({ undo: () => { undone = true; } }), lock: async () => {}, reopen })).rejects.toThrow("drain");
    expect(undone).toBe(true);
  });
});

describe("activating, resuming or restoring a workspace after the step had to leave the vault", () => {
  for (const step of ["activate", "resume", "restore"] as const) {
    it(`${step}: works on the new runtime, and the vault syncs again — also when it fails`, async () => {
      expect.hasAssertions();
      const done = renewing();
      let ranOn: string | null = null;
      await withSyncStopped(done.ports, async (on) => {
        ranOn = on.name;
        await on.belowChain!.writeTextFile(".plainva/step.json", step);
        await done.reopen();
      });
      expect(ranOn).toBe("new");
      expect(done.world.fresh.belowChain!.files.get(".plainva/step.json")).toBe(step);
      expect(done.world.sync).toBe("running");

      const failing = renewing();
      await expect(withSyncStopped(failing.ports, async () => { throw new Error("provider"); })).rejects.toThrow("provider");
      expect(failing.world.sync, "the hold ends on the way out of an error").toBe("running");
    });
  }
});
