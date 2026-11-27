import { beforeEach, describe, expect, it, vi } from "vitest";
import { SqlWorkspaceStateStore } from "@plainva/core/workspace";
import type { MobileVault } from "./vaultService";

/**
 * Leaving the workspace as the Security area runs it (`workspaceLeaving.ts`),
 * without a screen (review B2, round 10, MG5): which state is cleared, what is
 * recorded as asked for, when the vault opens anew, which row is shown.
 */

const m = vi.hoisted(() => ({
  decommissioned: [] as Array<{ vaultId: string; state: unknown; runtime: unknown; intent?: string; stopSync: () => Promise<unknown>; passedGate?: () => void }>,
  /** Where the stand-in decommission fails: before its gate, or past it. */
  failAt: "before the gate" as "before the gate" | "past the gate",
  retired: [] as unknown[],
  lifted: [] as string[],
  unfinished: null as null | "decommission" | "lift",
  steps: [] as Array<{ reload?: { own: string; afterFailure?: () => Promise<boolean> } }>,
  /** The runtime the step's stop answers (a renew after the deadline answers another). */
  stopAnswers: null as unknown,
  failWith: null as Error | null,
}));

vi.mock("./mobileWorkspaceSecurity", () => ({
  decommissionMobileWorkspace: async (input: { vaultId: string; state: unknown; runtime: unknown; intent?: string; stopSync: () => Promise<{ state: unknown } | null>; passedGate?: () => void }) => {
    m.decommissioned.push(input);
    const renewed = await input.stopSync();
    if (renewed) m.decommissioned[m.decommissioned.length - 1]!.state = renewed.state;
    if (m.failWith && m.failAt === "before the gate") throw m.failWith;
    input.passedGate?.();
    if (m.failWith) throw m.failWith;
  },
  markMobileEncryptionLift: async (vaultId: string) => { m.lifted.push(vaultId); },
  mobileDecommissionUnfinished: async () => m.unfinished,
}));
vi.mock("./syncService", () => ({
  retireWorkspaceRuntime: (runtime: unknown) => { m.retired.push(runtime); },
  withRuntimeStep: async (_step: unknown, run: { work(stop: () => Promise<unknown>): Promise<unknown>; reload?: { own: string; afterFailure?: () => Promise<boolean> } }) => {
    m.steps.push(run);
    return run.work(async () => m.stopAnswers);
  },
}));

import { leaveWorkspaceStep, unfinishedLeavingText, workspaceStateOf } from "./workspaceLeaving";

const db = { execute: async () => undefined, query: async () => [], queryOne: async () => null } as never;
function vaultOf(over: Partial<MobileVault> = {}): MobileVault {
  const enqueued: string[] = [];
  return { vaultId: "v1", db, workspaceState: null, workspaceRuntime: null, syncQueue: { enqueueAllLocalFiles: async () => { enqueued.push("all"); } }, enqueued, ...over } as unknown as MobileVault;
}

beforeEach(() => {
  m.decommissioned.length = 0;
  m.lifted.length = 0;
  m.steps.length = 0;
  m.unfinished = null;
  m.failWith = null;
  m.failAt = "before the gate";
  m.retired.length = 0;
  m.stopAnswers = null;
});

describe("leaving the workspace from the Security area", () => {
  it("N8: pressed again on a vault that opened without its workspace, it clears the state in the vault's database", async () => {
    expect.hasAssertions();
    const vault = vaultOf();
    m.stopAnswers = vault;
    await leaveWorkspaceStep(vault, "decommission");
    expect(m.decommissioned[0]!.state, "THE DEFECT (N8): only the runtime's state, none here").toBeInstanceOf(SqlWorkspaceStateStore);
    expect(workspaceStateOf({ workspaceState: null, db: null })).toBeNull();
  });

  it("N10: where the step had to open the vault anew, it goes on with the new runtime's state — from its database too", async () => {
    expect.hasAssertions();
    const vault = vaultOf();
    const fresh = vaultOf();
    m.stopAnswers = fresh;
    await leaveWorkspaceStep(vault, "decommission");
    expect(m.decommissioned[0]!.state).toBeInstanceOf(SqlWorkspaceStateStore);
  });

  it("N9: a lift records that it was a lift, queues every file and marks itself; a decommission does neither", async () => {
    expect.hasAssertions();
    const lifting = vaultOf();
    m.stopAnswers = lifting;
    await leaveWorkspaceStep(lifting, "lift");
    expect(m.decommissioned[0]!.intent).toBe("lift");
    expect((lifting as unknown as { enqueued: string[] }).enqueued).toEqual(["all"]);
    expect(m.lifted).toEqual(["v1"]);
    const leaving = vaultOf();
    m.stopAnswers = leaving;
    await leaveWorkspaceStep(leaving, "decommission");
    expect(m.decommissioned[1]!.intent).toBe("decommission");
    expect((leaving as unknown as { enqueued: string[] }).enqueued).toEqual([]);
    expect(m.lifted).toEqual(["v1"]);
  });

  it("SP1: a failure past the gate opens the vault anew, and the runtime is retired the moment the gate opens", async () => {
    expect.hasAssertions();
    const vault = vaultOf();
    m.stopAnswers = vault;
    m.failWith = new Error("keychain locked");
    m.failAt = "past the gate";
    await expect(leaveWorkspaceStep(vault, "decommission")).rejects.toThrow("keychain locked");
    expect(m.retired, "never a sync again on the runtime past the gate").toEqual([vault]);
    expect(await m.steps[0]!.reload!.afterFailure!(), "opened anew").toBe(true);
    expect(m.steps[0]!.reload!.own).toBe("security-area");
  });

  it("a failure before the gate reloads nothing and retires nothing: the workspace is whole", async () => {
    expect.hasAssertions();
    const vault = vaultOf();
    m.stopAnswers = vault;
    m.failWith = new Error("the keystore refused");
    await expect(leaveWorkspaceStep(vault, "decommission")).rejects.toThrow();
    expect(m.retired).toEqual([]);
    expect(await m.steps[0]!.reload!.afterFailure!()).toBe(false);
  });

  it("round 11: a lift whose decommission finished (its fact removed) and whose queueing then fails still opens the vault anew — past the gate, not while the fact stands", async () => {
    expect.hasAssertions();
    const vault = vaultOf({ syncQueue: { enqueueAllLocalFiles: async () => { throw new Error("the queue is closed"); } } } as never);
    m.stopAnswers = vault;
    m.unfinished = null;
    await expect(leaveWorkspaceStep(vault, "lift")).rejects.toThrow("the queue is closed");
    expect(m.retired).toEqual([vault]);
    // THE DEFECT (round 11): "does the fact still stand?" said no, nothing reloaded, and the release gave the sync back
    // to the runtime with the workspace in memory.
    expect(await m.steps[0]!.reload!.afterFailure!()).toBe(true);
  });

  it("a runtime renewed within the step is the one retired", async () => {
    expect.hasAssertions();
    const vault = vaultOf();
    const fresh = vaultOf();
    m.stopAnswers = fresh;
    await leaveWorkspaceStep(vault, "decommission");
    expect(m.retired).toEqual([fresh]);
  });

  it("N7: the row shows what was asked for, and only where a decommission passed its gate and stopped", async () => {
    expect.hasAssertions();
    expect(await unfinishedLeavingText("v1")).toBeNull();
    m.unfinished = "decommission";
    expect(await unfinishedLeavingText("v1")).toBe("workspaceSecurity.decommissionUnfinished");
    m.unfinished = "lift";
    expect(await unfinishedLeavingText("v1")).toBe("workspaceSecurity.liftUnfinished");
  });

  it("the screen shows that row with its button, and runs both buttons through this step", async () => {
    expect.hasAssertions();
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const screen = readFileSync(resolve("src/screens/SecurityAreaScreen.tsx"), "utf8");
    expect(screen).toContain('setUnfinished(await unfinishedLeavingText(vault.vaultId));');
    expect(screen).toMatch(/\{area === "overview" && !status && unfinished && \(/);
    expect(screen).toContain('await leaveWorkspaceStep(vault, "lift", ');
    expect(screen).toContain('await leaveWorkspaceStep(vault, "decommission", ');
    expect(screen).not.toMatch(/decommissionMobileWorkspace\(/);
  });
});
