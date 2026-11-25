// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "@plainva/ui/i18n";
import { encryptedRemoteFilePorts, markEncryptedRemoteDeparted, toast, toastStore } from "@plainva/ui";
import { createVaultCallOff } from "@plainva/core";
import { createSyncGate, resetVaultSyncTakenForTests, takeVaultSync } from "./syncGate";
import { createStepPorts, leaveWorkspace, lockWorkspaceStep, withSyncStopped } from "./workspaceSteps";

/**
 * The steps on a workspace that stop the sync first. The ports are the
 * desktop's own (`createStepPorts`): the step takes the vault's sync
 * (`takeVaultSync`), and its runtime is what the last load left — never a
 * fallback to what the step's caller held. The sync is a worker started
 * through the load's gate (`syncGate.ts`).
 */

const VAULT = "/vaults/notes";
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

/**
 * A vault on screen with a running sync. `stop` is the step's stop of it:
 * "same" stops the worker in time; "renewed" leaves the old runtime (called
 * off) and opens the vault anew — or, with `reopenFails`, does not manage to.
 */
function vaultOnScreen(how: "same" | "renewed", options: { reopenFails?: boolean } = {}) {
  const fence = createVaultCallOff();
  const oldFiles: Files = new Map();
  const old: Runtime = { name: "old", belowChain: fence.storage(memVault(oldFiles) as never) as unknown as ReturnType<typeof memVault> };
  const fresh: Runtime = { name: "new", belowChain: memVault() };
  const worker = { running: false, start() { this.running = true; }, stop() { this.running = false; } };
  const world: { live: Runtime | null; worker: typeof worker; oldFiles: Files; fresh: Runtime; reopened: number } = { live: old, worker, oldFiles, fresh, reopened: 0 };
  const load = () => createSyncGate({ path: VAULT, place: null, signal: new AbortController().signal }).start(() => world.worker.start());
  load();
  const ports = createStepPorts<Runtime>({
    vault: "Notes",
    take: () => takeVaultSync(VAULT),
    stop: async () => {
      world.worker.stop();
      if (how === "same") return "same";
      fence.callOff();
      world.live = null;
      if (!options.reopenFails) {
        // The vault opens anew: a new runtime with a new worker, started through its load's gate.
        world.live = fresh;
        world.worker = { running: false, start() { this.running = true; }, stop() { this.running = false; } };
        load();
      }
      return "renewed";
    },
    current: () => world.live,
  });
  const reopen = async () => { world.reopened += 1; };
  return { world, ports, reopen };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  resetVaultSyncTakenForTests();
  toast.clearAll();
});

const departed = (belowChain: ReturnType<typeof memVault>) => markEncryptedRemoteDeparted(encryptedRemoteFilePorts(belowChain), { workspace: "ws-1", sole: true });

describe("leaving the workspace", () => {
  for (const step of ["decommission", "lift the encryption"] as const) {
    it(`${step}, after the step had to leave the vault: notes the departure through the new runtime, and the vault syncs again`, async () => {
      expect.hasAssertions();
      const { world, ports, reopen } = vaultOnScreen("renewed");
      await leaveWorkspace(ports, { tearDown: async () => {}, markDeparted: departed, reopen });
      expect(world.fresh.belowChain!.files.get(".plainva/encrypted-remote.json")).toContain("released");
      expect([...world.oldFiles.keys()]).toEqual([]);
      expect(world.reopened).toBe(1);
      expect(world.worker.running).toBe(true);
    });

    it(`${step}, where the vault did not open again: tears nothing down, says so, and fails`, async () => {
      expect.hasAssertions();
      const { world, ports, reopen } = vaultOnScreen("renewed", { reopenFails: true });
      let tornDown = false;
      const outcome = await leaveWorkspace(ports, { tearDown: async () => { tornDown = true; }, markDeparted: departed, reopen }).then(() => "done", (e: Error) => e.name);
      // THE DEFECT: the step fell back on the closure's adapter of the old runtime — torn down, the note lost, "done".
      expect(outcome).toBe("StepNotRunError");
      expect(tornDown, "nothing torn down").toBe(false);
      expect([...world.oldFiles.keys()]).toEqual([]);
      expect(toastStore.get().map((t) => t.message)).toContain(i18n.t("closing.stepNotRun", { vault: "Notes" }));
    });
  }

  it("a teardown that fails after the sync stopped in time ('same') gives the sync back: it runs again", async () => {
    expect.hasAssertions();
    const { world, ports, reopen } = vaultOnScreen("same");
    await expect(leaveWorkspace(ports, { tearDown: async () => { throw new Error("keychain"); }, markDeparted: departed, reopen })).rejects.toThrow("keychain");
    expect(world.worker.running).toBe(true);
  });
});

describe("locking the workspace", () => {
  it("locks on the new runtime after the step had to leave the vault, and the vault syncs again", async () => {
    expect.hasAssertions();
    const { world, ports, reopen } = vaultOnScreen("renewed");
    let lockedOn: string | null = null;
    await lockWorkspaceStep(ports, { begin: () => ({ undo: () => {} }), lock: async (on) => { lockedOn = on.name; }, reopen });
    expect(lockedOn).toBe("new");
    expect(world.worker.running).toBe(true);
  });

  it("a lock that fails gives the sync back", async () => {
    expect.hasAssertions();
    const { world, ports, reopen } = vaultOnScreen("same");
    await expect(lockWorkspaceStep(ports, { begin: () => ({ undo: () => {} }), lock: async () => { throw new Error("store"); }, reopen })).rejects.toThrow("store");
    expect(world.worker.running).toBe(true);
  });

  it("undoes the lock where no runtime is left to lock", async () => {
    expect.hasAssertions();
    const { ports, reopen } = vaultOnScreen("renewed", { reopenFails: true });
    let undone = false;
    await expect(lockWorkspaceStep(ports, { begin: () => ({ undo: () => { undone = true; } }), lock: async () => {}, reopen })).rejects.toThrow();
    expect(undone).toBe(true);
  });
});

describe("activating, resuming or restoring a workspace", () => {
  it("after 'renewed' works on the new runtime; the sync runs again once the step is through, not before", async () => {
    expect.hasAssertions();
    const { world, ports } = vaultOnScreen("renewed");
    let runningDuringTheStep: boolean | null = null;
    let ranOn: string | null = null;
    await withSyncStopped(ports, async (on) => {
      ranOn = on.name;
      runningDuringTheStep = world.worker.running;
    });
    expect(ranOn).toBe("new");
    expect(runningDuringTheStep, "the reopened vault's sync waits for the step").toBe(false);
    expect(world.worker.running).toBe(true);
  });

  it("restoring with a wrong code after the sync stopped in time ('same') gives the sync back", async () => {
    expect.hasAssertions();
    const { world, ports } = vaultOnScreen("same");
    await expect(withSyncStopped(ports, async () => { throw new Error("wrong recovery code"); })).rejects.toThrow("wrong recovery code");
    // THE DEFECT: the vault stayed without its sync (probe d3).
    expect(world.worker.running).toBe(true);
  });
});
