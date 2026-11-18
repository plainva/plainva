import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { followDailyNaming } from "@plainva/ui";

/**
 * Open task lists follow a changed daily-note naming (follow-up of B10,
 * release 0.9.0): a new folder or format makes other notes daily notes, so
 * their tasks' journal stamps and their rows' `file.day` change. Before, the
 * desktop kept the lists until a reload and the phone kept the naming it had
 * opened the vault with.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const source = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("followDailyNaming", () => {
  it("sets the naming first without a reload, then reloads only on a change", () => {
    const applied: Array<((path: string) => string | null) | null> = [];
    const follow = followDailyNaming((resolver) => applied.push(resolver));
    expect(follow({ folder: "Daily", format: "YYYY-MM-DD" })).toBe(false);
    expect(applied).toHaveLength(1);
    expect(applied[0]!("Daily/2026-11-16.md")).toBe("2026-11-16");
    // The same naming again (another setting was saved): nothing to do.
    expect(follow({ folder: " Daily ", format: "YYYY-MM-DD" })).toBe(false);
    expect(applied).toHaveLength(1);
    // Another folder: other notes are daily notes now.
    expect(follow({ folder: "Journal", format: "YYYY-MM-DD" })).toBe(true);
    expect(applied).toHaveLength(2);
    expect(applied[1]!("Daily/2026-11-16.md")).toBeNull();
    expect(applied[1]!("Journal/2026-11-16.md")).toBe("2026-11-16");
    // No format: no daily notes at all, and that is a change too.
    expect(follow({ folder: "Journal", format: "" })).toBe(true);
    expect(applied[2]).toBeNull();
  });
});

describe("both shells follow it", () => {
  it("the desktop reloads its views when a saved naming changed", () => {
    const hook = source("apps/desktop/src/hooks/useDayBoundary.ts");
    expect(hook).toMatch(/followDailyNaming\(/);
    expect(hook).toMatch(/if \(alive && follow\(naming\)\) refresh\(\);/);
  });

  it("every desktop window that shows task lists or databases follows it, the auxiliary one too (review 17.11.)", () => {
    // AppShell draws the main and every full window; AuxApp draws TasksView and BaseViewer in an auxiliary one.
    expect(source("apps/desktop/src/components/AuxPane.tsx")).toMatch(/TasksView|BaseViewer/);
    for (const shell of ["apps/desktop/src/AppShell.tsx", "apps/desktop/src/AuxApp.tsx"]) expect(source(shell)).toMatch(/\buseDayBoundary\(\);/);
  });

  it("the phone follows the settings while the vault is open, and stops with it", () => {
    const vault = source("apps/mobile/src/services/vaultService.ts");
    expect(vault).toMatch(/followDailyNaming\(/);
    expect(vault).toMatch(/window\.addEventListener\("m-settings-changed", onSettings\)/);
    expect(vault).toMatch(/if \(follow\(naming\(\)\)\) window\.dispatchEvent\(new CustomEvent\("m-vault-changed"\)\)/);
    expect(vault).toMatch(/dispose: async \(\) => \{\n\s*stopFollowingNaming\(\);/);
  });
});
