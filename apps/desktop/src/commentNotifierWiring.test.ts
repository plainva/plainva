import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Where each shell hands the remark notifier its answers (plan Befunde 24.09.,
 * E7). The cycle and the two notifiers have behaviour tests; what regresses
 * silently is the registration: `isLocked` was declared in both notifier
 * interfaces for months and neither shell ever passed it. These are SOURCE
 * assertions on purpose — booting either shell to see a registration is not
 * a unit test.
 */
const SRC = fileURLToPath(new URL(".", import.meta.url));
const read = (...p: string[]) => readFileSync(join(SRC, ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the notifier's answers are registered with the lock and the vault", () => {
  it("desktop: the shell registers its vault, the lock from store and workspace phase, and releases only its own", () => {
    const shell = strip(read("AppShell.tsx"));
    const at = shell.indexOf("setCommentNotifierDeps({");
    expect(at).toBeGreaterThan(-1);
    const registration = shell.slice(at, at + 1200);
    expect(registration).toMatch(/\bvaultPath,/);
    expect(registration).toMatch(/lockState: async \(\) => commentLockState\(\s*await getCommentStoreState\(\)/);
    expect(registration).toMatch(/workspacePhase !== null && workspacePhase !== "active"/);
    expect(shell).toMatch(/releaseCommentNotifierDeps\(vaultPath\)/);
    expect(shell).not.toMatch(/setCommentNotifierDeps\(null\)/);
  });

  it("phone: the hook registers its vault, the lock from store and workspace, and releases only its own", () => {
    const hook = strip(read("..", "..", "mobile", "src", "hooks", "useCommentNotifierDeps.ts"));
    expect(hook).toMatch(/vaultId: vault\.vaultId/);
    expect(hook).toMatch(/mobileCommentStoreState\(vault\)/);
    expect(hook).toMatch(/isMobileWorkspaceLocked\(vault\.vaultId\)/);
    expect(hook).toMatch(/commentLockState\(store, workspaceLocked\)/);
    expect(hook).toMatch(/releaseMobileCommentNotifierDeps\(own\)/);
    expect(hook).not.toMatch(/setMobileCommentNotifierDeps\(null\)/);
  });

  it("neither notifier keeps a lock question of its own", () => {
    for (const source of [read("services", "commentNotifier.ts"), read("..", "..", "mobile", "src", "services", "commentNotifier.ts")]) {
      const code = strip(source);
      expect(code).not.toMatch(/isLocked/);
      expect(code).toMatch(/runCommentNotificationCycle\(/);
    }
  });
});
