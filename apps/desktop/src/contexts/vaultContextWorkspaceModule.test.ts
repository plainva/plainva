import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The encrypted workspace's module loads on demand (performance plan L5), and `workspaceModuleNow()` hands it over
 * synchronously — so only where a workspace runtime is there, which the vault open makes after the module loaded
 * (review of L5, 2026-11-25). The check for a workspace to join asked it in a vault with a plain sync, threw, and
 * found no workspace there.
 */
const SOURCE = readFileSync(join(__dirname, "VaultContext.tsx"), "utf8");

/** The name of the `const name = (…) => {` function a position stands in. */
function enclosing(at: number): string {
  const before = SOURCE.slice(0, at);
  const all = [...before.matchAll(/\n\s*const (\w+) = (?:async )?\([^)]*\)(?:: [^=]+)? => \{/g)];
  return all[all.length - 1]?.[1] ?? "?";
}

describe("the workspace's module in the vault context", () => {
  it("is taken synchronously only behind a workspace runtime", () => {
    expect.hasAssertions();
    const users = [...SOURCE.matchAll(/workspaceModuleNow\(\)/g)].map((m) => enclosing(m.index!));
    expect(users.length).toBeGreaterThan(0);
    expect([...new Set(users)].sort()).toEqual(["quarantineService", "workspaceControlPlane"]);
    // The control plane checks the runtime before it asks.
    expect(SOURCE).toMatch(/const workspaceControlPlane = \(\) => \{[\s\S]*?!runtime[\s\S]*?throw new Error\("workspace-unavailable-or-locked"\);[\s\S]*?workspaceModuleNow\(\)/);
    // The quarantine service goes through the control plane first.
    expect(SOURCE).toMatch(/const quarantineService = \(\) => \{\s*const \{ workspaceState \} = workspaceControlPlane\(\);/);
  });

  it("is loaded before the vault open hands out the runtime", () => {
    expect.hasAssertions();
    expect(SOURCE).toMatch(/if \(workspaceSecurityStatus\) await workspaceModule\(\);\s*workspacePlaneVaultRef\.current = path;\s*workspaceRuntimeRef\.current = workspaceRuntime;/);
  });

  it("is awaited by the join, whose vault has no workspace yet", () => {
    expect.hasAssertions();
    expect(SOURCE).toMatch(/const joinObjectStore = async \(\) => \{[\s\S]*?await workspaceModule\(\)/);
    expect(SOURCE).not.toMatch(/[^.\w]joinObjectStore\(\)\.store/);
  });
});

describe("the sync's modules in the vault open", () => {
  it("load once, before the open's checks — never between a check and what it guards", () => {
    expect.hasAssertions();
    expect([...SOURCE.matchAll(/await syncModules\(\)/g)]).toHaveLength(1);
    expect(SOURCE).toMatch(/const sync = await syncModules\(\);\s*const syncQueue = new sync\.SyncQueue\(dbAdapter\);/);
    expect(SOURCE).not.toMatch(/new \(await workspaceModule\(\)\)\.EncryptedWorkspaceWorker/);
  });
});
